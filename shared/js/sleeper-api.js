/**
 * SLEEPER API CLIENT & PLAYER METADATA ENGINE
 * Full ingestion of Sleeper public APIs, user leagues, rosters, matchups,
 * weekly projections, league scoring calculation, and dynamic Log-Normal parameterization.
 */

import { MOCK_LEAGUE_INFO, MOCK_USERS, MOCK_ROSTERS, MOCK_MATCHUPS, MOCK_PLAYERS_DB } from './mock-data.js';
import { getGameScheduleInfo, calculateWeatherModifier } from './nfl-schedule.js';

const SLEEPER_BASE_URL = 'https://api.sleeper.app/v1';

/**
 * Calculate customized fantasy points from raw stats and league scoring settings
 */
export function calculateStatsFantasyPoints(stats, scoringSettings = null) {
  if (!stats) return 0;
  
  const s = scoringSettings || {
    pass_yd: 0.04,
    pass_td: 4.0,
    pass_int: -2.0,
    pass_2pt: 2.0,
    rush_yd: 0.1,
    rush_td: 6.0,
    rush_2pt: 2.0,
    rec: 1.0,
    rec_yd: 0.1,
    rec_td: 6.0,
    rec_2pt: 2.0,
    fum_lost: -2.0,
    fgm_0_19: 3.0,
    fgm_20_29: 3.0,
    fgm_30_39: 3.0,
    fgm_40_49: 4.0,
    fgm_50p: 5.0,
    xpm: 1.0,
    def_td: 6.0,
    def_st_td: 6.0,
    sack: 1.0,
    int: 2.0,
    fum_rec: 2.0,
    safety: 2.0,
    def_pr_td: 6.0,
    def_kr_td: 6.0
  };

  let pts = 0;
  let hasStatMatch = false;

  for (const [statKey, statValue] of Object.entries(stats)) {
    if (s[statKey] !== undefined && typeof statValue === 'number') {
      pts += statValue * s[statKey];
      hasStatMatch = true;
    }
  }

  if (hasStatMatch && pts !== 0) {
    return Number(pts.toFixed(2));
  }

  // Fallback to precalculated PPR / Half-PPR / Standard
  const pprWeight = s.rec !== undefined ? s.rec : 1.0;
  if (pprWeight >= 0.9 && stats.pts_ppr) return Number(stats.pts_ppr.toFixed(2));
  if (pprWeight >= 0.4 && pprWeight < 0.9 && stats.pts_half_ppr) return Number(stats.pts_half_ppr.toFixed(2));
  if (stats.pts_std) return Number(stats.pts_std.toFixed(2));
  return Number((stats.pts_ppr || stats.pts_half_ppr || stats.pts_std || 0).toFixed(2));
}

export class SleeperApiClient {
  constructor() {
    this.playersMap = null;
    this.projectionsCache = new Map();
    this.playersPromise = null;
  }

  /**
   * Load and cache full NFL player database (~5MB JSON from Sleeper)
   * Uses in-memory cache + localStorage with 12-hour TTL.
   */
  async loadPlayersDatabase(forceRefresh = false) {
    return this.fetchAllPlayers(forceRefresh);
  }

  async getAllPlayers(forceRefresh = false) {
    return this.fetchAllPlayers(forceRefresh);
  }

  async getPlayers(forceRefresh = false) {
    return this.fetchAllPlayers(forceRefresh);
  }

  async fetchAllPlayers(forceRefresh = false) {
    if (!forceRefresh && this.playersMap && Object.keys(this.playersMap).length > 0) {
      return this.playersMap;
    }
    if (!forceRefresh && this.playersPromise) {
      return this.playersPromise;
    }

    const PLAYER_CACHE_TTL_MS = 12 * 3600 * 1000; // 12 Hours TTL

    this.playersPromise = (async () => {
      // 1. Check localStorage cache (if not forcing refresh)
      if (!forceRefresh) {
        try {
          if (typeof localStorage !== 'undefined') {
            const cached = localStorage.getItem('sleeper_nfl_players_cache_v3');
            const cachedTime = localStorage.getItem('sleeper_nfl_players_time_v3');
            if (cached && cachedTime && (Date.now() - parseInt(cachedTime, 10) < PLAYER_CACHE_TTL_MS)) {
              this.playersMap = JSON.parse(cached);
              console.info('Loaded NFL player database from local cache (12h TTL):', Object.keys(this.playersMap).length, 'players');
              return this.playersMap;
            }
          }
        } catch (e) {
          console.warn('localStorage cache read failed:', e);
        }
      }

      // 2. Fetch fresh from Sleeper API
      try {
        console.info('Fetching live NFL player database from Sleeper API...');
        const response = await fetch(`${SLEEPER_BASE_URL}/players/nfl?t=${Date.now()}`, { cache: 'no-store' });
        if (response.ok) {
          const data = await response.json();
          this.playersMap = data;
          try {
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem('sleeper_nfl_players_cache_v3', JSON.stringify(data));
              localStorage.setItem('sleeper_nfl_players_time_v3', Date.now().toString());
            }
          } catch (storageErr) {
            console.warn('Could not cache full player DB to localStorage (quota exceeded), keeping in-memory.');
          }
          console.info('Successfully loaded', Object.keys(data).length, 'players from Sleeper.');
          return this.playersMap;
        }
      } catch (fetchErr) {
        console.warn('Could not fetch players from Sleeper API, using bundled mock database:', fetchErr);
      }

      // 3. Fallback to bundled MOCK_PLAYERS_DB
      this.playersMap = { ...MOCK_PLAYERS_DB };
      return this.playersMap;
    })();

    return this.playersPromise;
  }

  /**
   * Fetch user by username
   */
  async getUserByUsername(username) {
    if (!username) throw new Error('Username is required');
    if (username === 'demo' || username === 'demo_user') {
      return MOCK_USERS[0];
    }

    const response = await fetch(`${SLEEPER_BASE_URL}/user/${encodeURIComponent(username)}`);
    if (!response.ok) {
      throw new Error(`Sleeper user "${username}" not found (${response.status})`);
    }
    return await response.json();
  }

  /**
   * Fetch all leagues for a user in a given NFL season
   */
  async getUserLeagues(userId, season = '2026') {
    if (!userId || userId === 'demo_user_1') {
      return [MOCK_LEAGUE_INFO];
    }

    const seasonsToTry = [season, '2025', '2024'];
    for (const yr of seasonsToTry) {
      try {
        const response = await fetch(`${SLEEPER_BASE_URL}/user/${userId}/leagues/nfl/${yr}`);
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data) && data.length > 0) return data;
        }
      } catch (e) {}
    }

    throw new Error(`No active leagues found on Sleeper for user ID ${userId}.`);
  }

  /**
   * Universal helper: fetch leagues by username or direct league ID
   */
  async fetchUserLeagues(usernameOrId, season = '2026') {
    if (!usernameOrId) throw new Error('Username or League ID is required');
    const clean = String(usernameOrId).trim();
    if (/^\d+$/.test(clean)) {
      const l = await this.getLeague(clean);
      return [l];
    }
    const user = await this.getUserByUsername(clean);
    return await this.getUserLeagues(user.user_id, season);
  }

  /**
   * Fetch league metadata by league_id
   */
  async getLeague(leagueId) {
    if (!leagueId || leagueId === 'demo' || leagueId === 'demo_championship_league_2025') {
      return MOCK_LEAGUE_INFO;
    }

    const cleanId = String(leagueId).trim();

    try {
      const response = await fetch(`${SLEEPER_BASE_URL}/league/${cleanId}`);
      if (response.ok) {
        return await response.json();
      }
    } catch (e) {}

    // Check if user entered a Draft ID
    try {
      const draftRes = await fetch(`${SLEEPER_BASE_URL}/draft/${cleanId}`);
      if (draftRes.ok) {
        const draft = await draftRes.json();
        if (draft && draft.league_id) {
          console.info(`Resolved Draft ID ${cleanId} to League ID ${draft.league_id}`);
          const leagueRes = await fetch(`${SLEEPER_BASE_URL}/league/${draft.league_id}`);
          if (leagueRes.ok) return await leagueRes.json();
        } else {
          throw new Error(`ID "${cleanId}" is a standalone mock draft without an associated league. Please enter your Sleeper League ID or Username.`);
        }
      }
    } catch (draftErr) {
      if (draftErr.message && draftErr.message.includes('mock draft')) throw draftErr;
    }

    throw new Error(`League ID "${cleanId}" not found on Sleeper. Please check your League ID.`);
  }

  /**
   * Fetch current live NFL state (season, week, season_type)
   */
  async getNflState() {
    try {
      const response = await fetch(`${SLEEPER_BASE_URL}/state/nfl`);
      if (response.ok) {
        return await response.json();
      }
    } catch (e) {
      console.warn('Failed to fetch Sleeper NFL state, falling back to 2026:', e);
    }
    return {
      season: '2026',
      week: 1,
      season_type: 'regular',
      league_season: '2026'
    };
  }

  /**
   * Fetch league rosters
   */
  async getRosters(leagueId) {
    if (!leagueId || leagueId === 'demo' || leagueId === 'demo_championship_league_2025') {
      return MOCK_ROSTERS;
    }

    const response = await fetch(`${SLEEPER_BASE_URL}/league/${leagueId}/rosters`);
    if (!response.ok) throw new Error(`Failed to fetch rosters for league ${leagueId} (${response.status})`);
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error(`No rosters found in league ${leagueId}.`);
    }
    return data;
  }

  /**
   * Fetch league users
   */
  async getUsers(leagueId) {
    if (!leagueId || leagueId === 'demo' || leagueId === 'demo_championship_league_2025') {
      return MOCK_USERS;
    }

    const response = await fetch(`${SLEEPER_BASE_URL}/league/${leagueId}/users`);
    if (!response.ok) throw new Error(`Failed to fetch users for league ${leagueId} (${response.status})`);
    return await response.json();
  }

  /**
   * Fetch matchups for a specific week
   */
  async getMatchups(leagueId, week = 1) {
    if (!leagueId || leagueId === 'demo' || leagueId === 'demo_championship_league_2025') {
      return MOCK_MATCHUPS;
    }

    try {
      const response = await fetch(`${SLEEPER_BASE_URL}/league/${leagueId}/matchups/${week}`);
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) return data;
      }
    } catch (e) {}

    return [];
  }

  /**
   * Fetch weekly player projections / stats from Sleeper API and compute customized points
   */
  async getProjections(season = '2024', week = 1, scoringSettings = null) {
    const cacheKey = `${season}_${week}`;
    if (this.projectionsCache.has(cacheKey)) {
      return this.projectionsCache.get(cacheKey);
    }

    const endpoints = [
      `${SLEEPER_BASE_URL}/projections/nfl/regular/${season}/${week}`,
      `${SLEEPER_BASE_URL}/projections/nfl/${season}/${week}?season_type=regular`,
      `${SLEEPER_BASE_URL}/stats/nfl/regular/${season}/${week}`,
      `${SLEEPER_BASE_URL}/stats/nfl/${season}/${week}?season_type=regular`
    ];

    for (const ep of endpoints) {
      try {
        const res = await fetch(ep);
        if (res.ok) {
          const rawData = await res.json();
          if (rawData && typeof rawData === 'object') {
            const resultMap = {};
            let validCount = 0;

            for (const [pid, pStats] of Object.entries(rawData)) {
              if (pStats && typeof pStats === 'object') {
                const statsObj = pStats.stats || pStats;
                const calculatedPts = calculateStatsFantasyPoints(statsObj, scoringSettings);
                if (calculatedPts > 0) {
                  resultMap[pid] = calculatedPts;
                  validCount++;
                }
              }
            }

            if (validCount > 30) {
              console.info(`Loaded ${validCount} projections from ${ep}`);
              this.projectionsCache.set(cacheKey, resultMap);
              return resultMap;
            }
          }
        }
      } catch (err) {}
    }

    // Fallback: build projection map from mock data
    const fallbackMap = {};
    Object.values(MOCK_PLAYERS_DB).forEach(p => {
      fallbackMap[p.player_id] = p.projected_pts;
    });
    this.projectionsCache.set(cacheKey, fallbackMap);
    return fallbackMap;
  }

  /**
   * Generate an individualized baseline projection when API feed is off-season or missing
   */
  estimatePlayerProjection(sp, scoringSettings = null) {
    if (!sp) return 0.0;
    const team = (sp.team || '').trim();
    if (!team || team === 'FA' || team === 'None' || team === 'FA*') {
      return 0.0;
    }
    const status = (sp.status || '').toUpperCase();
    const injStatus = (sp.injury_status || '').toUpperCase();
    const sidelinedStatuses = new Set(['IR', 'PUP', 'OUT', 'SUSPENDED', 'INACTIVE', 'FREE AGENT', 'RETIRED', 'DNR']);
    if (sidelinedStatuses.has(status) || sidelinedStatuses.has(injStatus)) {
      return 0.0;
    }

    const pos = sp.position || (sp.fantasy_positions && sp.fantasy_positions[0]) || 'FLEX';
    const order = sp.depth_chart_order || 1;
    const exp = sp.years_exp || 2;
    const ppr = scoringSettings?.rec !== undefined ? scoringSettings.rec : 1.0;

    // Hash player_id to generate consistent, deterministic micro-variance between players
    let hash = 0;
    const str = String(sp.player_id || sp.full_name || '100');
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    const pseudoRand = (Math.abs(hash) % 100) / 100; // 0.00 to 0.99

    let base = 8.0;

    switch (pos) {
      case 'QB':
        if (order === 1) {
          base = 16.5 + pseudoRand * 6.5; // 16.5 to 23.0
        } else {
          base = 2.0 + pseudoRand * 3.5;
        }
        break;

      case 'RB':
        if (order === 1) {
          base = 12.0 + pseudoRand * 6.8 + (ppr * 2.2); // 14.2 to 21.0
        } else if (order === 2) {
          base = 6.5 + pseudoRand * 4.2 + (ppr * 1.5); // 8.0 to 12.2
        } else {
          base = 2.5 + pseudoRand * 3.0;
        }
        break;

      case 'WR':
        if (order === 1) {
          base = 11.5 + pseudoRand * 6.5 + (ppr * 3.5); // 15.0 to 21.5
        } else if (order === 2) {
          base = 8.0 + pseudoRand * 4.5 + (ppr * 2.5); // 10.5 to 15.0
        } else if (order === 3) {
          base = 5.0 + pseudoRand * 3.5 + (ppr * 1.8); // 6.8 to 10.3
        } else {
          base = 2.0 + pseudoRand * 2.5;
        }
        break;

      case 'TE':
        if (order === 1) {
          base = 7.5 + pseudoRand * 6.0 + (ppr * 2.8); // 10.3 to 16.3
        } else {
          base = 2.5 + pseudoRand * 3.0 + (ppr * 1.0);
        }
        break;

      case 'K':
        base = 6.5 + pseudoRand * 3.8; // 6.5 to 10.3
        break;

      case 'DEF':
        base = 5.5 + pseudoRand * 4.5; // 5.5 to 10.0
        break;

      default:
        base = 7.0 + pseudoRand * 4.0;
        break;
    }

    if (exp >= 2 && exp <= 6) base += 0.4;

    return Number(base.toFixed(1));
  }

  /**
   * Determine Player Archetype & Dynamic Variance (Log-Normal CV & Skew)
   */
  determinePlayerArchetypeAndVariance(sp, pos, meanProj) {
    const name = (sp.full_name || '').toLowerCase();
    let cv = 0.42;
    let skew = 1.6;
    let archetype = 'Standard';

    switch (pos) {
      case 'QB':
        if (['allen', 'jackson', 'hurts', 'daniels', 'murray', 'fields', 'richardson'].some(n => name.includes(n))) {
          cv = 0.23;
          skew = 1.0;
          archetype = 'Dual-Threat QB (High Floor)';
        } else {
          cv = 0.30;
          skew = 1.15;
          archetype = 'Pocket Passer QB';
        }
        break;

      case 'RB':
        if (meanProj >= 14.0) {
          cv = 0.34;
          skew = 1.45;
          archetype = 'Bellcow RB (High Volume Floor)';
        } else if (name.includes('achane') || name.includes('gibbs') || name.includes('cook')) {
          cv = 0.48;
          skew = 2.0;
          archetype = 'Explosive Big-Play RB';
        } else {
          cv = 0.42;
          skew = 1.7;
          archetype = 'Committee / Rotational RB';
        }
        break;

      case 'WR':
        if (meanProj >= 14.5) {
          cv = 0.36;
          skew = 1.4;
          archetype = 'Alpha Target-Hog WR';
        } else if (['watson', 'pickens', 'shaheed', 'williams', 'worth', 'pierce', 'mims'].some(n => name.includes(n))) {
          cv = 0.58;
          skew = 2.3;
          archetype = 'Volatile Deep-Threat WR (Boom/Bust)';
        } else {
          cv = 0.44;
          skew = 1.7;
          archetype = 'Slot / Possession WR';
        }
        break;

      case 'TE':
        if (meanProj >= 11.0 || ['bowers', 'laporta', 'kelce', 'kittle', 'mcbride', 'andrews'].some(n => name.includes(n))) {
          cv = 0.38;
          skew = 1.5;
          archetype = 'Elite Target TE';
        } else {
          cv = 0.56;
          skew = 2.1;
          archetype = 'TD-Dependent Streaming TE';
        }
        break;

      case 'K':
        cv = 0.35;
        skew = 1.2;
        archetype = 'Placekicker';
        break;

      case 'DEF':
        cv = 0.52;
        skew = 1.6;
        archetype = 'Defense / Special Teams';
        break;

      default:
        cv = 0.42;
        skew = 1.6;
        archetype = 'Flex Utility';
    }

    return { cv, skew, archetype };
  }

  /**
   * Resolve full player metadata from player_id with dynamic projection, venue schedule, and archetype variance
   */
  getPlayerMetadata(playerId, customProjection = null, scoringSettings = null, week = 1, liveSchedule = null) {
    if (!playerId || playerId === '0' || playerId === 'null') {
      return null;
    }

    const strId = String(playerId).trim();

    // 1. Bundled MOCK_PLAYERS_DB (Priority for sample championship & mock players)
    if (MOCK_PLAYERS_DB[strId]) {
      const base = { ...MOCK_PLAYERS_DB[strId] };
      if (customProjection !== null && customProjection !== undefined && customProjection > 0) {
        base.projected_pts = Number(Number(customProjection).toFixed(1));
        base.points = base.projected_pts;
        base.projected_points = base.projected_pts;
      }
      base.points_banked = base.points_banked || 0;
      base.actual_points = base.actual_points || 0;
      base.points_scored = base.points_scored || 0;
      base.actual_pts = base.actual_pts || 0;
      base.is_final = Boolean(base.is_final || base.isFinal);
      base.isFinal = base.is_final;
      base.is_live = Boolean(base.is_live || base.isLive);
      base.isLive = base.is_live;
      base.gameState = base.gameState || 'UPCOMING';
      base.gameSchedule = getGameScheduleInfo(base.team, week, liveSchedule);
      if (base.game_status) {
        base.gameSchedule.text = base.game_status;
      }
      return base;
    }

    // 2. Loaded Sleeper Player DB
    if (this.playersMap && this.playersMap[strId]) {
      const sp = this.playersMap[strId];
      const pos = sp.position || (sp.fantasy_positions && sp.fantasy_positions[0]) || 'FLEX';
      const team = sp.team || 'FA';
      const fullName = sp.full_name || (sp.first_name ? `${sp.first_name} ${sp.last_name}` : `Player #${strId}`);
      
      const isDef = (pos === 'DEF' || team === strId || /^[A-Z]{2,3}$/.test(strId));
      const avatar = isDef 
        ? `https://sleepercdn.com/images/v2/logos/nfl/${(team !== 'FA' ? team : strId).toLowerCase()}.png`
        : `https://sleepercdn.com/content/nfl/players/thumb/${strId}.jpg`;

      let proj = Number(customProjection);
      if (isNaN(proj) || proj <= 0) {
        proj = this.estimatePlayerProjection(sp, scoringSettings);
      }

      const { cv, skew, archetype } = this.determinePlayerArchetypeAndVariance(sp, pos, proj);
      const schedule = getGameScheduleInfo(team, week, liveSchedule);

      // Step-Function Weather Modifier (Wind / Temperature)
      const weatherMod = calculateWeatherModifier(pos, archetype, schedule.weather);
      let adjustedProj = proj * weatherMod;
      let adjustedCv = cv;

      // In windy conditions, elevate variance for passing / kicking
      if (schedule.weather?.isWindAlert || schedule.weather?.isSevereWind) {
        if (['QB', 'WR', 'TE', 'K'].includes(pos)) {
          adjustedCv = cv * 1.15;
        }
      }

      // Inactive Injury Status Guardrail Override
      const INACTIVE_STATUSES = ['PUP', 'IR', 'OUT', 'SUS', 'COV', 'DNR', 'INJURED_RESERVE', 'SUSPENDED', 'IR-R', 'NA'];
      const injuryStatus = sp.injury_status;
      if (injuryStatus) {
        const inj = String(injuryStatus).toUpperCase().trim();
        if (INACTIVE_STATUSES.includes(inj)) {
          adjustedProj = 0.0;
          adjustedCv = 0.0;
        } else if (inj === 'QUESTIONABLE' || inj === 'QUES') {
          adjustedCv = adjustedCv * 1.25;
        } else if (inj === 'DOUBTFUL') {
          adjustedProj = adjustedProj * 0.5;
          adjustedCv = adjustedCv * 1.5;
        }
      }

      return {
        player_id: strId,
        full_name: fullName,
        first_name: sp.first_name || fullName,
        last_name: sp.last_name || '',
        position: pos,
        team: team,
        opponent: schedule.opponent,
        gameSchedule: schedule,
        weatherModifier: weatherMod,
        projected_pts: Number(adjustedProj.toFixed(1)),
        variance: Number(adjustedCv.toFixed(3)),
        skew: Number(skew.toFixed(2)),
        archetype: archetype,
        injury_status: sp.injury_status || null,
        injury_body_part: sp.injury_body_part || null,
        injury_notes: sp.injury_notes || null,
        avatar: avatar,
        depth_chart_order: sp.depth_chart_order || 1
      };
    }

    // 2. Bundled MOCK_PLAYERS_DB
    if (MOCK_PLAYERS_DB[strId]) {
      const base = { ...MOCK_PLAYERS_DB[strId] };
      if (customProjection !== null && customProjection !== undefined && customProjection > 0) {
        base.projected_pts = Number(Number(customProjection).toFixed(1));
      }
      base.gameSchedule = getGameScheduleInfo(base.team, week, liveSchedule);
      return base;
    }

    // 3. Safe Fallback
    const isTeamDef = /^[A-Z]{2,3}$/.test(strId);
    const pos = isTeamDef ? 'DEF' : 'FLEX';
    const team = isTeamDef ? strId : 'NFL';
    const avatar = isTeamDef 
      ? `https://sleepercdn.com/images/v2/logos/nfl/${strId.toLowerCase()}.png`
      : `https://sleepercdn.com/content/nfl/players/thumb/${strId}.jpg`;

    const proj = customProjection || (isTeamDef ? 7.5 : 9.5);
    const schedule = getGameScheduleInfo(team, week, liveSchedule);

    return {
      player_id: strId,
      full_name: isTeamDef ? `${strId} Defense` : `NFL Player #${strId}`,
      first_name: isTeamDef ? strId : 'Player',
      last_name: isTeamDef ? 'Defense' : `#${strId}`,
      position: pos,
      team: team,
      opponent: schedule.opponent,
      gameSchedule: schedule,
      projected_pts: Number(Number(proj).toFixed(1)),
      variance: isTeamDef ? 0.52 : 0.42,
      skew: 1.6,
      archetype: 'Standard',
      injury_status: null,
      avatar: avatar
    };
  }
}

export const sleeperApi = new SleeperApiClient();
