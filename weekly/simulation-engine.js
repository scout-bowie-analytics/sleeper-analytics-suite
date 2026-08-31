/**
 * QUANTITATIVE SIMULATION & LINEUP OPTIMIZATION ENGINE
 * 
 * Features:
 * - Strict immutable slot index template ordering
 * - Strict positional eligibility validation per slot
 * - 10,000-iteration Monte Carlo win-probability simulation using TypedArrays
 * - Right-skewed Log-Normal distribution modeling with archetype priors
 * - Floor (10th percentile), Median (50th), and Ceiling (90th percentile) calculations
 * - Floor vs. Ceiling strategy slider weighting
 * - Fixed-index roster constraint solver for Sleeper league configurations
 */

import { getGameScheduleInfo } from '../shared/js/nfl-schedule.js';

// Positional Variance & Skew Prior Profiles
export const POSITION_PROFILES = {
  QB: { cv: 0.28, skew: 1.1, name: "Quarterback", flexEligible: false },
  RB: { cv: 0.42, skew: 1.7, name: "Running Back", flexEligible: true },
  WR: { cv: 0.40, skew: 1.6, name: "Wide Receiver", flexEligible: true },
  TE: { cv: 0.48, skew: 2.1, name: "Tight End", flexEligible: true },
  FLEX: { cv: 0.42, skew: 1.7, name: "Flex (RB/WR/TE)", flexEligible: true },
  SUPER_FLEX: { cv: 0.35, skew: 1.3, name: "SuperFlex (QB/RB/WR/TE)", flexEligible: true },
  K: { cv: 0.36, skew: 1.2, name: "Kicker", flexEligible: false },
  DEF: { cv: 0.54, skew: 1.5, name: "Defense / ST", flexEligible: false }
};

/**
 * Check if a player position is strictly eligible for a given slot
 */
export function isPlayerEligibleForSlot(position, slotType) {
  if (!position || !slotType) return false;
  const p = String(position).toUpperCase().trim();
  const s = String(slotType).toUpperCase().trim();
  
  if (s === p) return true;
  if (s === 'FLEX' || s === 'WRRB_FLEX' || s === 'REC_FLEX') {
    return ['RB', 'WR', 'TE'].includes(p);
  }
  if (s === 'WR_RB' || s === 'RB_WR') {
    return ['RB', 'WR'].includes(p);
  }
  if (s === 'WR_TE' || s === 'TE_WR') {
    return ['WR', 'TE'].includes(p);
  }
  if (s === 'SUPER_FLEX' || s === 'OP') {
    return ['QB', 'RB', 'WR', 'TE'].includes(p);
  }
  if (s === 'BN' || s === 'BENCH') {
    return true;
  }
  return false;
}

/**
 * Get human-readable eligible slots list for a player bound dynamically to league roster settings
 */
export function getEligibleSlotsForPosition(position, leagueRosterPositions = null) {
  const p = String(position || 'FLEX').toUpperCase().trim();

  // If active roster positions are provided from Sleeper league settings:
  if (Array.isArray(leagueRosterPositions) && leagueRosterPositions.length > 0) {
    const uniqueSlots = Array.from(new Set(leagueRosterPositions))
      .filter(s => !['BN', 'BENCH', 'IR', 'TAXI', 'RESERVE'].includes(s));

    // Return only active league slots that this player is strictly eligible for
    const activeEligible = uniqueSlots.filter(s => isPlayerEligibleForSlot(p, s));
    if (activeEligible.length > 0) {
      return activeEligible;
    }
  }

  // Fallback default if league positions are not available
  if (p === 'QB') return ['QB'];
  if (p === 'RB') return ['RB', 'FLEX'];
  if (p === 'WR') return ['WR', 'FLEX'];
  if (p === 'TE') return ['TE', 'FLEX'];
  if (p === 'K') return ['K'];
  if (p === 'DEF') return ['DEF'];
  return ['FLEX'];
}

/**
 * Standard Normal Random Variate (Box-Muller Transform)
 */
function randomStandardNormal() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

export const INACTIVE_STATUSES = ['PUP', 'IR', 'OUT', 'SUS', 'COV', 'DNR', 'INJURED_RESERVE', 'SUSPENDED', 'IR-R', 'NA'];

/**
 * Calculate player distribution parameters and percentiles (supports UPCOMING, IN_PROGRESS, and FINAL states)
 */
export function calculatePlayerDistributions(player) {
  const pos = player.position || 'FLEX';
  const profile = POSITION_PROFILES[pos] || POSITION_PROFILES['FLEX'];

  const injStatus = String(player?.injury_status || '').toUpperCase().trim();
  const pointsScored = Number(player.points_scored ?? player.actual_pts ?? player.points_banked ?? player.actual_points ?? 0);
  const baseMean = Math.max(0.5, Number(player.base_projected_pts ?? player.projected_pts ?? player.points ?? player.projected_points) || 10.0);
  const isInactive = INACTIVE_STATUSES.includes(injStatus) || (Number(player?.projected_pts ?? player?.points ?? 10) === 0 && pointsScored === 0);

  const isFinal = Boolean(player.isFinal || player.is_final || (player.gameState === 'FINAL' && pointsScored > 0));
  const isLive = Boolean(player.isLive || player.is_live || player.gameState === 'IN_PROGRESS');
  const gameState = isFinal ? 'FINAL' : (isLive ? 'IN_PROGRESS' : (player.gameState === 'FINAL' && pointsScored > 0 ? 'FINAL' : (player.gameState === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'UPCOMING')));

  // 1. FINAL Game State: Lock player's points to actual final score, collapse Floor & Ceiling to final points, zero variance
  if (gameState === 'FINAL' || isFinal) {
    const finalScore = Number(pointsScored.toFixed(1));
    return {
      ...player,
      gameState: 'FINAL',
      points_scored: finalScore,
      actual_pts: finalScore,
      points_banked: finalScore,
      actual_points: finalScore,
      proj: finalScore,
      floor: finalScore,
      ceil: finalScore,
      ceiling: finalScore,
      ceilingSurge: 0.0,
      mean: finalScore,
      projected_pts: finalScore,
      points: finalScore,
      projected_points: finalScore,
      cv: 0.0,
      muLn: finalScore > 0 ? Math.log(finalScore) : -Infinity,
      sigmaLn: 0,
      floor10: finalScore,
      p25: finalScore,
      median: finalScore,
      p75: finalScore,
      ceiling90: finalScore,
      boomRate: 0.0,
      bustRate: 0.0,
      remainingTimeFraction: 0,
      isInactive: false,
      isFinal: true,
      is_final: true,
      is_live: false,
      isLive: false
    };
  }

  // 2. Inactive Status Guardrail: Force 0 projections & distributions
  if (isInactive && pointsScored === 0) {
    return {
      ...player,
      gameState: gameState || 'UPCOMING',
      points_scored: 0.0,
      proj: 0.0,
      floor: 0.0,
      ceil: 0.0,
      ceilingSurge: 0.0,
      mean: 0.0,
      projected_pts: 0.0,
      cv: 0.0,
      muLn: -Infinity,
      sigmaLn: 0,
      floor10: 0.0,
      p25: 0.0,
      median: 0.0,
      p75: 0.0,
      ceiling90: 0.0,
      boomRate: 0.0,
      bustRate: 100.0,
      remainingTimeFraction: 0,
      isInactive: true,
      isFinal: false
    };
  }

  const cv = player.variance || profile.cv;

  // 3. IN_PROGRESS Game State: Locked Banked Points + Time-Scaled Remaining Variance
  if (gameState === 'IN_PROGRESS') {
    let r = typeof player.remainingFraction === 'number' ? player.remainingFraction : 0.5; // default 50% remaining if not specified
    if (player.gameSchedule?.period) {
      const period = player.gameSchedule.period; // 1, 2, 3, 4, 5
      const clockStr = player.gameSchedule.displayClock || '15:00';
      const [mStr, sStr] = clockStr.split(':');
      const mins = (parseInt(mStr, 10) || 0) + (parseInt(sStr, 10) || 0) / 60;
      const quarterMinsRemaining = Math.max(0, Math.min(15, mins));
      const totalMinsRemaining = Math.max(0, (4 - period) * 15 + quarterMinsRemaining);
      r = Math.max(0.02, Math.min(1.0, totalMinsRemaining / 60));
    }

    const remainingExpected = Math.max(0.1, r * baseMean);
    const totalLiveMean = pointsScored + remainingExpected;

    // Remaining uncertainty narrows with square-root of remaining time
    const remainingSigmaLn = Math.sqrt(Math.log(1 + cv * cv)) * Math.sqrt(r);
    const remainingMuLn = Math.log(remainingExpected) - 0.5 * remainingSigmaLn * remainingSigmaLn;

    const remainingFloor10 = Math.max(0, Math.exp(remainingMuLn - 1.28155 * remainingSigmaLn));
    const remainingP25 = Math.max(0, Math.exp(remainingMuLn - 0.67449 * remainingSigmaLn));
    const remainingMedian = Math.exp(remainingMuLn);
    const remainingP75 = Math.exp(remainingMuLn + 0.67449 * remainingSigmaLn);
    const remainingCeiling90 = Math.exp(remainingMuLn + 1.28155 * remainingSigmaLn);

    const liveFloor10 = pointsScored + remainingFloor10;
    const liveMedian = pointsScored + remainingMedian;
    const liveCeiling90 = pointsScored + remainingCeiling90;

    const ceilingSurge = Math.max(0, liveCeiling90 - totalLiveMean);

    const normalCDF = (z) => 0.5 * (1 + Math.erf(z / Math.SQRT2));
    const zBoom = (Math.log(Math.max(0.1, baseMean * 1.35)) - remainingMuLn) / remainingSigmaLn;
    const zBust = (Math.log(Math.max(0.1, baseMean * 0.60)) - remainingMuLn) / remainingSigmaLn;

    const boomRate = Math.max(0.01, Math.min(0.99, 1 - normalCDF(zBoom)));
    const bustRate = Math.max(0.01, Math.min(0.99, normalCDF(zBust)));

    return {
      ...player,
      gameState: 'IN_PROGRESS',
      points_scored: Number(pointsScored.toFixed(1)),
      remaining_expected: Number(remainingExpected.toFixed(1)),
      remainingTimeFraction: r,
      proj: Number(totalLiveMean.toFixed(1)),
      floor: Number(liveFloor10.toFixed(1)),
      ceil: Number(liveCeiling90.toFixed(1)),
      ceilingSurge: Number(ceilingSurge.toFixed(1)),
      mean: Number(totalLiveMean.toFixed(1)),
      projected_pts: Number(totalLiveMean.toFixed(1)),
      cv: Number((cv * Math.sqrt(r)).toFixed(3)),
      muLn: remainingMuLn,
      sigmaLn: remainingSigmaLn,
      floor10: Number(liveFloor10.toFixed(1)),
      p25: Number((pointsScored + remainingP25).toFixed(1)),
      median: Number(liveMedian.toFixed(1)),
      p75: Number((pointsScored + remainingP75).toFixed(1)),
      ceiling90: Number(liveCeiling90.toFixed(1)),
      boomRate: Number((boomRate * 100).toFixed(1)),
      bustRate: Number((bustRate * 100).toFixed(1)),
      isInactive: false,
      isFinal: false
    };
  }

  // 4. Standard UPCOMING Game State
  const explicitFloor = (player.floor !== undefined && player.floor !== null && !isNaN(player.floor) && Number(player.floor) > 0) ? Number(player.floor) : null;
  const explicitCeil = (player.ceiling !== undefined && player.ceiling !== null && !isNaN(player.ceiling) && Number(player.ceiling) > 0) ? Number(player.ceiling) : null;

  let sigmaLn, muLn;
  if (explicitFloor !== null && explicitCeil !== null && explicitCeil > explicitFloor) {
    sigmaLn = (Math.log(explicitCeil) - Math.log(explicitFloor)) / (2 * 1.28155);
    muLn = (Math.log(explicitCeil) + Math.log(explicitFloor)) / 2;
  } else {
    sigmaLn = Math.sqrt(Math.log(1 + cv * cv));
    muLn = Math.log(baseMean) - 0.5 * sigmaLn * sigmaLn;
  }

  // Z-scores: 10th percentile (-1.28155), 25th (-0.67449), 75th (+0.67449), 90th (+1.28155)
  const floor10 = explicitFloor !== null ? explicitFloor : Math.max(0, Math.exp(muLn - 1.28155 * sigmaLn));
  const p25 = Math.max(0, Math.exp(muLn - 0.67449 * sigmaLn));
  const median = Math.exp(muLn);
  const p75 = Math.exp(muLn + 0.67449 * sigmaLn);
  const ceiling90 = explicitCeil !== null ? explicitCeil : Math.exp(muLn + 1.28155 * sigmaLn);

  // Boom (> 1.35x mean) and Bust (< 0.60x mean) probabilities
  const zBoom = (Math.log(baseMean * 1.35) - muLn) / sigmaLn;
  const zBust = (Math.log(Math.max(0.1, baseMean * 0.60)) - muLn) / sigmaLn;

  // Polyfill normal CDF
  const normalCDF = (z) => 0.5 * (1 + Math.erf(z / Math.SQRT2));
  const boomRate = Math.max(0.02, Math.min(0.95, 1 - normalCDF(zBoom)));
  const bustRate = Math.max(0.02, Math.min(0.95, normalCDF(zBust)));

  const ceilingSurge = Math.max(0, ceiling90 - baseMean);

  return {
    ...player,
    gameState: 'UPCOMING',
    points_scored: 0.0,
    points: Number(baseMean.toFixed(1)),
    projected_points: Number(baseMean.toFixed(1)),
    proj: Number(baseMean.toFixed(1)),
    floor: Number(floor10.toFixed(1)),
    ceil: Number(ceiling90.toFixed(1)),
    ceiling: Number(ceiling90.toFixed(1)),
    ceilingSurge: Number(ceilingSurge.toFixed(1)),
    mean: Number(baseMean.toFixed(1)),
    projected_pts: Number(baseMean.toFixed(1)),
    cv: Number((Math.sqrt(Math.exp(sigmaLn * sigmaLn) - 1)).toFixed(3)),
    muLn,
    sigmaLn,
    floor10: Number(floor10.toFixed(1)),
    p25: Number(p25.toFixed(1)),
    median: Number(median.toFixed(1)),
    p75: Number(p75.toFixed(1)),
    ceiling90: Number(ceiling90.toFixed(1)),
    boomRate: Number((boomRate * 100).toFixed(1)),
    bustRate: Number((bustRate * 100).toFixed(1)),
    remainingTimeFraction: 1.0,
    status: player.status || 'Active',
    game_status: player.game_status || (player.gameSchedule?.text || 'Sun 1:00 PM'),
    isInactive: false,
    isFinal: false
  };
}

/**
 * Polyfill / Helper for Error Function (Math.erf)
 */
if (!Math.erf) {
  Math.erf = function(x) {
    const a1 =  0.254829592;
    const a2 = -0.284496736;
    const a3 =  1.421413741;
    const a4 = -1.453152027;
    const a5 =  1.061405429;
    const p  =  0.3275911;

    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);

    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return sign * y;
  };
}

/**
 * Fast Random Draw from Player Log-Normal Distribution
 * Supports UPCOMING, IN_PROGRESS (banked + remaining sample), and FINAL (locked constant)
 */
export function samplePlayerScore(playerDist) {
  if (!playerDist || playerDist.isInactive) {
    return 0.0;
  }
  if (playerDist.gameState === 'FINAL' || playerDist.isFinal) {
    return Number(playerDist.points_scored ?? playerDist.actual_pts ?? playerDist.mean ?? 0);
  }
  if (playerDist.gameState === 'IN_PROGRESS') {
    const banked = Number(playerDist.points_scored ?? 0);
    if (!playerDist.muLn || !isFinite(playerDist.muLn) || playerDist.sigmaLn === 0) {
      return banked + Number(playerDist.remaining_expected ?? 0);
    }
    const z = randomStandardNormal();
    const sampledRemaining = Math.max(0, Math.exp(playerDist.muLn + playerDist.sigmaLn * z));
    return banked + sampledRemaining;
  }
  if (playerDist.mean === 0 || !playerDist.muLn || !isFinite(playerDist.muLn)) {
    return 0.0;
  }
  const z = randomStandardNormal();
  return Math.max(0, Math.exp(playerDist.muLn + playerDist.sigmaLn * z));
}

/**
 * 10,000-Iteration Monte Carlo Matchup Simulation
 */
export function runMonteCarloSimulation(userStarters, opponentStarters, iterations = 10000) {
  const startTime = performance.now();

  const userDists = (userStarters || []).map(calculatePlayerDistributions);
  const oppDists = (opponentStarters || []).map(calculatePlayerDistributions);

  const userScores = new Float32Array(iterations);
  const oppScores = new Float32Array(iterations);

  let userWins = 0;
  let ties = 0;

  for (let i = 0; i < iterations; i++) {
    let uTot = 0;
    for (let j = 0; j < userDists.length; j++) {
      uTot += samplePlayerScore(userDists[j]);
    }
    userScores[i] = uTot;

    let oTot = 0;
    for (let k = 0; k < oppDists.length; k++) {
      oTot += samplePlayerScore(oppDists[k]);
    }
    oppScores[i] = oTot;

    if (uTot > oTot) {
      userWins++;
    } else if (Math.abs(uTot - oTot) < 0.05) {
      ties++;
    }
  }

  const winProbability = ((userWins + ties * 0.5) / iterations) * 100;

  const sortedUser = Float32Array.from(userScores).sort();
  const sortedOpp = Float32Array.from(oppScores).sort();

  const getPercentile = (arr, p) => arr[Math.floor(p * (arr.length - 1))];

  const userStats = {
    mean: Number((userScores.reduce((a, b) => a + b, 0) / iterations).toFixed(2)),
    floor10: Number(getPercentile(sortedUser, 0.10).toFixed(2)),
    p25: Number(getPercentile(sortedUser, 0.25).toFixed(2)),
    median: Number(getPercentile(sortedUser, 0.50).toFixed(2)),
    p75: Number(getPercentile(sortedUser, 0.75).toFixed(2)),
    ceiling90: Number(getPercentile(sortedUser, 0.90).toFixed(2)),
    min: Number(sortedUser[0].toFixed(2)),
    max: Number(sortedUser[iterations - 1].toFixed(2))
  };

  const oppStats = {
    mean: Number((oppScores.reduce((a, b) => a + b, 0) / iterations).toFixed(2)),
    floor10: Number(getPercentile(sortedOpp, 0.10).toFixed(2)),
    p25: Number(getPercentile(sortedOpp, 0.25).toFixed(2)),
    median: Number(getPercentile(sortedOpp, 0.50).toFixed(2)),
    p75: Number(getPercentile(sortedOpp, 0.75).toFixed(2)),
    ceiling90: Number(getPercentile(sortedOpp, 0.90).toFixed(2)),
    min: Number(sortedOpp[0].toFixed(2)),
    max: Number(sortedOpp[iterations - 1].toFixed(2))
  };

  // Smooth Tail Clamping: Expand bounds so tails taper naturally to 0%
  const minRange = Math.max(30, Math.floor(Math.min(userStats.floor10, oppStats.floor10) - 25));
  const maxRange = Math.ceil(Math.max(userStats.ceiling90, oppStats.ceiling90) + 30);
  const binCount = 40;
  const binWidth = (maxRange - minRange) / binCount;

  const labels = [];
  const userDensity = new Array(binCount).fill(0);
  const oppDensity = new Array(binCount).fill(0);

  for (let b = 0; b < binCount; b++) {
    const binCenter = Math.round(minRange + (b + 0.5) * binWidth);
    labels.push(binCenter);
  }

  for (let i = 0; i < iterations; i++) {
    const uVal = userScores[i];
    const oVal = oppScores[i];

    if (uVal >= minRange && uVal < maxRange) {
      const uBin = Math.floor((uVal - minRange) / binWidth);
      if (uBin >= 0 && uBin < binCount) userDensity[uBin]++;
    }

    if (oVal >= minRange && oVal < maxRange) {
      const oBin = Math.floor((oVal - minRange) / binWidth);
      if (oBin >= 0 && oBin < binCount) oppDensity[oBin]++;
    }
  }

  const userPctDensity = userDensity.map(v => Number(((v / iterations) * 100).toFixed(2)));
  const oppPctDensity = oppDensity.map(v => Number(((v / iterations) * 100).toFixed(2)));

  // Precompute reverse CDF (Chance to reach >= score threshold)
  const userReach = labels.map(threshold => {
    let count = 0;
    for (let i = 0; i < iterations; i++) {
      if (userScores[i] >= threshold) count++;
    }
    return Math.round((count / iterations) * 100);
  });

  const oppReach = labels.map(threshold => {
    let count = 0;
    for (let i = 0; i < iterations; i++) {
      if (oppScores[i] >= threshold) count++;
    }
    return Math.round((count / iterations) * 100);
  });

  const execTimeMs = Number((performance.now() - startTime).toFixed(1));

  return {
    iterations,
    winProbability: Number(winProbability.toFixed(1)),
    spread: Number((userStats.mean - oppStats.mean).toFixed(2)),
    totalOverUnder: Number((userStats.mean + oppStats.mean).toFixed(2)),
    userStats,
    oppStats,
    chartData: {
      labels,
      userDensity: userPctDensity,
      oppDensity: oppPctDensity,
      userReach,
      oppReach
    },
    execTimeMs
  };
}

/**
 * Floor vs Ceiling Score Interpolator & Mode Evaluator
 * - 'floor': Evaluates player by 10th percentile floor
 * - 'balanced': Evaluates player by expected mean / E[X]
 * - 'ceiling': Evaluates player by 90th percentile ceiling
 */
export function getStrategicScore(playerDist, strategyModeOrWeight = 'balanced') {
  if (strategyModeOrWeight === 'floor' || strategyModeOrWeight === 0) {
    return playerDist.floor10 ?? playerDist.floor ?? 0;
  }
  if (strategyModeOrWeight === 'ceiling' || strategyModeOrWeight === 1) {
    return playerDist.ceiling90 ?? playerDist.ceil ?? 0;
  }
  if (strategyModeOrWeight === 'balanced' || strategyModeOrWeight === 0.5) {
    return playerDist.mean ?? playerDist.proj ?? 0;
  }

  const weight = typeof strategyModeOrWeight === 'number' ? strategyModeOrWeight : 0.5;
  if (weight <= 0.5) {
    const t = weight / 0.5;
    return (1 - t) * (playerDist.floor10 ?? playerDist.floor ?? 0) + t * (playerDist.mean ?? playerDist.proj ?? 0);
  } else {
    const t = (weight - 0.5) / 0.5;
    return (1 - t) * (playerDist.mean ?? playerDist.proj ?? 0) + t * (playerDist.ceiling90 ?? playerDist.ceil ?? 0);
  }
}

/**
 * Chronological Kickoff Time Evaluator for Late-Swap Strategy
 * Assigns higher weight to games later in the week / day
 */
export function getPlayerKickoffScore(player, week = 1, liveSchedule = null) {
  if (!player || !player.team) return 0;
  const sched = getGameScheduleInfo(player.team, week, liveSchedule);
  if (!sched) return 0;

  const dayMap = {
    'WED': 1,
    'THU': 2,
    'FRI': 3,
    'SAT': 4,
    'SUN': 5,
    'MON': 6,
    'TUE': 7
  };

  const dayStr = String(sched.day || 'Sun').toUpperCase().trim();
  const dayWeight = dayMap[dayStr] || 5;

  let minutes = 780; // default 1:00 PM (13 * 60)
  const timeStr = String(sched.time || '').trim();
  const m = timeStr.match(/^(\d+):(\d+)\s*(AM|PM)?$/i);
  if (m) {
    let hours = parseInt(m[1], 10);
    const mins = parseInt(m[2], 10);
    const meridiem = (m[3] || '').toUpperCase();
    if (meridiem === 'PM' && hours < 12) hours += 12;
    if (meridiem === 'AM' && hours === 12) hours = 0;
    minutes = hours * 60 + mins;
  }

  return dayWeight * 10000 + minutes;
}

/**
 * Lineup Solver & Optimizer with Strict Positional Constraints & Late-Swap FLEX
 * 
 * Execution Steps:
 * Step 1: Fill all strict single-position primary slots first (QB, RB1, RB2, WR1, WR2, TE, K, DEF)
 *         using the highest-scoring eligible players for each specific position.
 * Step 2: Fill the FLEX / SUPER_FLEX slot(s) from the remaining pool of eligible skill players.
 * Step 3: Apply the Late-Swap rule to FLEX (within position groups that have surplus starters,
 *         place the player with the latest kickoff time into the FLEX slot, while strictly
 *         guaranteeing all primary position slots are filled by players of that exact position).
 */
export function solveOptimalLineup(allPlayers, strategyModeOrWeight = 'balanced', slotTemplateOrReqs = null, options = {}) {
  const { week = 1, liveSchedule = null, currentStarters = [] } = (typeof options === 'object' && options !== null) ? options : {};

  // 1. Establish Immutable Slot Order Template
  let slotTemplate = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'];
  if (Array.isArray(slotTemplateOrReqs) && slotTemplateOrReqs.length > 0) {
    slotTemplate = [...slotTemplateOrReqs];
  } else if (slotTemplateOrReqs && typeof slotTemplateOrReqs === 'object') {
    const expanded = [];
    ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DEF'].forEach(pos => {
      const cnt = slotTemplateOrReqs[pos] || 0;
      for (let i = 0; i < cnt; i++) expanded.push(pos);
    });
    if (expanded.length > 0) slotTemplate = expanded;
  }

  // 2. Evaluate all players with strategic scores and kickoff timing
  const evaluatedPlayers = allPlayers.map(p => {
    const dist = calculatePlayerDistributions(p);
    const kickoffScore = getPlayerKickoffScore(p, week, liveSchedule);
    return {
      ...dist,
      kickoffScore,
      strategicScore: Number(getStrategicScore(dist, strategyModeOrWeight).toFixed(2))
    };
  });

  // Sort all players descending by strategic score (tie-break by projected points, then kickoff score)
  const sorted = [...evaluatedPlayers].sort((a, b) => {
    if (b.strategicScore !== a.strategicScore) return b.strategicScore - a.strategicScore;
    if (b.mean !== a.mean) return b.mean - a.mean;
    return b.kickoffScore - a.kickoffScore;
  });

  // Identify slot counts required by template
  const primarySlots = [];
  const flexSlots = [];

  slotTemplate.forEach((slotType, idx) => {
    if (['FLEX', 'SUPER_FLEX', 'WRRB_FLEX', 'REC_FLEX'].includes(slotType)) {
      flexSlots.push({ slotType, idx });
    } else {
      primarySlots.push({ slotType, idx });
    }
  });

  // Group primary slots by position
  const primaryReqsByPos = {};
  primarySlots.forEach(({ slotType }) => {
    primaryReqsByPos[slotType] = (primaryReqsByPos[slotType] || 0) + 1;
  });

  // STEP 1: Fill all strict single-position primary slots first
  const selectedPrimaryByPos = {};
  const assignedStarterIds = new Set();

  Object.keys(primaryReqsByPos).forEach(pos => {
    const requiredCount = primaryReqsByPos[pos];
    const eligibleForPos = sorted.filter(p => p.position === pos && !assignedStarterIds.has(p.player_id));
    const selected = eligibleForPos.slice(0, requiredCount);
    selectedPrimaryByPos[pos] = selected;
    selected.forEach(p => assignedStarterIds.add(p.player_id));
  });

  // STEP 2: Fill the FLEX / SUPER_FLEX slot(s) from the remaining pool
  const selectedFlexPlayers = [];
  flexSlots.forEach(({ slotType }) => {
    const eligibleForFlex = sorted.filter(p => isPlayerEligibleForSlot(p.position, slotType) && !assignedStarterIds.has(p.player_id));
    if (eligibleForFlex.length > 0) {
      const chosen = eligibleForFlex[0];
      selectedFlexPlayers.push({ ...chosen, flexSlotType: slotType });
      assignedStarterIds.add(chosen.player_id);
    }
  });

  // Combine all selected starters
  const allSelectedStarters = [];
  Object.values(selectedPrimaryByPos).forEach(list => allSelectedStarters.push(...list));
  allSelectedStarters.push(...selectedFlexPlayers);

  // STEP 3: Apply Late-Swap rule to FLEX while strictly preserving positional integrity
  const finalStarters = new Array(slotTemplate.length).fill(null);

  // Direct assignment for non-flex, single-slot positions like QB, K, DEF
  ['QB', 'K', 'DEF'].forEach(pos => {
    const playersForPos = selectedPrimaryByPos[pos] || [];
    let pIdx = 0;
    slotTemplate.forEach((slotType, idx) => {
      if (slotType === pos && pIdx < playersForPos.length) {
        finalStarters[idx] = { ...playersForPos[pIdx], slotAssigned: pos };
        pIdx++;
      }
    });
  });

  // Skill positions (RB, WR, TE)
  // For each skill position group, pool all starters of that position (primary + flex)
  const skillPositions = ['RB', 'WR', 'TE'];
  const skillStartersByPos = {};
  skillPositions.forEach(pos => {
    const prim = selectedPrimaryByPos[pos] || [];
    const flex = selectedFlexPlayers.filter(p => p.position === pos);
    skillStartersByPos[pos] = [...prim, ...flex];
  });

  // Determine which skill players occupy the FLEX slot(s) based on Late-Swap (latest kickoff time)
  // Number of flex spots occupied by each position = total starters of pos - primary slots required for pos
  const flexAssignedByPos = {};
  const primaryAssignedByPos = {};

  skillPositions.forEach(pos => {
    const pool = skillStartersByPos[pos] || [];
    const requiredPrimary = primaryReqsByPos[pos] || 0;
    const surplusForFlex = Math.max(0, pool.length - requiredPrimary);

    if (surplusForFlex > 0) {
      // Sort by kickoffScore descending (latest game first)
      const sortedByLateSwap = [...pool].sort((a, b) => {
        if (b.kickoffScore !== a.kickoffScore) return b.kickoffScore - a.kickoffScore;
        // Tie-breaker: prefer player already in FLEX in currentStarters
        const aWasFlex = (currentStarters || []).some(s => s.player_id === a.player_id && s.slotAssigned === 'FLEX');
        const bWasFlex = (currentStarters || []).some(s => s.player_id === b.player_id && s.slotAssigned === 'FLEX');
        if (aWasFlex && !bWasFlex) return -1;
        if (bWasFlex && !aWasFlex) return 1;
        return a.strategicScore - b.strategicScore;
      });

      // Top surplus players with latest kickoffs get FLEX
      flexAssignedByPos[pos] = sortedByLateSwap.slice(0, surplusForFlex);
      primaryAssignedByPos[pos] = sortedByLateSwap.slice(surplusForFlex);
    } else {
      flexAssignedByPos[pos] = [];
      primaryAssignedByPos[pos] = [...pool];
    }
  });

  // Assign primary skill slots (RB, WR, TE)
  const currentStarterIds = new Set((currentStarters || []).map(p => p.player_id));
  const isExactSameStarters = currentStarters && currentStarters.length === allSelectedStarters.length &&
    allSelectedStarters.every(p => currentStarterIds.has(p.player_id));

  skillPositions.forEach(pos => {
    const list = primaryAssignedByPos[pos] || [];
    if (isExactSameStarters) {
      // Preserve current starter slot order (e.g. RB1 vs RB2)
      const currentSlotMap = new Map();
      currentStarters.forEach((cs, idx) => currentSlotMap.set(cs.player_id, idx));
      list.sort((a, b) => (currentSlotMap.get(a.player_id) ?? 0) - (currentSlotMap.get(b.player_id) ?? 0));
    } else {
      list.sort((a, b) => b.strategicScore - a.strategicScore);
    }

    let pIdx = 0;
    slotTemplate.forEach((slotType, idx) => {
      if (slotType === pos && pIdx < list.length) {
        finalStarters[idx] = { ...list[pIdx], slotAssigned: pos };
        pIdx++;
      }
    });
  });

  // Assign FLEX slots from the designated flex players
  const allFlexDesignated = [];
  skillPositions.forEach(pos => {
    allFlexDesignated.push(...(flexAssignedByPos[pos] || []));
  });

  // Sort flex designated players by latest kickoff
  allFlexDesignated.sort((a, b) => b.kickoffScore - a.kickoffScore);

  flexSlots.forEach(({ slotType, idx }) => {
    const eligibleFlex = allFlexDesignated.filter(p => isPlayerEligibleForSlot(p.position, slotType));
    if (eligibleFlex.length > 0) {
      const chosen = eligibleFlex[0];
      finalStarters[idx] = { ...chosen, slotAssigned: slotType };
      const removeIdx = allFlexDesignated.indexOf(chosen);
      if (removeIdx > -1) allFlexDesignated.splice(removeIdx, 1);
    }
  });

  const verifiedFinalStarters = finalStarters.filter(Boolean);
  const starterIdSet = new Set(verifiedFinalStarters.map(p => p.player_id));

  // Bench players (all remaining roster players sorted descending by strategicScore)
  const benchPlayers = sorted.filter(p => !starterIdSet.has(p.player_id)).map(p => ({
    ...p,
    slotAssigned: 'BN'
  }));

  const totalFloor = Number(verifiedFinalStarters.reduce((acc, p) => acc + (p.floor10 || p.floor || 0), 0).toFixed(1));
  const totalProj = Number(verifiedFinalStarters.reduce((acc, p) => acc + (p.mean || p.proj || 0), 0).toFixed(1));
  const totalCeil = Number(verifiedFinalStarters.reduce((acc, p) => acc + (p.ceiling90 || p.ceil || 0), 0).toFixed(1));

  return {
    starters: verifiedFinalStarters,
    bench: benchPlayers,
    mode: strategyModeOrWeight,
    strategyWeight: typeof strategyModeOrWeight === 'number' ? strategyModeOrWeight : (strategyModeOrWeight === 'floor' ? 0 : strategyModeOrWeight === 'ceiling' ? 1 : 0.5),
    totalFloor,
    totalProj,
    totalCeil,
    totalProjectedScore: totalProj,
    totalStrategicScore: Number(verifiedFinalStarters.reduce((acc, p) => acc + p.strategicScore, 0).toFixed(2))
  };
}

/**
 * Identify Recommended Sit / Start Swaps
 */
export function identifyLineupSwaps(currentStarters, optimalStarters, allPlayers, strategyWeight = 0.5) {
  const currentStarterIds = new Set(currentStarters.map(p => p.player_id));
  const optimalStarterIds = new Set(optimalStarters.map(p => p.player_id));

  const shouldBench = currentStarters.filter(p => !optimalStarterIds.has(p.player_id));
  const shouldStart = optimalStarters.filter(p => !currentStarterIds.has(p.player_id));

  const swaps = [];

  shouldStart.forEach(starterToAdd => {
    const compatibleBench = shouldBench.find(b => 
      isPlayerEligibleForSlot(starterToAdd.position, b.slotAssigned) ||
      isPlayerEligibleForSlot(b.position, starterToAdd.slotAssigned) ||
      b.position === starterToAdd.position
    ) || shouldBench[0];

    if (compatibleBench) {
      const deltaMean = Number((starterToAdd.mean - compatibleBench.mean).toFixed(2));
      const deltaStrategic = Number((starterToAdd.strategicScore - compatibleBench.strategicScore).toFixed(2));

      swaps.push({
        playerToStart: starterToAdd,
        playerToBench: compatibleBench,
        deltaMean,
        deltaStrategic,
        reason: deltaStrategic > 0 
          ? `+${deltaStrategic} pts higher strategic utility (${strategyWeight > 0.5 ? 'Ceiling boost' : 'Floor stability'})`
          : `Optimal positional flex balance`
      });
    }
  });

  return swaps;
}
