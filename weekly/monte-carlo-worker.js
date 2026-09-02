/**
 * Scout Bowie In-Game Monte Carlo Web Worker
 * Performs 10,000 randomized iterations with Brownian Bridge time-decay variance modeling.
 * Runs completely off the main UI thread with zero UI freezing.
 */

self.onmessage = function(e) {
  const data = e.data;
  if (!data) return;

  if (data.action === 'SIMULATE') {
    const startTime = performance.now();
    const { userStarters = [], oppStarters = [], numIterations = 10000, context = {} } = data;

    const results = runInGameMonteCarlo(userStarters, oppStarters, numIterations, context);
    const endTime = performance.now();
    results.executionTimeMs = Number((endTime - startTime).toFixed(1));
    results.jobId = data.jobId;

    self.postMessage({ action: 'SIMULATION_COMPLETE', results });
  }
};

/**
 * Perform in-game Monte Carlo simulation
 */
function runInGameMonteCarlo(userStarters, oppStarters, numIterations, context) {
  // Pre-calculate distribution parameters for all starters
  const userParams = userStarters.map(p => resolvePlayerSimParams(p, context));
  const oppParams = oppStarters.map(p => resolvePlayerSimParams(p, context));

  let userWins = 0;
  let oppWins = 0;
  let ties = 0;

  const userSimTotals = new Float32Array(numIterations);
  const oppSimTotals = new Float32Array(numIterations);

  for (let i = 0; i < numIterations; i++) {
    let uTotal = 0;
    for (let j = 0; j < userParams.length; j++) {
      uTotal += samplePlayerOutcome(userParams[j]);
    }
    userSimTotals[i] = uTotal;

    let oTotal = 0;
    for (let j = 0; j < oppParams.length; j++) {
      oTotal += samplePlayerOutcome(oppParams[j]);
    }
    oppSimTotals[i] = oTotal;

    if (uTotal > oTotal) {
      userWins++;
    } else if (oTotal > uTotal) {
      oppWins++;
    } else {
      ties++;
    }
  }

  // Calculate statistics (mean, median, floor, ceiling, stdDev)
  const userStats = computeSeriesStats(userSimTotals);
  const oppStats = computeSeriesStats(oppSimTotals);

  const winProbability = Number(((userWins + ties * 0.5) / numIterations * 100).toFixed(1));
  const oppWinProbability = Number((100 - winProbability).toFixed(1));
  const spread = Number((userStats.median - oppStats.median).toFixed(1));
  const totalOverUnder = Number((userStats.mean + oppStats.mean).toFixed(1));

  return {
    winProbability,
    oppWinProbability,
    spread,
    totalOverUnder,
    userStats,
    oppStats,
    sampleCount: numIterations
  };
}

/**
 * Resolve player simulation parameters with in-game time decay
 */
function resolvePlayerSimParams(player, context) {
  const bankedPts = Number(player.points_scored ?? player.points_banked ?? player.actual_pts ?? player.actual_points ?? 0);
  const gameState = player.gameState ?? (player.is_final ? 'FINAL' : (player.is_live ? 'IN_PROGRESS' : 'UPCOMING'));

  // 1. FINAL GAME: Zero variance, exact banked points
  if (gameState === 'FINAL' || player.is_final || player.isFinal) {
    return {
      type: 'FINAL',
      bankedPts,
      remainingMean: 0,
      remainingVariance: 0,
      shape: 'deterministic'
    };
  }

  // 2. Base projection and variance baseline
  const baseMean = Number(player.projected_pts ?? player.proj ?? player.mean ?? 10.0);
  const pos = String(player.position || 'FLEX').toUpperCase();

  // Baseline standard deviation by position
  let baseStdDev = 4.5;
  if (pos === 'QB') baseStdDev = 6.2;
  else if (pos === 'RB') baseStdDev = 5.2;
  else if (pos === 'WR') baseStdDev = 5.8;
  else if (pos === 'TE') baseStdDev = 4.2;
  else if (pos === 'K') baseStdDev = 3.5;
  else if (pos === 'DEF') baseStdDev = 4.0;

  // 3. IN-PROGRESS GAME: Brownian Bridge square-root time decay
  if (gameState === 'IN_PROGRESS' || player.is_live || player.isLive) {
    // Fraction of game remaining [0.0, 1.0]
    let remFraction = (typeof player.remainingFraction === 'number') 
      ? player.remainingFraction 
      : computeRemainingFractionFromQuarterClock(player.gameQuarter, player.gameClock);

    remFraction = Math.max(0.0, Math.min(1.0, remFraction));

    // Time decay: linear for remaining mean, square-root for remaining variance (Brownian bridge)
    const remainingMean = baseMean * remFraction;
    const remainingStdDev = baseStdDev * Math.sqrt(remFraction);

    return {
      type: 'IN_PROGRESS',
      bankedPts,
      remainingMean,
      remainingStdDev,
      remFraction,
      shape: 'lognormal'
    };
  }

  // 4. UPCOMING GAME: Full baseline distribution
  return {
    type: 'UPCOMING',
    bankedPts: 0,
    remainingMean: baseMean,
    remainingStdDev: baseStdDev,
    remFraction: 1.0,
    shape: 'lognormal'
  };
}

/**
 * Sample a randomized outcome from the player distribution
 */
function samplePlayerOutcome(params) {
  if (params.type === 'FINAL' || params.remainingMean <= 0.05) {
    return params.bankedPts;
  }

  // Box-Muller standard normal transform
  const u1 = Math.max(1e-7, Math.random());
  const u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);

  // Sample using skewed lognormal-like distribution with non-negative lower bound
  const mean = params.remainingMean;
  const std = params.remainingStdDev;
  
  // Shifted normal with zero floor
  const sampledRemaining = Math.max(0, mean + z0 * std);
  return params.bankedPts + sampledRemaining;
}

/**
 * Estimate game fraction remaining from quarter & clock string (e.g. "3Q", "8:45")
 */
function computeRemainingFractionFromQuarterClock(quarter, clock) {
  if (!quarter) return 0.5; // Default halftime if unspecified
  const qStr = String(quarter).toUpperCase();
  
  let qNum = 1;
  if (qStr.includes('1')) qNum = 1;
  else if (qStr.includes('2') || qStr.includes('HALF')) qNum = 2;
  else if (qStr.includes('3')) qNum = 3;
  else if (qStr.includes('4')) qNum = 4;
  else if (qStr.includes('OT')) qNum = 4.5;

  let minsInQuarter = 7.5;
  if (clock && String(clock).includes(':')) {
    const parts = String(clock).split(':');
    const m = parseInt(parts[0], 10) || 0;
    const s = parseInt(parts[1], 10) || 0;
    minsInQuarter = Math.max(0, Math.min(15, m + s / 60));
  }

  // Total minutes remaining out of 60
  const totalMinsLeft = Math.max(0, (4 - qNum) * 15 + minsInQuarter);
  return totalMinsLeft / 60.0;
}

/**
 * Compute statistical summaries for a sample array
 */
function computeSeriesStats(arr) {
  const sorted = Array.from(arr).sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return { mean: 0, median: 0, floor10: 0, ceiling90: 0, stdDev: 0 };

  let sum = 0;
  for (let i = 0; i < n; i++) sum += sorted[i];
  const mean = Number((sum / n).toFixed(2));

  const median = Number((sorted[Math.floor(n * 0.5)]).toFixed(2));
  const floor10 = Number((sorted[Math.floor(n * 0.10)]).toFixed(2));
  const ceiling90 = Number((sorted[Math.floor(n * 0.90)]).toFixed(2));

  let varSum = 0;
  for (let i = 0; i < n; i++) {
    const diff = sorted[i] - mean;
    varSum += diff * diff;
  }
  const stdDev = Number(Math.sqrt(varSum / n).toFixed(2));

  return { mean, median, floor10, ceiling90, stdDev };
}
