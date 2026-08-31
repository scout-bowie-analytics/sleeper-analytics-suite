/**
 * VEGAS ODDS & GAME SCRIPT ENGINE
 * Integrates with The Odds API for real-time NFL spreads, over/under totals,
 * implied team totals, and game-script tactical modeling.
 * 
 * Features:
 * - 2-hour LocalStorage cache TTL to preserve 500 req/month free tier quota
 * - Automatic team name normalization across all 32 NFL franchises
 * - Implied team totals calculated: (OverUnder / 2) - (Spread / 2)
 * - Game script classification: Positive (Run-Heavy), Negative (Pass-Heavy), Balanced
 * - Graceful fallback defaults when API key is missing or offline
 */

export const CONFIG = {
  // Set your The Odds API key here or via setOddsApiKey('KEY')
  ODDS_API_KEY: ''
};

// 2-Hour Cache TTL in milliseconds
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const CACHE_KEY = 'sleeper_vegas_odds_cache_v1';

// Full NFL Team Name to Abbreviation Map
export const NFL_TEAM_NAME_MAP = {
  'arizona cardinals': 'ARI',
  'atlanta falcons': 'ATL',
  'baltimore ravens': 'BAL',
  'buffalo bills': 'BUF',
  'carolina panthers': 'CAR',
  'chicago bears': 'CHI',
  'cincinnati bengals': 'CIN',
  'cleveland browns': 'CLE',
  'dallas cowboys': 'DAL',
  'denver broncos': 'DEN',
  'detroit lions': 'DET',
  'green bay packers': 'GB',
  'houston texans': 'HOU',
  'indianapolis colts': 'IND',
  'jacksonville jaguars': 'JAX',
  'kansas city chiefs': 'KC',
  'las vegas raiders': 'LV',
  'los angeles chargers': 'LAC',
  'los angeles rams': 'LAR',
  'miami dolphins': 'MIA',
  'minnesota vikings': 'MIN',
  'new england patriots': 'NE',
  'new orleans saints': 'NO',
  'new york giants': 'NYG',
  'new york jets': 'NYJ',
  'philadelphia eagles': 'PHI',
  'pittsburgh steelers': 'PIT',
  'san francisco 49ers': 'SF',
  'seattle seahawks': 'SEA',
  'tampa bay buccaneers': 'TB',
  'tennessee titans': 'TEN',
  'washington commanders': 'WAS',
  'washington football team': 'WAS'
};

/**
 * Configure or update The Odds API Key dynamically
 */
export function setOddsApiKey(apiKey) {
  if (typeof apiKey === 'string') {
    CONFIG.ODDS_API_KEY = apiKey.trim();
    try {
      localStorage.setItem('the_odds_api_key', CONFIG.ODDS_API_KEY);
    } catch (e) {}
  }
}

/**
 * Resolve active API Key from Config, LocalStorage, or Global Window
 */
export function getActiveOddsApiKey() {
  if (CONFIG.ODDS_API_KEY && CONFIG.ODDS_API_KEY.length > 0) {
    return CONFIG.ODDS_API_KEY;
  }
  try {
    const saved = localStorage.getItem('the_odds_api_key');
    if (saved && saved.length > 0) return saved;
  } catch (e) {}

  if (typeof window !== 'undefined' && window.ODDS_API_KEY) {
    return String(window.ODDS_API_KEY).trim();
  }
  return '';
}

/**
 * Classify tactical game script based on point spread
 */
export function classifyGameScript(spread) {
  const numSpread = Number(spread) || 0;
  if (numSpread <= -6.5) {
    return {
      type: 'positive',
      label: 'Favorite · Positive Game Script (Run-Heavy)',
      shortLabel: 'Run-Heavy Script',
      desc: 'Projected multi-score lead favors high rushing volume and clock-control carries.',
      bias: 'RB_BOOST'
    };
  }
  if (numSpread >= 6.5) {
    return {
      type: 'negative',
      label: 'Underdog · Negative Game Script (Pass-Heavy)',
      shortLabel: 'Pass-Heavy Script',
      desc: 'Projected trailing deficit encourages elevated pass volume, hurry-up drives, and target volume.',
      bias: 'PASS_BOOST'
    };
  }
  return {
    type: 'balanced',
    label: 'Competitive / Balanced Script',
    shortLabel: 'Balanced Script',
    desc: 'Tight point spread projects neutral play-calling and standard offensive distribution.',
    bias: 'NEUTRAL'
  };
}

/**
 * Generate realistic fallback odds for a team when API is offline or unkeyed
 */
export function getFallbackTeamOdds(teamCode) {
  const cleanTeam = String(teamCode || 'NFL').toUpperCase().trim();
  
  // Seed hash based on team name for stable, realistic values
  let hash = 0;
  for (let i = 0; i < cleanTeam.length; i++) {
    hash = (hash << 5) - hash + cleanTeam.charCodeAt(i);
    hash |= 0;
  }
  const norm = (Math.abs(hash) % 100) / 100;

  // Realistic Over/Under: 41.5 to 48.5
  const overUnder = Number((41.5 + norm * 7.0).toFixed(1));
  
  // Spread: -6.5 to +6.5
  const spread = Number(((norm - 0.5) * 13.0).toFixed(1));
  
  // Implied Total: (O/U / 2) - (spread / 2)
  const impliedTotal = Number(Math.max(12.0, (overUnder / 2) - (spread / 2)).toFixed(1));
  const oppImpliedTotal = Number(Math.max(12.0, (overUnder / 2) + (spread / 2)).toFixed(1));
  
  const script = classifyGameScript(spread);

  return {
    team: cleanTeam,
    opponent: 'OPP',
    spread,
    overUnder,
    impliedTotal,
    oppImpliedTotal,
    gameScript: script.label,
    shortScript: script.shortLabel,
    scriptDetail: script,
    isFallback: true
  };
}

/**
 * Parse raw The Odds API response into structured team lookup map
 */
export function parseOddsApiResponse(events) {
  const teamOddsMap = {};

  if (!Array.isArray(events)) return teamOddsMap;

  events.forEach(event => {
    const homeName = String(event.home_team || '').toLowerCase().trim();
    const awayName = String(event.away_team || '').toLowerCase().trim();

    const homeAbbr = NFL_TEAM_NAME_MAP[homeName];
    const awayAbbr = NFL_TEAM_NAME_MAP[awayName];

    if (!homeAbbr || !awayAbbr) return;

    // Preferred sportsbooks: draftkings, fanduel, bovada, or first available
    const bookmaker = (event.bookmakers || []).find(b => ['draftkings', 'fanduel', 'bovada', 'betmgm', 'caesars'].includes(b.key)) 
      || (event.bookmakers && event.bookmakers[0]);

    if (!bookmaker || !Array.isArray(bookmaker.markets)) return;

    let overUnder = 44.5;
    let homeSpread = 0.0;
    let awaySpread = 0.0;
    let foundSpread = false;
    let foundTotal = false;

    bookmaker.markets.forEach(m => {
      if (m.key === 'totals' && Array.isArray(m.outcomes)) {
        const overOutcome = m.outcomes.find(o => String(o.name).toLowerCase() === 'over');
        if (overOutcome && overOutcome.point !== undefined) {
          overUnder = Number(overOutcome.point);
          foundTotal = true;
        }
      } else if (m.key === 'spreads' && Array.isArray(m.outcomes)) {
        const homeOutcome = m.outcomes.find(o => String(o.name).toLowerCase() === homeName);
        const awayOutcome = m.outcomes.find(o => String(o.name).toLowerCase() === awayName);
        if (homeOutcome && homeOutcome.point !== undefined) {
          homeSpread = Number(homeOutcome.point);
          awaySpread = -homeSpread;
          foundSpread = true;
        } else if (awayOutcome && awayOutcome.point !== undefined) {
          awaySpread = Number(awayOutcome.point);
          homeSpread = -awaySpread;
          foundSpread = true;
        }
      }
    });

    if (!foundSpread && !foundTotal) return;

    // Implied Total: (O/U / 2) - (spread / 2)
    const homeImplied = Number(((overUnder / 2) - (homeSpread / 2)).toFixed(1));
    const awayImplied = Number(((overUnder / 2) - (awaySpread / 2)).toFixed(1));

    const homeScript = classifyGameScript(homeSpread);
    const awayScript = classifyGameScript(awaySpread);

    teamOddsMap[homeAbbr] = {
      team: homeAbbr,
      opponent: awayAbbr,
      isHome: true,
      spread: homeSpread,
      overUnder: overUnder,
      impliedTotal: homeImplied,
      oppImpliedTotal: awayImplied,
      gameScript: homeScript.label,
      shortScript: homeScript.shortLabel,
      scriptDetail: homeScript,
      bookmaker: bookmaker.title || bookmaker.key,
      isFallback: false
    };

    teamOddsMap[awayAbbr] = {
      team: awayAbbr,
      opponent: homeAbbr,
      isHome: false,
      spread: awaySpread,
      overUnder: overUnder,
      impliedTotal: awayImplied,
      oppImpliedTotal: homeImplied,
      gameScript: awayScript.label,
      shortScript: awayScript.shortLabel,
      scriptDetail: awayScript,
      bookmaker: bookmaker.title || bookmaker.key,
      isFallback: false
    };
  });

  return teamOddsMap;
}

/**
 * Fetch live NFL odds from The Odds API with 2-Hour LocalStorage Cache
 */
export async function fetchLiveVegasOdds(forceRefresh = false) {
  // 1. Check LocalStorage Cache
  if (!forceRefresh) {
    try {
      const cachedStr = localStorage.getItem(CACHE_KEY);
      if (cachedStr) {
        const cached = JSON.parse(cachedStr);
        if (cached && cached.timestamp && (Date.now() - cached.timestamp < CACHE_TTL_MS) && cached.data) {
          return cached.data;
        }
      }
    } catch (e) {
      console.warn('[Vegas Odds] Cache read error:', e);
    }
  }

  const apiKey = getActiveOddsApiKey();
  if (!apiKey) {
    console.warn('[Vegas Odds Engine] No API key configured (CONFIG.ODDS_API_KEY). Using fallback Vegas lines.');
    return null;
  }

  const endpoint = `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/?apiKey=${encodeURIComponent(apiKey)}&regions=us&markets=spreads,totals&oddsFormat=american`;

  try {
    const res = await fetch(endpoint);
    if (!res.ok) {
      console.warn(`[Vegas Odds Engine] API error (${res.status} ${res.statusText}). Using fallback Vegas lines.`);
      return null;
    }

    const data = await res.json();
    if (!Array.isArray(data)) {
      console.warn('[Vegas Odds Engine] Unexpected response format from The Odds API.');
      return null;
    }

    const parsedOddsMap = parseOddsApiResponse(data);

    // Save to LocalStorage cache
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        timestamp: Date.now(),
        data: parsedOddsMap
      }));
    } catch (saveErr) {
      console.warn('[Vegas Odds] Cache save error:', saveErr);
    }

    return parsedOddsMap;
  } catch (netErr) {
    console.warn('[Vegas Odds Engine] Network fetch error:', netErr.message);
    return null;
  }
}

/**
 * Helper to get Vegas context for a specific team code
 */
export function getTeamVegasContext(teamCode, liveOddsMap = null) {
  const cleanTeam = String(teamCode || '').toUpperCase().trim();
  if (liveOddsMap && liveOddsMap[cleanTeam]) {
    return liveOddsMap[cleanTeam];
  }
  return getFallbackTeamOdds(cleanTeam);
}
