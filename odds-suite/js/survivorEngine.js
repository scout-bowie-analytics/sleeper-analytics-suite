/**
 * 🐾 SCOUT BOWIE NFL SURVIVOR & PICK'EM ANALYTICAL ENGINE
 * 100% Client-Side Pure JS Math & Dynamic Lookahead Solver
 */

export class SurvivorEngine {
  constructor(options = {}) {
    this.defaultPoolSize = options.poolSize || 100;
  }

  /**
   * Expected Value (EV) calculation against pool size
   * Formula: EV = (pWin / max(0.01, pickShare)) * (1 - (1 - pWin)^poolSize)
   */
  calculateEV(pWin, pickShare, poolSize = 100) {
    const safeWin = Math.max(0.01, Math.min(0.99, Number(pWin) || 0.5));
    const safeShare = Math.max(0.005, Math.min(0.99, Number(pickShare) || 0.05));
    const n = Math.max(2, Number(poolSize) || 100);

    const poolLeverage = 1 - Math.pow(1 - safeWin, n);
    const ev = (safeWin / safeShare) * poolLeverage;
    return Number(ev.toFixed(3));
  }

  /**
   * Future Value (FV) heuristic:
   * Sum of team's future win probabilities in games where P(Win) >= 65%
   */
  calculateFutureValue(teamCode, fromWeek, slateData) {
    let fv = 0;
    for (let w = fromWeek + 1; w <= 18; w++) {
      const weekData = slateData.find(s => s.week === w);
      if (!weekData || (weekData.byes && weekData.byes.includes(teamCode))) continue;

      const game = weekData.games.find(g => g.homeTeam === teamCode || g.awayTeam === teamCode);
      if (!game) continue;

      const isHome = game.homeTeam === teamCode;
      const winProb = isHome ? game.homeWinProb : game.awayWinProb;

      if (winProb >= 0.65) {
        fv += winProb;
      }
    }
    return Number(fv.toFixed(2));
  }

  /**
   * Helper to get a team's game details for a given week
   */
  getTeamGame(teamCode, week, slateData) {
    const weekData = slateData.find(s => s.week === week);
    if (!weekData) return null;
    if (weekData.byes && weekData.byes.includes(teamCode)) {
      return { isBye: true, week, teamCode };
    }

    const game = weekData.games.find(g => g.homeTeam === teamCode || g.awayTeam === teamCode);
    if (!game) return null;

    const isHome = game.homeTeam === teamCode;
    const oppCode = isHome ? game.awayTeam : game.homeTeam;
    const oppName = isHome ? game.awayTeamName : game.homeTeamName;
    const winProb = isHome ? game.homeWinProb : game.awayWinProb;
    const pickPct = isHome ? game.homePickPct : game.awayPickPct;
    const spread = isHome ? game.spread : -game.spread;

    return {
      id: game.id,
      week,
      teamCode,
      teamName: isHome ? game.homeTeamName : game.awayTeamName,
      oppCode,
      oppName,
      isHome,
      spread,
      total: game.total,
      winProb,
      pickPct,
      isBye: false
    };
  }

  /**
   * 18-Week Optimal Path Finder (Dynamic Programming Lookahead)
   * Enforces single-elimination (each team max once), user locks, and exclusions.
   */
  findOptimal18WeekPath(slateData, options = {}) {
    const poolSize = Math.max(10, Number(options.poolSize) || 100);
    const strategy = options.strategy || 'contrarian'; // 'survival' | 'contrarian'
    const lockedPicks = options.lockedPicks || {}; // { [week]: teamCode }
    const excludedTeams = new Set(options.excludedTeams || []);

    const usedTeams = new Set();
    const path = [];

    // Pre-populate locked picks so we don't accidentally reuse locked teams in earlier weeks
    Object.entries(lockedPicks).forEach(([w, team]) => {
      if (team) usedTeams.add(team);
    });

    let cumulativeSurvival = 1.0;

    for (let w = 1; w <= 18; w++) {
      const weekData = slateData.find(s => s.week === w);
      if (!weekData) continue;

      // 1. Check if user manually locked a pick for this week
      if (lockedPicks[w]) {
        const lockedTeam = lockedPicks[w];
        const game = this.getTeamGame(lockedTeam, w, slateData);
        if (game && !game.isBye) {
          const ev = this.calculateEV(game.winProb, game.pickPct, poolSize);
          const fv = this.calculateFutureValue(lockedTeam, w, slateData);
          cumulativeSurvival *= game.winProb;

          path.push({
            ...game,
            ev,
            futureValue: fv,
            isLocked: true,
            cumulativeProb: Number((cumulativeSurvival * 100).toFixed(2))
          });
          continue;
        }
      }

      // 2. Evaluate all available candidate teams for this week
      const candidates = [];
      weekData.games.forEach(g => {
        // Evaluate Home Team
        if (!usedTeams.has(g.homeTeam) && !excludedTeams.has(g.homeTeam)) {
          const ev = this.calculateEV(g.homeWinProb, g.homePickPct, poolSize);
          const fv = this.calculateFutureValue(g.homeTeam, w, slateData);
          candidates.push({
            teamCode: g.homeTeam,
            teamName: g.homeTeamName,
            oppCode: g.awayTeam,
            oppName: g.awayTeamName,
            isHome: true,
            spread: g.spread,
            total: g.total,
            winProb: g.homeWinProb,
            pickPct: g.homePickPct,
            ev,
            futureValue: fv
          });
        }

        // Evaluate Away Team
        if (!usedTeams.has(g.awayTeam) && !excludedTeams.has(g.awayTeam)) {
          const ev = this.calculateEV(g.awayWinProb, g.awayPickPct, poolSize);
          const fv = this.calculateFutureValue(g.awayTeam, w, slateData);
          candidates.push({
            teamCode: g.awayTeam,
            teamName: g.awayTeamName,
            oppCode: g.homeTeam,
            oppName: g.homeTeamName,
            isHome: false,
            spread: -g.spread,
            total: g.total,
            winProb: g.awayWinProb,
            pickPct: g.awayPickPct,
            ev,
            futureValue: fv
          });
        }
      });

      if (candidates.length === 0) {
        path.push({
          week: w,
          teamCode: '—',
          teamName: 'No Valid Pick',
          oppCode: '—',
          winProb: 0,
          pickPct: 0,
          ev: 0,
          futureValue: 0,
          isLocked: false,
          cumulativeProb: Number((cumulativeSurvival * 100).toFixed(2))
        });
        continue;
      }

      // Filter to legitimate favorites first (>= 55% winProb)
      let eligible = candidates.filter(c => c.winProb >= 0.55);
      if (eligible.length === 0) eligible = candidates.filter(c => c.winProb >= 0.50);
      if (eligible.length === 0) eligible = candidates;

      // Score candidates based on strategy & future lookahead
      eligible.forEach(cand => {
        const logProb = Math.log(cand.winProb);
        const logEv = Math.log(Math.max(0.1, cand.ev));

        if (strategy === 'survival') {
          // Pure survival: heavily prioritize raw win probability, penalize burning future value early
          const fvPenalty = w <= 6 ? 0.08 : (w <= 13 ? 0.04 : 0.01);
          cand.score = logProb + (0.12 * logEv) - (fvPenalty * cand.futureValue);
        } else {
          // Contrarian: Leverage EV bonus is stronger, rewarding pivot favorites against heavy chalk
          const fvPenalty = w <= 6 ? 0.05 : 0.02;
          const evWeight = poolSize >= 500 ? 0.45 : (poolSize >= 100 ? 0.35 : 0.22);
          cand.score = logProb + (evWeight * logEv) - (fvPenalty * cand.futureValue);
        }
      });

      eligible.sort((a, b) => b.score - a.score);
      const chosen = eligible[0];

      usedTeams.add(chosen.teamCode);
      cumulativeSurvival *= chosen.winProb;

      path.push({
        week: w,
        ...chosen,
        isLocked: false,
        cumulativeProb: Number((cumulativeSurvival * 100).toFixed(2))
      });
    }

    return {
      path,
      cumulativeSurvivalProb: Number((cumulativeSurvival * 100).toFixed(2)),
      strategy,
      poolSize
    };
  }

  /**
   * Weekly Recommendation Spotlight Card Generator
   * Categorizes picks into Top Leverage, Chalk, and Trap Pick for active week.
   */
  categorizeWeeklyPicks(week, slateData, options = {}) {
    const poolSize = Math.max(10, Number(options.poolSize) || 100);
    const weekData = slateData.find(s => s.week === week);
    if (!weekData) return { leverage: null, chalk: null, trap: null, all: [] };

    const picks = [];
    weekData.games.forEach(g => {
      // Home Team
      const homeEv = this.calculateEV(g.homeWinProb, g.homePickPct, poolSize);
      const homeFv = this.calculateFutureValue(g.homeTeam, week, slateData);
      picks.push({
        id: `${g.id}_home`,
        teamCode: g.homeTeam,
        teamName: g.homeTeamName,
        oppCode: g.awayTeam,
        oppName: g.awayTeamName,
        isHome: true,
        spread: g.spread,
        total: g.total,
        winProb: g.homeWinProb,
        pickPct: g.homePickPct,
        ev: homeEv,
        futureValue: homeFv
      });

      // Away Team
      const awayEv = this.calculateEV(g.awayWinProb, g.awayPickPct, poolSize);
      const awayFv = this.calculateFutureValue(g.awayTeam, week, slateData);
      picks.push({
        id: `${g.id}_away`,
        teamCode: g.awayTeam,
        teamName: g.awayTeamName,
        oppCode: g.homeTeam,
        oppName: g.homeTeamName,
        isHome: false,
        spread: -g.spread,
        total: g.total,
        winProb: g.awayWinProb,
        pickPct: g.awayPickPct,
        ev: awayEv,
        futureValue: awayFv
      });
    });

    // 1. Chalk Pick: Highest raw win probability on the slate
    const chalkPicks = [...picks].sort((a, b) => b.winProb - a.winProb);
    const chalk = chalkPicks[0] || null;

    // 2. Top Leverage Pick: High EV with solid win prob (>= 58%) and lower pick share
    const leverageCandidates = picks.filter(p => p.winProb >= 0.58 && p.pickPct <= 0.22 && p.teamCode !== (chalk ? chalk.teamCode : ''));
    leverageCandidates.sort((a, b) => b.ev - a.ev);
    const leverage = leverageCandidates[0] || [...picks].sort((a, b) => b.ev - a.ev)[0];

    // 3. Trap Pick: High pick share (> 8%) where win probability is vulnerable (< 70%) or EV is discounted
    const trapCandidates = picks.filter(p => p.pickPct >= 0.06 && p.teamCode !== (chalk ? chalk.teamCode : ''));
    trapCandidates.sort((a, b) => (b.pickPct / Math.max(0.40, b.winProb)) - (a.pickPct / Math.max(0.40, a.winProb)));
    const trap = trapCandidates[0] || null;

    // Sort all picks by EV descending
    picks.sort((a, b) => b.ev - a.ev);

    return {
      leverage,
      chalk,
      trap,
      all: picks,
      byes: weekData.byes || []
    };
  }

  /**
   * Pick'em Confidence Mode:
   * Rank all weekly games by win probability and assign 16 down to 1 points.
   */
  generatePickemConfidence(week, slateData) {
    const weekData = slateData.find(s => s.week === week);
    if (!weekData || !weekData.games) return [];

    const games = weekData.games.map(g => {
      const isHomeFav = g.homeWinProb >= g.awayWinProb;
      const pickedTeam = isHomeFav ? g.homeTeam : g.awayTeam;
      const pickedTeamName = isHomeFav ? g.homeTeamName : g.awayTeamName;
      const oppTeam = isHomeFav ? g.awayTeam : g.homeTeam;
      const oppTeamName = isHomeFav ? g.awayTeamName : g.homeTeamName;
      const winProb = isHomeFav ? g.homeWinProb : g.awayWinProb;
      const pickPct = isHomeFav ? g.homePickPct : g.awayPickPct;
      const spread = isHomeFav ? g.spread : -g.spread;

      const edge = Number(((winProb - pickPct) * 100).toFixed(1));

      return {
        id: g.id,
        pickedTeam,
        pickedTeamName,
        oppTeam,
        oppTeamName,
        isHome: isHomeFav,
        spread,
        total: g.total,
        winProb,
        pickPct,
        edge,
        isLeveragePlay: edge >= 8.0 && winProb >= 0.58
      };
    });

    games.sort((a, b) => b.winProb - a.winProb);

    const totalGames = games.length;
    games.forEach((g, idx) => {
      g.confidence = totalGames - idx;
    });

    return games;
  }

  /**
   * Format 18-week path for 1-click clipboard export
   */
  formatClipboardSurvivorPath(result, options = {}) {
    if (!result || !result.path) return '';
    const poolSize = options.poolSize || result.poolSize || 100;
    const stratName = (result.strategy === 'survival' ? 'Max Survival' : 'Contrarian Leverage');

    let text = `🐾 SCOUT BOWIE 18-WEEK SURVIVOR OPTIMAL PATH\n`;
    text += `Strategy: ${stratName} | Pool Size: ${poolSize} Entries | Est. Survival: ${result.cumulativeSurvivalProb}%\n`;
    text += `------------------------------------------------------------\n`;

    result.path.forEach(p => {
      const loc = p.isHome ? 'vs' : '@';
      const spreadStr = p.spread < 0 ? `${p.spread}` : `+${p.spread}`;
      const lockMark = p.isLocked ? ' 🔒[LOCKED]' : '';
      text += `Week ${String(p.week).padEnd(2)}: ${p.teamCode.padEnd(4)} (${loc} ${p.oppCode}) [${spreadStr}, Win: ${(p.winProb*100).toFixed(0)}%, EV: ${p.ev}]${lockMark}\n`;
    });

    text += `------------------------------------------------------------\n`;
    text += `Generated via Scout Bowie Odds Suite • https://scout-bowie-analytics.github.io/sleeper-analytics-suite/odds-suite/`;
    return text;
  }

  /**
   * Format Pick'em Confidence sheet for clipboard export
   */
  formatClipboardPickem(confidenceList, week) {
    if (!confidenceList || confidenceList.length === 0) return '';
    let text = `🐾 SCOUT BOWIE WEEK ${week} NFL PICK'EM CONFIDENCE SHEET\n`;
    text += `------------------------------------------------------------\n`;

    confidenceList.forEach(c => {
      const loc = c.isHome ? 'vs' : '@';
      const spreadStr = c.spread < 0 ? `${c.spread}` : `+${c.spread}`;
      const edgeStr = c.isLeveragePlay ? ' ⚡[LEVERAGE VALUE]' : '';
      text += `[${String(c.confidence).padStart(2)} pts] ${c.pickedTeam.padEnd(4)} (${loc} ${c.oppTeam}) | Spread: ${spreadStr} | Win: ${(c.winProb*100).toFixed(0)}%${edgeStr}\n`;
    });

    text += `------------------------------------------------------------\n`;
    text += `Generated via Scout Bowie Odds Suite • https://scout-bowie-analytics.github.io/sleeper-analytics-suite/odds-suite/`;
    return text;
  }
}
