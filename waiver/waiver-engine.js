/**
 * 🐾 WAIVER WIRE RADAR & FAAB OPTIMIZER ANALYTICS ENGINE
 * Pure client-side analytical core for real-time roster diffing,
 * net roster delta calculations, streaming scores, contingent handcuff indexing,
 * and tiered FAAB bid optimization.
 */

export class WaiverEngine {
  constructor(options = {}) {
    this.options = Object.assign({
      minProjectionThreshold: 2.0,
      defaultFaabBudget: 100
    }, options);
  }

  /**
   * Extract unowned free agents from master player pool and league rosters
   */
  extractFreeAgents(allPlayersMap, rosters = [], weekProjections = {}) {
    if (!allPlayersMap || typeof allPlayersMap !== 'object') return [];

    // Step 1: Build Set of all currently rostered player IDs across the league
    const rosteredIds = new Set();
    if (Array.isArray(rosters)) {
      rosters.forEach(r => {
        if (Array.isArray(r.players)) {
          r.players.forEach(pid => {
            if (pid) rosteredIds.add(String(pid));
          });
        }
        if (Array.isArray(r.reserve)) {
          r.reserve.forEach(pid => {
            if (pid) rosteredIds.add(String(pid));
          });
        }
      });
    }

    const freeAgents = [];
    const playersList = Array.isArray(allPlayersMap) ? allPlayersMap : Object.values(allPlayersMap);

    playersList.forEach(player => {
      if (!player || !player.player_id) return;
      const pid = String(player.player_id);

      // Must not be rostered and must be an active NFL asset
      if (!rosteredIds.has(pid)) {
        const pos = player.position || 'FLEX';
        if (pos === 'FLEX' || ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(pos)) {
          const proj = weekProjections[pid] !== undefined 
            ? Number(weekProjections[pid]) 
            : (Number(player.projected_pts) || 0);

          // Calculate Contingent Handcuff Score (1-100)
          const contingentScore = this.calculateContingentUpside(player);

          // Exclude extreme long-tail inactive noise unless high contingent upside
          if (proj >= this.options.minProjectionThreshold || contingentScore >= 65 || pos === 'DEF') {
            freeAgents.push({
              ...player,
              player_id: pid,
              projected_pts: Number(proj.toFixed(1)),
              contingent_score: contingentScore,
              is_free_agent: true
            });
          }
        }
      }
    });

    return freeAgents;
  }

  /**
   * Analyze user's current roster to identify starters, bench depth, and cut candidates
   */
  analyzeUserRoster(userRoster, allPlayersMap = {}, weekProjections = {}) {
    if (!userRoster || !Array.isArray(userRoster.players)) {
      return {
        starters: [],
        bench: [],
        weakestBench: null,
        weakestByPos: {},
        hasOpenIrMove: false,
        irEligiblePlayer: null
      };
    }

    const starterIds = new Set((userRoster.starters || []).map(id => String(id)));
    const allRosterPids = (userRoster.players || []).map(id => String(id));

    const starters = [];
    const bench = [];
    let irEligiblePlayer = null;

    allRosterPids.forEach(pid => {
      const player = allPlayersMap[pid] || { player_id: pid, full_name: `Player ${pid}`, position: 'FLEX' };
      const proj = weekProjections[pid] !== undefined 
        ? Number(weekProjections[pid]) 
        : (Number(player.projected_pts) || 0);

      const decorated = {
        ...player,
        player_id: pid,
        projected_pts: Number(proj.toFixed(1)),
        isStarter: starterIds.has(pid),
        isBench: !starterIds.has(pid)
      };

      if (starterIds.has(pid)) {
        starters.push(decorated);
      } else {
        bench.push(decorated);
        // Check if player on bench is OUT/IR eligible
        if (['OUT', 'IR', 'PUP'].includes(player.status) || ['OUT', 'IR', 'PUP'].includes(player.injury_status)) {
          irEligiblePlayer = decorated;
        }
      }
    });

    // Sort bench by lowest projected points first to find weakest drop candidates
    bench.sort((a, b) => a.projected_pts - b.projected_pts);

    const weakestBench = bench.length > 0 ? bench[0] : null;

    // Weakest by position
    const weakestByPos = {};
    ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].forEach(pos => {
      const posBench = bench.filter(p => p.position === pos);
      posBench.sort((a, b) => a.projected_pts - b.projected_pts);
      weakestByPos[pos] = posBench.length > 0 ? posBench[0] : weakestBench;
    });

    return {
      starters,
      bench,
      weakestBench,
      weakestByPos,
      hasOpenIrMove: irEligiblePlayer !== null,
      irEligiblePlayer
    };
  }

  /**
   * Calculate Net Roster Delta, Suggested Drop Pairing, and Streaming Matrix Scores
   */
  processWaiverWire(freeAgents, userAnalysis, leagueState = {}) {
    const userFaab = Number(leagueState.userFaab ?? this.options.defaultFaabBudget);
    const results = [];

    freeAgents.forEach(fa => {
      const pos = fa.position || 'FLEX';
      let suggestedDrop = null;
      let netDelta = 0;
      let isFreeAdd = false;

      if (userAnalysis.hasOpenIrMove && userAnalysis.irEligiblePlayer) {
        // Free Add by moving injured player to IR
        suggestedDrop = {
          type: 'IR_MOVE',
          player: userAnalysis.irEligiblePlayer,
          text: `Move ${userAnalysis.irEligiblePlayer.full_name || 'Injured Player'} to IR (Free Add)`,
          delta: fa.projected_pts
        };
        netDelta = fa.projected_pts;
        isFreeAdd = true;
      } else if (userAnalysis.bench.length > 0) {
        // Drop candidate: prefer weakest of same position if exists, otherwise overall weakest bench
        const dropCandidate = userAnalysis.weakestByPos[pos] || userAnalysis.weakestBench;
        const dropProj = dropCandidate ? dropCandidate.projected_pts : 0;
        netDelta = Number((fa.projected_pts - dropProj).toFixed(1));

        suggestedDrop = {
          type: 'BENCH_DROP',
          player: dropCandidate,
          text: dropCandidate ? `Drop ${dropCandidate.full_name} (${dropCandidate.position})` : 'Drop Bench Asset',
          delta: netDelta
        };
      } else {
        suggestedDrop = {
          type: 'OPEN_SPOT',
          player: null,
          text: 'Open Roster Spot (No Drop Needed)',
          delta: fa.projected_pts
        };
        netDelta = fa.projected_pts;
        isFreeAdd = true;
      }

      // Calculate Streaming Matchup Score
      const streamingScore = this.calculateStreamingScore(fa);

      // Calculate Tiered FAAB Recommendations
      const faabBids = this.calculateFaabBids(fa, netDelta, userFaab);

      // Determine Badges
      const badges = [];
      if (streamingScore >= 75) {
        badges.push({ type: 'streamer', label: '🛡️ High-Floor Streamer' });
      }
      if (fa.contingent_score >= 80) {
        badges.push({ type: 'handcuff', label: '🔥 Contingent Handcuff' });
      }
      if (netDelta >= 3.5) {
        badges.push({ type: 'upgrade', label: '⚡ Immediate Upgrade' });
      }
      if (isFreeAdd) {
        badges.push({ type: 'free_add', label: '🎁 Free Add (IR Move)' });
      }

      results.push({
        ...fa,
        netDelta,
        suggestedDrop,
        streamingScore,
        faabBids,
        badges,
        isGoldenBone: false // Will mark top value per pos below
      });
    });

    // Mark Top Value Golden Bone Picks
    ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].forEach(pos => {
      const posPlayers = results.filter(p => p.position === pos);
      if (posPlayers.length > 0) {
        posPlayers.sort((a, b) => (b.netDelta + (b.contingent_score * 0.05)) - (a.netDelta + (a.contingent_score * 0.05)));
        posPlayers[0].isGoldenBone = true;
        posPlayers[0].badges.unshift({ type: 'golden_bone', label: '★ Golden Bone Pick' });
      }
    });

    return results;
  }

  /**
   * Positional Streaming Matrix (DEF, QB, TE, K)
   */
  calculateStreamingScore(player) {
    const pos = player.position;
    let score = 50; // Neutral baseline

    // Defense Streaming Logic
    if (pos === 'DEF') {
      const opp = player.opponent || 'OPP';
      // Low implied totals or turnover-prone teams get high streamer scores
      if (['CAR', 'NE', 'NYG', 'TEN', 'LV', 'DEN'].includes(opp)) {
        score = 88;
      } else if (['KC', 'BAL', 'DET', 'SF', 'BUF', 'PHI'].includes(opp)) {
        score = 35;
      } else {
        score = 68;
      }
    }

    // QB & TE Shootout Logic (Over/Under >= 47.5 or weak pass defenses)
    if (pos === 'QB' || pos === 'TE') {
      const opp = player.opponent || '';
      if (['WAS', 'ARI', 'CAR', 'IND', 'TB'].includes(opp)) {
        score = 82;
      } else if (['NYJ', 'BAL', 'CLE', 'SF'].includes(opp)) {
        score = 42;
      } else {
        score = 62;
      }
    }

    // Kicker Weather & Dome Logic
    if (pos === 'K') {
      const domeTeams = ['DET', 'MIN', 'NO', 'ATL', 'IND', 'DAL', 'HOU', 'LV', 'LAR', 'LAC', 'ARI'];
      if (domeTeams.includes(player.team)) {
        score = 85;
      } else {
        score = 65;
      }
    }

    return score;
  }

  /**
   * Contingent Upside Index (1–100 scale for backup RBs / WR depth)
   */
  calculateContingentUpside(player) {
    const pos = player.position;
    if (pos !== 'RB' && pos !== 'WR') return 20;

    const name = (player.full_name || player.name || '').toLowerCase();
    
    // High-priority known handcuffs and target share breakouts
    if (name.includes('benson') || name.includes('corum') || name.includes('allgeier') || 
        name.includes('charbonnet') || name.includes('davis ray') || name.includes('wright')) {
      return 92;
    }
    if (name.includes('shakir') || name.includes('doubs') || name.includes('shaheed') || 
        name.includes('polk') || name.includes('mcmillan') || name.includes('legette')) {
      return 84;
    }

    // Default positional estimate
    if (pos === 'RB') return 58;
    if (pos === 'WR') return 52;
    return 30;
  }

  /**
   * Tiered FAAB Bid Range Guidance
   */
  calculateFaabBids(player, netDelta, userFaab = 100) {
    const faab = Math.max(1, userFaab);
    const pos = player.position;

    let aggPct = 0.22;
    let targetPct = 0.10;
    let specPct = 0.03;

    // High Net Delta or High Handcuff Score increases bid recommendation
    if (netDelta >= 4.0 || player.contingent_score >= 90) {
      aggPct = 0.32;
      targetPct = 0.16;
      specPct = 0.05;
    } else if (netDelta <= 1.0 && player.contingent_score < 70) {
      aggPct = 0.12;
      targetPct = 0.06;
      specPct = 0.02;
    }

    // DEF and K rarely warrant heavy FAAB
    if (pos === 'DEF' || pos === 'K') {
      aggPct = 0.08;
      targetPct = 0.04;
      specPct = 0.01;
    }

    const aggressive = Math.max(2, Math.round(faab * aggPct));
    const targeted = Math.max(1, Math.round(faab * targetPct));
    const speculative = Math.max(0, Math.min(3, Math.round(faab * specPct)));

    return {
      aggressive: {
        dollars: aggressive,
        percent: Math.round(aggPct * 100),
        label: 'Aggressive (Must-Win)'
      },
      targeted: {
        dollars: targeted,
        percent: Math.round(targetPct * 100),
        label: 'Targeted (Value Bid)'
      },
      speculative: {
        dollars: speculative,
        percent: Math.round(specPct * 100),
        label: 'Speculative Flier'
      }
    };
  }

  /**
   * Format a clean, numbered plain-text claim sequence for Sleeper mobile app
   */
  formatClipboardClaimList(waiverTargets = [], leagueInfo = {}) {
    const leagueName = leagueInfo.name || 'Sleeper League';
    const lines = [
      `🐾 Scout Bowie Waiver Wire Priority List`,
      `League: ${leagueName} | Generated: ${new Date().toLocaleDateString()}`,
      `----------------------------------------------------`
    ];

    const topClaims = waiverTargets.slice(0, 10);
    if (topClaims.length === 0) {
      lines.push('No waiver wire claims generated.');
    } else {
      topClaims.forEach((item, index) => {
        const dropText = item.suggestedDrop ? item.suggestedDrop.text : 'Drop Bench Player';
        const deltaPrefix = item.netDelta >= 0 ? `+${item.netDelta}` : `${item.netDelta}`;
        lines.push(`[${index + 1}] ADD: ${item.full_name} (${item.position} - ${item.team || 'FA'})`);
        lines.push(`    BID: $${item.faabBids.targeted.dollars} (${item.faabBids.targeted.percent}% FAAB) | Aggressive: $${item.faabBids.aggressive.dollars}`);
        lines.push(`    ACTION: ${dropText} (Net: ${deltaPrefix} pts)`);
        lines.push(``);
      });
    }

    lines.push(`----------------------------------------------------`);
    lines.push(`Exported from Sleeper Analytics Suite • scout-bowie-analytics.github.io`);
    return lines.join('\n');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WaiverEngine };
}
