/**
 * 🐾 SCOUT BOWIE PARLAY & SAME-GAME PARLAY (SGP) ANALYTICAL ENGINE
 * Pure client-side analytical core for bet slip management, odds conversion,
 * uncorrelated multiplier calculations, vig/edge metrics, and SGP correlation analysis.
 */

export class ParlayEngine {
  constructor() {
    this.legs = [];
    this.stake = 10;
    this.customOfferedOdds = null; // null means auto-calculate uncorrelated default
  }

  // ==========================================
  // ODDS CONVERSION UTILITIES
  // ==========================================

  /**
   * Convert American odds to Decimal multiplier
   * e.g., -110 -> 1.9091, +150 -> 2.5000, -500 -> 1.2000
   */
  americanToDecimal(american) {
    const odds = Number(american);
    if (isNaN(odds) || odds === 0) return 1.0;
    if (odds > 0) {
      return 1 + (odds / 100);
    } else {
      return 1 + (100 / Math.abs(odds));
    }
  }

  /**
   * Convert Decimal multiplier to American odds integer
   * e.g., 1.9091 -> -110, 2.5000 -> +150
   */
  decimalToAmerican(decimal) {
    const dec = Number(decimal);
    if (isNaN(dec) || dec <= 1.0) return 100;
    if (dec >= 2.0) {
      return Math.round((dec - 1) * 100);
    } else {
      return -Math.round(100 / (dec - 1));
    }
  }

  /**
   * Convert American odds to raw bookmaker implied probability
   * e.g., -110 -> 0.5238 (52.38%), +150 -> 0.4000 (40.00%)
   */
  americanToImpliedProb(american) {
    const dec = this.americanToDecimal(american);
    return dec > 0 ? 1 / dec : 0;
  }

  /**
   * Convert Win Probability (0.0 to 1.0) to Decimal odds
   */
  probToDecimal(prob) {
    const p = Math.max(0.0001, Math.min(0.9999, Number(prob)));
    return 1 / p;
  }

  /**
   * Convert Win Probability (0.0 to 1.0) to Fair American odds
   */
  probToAmerican(prob) {
    return this.decimalToAmerican(this.probToDecimal(prob));
  }

  /**
   * Format American odds with explicit sign (e.g., +150, -110)
   */
  formatAmerican(odds) {
    const num = Number(odds);
    if (isNaN(num)) return '—';
    return num > 0 ? `+${num}` : `${num}`;
  }

  // ==========================================
  // FAIR PROBABILITIES & CORRELATION MATH
  // ==========================================

  /**
   * Compute no-vig fair independent probability for a leg.
   * For standard spread/total lines (-110/-110), fair prob = 50.0%.
   * For moneyline, vig is stripped across the 2-way market.
   */
  getFairIndependentProb(leg, slateGame = null) {
    if (!leg) return 0.5;

    // Spread and Over/Under standard markets (-110 vs -110)
    if (leg.marketCategory === 'spread' || leg.marketCategory === 'total') {
      return 0.50;
    }

    // Moneyline market: de-vig home/away pair
    if (leg.marketCategory === 'moneyline' && slateGame) {
      const homeImplied = this.americanToImpliedProb(slateGame.homeMoneyline || -110);
      const awayImplied = this.americanToImpliedProb(slateGame.awayMoneyline || 110);
      const totalOverround = homeImplied + awayImplied;

      if (leg.selection === slateGame.homeTeam) {
        return homeImplied / totalOverround;
      } else {
        return awayImplied / totalOverround;
      }
    }

    // Fallback if game context is missing: normalize single leg assuming standard 4.5% vig
    const rawImplied = this.americanToImpliedProb(leg.bookOdds);
    return rawImplied / 1.045;
  }

  /**
   * Calculate the product of fair independent probabilities across all legs.
   * Naive un-correlated fair benchmark: Product(P_fair_indep)
   */
  calculateNaiveFairProduct(slateData = []) {
    if (this.legs.length === 0) return 0;

    let product = 1.0;
    this.legs.forEach(leg => {
      let slateGame = null;
      if (Array.isArray(slateData)) {
        for (const weekObj of slateData) {
          const found = (weekObj.games || []).find(g => g.id === leg.gameId);
          if (found) { slateGame = found; break; }
        }
      }
      const fairP = this.getFairIndependentProb(leg, slateGame);
      product *= fairP;
    });

    return product;
  }

  // ==========================================
  // BET SLIP STATE MANAGEMENT
  // ==========================================

  /**
   * Check if a specific leg is currently in the slip
   */
  hasLeg(legId) {
    return this.legs.some(l => l.id === legId);
  }

  /**
   * Get leg index by ID
   */
  getLegIndex(legId) {
    return this.legs.findIndex(l => l.id === legId);
  }

  /**
   * Toggle a betting selection with MUTUAL EXCLUSIVITY AUTO-REPLACEMENT.
   * - If exact leg is already present: remove it (toggle off).
   * - If opposing selection in the same market category exists for the same game
   *   (e.g., user selects BAL +3.5 while DET -3.5 is already in slip,
   *   or UNDER 44.0 while OVER 44.0 is in slip, or Home ML vs Away ML):
   *   AUTO-REPLACE the conflicting leg instead of stacking them.
   * - Otherwise: append the new leg to the slip.
   * Returns: { action: 'added' | 'removed' | 'replaced', leg: Leg, replacedLeg: Leg | null }
   */
  toggleLeg(leg) {
    const exactIndex = this.legs.findIndex(l => l.id === leg.id);
    if (exactIndex !== -1) {
      const removed = this.legs.splice(exactIndex, 1)[0];
      return { action: 'removed', leg: removed, replacedLeg: null };
    }

    // Check for conflicting selection on the same market category in the same game
    const conflictIndex = this.legs.findIndex(l => 
      l.gameId === leg.gameId && l.marketCategory === leg.marketCategory
    );

    if (conflictIndex !== -1) {
      const replaced = this.legs[conflictIndex];
      this.legs[conflictIndex] = { ...leg };
      return { action: 'replaced', leg: this.legs[conflictIndex], replacedLeg: replaced };
    }

    // Add new leg
    this.legs.push({ ...leg });
    return { action: 'added', leg: leg, replacedLeg: null };
  }

  /**
   * Remove a leg by ID
   */
  removeLeg(legId) {
    const idx = this.legs.findIndex(l => l.id === legId);
    if (idx !== -1) {
      return this.legs.splice(idx, 1)[0];
    }
    return null;
  }

  /**
   * Clear all legs from the slip
   */
  clearSlip() {
    this.legs = [];
    this.customOfferedOdds = null;
  }

  /**
   * Dynamic Ticket Classification
   */
  getTicketClassification() {
    if (this.legs.length === 0) {
      return { type: 'empty', label: 'Empty Bet Slip', badgeClass: 'badge-empty', isSgp: false };
    }
    if (this.legs.length === 1) {
      return { type: 'single', label: 'Single Wager', badgeClass: 'badge-single', isSgp: false };
    }

    // Group by gameId
    const gameCounts = {};
    this.legs.forEach(l => {
      gameCounts[l.gameId] = (gameCounts[l.gameId] || 0) + 1;
    });

    const uniqueGames = Object.keys(gameCounts).length;
    const maxLegsInSingleGame = Math.max(...Object.values(gameCounts));

    if (uniqueGames === 1) {
      return { 
        type: 'sgp', 
        label: 'Same-Game Parlay (Correlated SGP)', 
        badgeClass: 'badge-sgp', 
        isSgp: true,
        desc: 'All legs from 1 matchup evaluated on synchronized game script.'
      };
    }

    if (maxLegsInSingleGame >= 2) {
      return { 
        type: 'sgp_hybrid', 
        label: 'SGP + Multi-Game Combo', 
        badgeClass: 'badge-sgp-hybrid', 
        isSgp: true,
        desc: 'Hybrid ticket containing intra-game SGP correlations across games.'
      };
    }

    return { 
      type: 'parlay', 
      label: 'Standard Multi-Game Parlay', 
      badgeClass: 'badge-parlay', 
      isSgp: false,
      desc: 'Independent multi-game ticket.'
    };
  }

  // ==========================================
  // UNCORRELATED BOOK MULTIPLIER & PAYOUT
  // ==========================================

  /**
   * Calculate standard uncorrelated book multiplier & American odds
   */
  calculateUncorrelatedBookOdds() {
    if (this.legs.length === 0) {
      return { combinedDecimal: 1.0, combinedAmerican: 100, combinedImpliedProb: 1.0 };
    }

    let combinedDecimal = 1.0;
    this.legs.forEach(leg => {
      combinedDecimal *= this.americanToDecimal(leg.bookOdds);
    });

    const combinedAmerican = this.decimalToAmerican(combinedDecimal);
    const combinedImpliedProb = 1 / combinedDecimal;

    return {
      combinedDecimal: Number(combinedDecimal.toFixed(4)),
      combinedAmerican,
      combinedImpliedProb: Number(combinedImpliedProb.toFixed(4))
    };
  }

  // ==========================================
  // EXPECTED VALUE (+EV), VIG & ANALYTICS
  // ==========================================

  /**
   * Calculate complete quantitative analytics suite for the current ticket
   * @param {Object} simResults - { winProbability: 0.15, winCount: 1500, iterations: 10000, fairAmericanOdds: 567 }
   * @param {Array} slateData - full season slate data
   * @param {Number|null} customOddsOverride - user entered sportsbook offer
   * @param {Number} stake - stake in dollars
   */
  calculateAnalytics(simResults = null, slateData = [], customOddsOverride = null, stake = 10) {
    const uncorrelated = this.calculateUncorrelatedBookOdds();
    
    // Effective offered American odds (either user override or default bookmaker multiplier)
    const effectiveAmericanOdds = (customOddsOverride !== null && customOddsOverride !== undefined && !isNaN(Number(customOddsOverride)))
      ? Number(customOddsOverride)
      : uncorrelated.combinedAmerican;

    const effectiveDecimal = this.americanToDecimal(effectiveAmericanOdds);
    const bookImpliedProb = 1 / effectiveDecimal;

    // Simulation results (or fallback if not simulated yet)
    let simWinProb = 0;
    let fairAmericanOdds = 100;
    let iterations = 10000;

    if (simResults && simResults.winProbability !== undefined) {
      simWinProb = Number(simResults.winProbability);
      fairAmericanOdds = simResults.fairAmericanOdds !== undefined 
        ? simResults.fairAmericanOdds 
        : this.probToAmerican(simWinProb);
      iterations = simResults.iterations || 10000;
    } else {
      // Fallback to naive fair product
      const naiveProduct = this.calculateNaiveFairProduct(slateData);
      simWinProb = naiveProduct;
      fairAmericanOdds = this.probToAmerican(naiveProduct);
    }

    // Expected Value Percentage: EV% = (P_sim * Decimal_offered - 1) * 100
    const expectedValuePct = ((simWinProb * effectiveDecimal) - 1) * 100;
    const isPositiveEv = expectedValuePct > 0;

    // House Edge / Vig Tax: (1 - P_sim * Decimal_offered) * 100 (if negative EV, this represents house tax)
    const vigTaxPct = Math.max(0, -expectedValuePct);

    // Clean correlation lift: P_sim - Product(P_fair_indep)
    const naiveFairProduct = this.calculateNaiveFairProduct(slateData);
    const correlationBoostPct = (simWinProb - naiveFairProduct) * 100;

    // Payout and Profit
    const safeStake = Math.max(0.5, Number(stake) || 10);
    const potentialPayout = safeStake * effectiveDecimal;
    const potentialProfit = potentialPayout - safeStake;

    const classification = this.getTicketClassification();

    return {
      legsCount: this.legs.length,
      classification,
      stake: safeStake,
      effectiveAmericanOdds,
      effectiveDecimal: Number(effectiveDecimal.toFixed(3)),
      uncorrelatedAmerican: uncorrelated.combinedAmerican,
      uncorrelatedDecimal: uncorrelated.combinedDecimal,
      isCustomOdds: customOddsOverride !== null && customOddsOverride !== undefined && !isNaN(Number(customOddsOverride)),
      bookImpliedProbPct: Number((bookImpliedProb * 100).toFixed(2)),
      simWinProbPct: Number((simWinProb * 100).toFixed(2)),
      fairAmericanOdds,
      expectedValuePct: Number(expectedValuePct.toFixed(2)),
      isPositiveEv,
      vigTaxPct: Number(vigTaxPct.toFixed(2)),
      naiveFairProbPct: Number((naiveFairProduct * 100).toFixed(2)),
      correlationBoostPct: Number(correlationBoostPct.toFixed(2)),
      potentialPayout: Number(potentialPayout.toFixed(2)),
      potentialProfit: Number(potentialProfit.toFixed(2)),
      iterations
    };
  }

  // ==========================================
  // EMBEDDED SYNCHRONOUS SIMULATOR (FALLBACK)
  // ==========================================

  /**
   * 10,000-Iteration Monte Carlo Parlay Simulation with Box-Muller Normal Score Generator
   * and Push Reduction Handling.
   */
  runSyncSimulation(slateData = [], iterations = 10000) {
    if (this.legs.length === 0) {
      return { winProbability: 0, winCount: 0, iterations, fairAmericanOdds: 100 };
    }

    // 1. Build Game Baseline Lookup for legs in slip
    const gameBaselines = {};
    this.legs.forEach(leg => {
      if (!gameBaselines[leg.gameId]) {
        let gameObj = null;
        for (const weekObj of slateData) {
          const found = (weekObj.games || []).find(g => g.id === leg.gameId);
          if (found) { gameObj = found; break; }
        }

        const spread = gameObj ? Number(gameObj.spread || 0) : Number(leg.lineValue || 0);
        const total = gameObj ? Number(gameObj.total || 44) : 44.0;

        // Implied Team Means: HomeMean = (Total - Spread)/2, AwayMean = (Total + Spread)/2
        const homeMean = (total - spread) / 2;
        const awayMean = (total + spread) / 2;

        gameBaselines[leg.gameId] = {
          id: leg.gameId,
          homeTeam: gameObj?.homeTeam || leg.homeTeam,
          awayTeam: gameObj?.awayTeam || leg.awayTeam,
          spread,
          total,
          homeMean,
          awayMean,
          stdDev: 10.5 // Standard NFL scoring variance
        };
      }
    });

    const uniqueGameIds = Object.keys(gameBaselines);
    let winCount = 0;

    // Marsaglia Polar / Box-Muller normal sampling helper
    const sampleNormal = (mean, stdDev) => {
      let u = 0, v = 0;
      while (u === 0) u = Math.random();
      while (v === 0) v = Math.random();
      const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
      return Math.max(0, Math.round(mean + stdDev * z));
    };

    for (let iter = 0; iter < iterations; iter++) {
      // Step A: Simulate synchronized scorelines for all games in the slip
      const simScores = {};
      uniqueGameIds.forEach(gid => {
        const bg = gameBaselines[gid];
        const homeScore = sampleNormal(bg.homeMean, bg.stdDev);
        const awayScore = sampleNormal(bg.awayMean, bg.stdDev);
        simScores[gid] = {
          homeScore,
          awayScore,
          totalScore: homeScore + awayScore,
          margin: homeScore - awayScore // positive means Home won by X
        };
      });

      // Step B: Evaluate each ticket leg against the simulated scoreline
      let ticketFailed = false;
      let nonPushWins = 0;

      for (let i = 0; i < this.legs.length; i++) {
        const leg = this.legs[i];
        const sim = simScores[leg.gameId];
        if (!sim) continue;

        let legResult = 'LOSS'; // 'WIN' | 'PUSH' | 'LOSS'

        switch (leg.marketCategory) {
          case 'spread': {
            const isHome = leg.selection === leg.homeTeam;
            const effectiveSpread = Number(leg.lineValue);
            const teamScore = isHome ? sim.homeScore : sim.awayScore;
            const oppScore = isHome ? sim.awayScore : sim.homeScore;
            const finalWithSpread = teamScore + effectiveSpread;

            if (finalWithSpread > oppScore) {
              legResult = 'WIN';
            } else if (finalWithSpread === oppScore) {
              legResult = 'PUSH'; // Whole-number push
            } else {
              legResult = 'LOSS';
            }
            break;
          }

          case 'moneyline': {
            const isHome = leg.selection === leg.homeTeam;
            if (isHome) {
              if (sim.homeScore > sim.awayScore) legResult = 'WIN';
              else if (sim.homeScore === sim.awayScore) legResult = 'PUSH';
              else legResult = 'LOSS';
            } else {
              if (sim.awayScore > sim.homeScore) legResult = 'WIN';
              else if (sim.awayScore === sim.homeScore) legResult = 'PUSH';
              else legResult = 'LOSS';
            }
            break;
          }

          case 'total': {
            const totalLine = Number(leg.lineValue);
            if (leg.marketType === 'total_over') {
              if (sim.totalScore > totalLine) legResult = 'WIN';
              else if (sim.totalScore === totalLine) legResult = 'PUSH';
              else legResult = 'LOSS';
            } else {
              if (sim.totalScore < totalLine) legResult = 'WIN';
              else if (sim.totalScore === totalLine) legResult = 'PUSH';
              else legResult = 'LOSS';
            }
            break;
          }

          default:
            legResult = 'WIN';
        }

        if (legResult === 'LOSS') {
          ticketFailed = true;
          break;
        } else if (legResult === 'WIN') {
          nonPushWins++;
        }
      }

      // Ticket is a simulation win if no legs lost and at least 1 leg won
      if (!ticketFailed && (nonPushWins > 0 || this.legs.length === 0)) {
        winCount++;
      }
    }

    const winProbability = Number((winCount / iterations).toFixed(4));
    const fairAmericanOdds = this.probToAmerican(winProbability);

    return {
      winCount,
      iterations,
      winProbability,
      fairAmericanOdds
    };
  }
}
