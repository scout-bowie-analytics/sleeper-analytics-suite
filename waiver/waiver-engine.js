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
   * Real-Time Injury & Role Inheritance Engine ("Next Man Up")
   * Scans master players for sidelined depth-chart starters and redistributes workload to backups.
   */
  computeRoleInheritance(allPlayersMap = {}, weekProjections = {}) {
    const playersList = Array.isArray(allPlayersMap) ? allPlayersMap : Object.values(allPlayersMap);
    const inheritanceMap = new Map(); // Key: promotedPlayerId -> Inheritance Data

    const sidelinedStatuses = new Set(['OUT', 'IR', 'PUP', 'DOUBTFUL', 'SUSPENDED', 'INACTIVE']);

    // Step 1: Identify all sidelined starters (depth_chart_order: 1 or high projection starter)
    const sidelinedStarters = playersList.filter(p => {
      if (!p || !p.team || !p.position) return false;
      const status = (p.status || '').toUpperCase();
      const injStatus = (p.injury_status || '').toUpperCase();
      const isSidelined = sidelinedStatuses.has(status) || sidelinedStatuses.has(injStatus);
      const isStarter = p.depth_chart_order === 1 || (p.projected_pts && p.projected_pts >= 11.0);
      return isSidelined && isStarter && ['RB', 'WR', 'TE'].includes(p.position);
    });

    // Step 2: For each sidelined starter, calculate workload transfer to backup
    sidelinedStarters.forEach(starter => {
      const starterProj = weekProjections[starter.player_id] !== undefined
        ? Number(weekProjections[starter.player_id])
        : (Number(starter.projected_pts) || 14.0);

      // Find active backups on same team & position
      const teamBackups = playersList.filter(p => 
        p && p.team === starter.team && 
        p.position === starter.position && 
        p.player_id !== starter.player_id &&
        !sidelinedStatuses.has((p.status || '').toUpperCase()) &&
        !sidelinedStatuses.has((p.injury_status || '').toUpperCase())
      );

      // Sort by depth chart order
      teamBackups.sort((a, b) => (Number(a.depth_chart_order) || 99) - (Number(b.depth_chart_order) || 99));

      if (teamBackups.length > 0) {
        const primaryBackup = teamBackups[0];
        let inheritedProj = 0;
        let roleDesc = '';

        if (starter.position === 'RB') {
          // Running Back: Inherits 70% of starter baseline volume
          inheritedProj = Math.max(12.2, Number((starterProj * 0.70).toFixed(1)));
          roleDesc = `Inherited ${starter.full_name || 'RB1'} Lead Workload`;
        } else if (starter.position === 'WR') {
          // Wide Receiver: Inherits 35% vacated target equity
          inheritedProj = Number(((weekProjections[primaryBackup.player_id] || primaryBackup.projected_pts || 7.0) + (starterProj * 0.35)).toFixed(1));
          roleDesc = `Inherited ${starter.full_name || 'WR1'} Target Share`;
        } else if (starter.position === 'TE') {
          // Tight End: Inherits 50% vacated target equity
          inheritedProj = Number(((weekProjections[primaryBackup.player_id] || primaryBackup.projected_pts || 5.0) + (starterProj * 0.50)).toFixed(1));
          roleDesc = `Inherited ${starter.full_name || 'TE1'} Route Equity`;
        }

        inheritanceMap.set(String(primaryBackup.player_id), {
          promotedPlayerId: String(primaryBackup.player_id),
          starterName: starter.full_name || 'Starter',
          starterPos: starter.position,
          starterTeam: starter.team,
          starterProj,
          inheritedProj,
          roleDesc,
          isNextManUp: true
        });
      }
    });

    return inheritanceMap;
  }

  /**
   * Helper to format large trending counts into compact ticker strings (e.g. 520560 -> 520.6k)
   */
  formatTrendingCount(count) {
    if (!count || count <= 0) return '0';
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M`;
    }
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}k`;
    }
    return `${count}`;
  }

  /**
   * Extract unowned free agents from master player pool and league rosters
   */
  extractFreeAgents(allPlayersMap, rosters = [], weekProjections = {}, trendingAddsMap = {}, trendingDropsMap = {}) {
    if (!allPlayersMap || typeof allPlayersMap !== 'object') return [];

    // Step 1: Compute Real-Time Role Inheritances ("Next Man Up")
    const inheritanceMap = this.computeRoleInheritance(allPlayersMap, weekProjections);

    // Step 2: Build Set of all currently rostered player IDs across the league
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
          const team = (player.team || '').trim();
          const hasNflTeam = team && team !== 'FA' && team !== 'None' && team !== 'FA*';
          const status = (player.status || '').toUpperCase();
          const injStatus = (player.injury_status || '').toUpperCase();
          const sidelinedStatuses = new Set(['IR', 'PUP', 'OUT', 'SUSPENDED', 'INACTIVE', 'FREE AGENT', 'RETIRED', 'DNR']);
          const isSidelined = sidelinedStatuses.has(status) || sidelinedStatuses.has(injStatus);

          // If player is not on an NFL team or is on IR/PUP/OUT, projection MUST be 0.0 pts
          let rawProj = 0;
          if (hasNflTeam && !isSidelined) {
            if (weekProjections[pid] !== undefined && Number(weekProjections[pid]) > 0) {
              rawProj = Number(weekProjections[pid]);
            } else if (player.projected_pts !== undefined && Number(player.projected_pts) > 0) {
              rawProj = Number(player.projected_pts);
            } else if (player.projected_points !== undefined && Number(player.projected_points) > 0) {
              rawProj = Number(player.projected_points);
            } else if (pos === 'DEF') {
              rawProj = 7.0 + (['SF', 'BAL', 'NYJ', 'CLE', 'DAL', 'KC', 'BUF', 'PHI'].includes(player.team || pid) ? 1.5 : 0);
            } else if (pos === 'K') {
              rawProj = 7.2;
            } else {
              rawProj = 0;
            }
          }

          // Check if this player inherited a starting role
          const inheritance = (hasNflTeam && !isSidelined) ? (inheritanceMap.get(pid) || null) : null;
          const finalProj = inheritance 
            ? Math.max(rawProj, inheritance.inheritedProj)
            : rawProj;

          // Calculate Contingent Handcuff Score (1-100)
          const baseContingent = hasNflTeam ? this.calculateContingentUpside(player) : 0;
          const contingentScore = (hasNflTeam && inheritance) ? 96 : baseContingent;

          // Check if player is an Elite IR/PUP Stash on return watch
          const isIrStash = hasNflTeam && isSidelined && ['IR', 'PUP', 'OUT'].includes(injStatus || status) && 
            ((player.projected_pts && player.projected_pts >= 7.5) || player.depth_chart_order === 1 || baseContingent >= 60);

          const returnBaseline = isIrStash ? Number((player.projected_pts || player.projected_points || 11.5).toFixed(1)) : 0;

          // Real-Time Stock Ticker Adds / Drops
          const addCount = Number(trendingAddsMap[pid] ?? player.trending_adds ?? 0);
          const dropCount = Number(trendingDropsMap[pid] ?? player.trending_drops ?? 0);
          let trend = null;
          if (addCount >= 1000) {
            trend = {
              type: 'UP',
              count: addCount,
              formatted: `▲ +${this.formatTrendingCount(addCount)}`
            };
          } else if (dropCount >= 1000) {
            trend = {
              type: 'DOWN',
              count: dropCount,
              formatted: `▼ -${this.formatTrendingCount(dropCount)}`
            };
          }

          const fullName = player.full_name || 
            (player.first_name && player.last_name ? `${player.first_name} ${player.last_name}`.trim() : null) || 
            player.name || 
            (pos === 'DEF' ? `${player.first_name || player.team || pid} ${player.last_name || 'Defense'}`.trim() : `Player ${pid}`);

          const avatar = player.avatar || 
            (pos === 'DEF' 
              ? `https://sleepercdn.com/images/team_logos/nfl/${(player.team || pid).toLowerCase()}.png` 
              : `https://sleepercdn.com/content/nfl/players/thumb/${pid}.jpg`);

          // Exclude players not on an NFL team, and non-stash inactive noise
          if (hasNflTeam && (!isSidelined || isIrStash) && (finalProj >= this.options.minProjectionThreshold || contingentScore >= 65 || pos === 'DEF' || inheritance || isIrStash || addCount >= 10000)) {
            freeAgents.push({
              ...player,
              player_id: pid,
              full_name: fullName,
              name: fullName,
              avatar,
              raw_projected_pts: Number(rawProj.toFixed(1)),
              projected_pts: Number(finalProj.toFixed(1)),
              contingent_score: contingentScore,
              inheritance,
              isNextManUp: inheritance !== null,
              isIrStash: Boolean(isIrStash),
              return_baseline_pts: returnBaseline,
              trending_adds: addCount,
              trending_drops: dropCount,
              trend,
              is_free_agent: true
            });
          }
        }
      }
    });

    return freeAgents;
  }

  /**
   * Analyze user's current roster to identify starters, bench depth, cut candidates, and IR lock risks
   */
  analyzeUserRoster(userRoster, allPlayersMap = {}, weekProjections = {}, trendingDropsMap = {}) {
    if (!userRoster || !Array.isArray(userRoster.players)) {
      return {
        starters: [],
        bench: [],
        reserve: [],
        weakestBench: null,
        weakestByPos: {},
        hasOpenIrMove: false,
        irEligiblePlayer: null,
        hasIrLockWarning: false,
        lockedPlayer: null
      };
    }

    const starterIds = new Set((userRoster.starters || []).map(id => String(id)));
    const reserveIds = new Set((userRoster.reserve || []).map(id => String(id)));
    const allRosterPids = (userRoster.players || []).map(id => String(id));

    const starters = [];
    const bench = [];
    const reserve = [];
    let irEligiblePlayer = null;
    let hasIrLockWarning = false;
    let lockedPlayer = null;

    const validIrStatuses = new Set(['IR', 'PUP', 'OUT', 'SUSPENDED', 'COV', 'DNR']);

    // Check Reserve (IR Slots) for Roster Lock Warnings
    if (Array.isArray(userRoster.reserve)) {
      userRoster.reserve.forEach(pid => {
        const p = allPlayersMap[String(pid)] || { player_id: pid, full_name: `Player ${pid}` };
        reserve.push(p);
        const pStatus = (p.status || '').toUpperCase();
        const pInj = (p.injury_status || '').toUpperCase();
        if (!validIrStatuses.has(pInj) && !validIrStatuses.has(pStatus)) {
          hasIrLockWarning = true;
          lockedPlayer = {
            ...p,
            currentStatus: p.injury_status || 'Active'
          };
        }
      });
    }

    allRosterPids.forEach(pid => {
      if (reserveIds.has(pid)) return; // Already processed in reserve

      const player = allPlayersMap[pid] || { player_id: pid, full_name: `Player ${pid}`, position: 'FLEX' };
      const team = (player.team || '').trim();
      const hasNflTeam = team && team !== 'FA' && team !== 'None' && team !== 'FA*';
      const status = (player.status || '').toUpperCase();
      const injStatus = (player.injury_status || '').toUpperCase();
      const sidelinedStatuses = new Set(['IR', 'PUP', 'OUT', 'SUSPENDED', 'INACTIVE', 'FREE AGENT', 'RETIRED', 'DNR']);
      const isSidelined = sidelinedStatuses.has(status) || sidelinedStatuses.has(injStatus);

      let proj = 0;
      if (hasNflTeam && !isSidelined) {
        proj = weekProjections[pid] !== undefined 
          ? Number(weekProjections[pid]) 
          : (Number(player.projected_pts) || 0);
      }

      const dropCount = Number(trendingDropsMap[pid] ?? player.trending_drops ?? 0);
      let trend = null;
      if (dropCount >= 1000) {
        trend = {
          type: 'DOWN',
          count: dropCount,
          formatted: `▼ -${this.formatTrendingCount(dropCount)}`
        };
      }

      const fullName = player.full_name || 
        (player.first_name && player.last_name ? `${player.first_name} ${player.last_name}`.trim() : null) || 
        player.name || 
        (player.position === 'DEF' ? `${player.first_name || player.team || pid} ${player.last_name || 'Defense'}`.trim() : `Player ${pid}`);

      const decorated = {
        ...player,
        player_id: pid,
        full_name: fullName,
        name: fullName,
        projected_pts: Number(proj.toFixed(1)),
        isStarter: starterIds.has(pid),
        isBench: !starterIds.has(pid),
        hasNflTeam,
        isSidelined,
        trending_drops: dropCount,
        trend
      };

      if (starterIds.has(pid)) {
        starters.push(decorated);
      } else {
        bench.push(decorated);
        // Check if player on bench is OUT/IR/PUP eligible
        if (isSidelined || ['OUT', 'IR', 'PUP'].includes(player.status) || ['OUT', 'IR', 'PUP'].includes(player.injury_status)) {
          irEligiblePlayer = decorated;
        }
      }
    });

    // Sort bench by lowest projected points first to find weakest drop candidates
    bench.sort((a, b) => a.projected_pts - b.projected_pts);

    const weakestBench = bench.length > 0 ? bench[0] : null;

    // Weakest by position (for K and DEF, prioritize existing K/DEF assets to prevent dropping skill players)
    const weakestByPos = {};
    ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].forEach(pos => {
      const posBench = bench.filter(p => p.position === pos);
      posBench.sort((a, b) => a.projected_pts - b.projected_pts);
      if (posBench.length > 0) {
        weakestByPos[pos] = posBench[0];
      } else if (pos === 'K' || pos === 'DEF') {
        const starterAsset = starters.find(p => p.position === pos);
        weakestByPos[pos] = starterAsset || null;
      } else {
        weakestByPos[pos] = weakestBench;
      }
    });

    return {
      starters,
      bench,
      reserve,
      weakestBench,
      weakestByPos,
      hasOpenIrMove: irEligiblePlayer !== null,
      irEligiblePlayer,
      hasIrLockWarning,
      lockedPlayer
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

      if (pos === 'K') {
        const existingK = userAnalysis.weakestByPos['K'];
        if (existingK) {
          netDelta = Number((fa.projected_pts - existingK.projected_pts).toFixed(1));
          suggestedDrop = {
            type: 'KICKER_SWAP',
            player: existingK,
            text: `Streamer Swap: Drop ${existingK.full_name} (K)`,
            delta: netDelta
          };
        } else {
          netDelta = fa.projected_pts;
          suggestedDrop = {
            type: 'OPEN_SPOT',
            player: null,
            text: 'Starting Kicker Slot (No Drop Needed)',
            delta: netDelta
          };
          isFreeAdd = true;
        }
      } else if (pos === 'DEF' && userAnalysis.weakestByPos['DEF']) {
        const existingDef = userAnalysis.weakestByPos['DEF'];
        netDelta = Number((fa.projected_pts - existingDef.projected_pts).toFixed(1));
        suggestedDrop = {
          type: 'DEF_SWAP',
          player: existingDef,
          text: `Streamer Swap: Drop ${existingDef.full_name} (DEF)`,
          delta: netDelta
        };
      } else if (userAnalysis.hasOpenIrMove && userAnalysis.irEligiblePlayer) {
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
      if (fa.isNextManUp && fa.inheritance) {
        badges.push({ type: 'next_man_up', label: `🚨 Next Man Up: ${fa.inheritance.roleDesc}` });
      }
      if (fa.isIrStash) {
        badges.push({ type: 'ir_stash', label: '⏳ Return Watch: Elite IR Stash' });
      }
      if (streamingScore >= 75 && !fa.isIrStash) {
        badges.push({ type: 'streamer', label: '🛡️ High-Floor Streamer' });
      }
      if (fa.contingent_score >= 80 && !fa.isNextManUp && !fa.isIrStash) {
        badges.push({ type: 'handcuff', label: '🔥 Contingent Handcuff' });
      }
      if (netDelta >= 3.5 && !fa.isIrStash) {
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

    // Next Man Up (Inherited Starter Role) triggers top-tier aggressive bidding
    if (player.isNextManUp && player.position === 'RB') {
      aggPct = 0.45;
      targetPct = 0.25;
      specPct = 0.08;
    } else if (player.isNextManUp) {
      aggPct = 0.35;
      targetPct = 0.18;
      specPct = 0.05;
    } else if (netDelta >= 4.0 || player.contingent_score >= 90) {
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
