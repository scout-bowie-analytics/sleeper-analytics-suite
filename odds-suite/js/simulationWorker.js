/**
 * 🐾 SCOUT BOWIE NFL SURVIVOR MONTE CARLO SIMULATION WORKER
 * Runs 10,000 iterations off the main UI thread
 */

self.onmessage = function(e) {
  const { path: userPath, slateData, poolSize = 100, iterations = 10000, targetHorizon = 11 } = e.data;

  try {
    const results = runMonteCarloSimulation(userPath, slateData, poolSize, iterations, targetHorizon, (pct) => {
      self.postMessage({ type: 'progress', percent: pct });
    });
    self.postMessage({ type: 'complete', results });
  } catch (err) {
    self.postMessage({ type: 'error', error: err.message });
  }
};

function runMonteCarloSimulation(userPath, slateData, poolSize, iterations, targetHorizon, progressCb) {
  const userPicksByWeek = {};
  userPath.forEach(p => {
    userPicksByWeek[p.week] = p.teamCode;
  });

  const totalPoolSize = Math.max(2, Math.min(10000, Number(poolSize) || 100));
  const numOpponents = totalPoolSize - 1;

  let totalWinEquity = 0;
  let userSurvivedHorizon = 0;
  let userSurvived18 = 0;

  const poolEndWeeks = [];
  const reportInterval = Math.max(500, Math.floor(iterations / 20));

  for (let iter = 1; iter <= iterations; iter++) {
    if (progressCb && iter % reportInterval === 0) {
      progressCb(Math.round((iter / iterations) * 100));
    }

    let userAlive = true;
    let opponentsAlive = numOpponents;
    let poolFinishWeek = 18;
    let poolEndedEarly = false;

    for (let w = 1; w <= 18; w++) {
      const weekData = slateData.find(s => s.week === w);
      if (!weekData) continue;

      // 1. Simulate game outcomes for week w
      const gameOutcomes = {};
      weekData.games.forEach(g => {
        const homeWon = Math.random() < g.homeWinProb;
        gameOutcomes[g.homeTeam] = homeWon;
        gameOutcomes[g.awayTeam] = !homeWon;
      });

      // 2. Check user pick
      const myTeam = userPicksByWeek[w];
      const userSurvivesThisWeek = (myTeam && myTeam !== '—' && gameOutcomes[myTeam] === true);

      // 3. Simulate opponent pool picks & survival
      let survivingOpponents = 0;
      if (opponentsAlive > 0) {
        const pickDistribution = [];
        let cumPct = 0;
        weekData.games.forEach(g => {
          cumPct += g.homePickPct;
          pickDistribution.push({ team: g.homeTeam, cumPct, won: gameOutcomes[g.homeTeam] });
          cumPct += g.awayPickPct;
          pickDistribution.push({ team: g.awayTeam, cumPct, won: gameOutcomes[g.awayTeam] });
        });

        for (let opp = 0; opp < opponentsAlive; opp++) {
          const r = Math.random() * (cumPct || 1.0);
          const picked = pickDistribution.find(p => r <= p.cumPct) || pickDistribution[pickDistribution.length - 1];
          if (picked && picked.won) {
            survivingOpponents++;
          }
        }
      }

      // Check if user survived through the designated target horizon
      if (w === targetHorizon && userAlive && userSurvivesThisWeek) {
        userSurvivedHorizon++;
      }

      // 4. Resolve week outcomes & pool termination
      if (userAlive && !userSurvivesThisWeek) {
        userAlive = false;
        if (survivingOpponents === 0 && opponentsAlive > 0) {
          // Everyone died in this same week: split pot
          totalWinEquity += (1 / (1 + opponentsAlive));
          poolFinishWeek = w;
          poolEndedEarly = true;
          break;
        }
      } else if (userAlive && userSurvivesThisWeek) {
        if (survivingOpponents === 0) {
          // User solo win!
          totalWinEquity += 1.0;
          poolFinishWeek = w;
          poolEndedEarly = true;
          break;
        }
      }

      opponentsAlive = survivingOpponents;

      if (!userAlive && opponentsAlive === 0) {
        poolFinishWeek = w;
        poolEndedEarly = true;
        break;
      }
    }

    if (!poolEndedEarly) {
      poolFinishWeek = 18;
      if (userAlive) {
        userSurvived18++;
        totalWinEquity += (1 / (1 + opponentsAlive));
      }
    }

    poolEndWeeks.push(poolFinishWeek);
  }

  // Calculate stats
  poolEndWeeks.sort((a, b) => a - b);
  const medianPoolEnd = poolEndWeeks[Math.floor(poolEndWeeks.length / 2)];
  const avgPoolEnd = Number((poolEndWeeks.reduce((a, b) => a + b, 0) / iterations).toFixed(1));

  const winEquityPct = Number(((totalWinEquity / iterations) * 100).toFixed(2));
  const randomBaselinePct = Number(((1 / totalPoolSize) * 100).toFixed(2));
  const edgeMultiple = Number((winEquityPct / Math.max(0.001, randomBaselinePct)).toFixed(1));

  const horizonSurvivalPct = Number(((userSurvivedHorizon / iterations) * 100).toFixed(1));
  const fullSeasonSurvivalPct = Number(((userSurvived18 / iterations) * 100).toFixed(2));

  return {
    iterations,
    poolSize: totalPoolSize,
    winEquityPct,
    randomBaselinePct,
    edgeMultiple,
    expectedPoolEndWeek: avgPoolEnd,
    medianPoolEndWeek: medianPoolEnd,
    picksNeededToWin: Math.round(avgPoolEnd),
    horizonSurvivalPct,
    fullSeasonSurvivalPct,
    targetHorizon
  };
}
