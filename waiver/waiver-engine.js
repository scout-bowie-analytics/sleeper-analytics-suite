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

    // Step 1: Identify all sidelined starters (depth_chart_order: 1, known star names, or high projection starter)
    const sidelinedStarters = playersList.filter(p => {
      if (!p || !p.team || !p.position || !['RB', 'WR', 'TE'].includes(p.position)) return false;
      const status = (p.status || '').toUpperCase();
      const injStatus = (p.injury_status || '').toUpperCase();
      const isSidelined = sidelinedStatuses.has(status) || sidelinedStatuses.has(injStatus) || p.active === false;
      if (!isSidelined) return false;

      // Critical check: if there is an active, healthy starter (depth_chart_order: 1) on the same team,
      // a sidelined depth/backup player cannot trigger an RB1/WR1/TE1 starter vacancy!
      const healthyStarter = playersList.find(other => 
        other && other.team === p.team && other.position === p.position && 
        other.player_id !== p.player_id &&
        other.depth_chart_order === 1 &&
        !sidelinedStatuses.has((other.status || '').toUpperCase()) &&
        !sidelinedStatuses.has((other.injury_status || '').toUpperCase()) &&
        other.active !== false
      );
      if (healthyStarter) return false;
      
      const pNameLower = (p.full_name || p.name || '').toLowerCase();
      const isKnownLead = [
        'achane', 'mccaffrey', 'breece hall', 'bijan robinson', 'saquon barkley', 
        'jonathan taylor', 'derrick henry', 'kyren williams', 'travis etienne', 
        'jahmyr gibbs', 'isiah pacheco', 'kenneth walker', 'james cook', 
        'josh jacobs', 'alvin kamara', 'puka nacua', 'jamarr chase', 
        'justin jefferson', 'ceedee lamb', 'amon-ra st. brown'
      ].some(n => pNameLower.includes(n));
      const isStarter = p.depth_chart_order === 1 || (p.projected_pts && p.projected_pts >= 11.0) || isKnownLead || (p.search_rank && p.search_rank <= 60);

      return isStarter;
    });

    // Step 2: For each sidelined starter, calculate workload transfer to backup
    sidelinedStarters.forEach(starter => {
      const starterProj = weekProjections[starter.player_id] !== undefined
        ? Number(weekProjections[starter.player_id])
        : (Number(starter.projected_pts) || Number(starter.raw_projected_pts) || 14.5);

      const notes = (starter.injury_notes || '').toLowerCase();
      const status = (starter.status || '').toUpperCase();
      const injStatus = (starter.injury_status || '').toUpperCase();
      const isSeasonEnding = notes.includes('out for season') || notes.includes('out for the year') || 
                             notes.includes('torn acl') || notes.includes('torn achilles') || 
                             notes.includes('season-ending') || status === 'IR' || injStatus === 'IR';

      const sNameLower = (starter.full_name || starter.name || '').toLowerCase();
      const isEliteRb1 = (starter.position === 'RB') && (
        starterProj >= 12.0 || starter.depth_chart_order === 1 || 
        ['achane', 'mccaffrey', 'breece hall', 'bijan', 'barkley', 'taylor', 'henry', 'williams', 'etienne', 'gibbs'].some(n => sNameLower.includes(n))
      );

      // Find active backups on same team & position (excluding fullbacks)
      const teamBackups = playersList.filter(p => 
        p && p.team === starter.team && 
        p.position === starter.position && 
        p.player_id !== starter.player_id &&
        !sidelinedStatuses.has((p.status || '').toUpperCase()) &&
        !sidelinedStatuses.has((p.injury_status || '').toUpperCase()) &&
        p.position !== 'FB' && p.depth_chart_position !== 'FB'
      );

      // Sort by depth chart order
      teamBackups.sort((a, b) => (Number(a.depth_chart_order) || 99) - (Number(b.depth_chart_order) || 99));

      if (teamBackups.length > 0) {
        // ONLY Promote Primary Direct Successor (e.g. Ollie Gordon / Braelon Allen)
        const primaryBackup = teamBackups[0];
        let inheritedProj = 0;
        let roleDesc = '';

        if (starter.position === 'RB') {
          // Running Back: Inherits 75% of starter baseline volume for season-ending, 70% for short-term
          const sharePct = isSeasonEnding ? 0.75 : 0.70;
          inheritedProj = Math.max(13.5, Number((starterProj * sharePct).toFixed(1)));
          roleDesc = isSeasonEnding 
            ? `Inherited ${starter.full_name || 'RB1'} Lead Workload (Season-Ending Takeover)`
            : `Inherited ${starter.full_name || 'RB1'} Lead Workload`;
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
          isNextManUp: true,
          injuredPlayer: starter,
          isSeasonEnding,
          isEliteRb1
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
  extractFreeAgents(allPlayersMap, rosters = [], weekProjections = {}, trendingAddsMap = {}, trendingDropsMap = {}, scoringSettings = null) {
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
        if (Array.isArray(r.taxi)) {
          r.taxi.forEach(pid => {
            if (pid) rosteredIds.add(String(pid));
          });
        }
      });
    }

    const isRealLeague = Array.from(rosteredIds).some(id => /^\d+$/.test(id));

    const freeAgents = [];
    const playersList = Array.isArray(allPlayersMap) ? allPlayersMap : Object.values(allPlayersMap);

    playersList.forEach(player => {
      if (!player || !player.player_id) return;
      const pid = String(player.player_id);

      // In a real Sleeper league with numeric IDs, skip synthetic mock IDs (p_*)
      if (isRealLeague && pid.startsWith('p_')) return;

      // Must not be rostered and must be an active NFL asset
      if (!rosteredIds.has(pid)) {
        let pos = (player.position || '').toUpperCase();
        if (!pos && Array.isArray(player.fantasy_positions) && player.fantasy_positions.length > 0) {
          pos = String(player.fantasy_positions[0]).toUpperCase();
        }

        // Filter out Fullbacks (both by position and depth chart position or known fullbacks)
        const isFullback = pos === 'FB' || (player.depth_chart_position || '').toUpperCase() === 'FB';
        if (isFullback) return;

        const knownFullbacks = new Set([
          'andrew beck', 'kyle juszczyk', 'patrick ricard', 'alec ingold', 
          'c.j. ham', 'cj ham', 'jakob johnson', 'keith smith', 
          'reggie gilliam', 'khari blasingame', 'adam prentice'
        ]);
        if (knownFullbacks.has((player.full_name || player.name || '').toLowerCase().trim())) return;

        const validFantasyPositions = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
        if (!validFantasyPositions.has(pos)) {
          return; // Skip IDP, offensive linemen, snappers, or null positions
        }

        const team = (player.team || '').trim();
        const hasNflTeam = team && team !== 'FA' && team !== 'None' && team !== 'FA*';
        if (!hasNflTeam) return;

        const status = (player.status || '').toUpperCase();
        const injStatus = (player.injury_status || '').toUpperCase();
        const sidelinedStatuses = new Set(['IR', 'PUP', 'OUT', 'SUSPENDED', 'INACTIVE', 'FREE AGENT', 'RETIRED', 'DNR']);
        const isSidelined = sidelinedStatuses.has(status) || sidelinedStatuses.has(injStatus) || player.active === false;

        // If player is not on an NFL team or is on IR/PUP/OUT, projection MUST be 0.0 pts
        let rawProj = 0;
        if (hasNflTeam && !isSidelined) {
          if (weekProjections && weekProjections[pid] !== undefined && Number(weekProjections[pid]) > 0) {
            rawProj = Number(weekProjections[pid]);
          } else if (player.projected_pts !== undefined && Number(player.projected_pts) > 0) {
            rawProj = Number(player.projected_pts);
          } else if (player.projected_points !== undefined && Number(player.projected_points) > 0) {
            rawProj = Number(player.projected_points);
          } else {
            rawProj = this.estimatePlayerProjection(player, scoringSettings);
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

        // Check if player is an Elite IR/PUP Stash on return watch (official IR/PUP only)
        const isIrStash = hasNflTeam && isSidelined && ['IR', 'IR-R', 'INJURED_RESERVE', 'PUP'].includes(injStatus || status) && 
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
            position: pos,
            fantasy_positions: [pos],
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
    });

    return freeAgents;
  }

  /**
   * Hard Drop Protection Rule
   * Prevents suggesting dropping top draft capital (Rounds 1–6), high-value stars,
   * and weekly anchors regardless of temporary injury status (OUT / QUES / DOUBTFUL).
   * Only players officially on IR with season-ending designations are drop-eligible when IR slots are saturated.
   */
  isDropProtected(player) {
    if (!player) return false;
    const pos = (player.position || '').toUpperCase();
    if (pos === 'K' || pos === 'DEF') {
      return false; // K and DEF are never drop-protected streamers
    }

    const notes = (player.injury_notes || '').toLowerCase();
    const isSeasonEnding = notes.includes('out for season') || notes.includes('out for the year') || 
                           notes.includes('torn acl') || notes.includes('torn achilles') || 
                           notes.includes('season-ending');

    // Season-ending IR players without dynasty retention are not drop-protected
    if (isSeasonEnding) {
      return false;
    }

    const name = (player.full_name || player.name || '').toLowerCase().trim();

    // 1. Explicit Elite Stars & Core Staples (Never drop: Puka Nacua, Travis Etienne, etc.)
    const eliteNames = [
      'nacua', 'puka', 'etienne', 'achane', 'jefferson', 'chase', 'lamb', 'st. brown',
      'breece hall', 'bijan', 'mccaffrey', 'gibbs', 'barkley', 'jonathan taylor',
      'derrick henry', 'kyren williams', 'josh allen', 'lamar jackson', 'hurts',
      'mahomes', 'kelce', 'laporta', 'mcbride', 'garrett wilson', 'olave',
      'drake london', 'nico collins', 'marvin harrison', 'nabers', 'devonta smith',
      'aiyuk', 'dk metcalf', 'dj moore', 'kupp', 'waddle', 'kittle', 'andrews',
      'kincaid', 'kenneth walker', 'james cook', 'josh jacobs', 'mixon', 'kamara',
      'rachaad white', 'pacheco', 'david montgomery', 'deebo samuel', 'mclaurin',
      'tee higgins', 'amari cooper', 'pickens', 'rashee rice', 'brian thomas',
      'kyle pitts', 'engram', 'bowers', 'james conner', 'swift', 'pollard',
      'najee harris', 'jaylen warren', 'mostert', 'brian robinson', 'hubbard',
      'jayden daniels', 'kyler murray', 'anthony richardson', 'stroud', 'prescott',
      'jordan love', 'burrow', 'purdy'
    ];

    if (eliteNames.some(star => name.includes(star))) {
      return true;
    }

    // 2. Draft Capital: Rounds 1–6 (Search rank or ADP <= 75)
    const searchRank = Number(player.search_rank || 999);
    if (searchRank > 0 && searchRank <= 75) {
      return true;
    }

    // 3. High Baseline Talent (healthy projected points >= 9.5 or starter depth chart)
    const rawProj = Number(player.raw_projected_pts || player.projected_pts || player.return_baseline_pts || 0);
    if (rawProj >= 9.5) {
      return true;
    }

    if (player.depth_chart_order === 1 && ['QB', 'RB', 'WR', 'TE'].includes(pos)) {
      return true;
    }

    return false;
  }

  /**
   * Analyze user's current roster to identify starters, bench depth, cut candidates, and IR lock risks
   */
  analyzeUserRoster(userRoster, allPlayersMap = {}, weekProjections = {}, trendingDropsMap = {}, scoringSettings = null, leagueContext = {}) {
    if (!userRoster || !Array.isArray(userRoster.players)) {
      return {
        starters: [],
        bench: [],
        reserve: [],
        weakestBench: null,
        weakestByPos: {},
        totalIrSlots: 0,
        openIrSlots: 0,
        hasOpenIrMove: false,
        irEligiblePlayer: null,
        hasIrLockWarning: false,
        lockedPlayer: null
      };
    }

    // 1. Calculate League IR Slot Capacity & Rules
    const rawPositions = leagueContext.rosterPositions || leagueContext.league?.roster_positions || [];
    const irSlotsInPositions = rawPositions.filter(pos => pos === 'IR' || pos === 'RESERVE').length;
    const reserveSlotsSetting = Number(leagueContext.leagueSettings?.reserve_slots ?? leagueContext.league?.settings?.reserve_slots ?? irSlotsInPositions);
    const totalIrSlots = Math.max(irSlotsInPositions, reserveSlotsSetting);

    // Count current reserve slots used
    const currentReserveCount = Array.isArray(userRoster.reserve) ? userRoster.reserve.length : 0;
    const openIrSlots = Math.max(0, totalIrSlots - currentReserveCount);

    // League setting: whether OUT / SUS / DOUBTFUL players are allowed in IR slots
    const allowOutInIr = Boolean(
      leagueContext.leagueSettings?.reserve_allow_out === 1 || 
      leagueContext.league?.settings?.reserve_allow_out === 1
    );
    const allowSusInIr = Boolean(
      leagueContext.leagueSettings?.reserve_allow_sus === 1 || 
      leagueContext.league?.settings?.reserve_allow_sus === 1
    );
    const allowDoubtfulInIr = Boolean(
      leagueContext.leagueSettings?.reserve_allow_doubtful === 1 || 
      leagueContext.league?.settings?.reserve_allow_doubtful === 1
    );

    const starterIds = new Set((userRoster.starters || []).map(id => String(id)));
    const reserveIds = new Set((userRoster.reserve || []).map(id => String(id)));
    const allRosterPids = (userRoster.players || []).map(id => String(id));

    const starters = [];
    const bench = [];
    const reserve = [];
    let irEligiblePlayer = null;
    let hasIrLockWarning = false;
    let lockedPlayer = null;

    const validIrStatuses = new Set(['IR', 'IR-R', 'INJURED_RESERVE', 'PUP']);
    if (allowOutInIr) validIrStatuses.add('OUT');
    if (allowSusInIr) { validIrStatuses.add('SUS'); validIrStatuses.add('SUSPENDED'); }
    if (allowDoubtfulInIr) validIrStatuses.add('DOUBTFUL');

    // Check Reserve (IR Slots) for Roster Lock Warnings
    if (Array.isArray(userRoster.reserve)) {
      userRoster.reserve.forEach(pid => {
        const p = allPlayersMap[String(pid)] || { player_id: pid, full_name: `Player ${pid}` };
        reserve.push(p);
        const pStatus = (p.status || '').toUpperCase().trim();
        const pInj = (p.injury_status || '').toUpperCase().trim();
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
      const status = (player.status || '').toUpperCase().trim();
      const injStatus = (player.injury_status || '').toUpperCase().trim();
      const sidelinedStatuses = new Set(['IR', 'IR-R', 'INJURED_RESERVE', 'PUP', 'OUT', 'SUSPENDED', 'SUS', 'INACTIVE', 'FREE AGENT', 'RETIRED', 'DNR']);
      const isSidelined = sidelinedStatuses.has(status) || sidelinedStatuses.has(injStatus);

      let proj = 0;
      if (hasNflTeam && !isSidelined) {
        if (weekProjections && weekProjections[pid] !== undefined && Number(weekProjections[pid]) > 0) {
          proj = Number(weekProjections[pid]);
        } else if (player.projected_pts !== undefined && Number(player.projected_pts) > 0) {
          proj = Number(player.projected_pts);
        } else if (player.projected_points !== undefined && Number(player.projected_points) > 0) {
          proj = Number(player.projected_points);
        } else {
          proj = this.estimatePlayerProjection(player, scoringSettings);
        }
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
      }

      // Check if player on active roster / bench is officially IR-eligible AND an open IR slot exists
      const isOfficialIr = ['IR', 'IR-R', 'INJURED_RESERVE', 'PUP'].includes(injStatus) || 
                           ['IR', 'IR-R', 'INJURED_RESERVE', 'PUP'].includes(status);
      const isOutEligible = allowOutInIr && (injStatus === 'OUT' || status === 'OUT');
      const isSusEligible = allowSusInIr && (injStatus === 'SUSPENDED' || status === 'SUSPENDED' || injStatus === 'SUS' || status === 'SUS');
      const isDoubtfulEligible = allowDoubtfulInIr && (injStatus === 'DOUBTFUL' || status === 'DOUBTFUL');

      const isIrEligible = isOfficialIr || isOutEligible || isSusEligible || isDoubtfulEligible;

      if (isIrEligible && openIrSlots > 0 && !irEligiblePlayer) {
        irEligiblePlayer = decorated;
      }
    });

    // Sort bench by lowest projected points first to find weakest drop candidates,
    // strictly excluding untouchable stars via Hard Drop Protection (e.g. Puka Nacua, Travis Etienne)
    const droppableBench = bench.filter(p => !this.isDropProtected(p));
    droppableBench.sort((a, b) => a.projected_pts - b.projected_pts);

    // Strictly isolate Skill bench assets from DEF/K to prevent cross-positional drop pollution
    const skillPositions = new Set(['QB', 'RB', 'WR', 'TE']);
    const droppableSkillBench = droppableBench.filter(p => skillPositions.has(p.position));
    const weakestSkillBench = droppableSkillBench.length > 0 ? droppableSkillBench[0] : null;
    const weakestBench = droppableBench.length > 0 ? droppableBench[0] : null;

    // Weakest by position (strictly respecting Hard Drop Protection and positional boundaries)
    const weakestByPos = {};
    ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].forEach(pos => {
      const posBench = droppableBench.filter(p => p.position === pos);
      posBench.sort((a, b) => a.projected_pts - b.projected_pts);
      if (posBench.length > 0) {
        weakestByPos[pos] = posBench[0];
      } else if (pos === 'K' || pos === 'DEF') {
        const starterAsset = starters.find(p => p.position === pos);
        weakestByPos[pos] = starterAsset || null;
      } else {
        // For skill positions: ONLY fall back to weakestSkillBench, NEVER to DEF or K!
        weakestByPos[pos] = weakestSkillBench;
      }
    });

    const hasOpenIrMove = Boolean(openIrSlots > 0 && irEligiblePlayer !== null);

    return {
      starters,
      bench,
      reserve,
      weakestBench,
      weakestSkillBench,
      weakestByPos,
      totalIrSlots,
      openIrSlots,
      hasOpenIrMove,
      irEligiblePlayer: hasOpenIrMove ? irEligiblePlayer : null,
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
      } else if (pos === 'DEF') {
        const existingDef = userAnalysis.weakestByPos['DEF'];
        if (existingDef) {
          netDelta = Number((fa.projected_pts - existingDef.projected_pts).toFixed(1));
          suggestedDrop = {
            type: 'DEF_SWAP',
            player: existingDef,
            text: `Streamer Swap: Drop ${existingDef.full_name} (DEF)`,
            delta: netDelta
          };
        } else {
          netDelta = fa.projected_pts;
          suggestedDrop = {
            type: 'OPEN_SPOT',
            player: null,
            text: 'Starting Defense Slot (No Drop Needed)',
            delta: netDelta
          };
          isFreeAdd = true;
        }
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
      } else {
        // Skill position addition (QB, RB, WR, TE): strictly compare against SKILL bench
        const dropCandidate = userAnalysis.weakestByPos[pos] || userAnalysis.weakestSkillBench;
        if (dropCandidate) {
          const dropProj = dropCandidate.projected_pts || 0;
          netDelta = Number((fa.projected_pts - dropProj).toFixed(1));
          suggestedDrop = {
            type: 'BENCH_DROP',
            player: dropCandidate,
            text: `Drop ${dropCandidate.full_name} (${dropCandidate.position})`,
            delta: netDelta
          };
        } else if (userAnalysis.bench.length > 0) {
          // All skill bench players are protected (e.g. Puka Nacua, Travis Etienne).
          // Strictly DO NOT suggest dropping K or DEF for a skill player!
          suggestedDrop = {
            type: 'BENCH_PROTECTED',
            player: null,
            text: 'Bench Protected (No Safe Drop Available)',
            delta: 0
          };
          netDelta = 0;
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
      }

      // Calculate Streaming Matchup Score
      const streamingScore = this.calculateStreamingScore(fa);

      // Calculate Single Smart FAAB Recommendation & Tiered Fallback
      const faabBid = this.calculateSmartFaabBid(fa, netDelta, userFaab, leagueState);
      const faabBids = this.calculateFaabBids(fa, netDelta, userFaab, leagueState);

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
        faabBid,
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
   * Baseline Player Projection Estimator (when external projections feed is missing or off-season)
   */
  estimatePlayerProjection(player, scoringSettings = null) {
    if (!player) return 0.0;
    const team = (player.team || '').trim();
    if (!team || team === 'FA' || team === 'None' || team === 'FA*') return 0.0;

    const status = (player.status || '').toUpperCase();
    const injStatus = (player.injury_status || '').toUpperCase();
    const sidelinedStatuses = new Set(['IR', 'PUP', 'OUT', 'SUSPENDED', 'INACTIVE', 'FREE AGENT', 'RETIRED', 'DNR']);
    if (sidelinedStatuses.has(status) || sidelinedStatuses.has(injStatus) || player.active === false) return 0.0;

    let pos = (player.position || '').toUpperCase();
    if (!pos && Array.isArray(player.fantasy_positions) && player.fantasy_positions.length > 0) {
      pos = String(player.fantasy_positions[0]).toUpperCase();
    }
    const validFantasyPositions = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
    if (!validFantasyPositions.has(pos)) return 0.0;

    const hasExplicitOrder = player.depth_chart_order !== null && player.depth_chart_order !== undefined && !isNaN(Number(player.depth_chart_order));
    const order = hasExplicitOrder ? Number(player.depth_chart_order) : 4;
    const ppr = scoringSettings?.rec !== undefined ? scoringSettings.rec : 1.0;

    // Deterministic pseudo-random variation based on player name/ID
    let hash = 0;
    const str = String(player.player_id || player.full_name || player.name || '100');
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    const pseudoRand = (Math.abs(hash) % 100) / 100; // 0.00 to 0.99

    switch (pos) {
      case 'QB':
        if (order === 1) return Number((16.5 + pseudoRand * 5.5).toFixed(1));
        if (order === 2) return Number((4.5 + pseudoRand * 3.5).toFixed(1));
        return Number((1.5 + pseudoRand * 2.0).toFixed(1));

      case 'RB':
        if (order === 1) return Number((12.5 + pseudoRand * 5.5 + ppr * 2.0).toFixed(1));
        if (order === 2) return Number((6.8 + pseudoRand * 3.8 + ppr * 1.2).toFixed(1));
        if (order === 3) return Number((3.5 + pseudoRand * 2.5).toFixed(1));
        return Number((1.2 + pseudoRand * 1.5).toFixed(1));

      case 'WR':
        if (order === 1) return Number((11.5 + pseudoRand * 5.5 + ppr * 3.0).toFixed(1));
        if (order === 2) return Number((8.2 + pseudoRand * 3.8 + ppr * 2.0).toFixed(1));
        if (order === 3) return Number((5.5 + pseudoRand * 3.0 + ppr * 1.2).toFixed(1));
        return Number((2.0 + pseudoRand * 2.0).toFixed(1));

      case 'TE':
        if (order === 1) return Number((7.8 + pseudoRand * 5.0 + ppr * 2.2).toFixed(1));
        if (order === 2) return Number((3.5 + pseudoRand * 2.5 + ppr * 0.8).toFixed(1));
        return Number((1.2 + pseudoRand * 1.5).toFixed(1));

      case 'K':
        return Number((7.0 + pseudoRand * 3.0).toFixed(1));

      case 'DEF':
        const isEliteDef = ['SF', 'BAL', 'NYJ', 'CLE', 'DAL', 'KC', 'BUF', 'PHI'].includes(player.team || player.player_id);
        return Number((isEliteDef ? 8.5 : (6.5 + pseudoRand * 2.0)).toFixed(1));

      default:
        return Number((5.0 + pseudoRand * 3.0).toFixed(1));
    }
  }

  /**
   * Single Smart FAAB Bidding Optimizer
   * Calculates 1 precise recommended dollar amount based on Week/State awareness,
   * Net Delta, Role Inheritance, Market Velocity, Time Decay, and League Transaction History.
   */
  calculateSmartFaabBid(player, netDelta, userFaab = 100, leagueContext = {}) {
    const isWeek0 = Boolean(leagueContext.isWeek0 || leagueContext.isFreeAgencyPeriod);
    const isExplicitWaiver = Boolean(player.is_on_waivers || player.waiver_status === 'waivers');

    // In Week 0 / Pre-Season (or Open Free Agency without a waiver hold), price is $0 Free Add
    if (isWeek0 && !isExplicitWaiver) {
      return {
        dollars: 0,
        percent: 0,
        isFreeAdd: true,
        label: '$0 (Free Add)'
      };
    }

    const faab = Math.max(0, userFaab);
    if (faab === 0) {
      return {
        dollars: 0,
        percent: 0,
        isFreeAdd: false,
        label: '$0 (0%)'
      };
    }

    const pos = player.position || 'FLEX';
    let basePct = 0.02; // 2% baseline flier

    // 1. Role & Net Delta Impact
    if (player.isNextManUp && player.inheritance) {
      const inh = player.inheritance;
      const injStatus = (inh.injuredPlayer?.injury_status || inh.injuredPlayer?.status || '').toUpperCase();
      const isSeasonEnding = Boolean(inh.isSeasonEnding || ['IR', 'PUP', 'SUSPENDED'].includes(injStatus));
      const isEliteRb1 = Boolean(inh.isEliteRb1 || (pos === 'RB' && (inh.starterProj >= 12.0 || inh.injuredPlayer?.depth_chart_order === 1)));

      if (pos === 'RB') {
        if (isSeasonEnding && isEliteRb1) {
          // BELLCOW RB1 TAKEOVER (e.g. Ollie Gordon taking over for Devon Achane out for year)
          basePct = 0.50; // 50% baseline for league-winning starter takeover
        } else if (isSeasonEnding) {
          basePct = 0.35; // 35% for standard lead back out for season
        } else if (isEliteRb1) {
          basePct = 0.22; // 22% for multi-week rental of elite back
        } else {
          basePct = 0.14; // 14% for short-term rental
        }
      } else if (pos === 'WR') {
        basePct = isSeasonEnding ? 0.30 : 0.15;
      } else if (pos === 'TE') {
        basePct = isSeasonEnding ? 0.22 : 0.10;
      } else {
        basePct = 0.12;
      }
    } else if (netDelta >= 5.0) {
      basePct = 0.16;
    } else if (netDelta >= 3.0) {
      basePct = 0.10;
    } else if (player.contingent_score >= 85) {
      basePct = 0.04; // High-priority handcuff (4% = $4)
    } else if (netDelta > 1.5) {
      basePct = 0.05;
    } else if (pos === 'DEF' || pos === 'K') {
      basePct = 0.01; // Streamers rarely command high FAAB
    } else {
      basePct = 0.02; // Deep flier ($2)
    }

    // 2. National Market Velocity Booster (clearing consensus frenzies)
    const adds = Number(player.trending_adds || 0);
    if (adds >= 50000) {
      basePct += 0.05;
    } else if (adds >= 15000) {
      basePct += 0.03;
    }

    // 3. League Historical Spending Pattern Adjustment (if past transactions exist)
    const isEliteTakeover = Boolean(player.isNextManUp && player.inheritance?.isSeasonEnding && player.inheritance?.isEliteRb1);

    if (isEliteTakeover) {
      // For ELITE BELLCOW TAKEOVER: Do NOT dilute the 50%+ bid with low-value historical fliers!
      // Instead, treat league historical RB premium and aggression as an UPWARD markup!
      const leagueRbPrem = Number(leagueContext.tendencies?.leagueRbPremium || 0);
      const septVel = Number(leagueContext.tendencies?.septemberSpendVelocity || 0);
      if (leagueRbPrem > 10 || septVel > 25) {
        basePct += 0.05; // Competitive boost to beat aggressive league opponents
      }
    } else if (Array.isArray(leagueContext.historicalTransactions) && leagueContext.historicalTransactions.length > 0) {
      // Historical blending ONLY for starting assets / high net deltas (basePct >= 0.10)
      // Never drag low-end stashes, handcuffs, or fliers ($1-$5) up to the league's high historical average ($18-$25)!
      if (basePct >= 0.10) {
        const posTx = leagueContext.historicalTransactions.filter(t => t.position === pos && t.bid > 0);
        if (posTx.length > 0) {
          const avgBid = posTx.reduce((sum, t) => sum + t.bid, 0) / posTx.length;
          const totalLeagueBudget = Number(leagueContext.leagueSettings?.waiver_budget || 100);
          const avgPct = avgBid / totalLeagueBudget;
          // Blend 70% model base, 30% league historical norm
          basePct = (basePct * 0.7) + (avgPct * 0.3);
        }
      }
    }

    // 4. Season Time Decay (ROI depreciation)
    const currentWeek = Number(leagueContext.currentWeek || 1);
    let timeDecay = 1.0;
    if (currentWeek >= 9) {
      timeDecay = 0.70;
    } else if (currentWeek >= 5) {
      timeDecay = 0.85;
    }
    const finalPct = Math.min(0.85, Math.max(0.01, basePct * timeDecay));

    // Calculate smart dollar amount
    let smartDollars = Math.round(faab * finalPct);
    smartDollars = Math.max(1, Math.min(faab, smartDollars));
    const smartPct = Math.round((smartDollars / (leagueContext.leagueSettings?.waiver_budget || faab || 100)) * 100);

    return {
      dollars: smartDollars,
      percent: smartPct,
      isFreeAdd: false,
      label: `$${smartDollars} (${smartPct}%)`
    };
  }

  /**
   * Tiered FAAB Bid Range Guidance (Derived from Single Smart FAAB)
   */
  calculateFaabBids(player, netDelta, userFaab = 100, leagueContext = {}) {
    const smart = this.calculateSmartFaabBid(player, netDelta, userFaab, leagueContext);
    if (smart.isFreeAdd) {
      return {
        aggressive: { dollars: 0, percent: 0, label: 'Free Add' },
        targeted: smart,
        speculative: { dollars: 0, percent: 0, label: 'Free Add' }
      };
    }

    const faab = Math.max(1, userFaab);
    const aggDollars = Math.min(faab, Math.round(smart.dollars * 1.5));
    const specDollars = Math.max(0, Math.round(smart.dollars * 0.4));

    return {
      aggressive: {
        dollars: aggDollars,
        percent: Math.round((aggDollars / faab) * 100),
        label: 'Aggressive'
      },
      targeted: smart,
      speculative: {
        dollars: specDollars,
        percent: Math.round((specDollars / faab) * 100),
        label: 'Speculative'
      }
    };
  }

  /**
   * Format a clean, numbered plain-text claim sequence for Sleeper mobile app
   */
  formatClipboardClaimList(waiverTargets = [], leagueInfo = {}) {
    const leagueName = leagueInfo.name || 'Sleeper League';
    const waiverType = Number(leagueInfo.settings?.waiver_type ?? 0);
    const waiverBudget = Number(leagueInfo.settings?.waiver_budget ?? 0);
    const isFaab = leagueInfo.isFaab !== undefined 
      ? Boolean(leagueInfo.isFaab) 
      : (waiverType === 2 || waiverType === 3 || waiverBudget > 0);

    const lines = [
      `🐾 Scout Bowie Waiver Wire Priority List`,
      `League: ${leagueName} | System: ${isFaab ? 'FAAB Bidding' : 'Priority Order'} | Generated: ${new Date().toLocaleDateString()}`,
      `----------------------------------------------------`
    ];

    const topClaims = waiverTargets.slice(0, 10);
    if (topClaims.length === 0) {
      lines.push('No waiver wire claims generated.');
    } else {
      topClaims.forEach((item, index) => {
        const dropText = item.suggestedDrop ? item.suggestedDrop.text : 'Drop Bench Player';
        const deltaPrefix = item.netDelta >= 0 ? `+${item.netDelta}` : `${item.netDelta}`;
        lines.push(`[${index + 1}] ADD: ${item.full_name || item.name} (${item.position} - ${item.team || 'FA'})`);
        if (isFaab) {
          const bidLabel = item.faabBid?.label || `$${item.faabBids?.targeted?.dollars ?? 0} (${item.faabBids?.targeted?.percent ?? 0}%)`;
          lines.push(`    BID: ${bidLabel}`);
        } else {
          let claimPriority = 'Free Add / Flier';
          if (item.isNextManUp || item.netDelta >= 4.0 || (item.contingent_score && item.contingent_score >= 85)) {
            claimPriority = 'High Priority Claim';
          } else if (item.netDelta >= 1.5 || (item.streamingScore && item.streamingScore >= 80) || (item.contingent_score && item.contingent_score >= 70)) {
            claimPriority = 'Mid Priority Claim';
          } else if (item.netDelta > 0 || (item.trending_adds && item.trending_adds > 10000)) {
            claimPriority = 'Speculative / Low';
          }
          lines.push(`    CLAIM: ${claimPriority}`);
        }
        lines.push(`    ACTION: ${dropText} (Net: ${deltaPrefix} pts)`);
        lines.push(``);
      });
    }

    lines.push(`----------------------------------------------------`);
    lines.push(`Exported from Sleeper Analytics Suite • scout-bowie-analytics.github.io`);
    return lines.join('\n');
  }

  generateClipboardPriorityList(waiverTargets = [], leagueInfo = {}) {
    return this.formatClipboardClaimList(waiverTargets, leagueInfo);
  }

  /**
   * Recursive Multi-Year League History Crawler
   * Traverses backward via previous_league_id with a strict maxPriorSeasons cap (default 2).
   * Ingests all waiver claims (complete and failed) across historical seasons.
   * Caches pruned transaction list in localStorage with 24h TTL.
   */
  async crawlLeagueHistory(startLeagueId, options = {}) {
    if (!startLeagueId || startLeagueId === 'demo' || startLeagueId === 'demo_championship_league_2025') {
      return {
        fromCache: false,
        seasons: [{ season: '2026', leagueId: 'demo' }],
        claims: [],
        managerProfiles: [],
        tendencies: {
          avgStartingRbBid: 15,
          avgStartingRbPct: 15,
          septemberSpendVelocity: 35,
          leagueRbPremium: 25,
          topAggressiveManagers: []
        }
      };
    }

    const cleanStartId = String(startLeagueId).trim();
    const maxPriorSeasons = options.maxPriorSeasons !== undefined ? Number(options.maxPriorSeasons) : 2;
    const maxTotalSeasons = maxPriorSeasons + 1; // e.g. 2026 + 2 prior (2025, 2024) = 3 seasons max
    const currentWeek = Number(options.currentWeek || 1);
    const forceRefresh = Boolean(options.forceRefresh);
    const allPlayersMap = options.allPlayersMap || {};
    const fetchFunc = options.fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
    const storage = options.localStorageObj || (typeof localStorage !== 'undefined' ? localStorage : null);
    const cacheKey = `sleeper_history_${cleanStartId}`;
    const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 Hours TTL

    // 1. Check localStorage cache
    if (!forceRefresh && storage) {
      try {
        const cachedRaw = storage.getItem(cacheKey);
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw);
          if (cached && cached.timestamp && (Date.now() - cached.timestamp < CACHE_TTL_MS) && Array.isArray(cached.claims)) {
            const managerProfiles = this.computeManagerProfiles(cached.claims, cached.seasons || [], allPlayersMap);
            const tendencies = this.computeLeagueTendencies(cached.claims, managerProfiles, cached.seasons || []);
            return {
              fromCache: true,
              seasons: cached.seasons || [],
              claims: cached.claims,
              managerProfiles,
              tendencies
            };
          }
        }
      } catch (cacheErr) {
        console.warn('Could not read sleeper_history cache:', cacheErr);
      }
    }

    if (!fetchFunc) {
      throw new Error('No fetch implementation available for crawlLeagueHistory.');
    }

    const seasons = [];
    const claims = [];
    let currLeagueId = cleanStartId;
    let seasonsCrawled = 0;

    // 2. Recursive Traversal backward via previous_league_id
    while (currLeagueId && currLeagueId !== 'null' && currLeagueId !== 'undefined' && seasonsCrawled < maxTotalSeasons) {
      try {
        // Fetch League info
        const leagueRes = await fetchFunc(`https://api.sleeper.app/v1/league/${currLeagueId}?t=${Date.now()}`);
        if (!leagueRes.ok) break;
        const leagueData = await leagueRes.json();
        if (!leagueData || !leagueData.season) break;

        const seasonYear = String(leagueData.season);
        const prevLeagueId = leagueData.previous_league_id ? String(leagueData.previous_league_id).trim() : null;
        const leagueName = leagueData.name || `Season ${seasonYear}`;
        const waiverBudget = Number(leagueData.settings?.waiver_budget || 100);

        // Fetch Rosters and Users concurrently to preserve manager identity
        const [usersRes, rostersRes] = await Promise.all([
          fetchFunc(`https://api.sleeper.app/v1/league/${currLeagueId}/users?t=${Date.now()}`).catch(() => null),
          fetchFunc(`https://api.sleeper.app/v1/league/${currLeagueId}/rosters?t=${Date.now()}`).catch(() => null)
        ]);

        const usersData = usersRes && usersRes.ok ? await usersRes.json() : [];
        const rostersData = rostersRes && rostersRes.ok ? await rostersRes.json() : [];

        // Build User lookup: userId -> { displayName, avatar }
        const userMap = new Map();
        if (Array.isArray(usersData)) {
          usersData.forEach(u => {
            if (u && u.user_id) {
              const dName = u.display_name || u.metadata?.team_name || u.username || `Manager ${u.user_id}`;
              userMap.set(String(u.user_id), {
                displayName: dName,
                avatar: u.avatar || null
              });
            }
          });
        }

        // Build Roster lookup: rosterId -> { ownerId, displayName, avatar }
        const rosterToUserMap = new Map();
        if (Array.isArray(rostersData)) {
          rostersData.forEach(r => {
            if (r && r.roster_id !== undefined) {
              const rId = Number(r.roster_id);
              const ownerId = r.owner_id ? String(r.owner_id) : null;
              const uInfo = ownerId ? userMap.get(ownerId) : null;
              rosterToUserMap.set(rId, {
                ownerId,
                displayName: uInfo?.displayName || (r.settings?.team_name ? r.settings.team_name : `Team ${rId}`),
                avatar: uInfo?.avatar || null
              });
            }
          });
        }

        // Determine weeks to fetch
        // Active season (depth 0): fetch only up to current active week
        // Historical seasons (depth > 0): fetch weeks 1 through 18
        const isCurrentSeason = (seasonsCrawled === 0);
        const maxWeekToFetch = isCurrentSeason ? Math.max(1, currentWeek) : 18;

        // Fetch weekly transactions
        for (let w = 1; w <= maxWeekToFetch; w++) {
          try {
            const txRes = await fetchFunc(`https://api.sleeper.app/v1/league/${currLeagueId}/transactions/${w}?t=${Date.now()}`);
            if (txRes && txRes.ok) {
              const txList = await txRes.json();
              if (Array.isArray(txList)) {
                txList.forEach(tx => {
                  if (tx && tx.type === 'waiver') {
                    const status = (tx.status === 'complete') ? 'complete' : 'failed';
                    const bid = Number(tx.settings?.waiver_bid || 0);
                    const rosterId = Array.isArray(tx.roster_ids) && tx.roster_ids.length > 0 ? Number(tx.roster_ids[0]) : null;
                    const managerMeta = rosterId !== null ? rosterToUserMap.get(rosterId) : null;
                    const managerName = managerMeta?.displayName || (rosterId !== null ? `Team ${rosterId}` : 'Unknown');
                    const ownerId = managerMeta?.ownerId || null;

                    // Capture all added players in this waiver claim
                    if (tx.adds && typeof tx.adds === 'object') {
                      Object.keys(tx.adds).forEach(pid => {
                        const strPid = String(pid).trim();
                        // Safe Position Resolution (handles unknown / retired / null gracefully)
                        let pos = 'UNKNOWN';
                        if (allPlayersMap && allPlayersMap[strPid]) {
                          const p = allPlayersMap[strPid];
                          pos = p.position || (Array.isArray(p.fantasy_positions) ? p.fantasy_positions[0] : 'UNKNOWN');
                        } else if (/^[A-Z]{2,3}$/.test(strPid)) {
                          pos = 'DEF';
                        }
                        pos = String(pos || 'UNKNOWN').toUpperCase();

                        // Pruned lightweight transaction object
                        claims.push({
                          season: seasonYear,
                          week: w,
                          manager: managerName,
                          ownerId: ownerId,
                          playerId: strPid,
                          pos: pos,
                          bid: bid,
                          status: status
                        });
                      });
                    }
                  }
                });
              }
            }
          } catch (txErr) {
            console.warn(`Error fetching transactions for league ${currLeagueId} week ${w}:`, txErr);
          }
        }

        seasons.push({
          season: seasonYear,
          leagueId: currLeagueId,
          name: leagueName,
          previousLeagueId: prevLeagueId,
          totalBudget: waiverBudget
        });

        seasonsCrawled++;
        currLeagueId = prevLeagueId;
      } catch (seasonErr) {
        console.warn(`Failed crawling season league ${currLeagueId}:`, seasonErr);
        break;
      }
    }

    // 3. Cache pruned data in localStorage
    if (storage) {
      try {
        const payloadToCache = {
          timestamp: Date.now(),
          startLeagueId: cleanStartId,
          seasons,
          claims
        };
        storage.setItem(cacheKey, JSON.stringify(payloadToCache));
      } catch (storageErr) {
        console.warn('Could not cache league history to localStorage (quota or disabled):', storageErr);
      }
    }

    // 4. Compute Metrics
    const managerProfiles = this.computeManagerProfiles(claims, seasons, allPlayersMap);
    const tendencies = this.computeLeagueTendencies(claims, managerProfiles, seasons);

    return {
      fromCache: false,
      seasons,
      claims,
      managerProfiles,
      tendencies
    };
  }

  /**
   * Compute Manager Profiles (September Aggression %, RB Premium %, Win Rate, and Archetype)
   */
  computeManagerProfiles(claims = [], seasons = [], allPlayersMap = {}) {
    if (!Array.isArray(claims) || claims.length === 0) return [];

    // Group claims by manager identity (prefer ownerId for cross-year persistence, fallback to manager name)
    const managerGroups = new Map();

    claims.forEach(c => {
      const key = c.ownerId || c.manager || 'Unknown';
      if (!managerGroups.has(key)) {
        managerGroups.set(key, {
          key,
          ownerId: c.ownerId || null,
          displayName: c.manager || 'Unknown Manager',
          claims: []
        });
      }
      const group = managerGroups.get(key);
      group.claims.push(c);
      // Keep most recent non-generic display name
      if (c.manager && !c.manager.startsWith('Team ') && !c.manager.startsWith('Manager ')) {
        group.displayName = c.manager;
      }
    });

    const profiles = [];

    managerGroups.forEach(group => {
      const allUserClaims = group.claims;
      const totalClaims = allUserClaims.length;
      const wonClaims = allUserClaims.filter(c => c.status === 'complete');
      const wonCount = wonClaims.length;
      const winRate = totalClaims > 0 ? Math.round((wonCount / totalClaims) * 100) : 0;

      // September Aggression: Total spend in Weeks 1–4 across all seasons
      const septWonClaims = wonClaims.filter(c => c.week >= 1 && c.week <= 4);
      const septSpend = septWonClaims.reduce((sum, c) => sum + (Number(c.bid) || 0), 0);
      
      const distinctSeasons = new Set(allUserClaims.map(c => c.season)).size || 1;
      const totalStartingBudget = distinctSeasons * 100;
      const septSpendVelocity = totalStartingBudget > 0 
        ? Math.round((septSpend / totalStartingBudget) * 100)
        : 0;

      // Positional Spending: RB vs WR/TE
      const rbClaims = wonClaims.filter(c => c.pos === 'RB' && c.bid > 0);
      const wrTeClaims = wonClaims.filter(c => ['WR', 'TE'].includes(c.pos) && c.bid > 0);

      const totalRbSpend = rbClaims.reduce((s, c) => s + c.bid, 0);
      const totalWrTeSpend = wrTeClaims.reduce((s, c) => s + c.bid, 0);

      const avgRbBid = rbClaims.length > 0 ? Number((totalRbSpend / rbClaims.length).toFixed(1)) : 0;
      const avgWrTeBid = wrTeClaims.length > 0 ? Number((totalWrTeSpend / wrTeClaims.length).toFixed(1)) : 0;

      let rbPremiumPct = 0;
      if (avgWrTeBid > 0) {
        rbPremiumPct = Math.round(((avgRbBid - avgWrTeBid) / avgWrTeBid) * 100);
      } else if (avgRbBid > 0) {
        rbPremiumPct = 100;
      }

      // Classify Manager Tendency / Behavioral Archetype
      let archetype = 'Patient Builder 🧘';
      let badgeClass = 'badge-patient';

      if (septSpendVelocity >= 35) {
        archetype = 'Early Spender ⚡';
        badgeClass = 'badge-early';
      } else if (rbPremiumPct >= 25 && rbClaims.length >= 1) {
        archetype = 'RB Chaser 🏃';
        badgeClass = 'badge-rb';
      } else if (winRate <= 35 && totalClaims >= 5) {
        archetype = 'Bargain Hunter 🎯';
        badgeClass = 'badge-bargain';
      } else if (septSpendVelocity <= 10 && wonCount >= 3) {
        archetype = 'Late Saver 🛡️';
        badgeClass = 'badge-saver';
      }

      profiles.push({
        ownerId: group.ownerId,
        displayName: group.displayName,
        totalClaims,
        wonClaims: wonCount,
        failedClaims: totalClaims - wonCount,
        winRate,
        septSpend,
        septSpendVelocity,
        avgRbBid,
        avgWrTeBid,
        rbPremiumPct,
        archetype,
        badgeClass,
        seasonsCount: distinctSeasons
      });
    });

    // Sort by September Spend Velocity descending
    profiles.sort((a, b) => b.septSpendVelocity - a.septSpendVelocity);

    return profiles;
  }

  /**
   * Compute League-Wide Historical Tendencies
   */
  computeLeagueTendencies(claims = [], managerProfiles = [], seasons = []) {
    const allWon = Array.isArray(claims) ? claims.filter(c => c.status === 'complete') : [];
    const rbWon = allWon.filter(c => c.pos === 'RB' && c.bid > 0);
    const wrTeWon = allWon.filter(c => ['WR', 'TE'].includes(c.pos) && c.bid > 0);

    // Starting RB average winning bid
    const startingRbBids = rbWon.filter(c => c.bid >= 5);
    const targetRbPool = startingRbBids.length > 0 ? startingRbBids : rbWon;
    const avgStartingRbBid = targetRbPool.length > 0 
      ? Number((targetRbPool.reduce((s, c) => s + c.bid, 0) / targetRbPool.length).toFixed(1))
      : 15;
    const avgStartingRbPct = Math.round((avgStartingRbBid / 100) * 100);

    // September Spend Velocity across league
    const leagueSeptClaims = allWon.filter(c => c.week >= 1 && c.week <= 4);
    const leagueSeptTotal = leagueSeptClaims.reduce((s, c) => s + c.bid, 0);
    const numSeasons = (seasons && seasons.length > 0) ? seasons.length : 1;
    const totalLeagueBudget = numSeasons * 12 * 100;
    const septemberSpendVelocity = totalLeagueBudget > 0
      ? Math.round((leagueSeptTotal / totalLeagueBudget) * 100)
      : 32;

    // League RB Premium %
    const avgLeagueRb = rbWon.length > 0 ? (rbWon.reduce((s, c) => s + c.bid, 0) / rbWon.length) : 0;
    const avgLeagueWrTe = wrTeWon.length > 0 ? (wrTeWon.reduce((s, c) => s + c.bid, 0) / wrTeWon.length) : 0;
    let leagueRbPremium = 0;
    if (avgLeagueWrTe > 0) {
      leagueRbPremium = Math.round(((avgLeagueRb - avgLeagueWrTe) / avgLeagueWrTe) * 100);
    } else if (avgLeagueRb > 0) {
      leagueRbPremium = 50;
    }

    return {
      avgStartingRbBid,
      avgStartingRbPct,
      septemberSpendVelocity,
      leagueRbPremium,
      topAggressiveManagers: managerProfiles.slice(0, 5)
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WaiverEngine };
}
