/**
 * 🐾 SCOUT BOWIE NFL SURVIVOR MONTE CARLO SIMULATION WORKER
 * Runs 10,000 iterations off the main UI thread
 */

self.onmessage = function(e) {
  const { path: userPath, slateData, poolSize = 100, iterations = 10000 } = e.data;

  try {
    const results = runMonteCarloSimulation(userPath, slateData, poolSize, iterations, (pct) => {
      self.postMessage({ type: 'progress', percent: pct });
    });
    self.postMessage({ type: 'complete', results });
  } catch (err) {
    self.postMessage({ type: 'error', error: err.message });
  }
};

function runMonteCarloSimulation(userPath, slateData, poolSize, iterations, progressCb) {
  const userPicksByWeek = {};
  userPath.forEach(p => {
    userPicksByWeek[p.week] = p.teamCode;
  });

  const totalPoolSize = Math.max(2, Math.min(10000, Number(poolSize) || 100));
  const numOpponents = totalPoolSize - 1;

  let totalWinEquity = 0;
  let soloWins = 0;
  let splitWins = 0;
  let userSurvived18 = 0;

  const eliminationWeeksCount = {};
  for (let w = 1; w <= 18; w++) eliminationWeeksCount[w] = 0;
  eliminationWeeksCount['survived'] = 0;

  const weekUserAliveCount = new Array(19).fill(0);
  const weekOpponentsAvgSum = new Array(19).fill(0);

  const reportInterval = Math.max(500, Math.floor(iterations / 20));

  for (let iter = 1; iter <= iterations; iter++) {
    if (progressCb && iter % reportInterval === 0) {
      progressCb(Math.round((iter / iterations) * 100));
    }

    let userAlive = true;
    let opponentsAlive = numOpponents;
    let userElimWeek = null;
    let poolEndedWeek = null;
    let userWonSolo = false;
    let userSplitPot = false;

    for (let w = 1; w <= 18; w++) {
      if (userAlive) weekUserAliveCount[w]++;
      weekOpponentsAvgSum[w] += opponentsAlive;

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

      // 4. Resolve week outcomes
      if (userAlive && !userSurvivesThisWeek) {
        // User died this week
        userAlive = false;
        userElimWeek = w;
        if (survivingOpponents === 0 && opponentsAlive > 0) {
          // Everyone died in this same week: split pot among week's survivors!
          const tiedWinners = 1 + opponentsAlive;
          totalWinEquity += (1 / tiedWinners);
          userSplitPot = true;
          poolEndedWeek = w;
          break;
        }
      } else if (userAlive && userSurvivesThisWeek) {
        // User survived this week!
        if (survivingOpponents === 0) {
          // ALL opponents eliminated! User WINS SOLO in week w!
          soloWins++;
          totalWinEquity += 1.0;
          userWonSolo = true;
          poolEndedWeek = w;
          break;
        }
      }

      opponentsAlive = survivingOpponents;

      if (!userAlive && opponentsAlive === 0) {
        break; // Pool ended
      }
    }

    // Record iteration stats
    if (userWonSolo) {
      eliminationWeeksCount[poolEndedWeek || 18]++;
    } else if (userSplitPot) {
      splitWins++;
      eliminationWeeksCount[poolEndedWeek || 18]++;
    } else if (userAlive) {
      userSurvived18++;
      eliminationWeeksCount['survived']++;
      const totalWinners = 1 + opponentsAlive;
      totalWinEquity += (1 / totalWinners);
      if (opponentsAlive === 0) soloWins++;
      else splitWins++;
    } else {
      eliminationWeeksCount[userElimWeek || 18]++;
    }
  }

  // Calculate final statistics
  const winEquityPct = Number(((totalWinEquity / iterations) * 100).toFixed(2));
  const soloWinPct = Number(((soloWins / iterations) * 100).toFixed(2));
  const splitWinPct = Number(((splitWins / iterations) * 100).toFixed(2));
  const fullSeasonSurvivalPct = Number(((userSurvived18 / iterations) * 100).toFixed(2));

  let totalWeeksSum = 0;
  for (let w = 1; w <= 18; w++) {
    totalWeeksSum += eliminationWeeksCount[w] * w;
  }
  totalWeeksSum += eliminationWeeksCount['survived'] * 18;
  const expectedElimWeek = Number((totalWeeksSum / iterations).toFixed(1));

  return {
    iterations,
    poolSize: totalPoolSize,
    winEquityPct,
    expectedElimWeek,
    soloWinPct,
    splitWinPct,
    fullSeasonSurvivalPct
  };
}
