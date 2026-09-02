/**
 * NFL SCHEDULE & STADIUM VENUE / WEATHER ENGINE
 * Provides realistic game schedules, home/away opponent mapping,
 * kickoff times, stadium directories, step-function weather modeling,
 * and visual weather/venue badges matching Sleeper's native UI.
 */

export const DOME_TEAMS = new Set([
  'DET', 'MIN', 'LV', 'LAR', 'LAC', 'NO', 'ATL', 'IND', 'DAL', 'HOU', 'ARI'
]);

export const STADIUM_DIRECTORY = {
  DET: { name: "Ford Field", city: "Detroit, MI", isDome: true, roof: "Fixed Dome" },
  MIN: { name: "U.S. Bank Stadium", city: "Minneapolis, MN", isDome: true, roof: "Fixed Dome" },
  LV:  { name: "Allegiant Stadium", city: "Las Vegas, NV", isDome: true, roof: "Fixed Dome" },
  LAR: { name: "SoFi Stadium", city: "Inglewood, CA", isDome: true, roof: "Fixed Canopy" },
  LAC: { name: "SoFi Stadium", city: "Inglewood, CA", isDome: true, roof: "Fixed Canopy" },
  NO:  { name: "Caesars Superdome", city: "New Orleans, LA", isDome: true, roof: "Fixed Dome" },
  ATL: { name: "Mercedes-Benz Stadium", city: "Atlanta, GA", isDome: true, roof: "Retractable Dome" },
  IND: { name: "Lucas Oil Stadium", city: "Indianapolis, IN", isDome: true, roof: "Retractable Dome" },
  DAL: { name: "AT&T Stadium", city: "Arlington, TX", isDome: true, roof: "Retractable Dome" },
  HOU: { name: "NRG Stadium", city: "Houston, TX", isDome: true, roof: "Retractable Dome" },
  ARI: { name: "State Farm Stadium", city: "Glendale, AZ", isDome: true, roof: "Retractable Dome" },
  KC:  { name: "Arrowhead Stadium", city: "Kansas City, MO", isDome: false, roof: "Outdoor Open-Air" },
  BUF: { name: "Highmark Stadium", city: "Orchard Park, NY", isDome: false, roof: "Outdoor Open-Air" },
  PHI: { name: "Lincoln Financial Field", city: "Philadelphia, PA", isDome: false, roof: "Outdoor Open-Air" },
  SF:  { name: "Levi's Stadium", city: "Santa Clara, CA", isDome: false, roof: "Outdoor Open-Air" },
  GB:  { name: "Lambeau Field", city: "Green Bay, WI", isDome: false, roof: "Outdoor Open-Air" },
  CHI: { name: "Soldier Field", city: "Chicago, IL", isDome: false, roof: "Outdoor Open-Air" },
  BAL: { name: "M&T Bank Stadium", city: "Baltimore, MD", isDome: false, roof: "Outdoor Open-Air" },
  CIN: { name: "Paycor Stadium", city: "Cincinnati, OH", isDome: false, roof: "Outdoor Open-Air" },
  CLE: { name: "Huntington Bank Field", city: "Cleveland, OH", isDome: false, roof: "Outdoor Open-Air" },
  PIT: { name: "Acrisure Stadium", city: "Pittsburgh, PA", isDome: false, roof: "Outdoor Open-Air" },
  NYG: { name: "MetLife Stadium", city: "East Rutherford, NJ", isDome: false, roof: "Outdoor Open-Air" },
  NYJ: { name: "MetLife Stadium", city: "East Rutherford, NJ", isDome: false, roof: "Outdoor Open-Air" },
  NE:  { name: "Gillette Stadium", city: "Foxborough, MA", isDome: false, roof: "Outdoor Open-Air" },
  MIA: { name: "Hard Rock Stadium", city: "Miami Gardens, FL", isDome: false, roof: "Outdoor Canopy" },
  TB:  { name: "Raymond James Stadium", city: "Tampa, FL", isDome: false, roof: "Outdoor Open-Air" },
  JAX: { name: "EverBank Stadium", city: "Jacksonville, FL", isDome: false, roof: "Outdoor Open-Air" },
  TEN: { name: "Nissan Stadium", city: "Nashville, TN", isDome: false, roof: "Outdoor Open-Air" },
  DEN: { name: "Empower Field at Mile High", city: "Denver, CO", isDome: false, roof: "Outdoor Open-Air" },
  SEA: { name: "Lumen Field", city: "Seattle, WA", isDome: false, roof: "Outdoor Open-Air" },
  WAS: { name: "Northwest Stadium", city: "Landover, MD", isDome: false, roof: "Outdoor Open-Air" },
  CAR: { name: "Bank of America Stadium", city: "Charlotte, NC", isDome: false, roof: "Outdoor Open-Air" }
};

export const ALL_TEAMS = Object.keys(STADIUM_DIRECTORY);

/**
 * Generate realistic weather conditions for a home stadium venue and week
 */
export function generateStadiumWeather(homeTeam, week = 1) {
  if (DOME_TEAMS.has(homeTeam)) {
    return {
      isDome: true,
      windSpeed: 0,
      temperature: 72,
      condition: 'indoor',
      isWindAlert: false,
      isSevereWind: false,
      isColdAlert: false,
      summary: 'Indoor Climate Controlled'
    };
  }

  // Base seasonal temperature profile
  let baseTemp = 72;
  if (week <= 4) baseTemp = 74;
  else if (week <= 8) baseTemp = 64;
  else if (week <= 12) baseTemp = 48;
  else baseTemp = 32;

  // Stadium geographic temperature offset
  const warmCities = ['MIA', 'TB', 'JAX', 'SF', 'CAR', 'TEN'];
  const coldCities = ['GB', 'BUF', 'CHI', 'CLE', 'NE', 'PIT', 'DEN'];

  if (warmCities.includes(homeTeam)) baseTemp += 12;
  if (coldCities.includes(homeTeam)) baseTemp -= (week >= 10 ? 18 : 6);

  // Hash-seeded wind and micro-weather
  let hash = 0;
  const seedStr = `${homeTeam}_wk${week}_nfl`;
  for (let i = 0; i < seedStr.length; i++) {
    hash = (hash << 5) - hash + seedStr.charCodeAt(i);
    hash |= 0;
  }
  const normHash = (Math.abs(hash) % 100) / 100;

  // Windy outdoor stadiums (Cleveland Lakefront, Chicago Lakefront, Buffalo, East Rutherford)
  const isWindProne = ['CLE', 'CHI', 'BUF', 'NYG', 'NYJ', 'NE', 'SF'].includes(homeTeam);
  
  let windSpeed = 6 + Math.round(normHash * 8); // 6 - 14 mph default
  if (isWindProne) {
    if (normHash > 0.45 && normHash <= 0.80) {
      windSpeed = 16 + Math.round(normHash * 3); // 16 - 19 mph (High Wind Alert)
    } else if (normHash > 0.80) {
      windSpeed = 20 + Math.round(normHash * 6); // 20 - 26 mph (Severe Wind Alert)
    }
  }

  const temperature = Math.max(8, Math.min(92, Math.round(baseTemp + (normHash * 10 - 5))));
  const isSevereWind = windSpeed >= 20;
  const isWindAlert = windSpeed >= 15 && !isSevereWind;
  const isColdAlert = temperature <= 15;

  let condition = 'clear';
  if (isSevereWind || isWindAlert) condition = 'windy';
  else if (isColdAlert) condition = 'freezing';

  return {
    isDome: false,
    windSpeed,
    temperature,
    condition,
    isWindAlert,
    isSevereWind,
    isColdAlert,
    summary: `${temperature}°F, ${windSpeed} mph wind`
  };
}

/**
 * Step-function weather impact multipliers for fantasy projected points
 */
export function calculateWeatherModifier(position, archetype, weather) {
  if (!weather || weather.isDome) return 1.0;

  const wind = weather.windSpeed || 0;
  const temp = weather.temperature || 70;
  const isDeepWr = String(archetype || '').includes('Deep') || String(archetype || '').includes('Volatile');
  const isSlotWr = String(archetype || '').includes('Slot') || String(archetype || '').includes('Possession');

  let mult = 1.0;

  // 1. Wind impact step-function
  if (wind >= 20) {
    if (position === 'QB') mult *= 0.86;
    else if (position === 'WR' && isDeepWr) mult *= 0.80;
    else if (position === 'WR' && isSlotWr) mult *= 0.95;
    else if (position === 'WR') mult *= 0.88;
    else if (position === 'RB') mult *= 1.04;
    else if (position === 'K') mult *= 0.70;
    else if (position === 'DEF') mult *= 1.10;
    else if (position === 'TE') mult *= 0.94;
  } else if (wind >= 15) {
    if (position === 'QB') mult *= 0.93;
    else if (position === 'WR' && isDeepWr) mult *= 0.88;
    else if (position === 'WR' && isSlotWr) mult *= 0.98;
    else if (position === 'WR') mult *= 0.93;
    else if (position === 'RB') mult *= 1.02;
    else if (position === 'K') mult *= 0.85;
    else if (position === 'DEF') mult *= 1.05;
    else if (position === 'TE') mult *= 0.97;
  }

  // 2. Temperature impact (<= 15°F)
  if (temp <= 15) {
    if (position === 'QB') mult *= 0.92;
    else if (position === 'WR') mult *= 0.92;
    else if (position === 'K') mult *= 0.85;
  }

  return Number(mult.toFixed(3));
}

const ESPN_TO_SLEEPER_TEAMS = {
  WSH: 'WAS',
  LA: 'LAR',
  JAC: 'JAX'
};

export function normalizeTeamCode(code) {
  if (!code) return 'FA';
  const c = String(code).toUpperCase().trim();
  return ESPN_TO_SLEEPER_TEAMS[c] || c;
}

const espnScheduleCache = new Map();

/**
 * Fetch live NFL schedule from ESPN scoreboard API for a given season and week
 */
export async function fetchLiveNflSchedule(season = '2026', week = 1, seasonType = 2) {
  console.log('[Schedule Engine] Active Season/Week:', { season, week });

  const cacheKey = `${season}_${week}_${seasonType}`;
  if (espnScheduleCache.has(cacheKey)) {
    const cached = espnScheduleCache.get(cacheKey);
    console.log('[Schedule Engine] Fetched ESPN Matchups (from cache):', cached);
    console.log('[Schedule Engine] Team Schedule Map for LAC/PHI/JAX:', {
      LAC: cached['LAC'],
      PHI: cached['PHI'],
      JAX: cached['JAX']
    });
    return cached;
  }

  const scheduleMap = {};

  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=${seasonType}&week=${week}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.events)) {
        for (const event of data.events) {
          const comp = event.competitions?.[0];
          if (!comp || !Array.isArray(comp.competitors) || comp.competitors.length < 2) continue;

          const homeComp = comp.competitors.find(c => c.homeAway === 'home') || comp.competitors[0];
          const awayComp = comp.competitors.find(c => c.homeAway === 'away') || comp.competitors[1];

          const homeTeamRaw = homeComp.team?.abbreviation || '';
          const awayTeamRaw = awayComp.team?.abbreviation || '';

          const homeTeam = normalizeTeamCode(homeTeamRaw);
          const awayTeam = normalizeTeamCode(awayTeamRaw);

          const venue = comp.venue || {};
          const isVenueIndoor = venue.indoor === true || DOME_TEAMS.has(homeTeam);
          const rawStadiumName = venue.fullName || STADIUM_DIRECTORY[homeTeam]?.name || `${homeTeam} Stadium`;
          const stadiumName = rawStadiumName.replace(/\s*\(Old\)/gi, '').trim();
          const stadiumCity = venue.address ? `${venue.address.city}, ${venue.address.state || ''}` : STADIUM_DIRECTORY[homeTeam]?.city || '';

          let day = 'Sun';
          let time = '1:00 PM';
          if (event.date) {
            try {
              const gameDate = new Date(event.date);
              const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
              day = days[gameDate.getDay()];
              time = gameDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
            } catch (e) {}
          }

          const statusState = event.status?.type?.state || 'pre'; // 'pre', 'in', 'post'
          const statusDetail = event.status?.type?.shortDetail || event.status?.type?.detail || '';
          const period = event.status?.period || 0;
          const displayClock = event.status?.displayClock || '';
          const homeScore = parseInt(homeComp.score, 10) || 0;
          const awayScore = parseInt(awayComp.score, 10) || 0;

          let parsedWeather = null;
          if (isVenueIndoor) {
            parsedWeather = {
              isDome: true,
              windSpeed: 0,
              temperature: 72,
              condition: 'indoor',
              isWindAlert: false,
              isSevereWind: false,
              isColdAlert: false,
              summary: 'Indoor Climate Controlled'
            };
          } else if (comp.weather) {
            const temp = typeof comp.weather.temperature === 'number' ? comp.weather.temperature : 70;
            const wind = comp.weather.wind?.speed || comp.weather.windSpeed || 0;
            const desc = String(comp.weather.displayValue || '').toLowerCase();
            let cond = 'clear';
            if (desc.includes('rain') || desc.includes('shower')) cond = 'rain';
            else if (desc.includes('snow') || desc.includes('flurr')) cond = 'snow';
            else if (wind >= 15) cond = 'windy';
            else if (temp <= 15) cond = 'freezing';

            parsedWeather = {
              isDome: false,
              windSpeed: wind,
              temperature: temp,
              condition: cond,
              isWindAlert: wind >= 15 && wind < 20,
              isSevereWind: wind >= 20,
              isColdAlert: temp <= 15,
              summary: comp.weather.displayValue || `${temp}°F, ${wind} mph`
            };
          } else {
            parsedWeather = generateStadiumWeather(homeTeam, week);
          }

          scheduleMap[homeTeam] = {
            team: homeTeam,
            opponent: awayTeam,
            isHome: true,
            day,
            time,
            isDome: isVenueIndoor,
            stadiumName,
            stadiumCity,
            weather: parsedWeather,
            statusState,
            statusDetail,
            period,
            displayClock,
            teamScore: homeScore,
            oppScore: awayScore
          };

          scheduleMap[awayTeam] = {
            team: awayTeam,
            opponent: homeTeam,
            isHome: false,
            day,
            time,
            isDome: isVenueIndoor,
            stadiumName,
            stadiumCity,
            weather: parsedWeather,
            statusState,
            statusDetail,
            period,
            displayClock,
            teamScore: awayScore,
            oppScore: homeScore
          };
        }
      }
    }
  } catch (err) {
    console.warn(`[Schedule Engine] WARNING: Failed to fetch live ESPN schedule for season ${season}, week ${week}:`, err);
  }

  console.log('[Schedule Engine] Fetched ESPN Matchups:', scheduleMap);
  console.log('[Schedule Engine] Team Schedule Map for LAC/PHI/JAX:', {
    LAC: scheduleMap['LAC'],
    PHI: scheduleMap['PHI'],
    JAX: scheduleMap['JAX']
  });

  espnScheduleCache.set(cacheKey, scheduleMap);
  return scheduleMap;
}

/**
 * Get comprehensive game schedule, opponent, venue, and weather indicators for a team and week
 */
export function getGameScheduleInfo(teamCode, week = 1, liveSchedule = null) {
  const team = normalizeTeamCode(teamCode);
  
  if (team === 'FA' || (!STADIUM_DIRECTORY[team] && !liveSchedule?.[team])) {
    return {
      team: team || 'FA',
      opponent: 'BYE',
      isHome: true,
      day: 'Sun',
      time: '1:00 PM',
      isDome: false,
      weather: { isDome: false, windSpeed: 0, temperature: 72, isWindAlert: false, isSevereWind: false },
      badgeHtml: '',
      text: 'vs BYE',
      html: `<span style="color:var(--muted);font-size:11px;">BYE WEEK</span>`
    };
  }

  // Check passed liveSchedule, or active cache entry
  let matchInfo = liveSchedule?.[team];
  if (!matchInfo && espnScheduleCache.size > 0) {
    for (const cachedMap of espnScheduleCache.values()) {
      if (cachedMap[team]) {
        matchInfo = cachedMap[team];
        break;
      }
    }
  }

  if (!matchInfo) {
    console.warn(`[Schedule Engine] No live matchup found for ${team} in week ${week}. Generating rotational fallback.`);
    const idx = ALL_TEAMS.indexOf(team);
    const oppIdx = idx >= 0 ? (idx + (week * 3) + 7) % ALL_TEAMS.length : 0;
    const oppTeam = ALL_TEAMS[oppIdx === idx ? (oppIdx + 1) % ALL_TEAMS.length : oppIdx];
    const isHome = idx >= 0 ? ((idx + week) % 2 === 0) : true;

    const slotSeed = (idx + week * 5) % 6;
    let day = 'Sun';
    let time = '1:00 PM';

    if (slotSeed === 0) { day = 'Thu'; time = '8:15 PM'; }
    else if (slotSeed === 1) { day = 'Sun'; time = '1:00 PM'; }
    else if (slotSeed === 2) { day = 'Sun'; time = '1:00 PM'; }
    else if (slotSeed === 3) { day = 'Sun'; time = '4:05 PM'; }
    else if (slotSeed === 4) { day = 'Sun'; time = '4:25 PM'; }
    else if (slotSeed === 5) { day = 'Mon'; time = '8:15 PM'; }

    const homeTeam = isHome ? team : oppTeam;
    const isDome = DOME_TEAMS.has(homeTeam);
    const stadium = STADIUM_DIRECTORY[homeTeam] || { name: `${homeTeam} Stadium`, city: '' };
    const weather = generateStadiumWeather(homeTeam, week);

    matchInfo = {
      team,
      opponent: oppTeam,
      isHome,
      day,
      time,
      isDome,
      stadiumName: stadium.name,
      stadiumCity: stadium.city,
      weather
    };
  }

  const { opponent, isHome, day, time, isDome, stadiumName, weather } = matchInfo;
  const badgeHtml = getVenueBadgeHtml(isDome, time, weather, stadiumName);

  const locPrefix = isHome ? 'vs' : '@';
  const text = `${day} ${time} ${locPrefix} ${opponent}`;

  const html = `
    <span style="display:inline-flex;align-items:center;gap:5px;color:var(--muted);font-size:11px;flex-wrap:wrap;">
      <span style="font-weight:700;color:var(--text);">${team}</span>
      <span>&middot;</span>
      <span>${day} ${time}</span>
      <span style="font-weight:600;color:${isHome ? 'var(--accent)' : 'var(--prob-mid)'};">${locPrefix} ${opponent}</span>
      ${badgeHtml}
    </span>
  `;

  return {
    team,
    opponent,
    isHome,
    day,
    time,
    isDome,
    weather,
    badgeHtml,
    stadiumName,
    text,
    html,
    statusState: matchInfo.statusState || 'pre',
    statusDetail: matchInfo.statusDetail || '',
    period: matchInfo.period || 0,
    displayClock: matchInfo.displayClock || '',
    teamScore: matchInfo.teamScore || 0,
    oppScore: matchInfo.oppScore || 0,
    gameState: matchInfo.statusState === 'post' ? 'FINAL' : matchInfo.statusState === 'in' ? 'IN_PROGRESS' : 'UPCOMING'
  };
}

/**
 * Generate accurate exception-only condition venue badge HTML
 * - DOME: Cyan Pill (🏟️ DOME)
 * - Adverse Weather: Amber Pill (💨 18 mph, 🌧️ Rain, ❄️ Snow)
 * - Standard Outdoor: Clean empty string (no badge)
 */
export function getVenueBadgeHtml(isDome, time, weather, stadiumName = '') {
  if (isDome) {
    return `<span class="badge-venue dome" title="Climate-Controlled Stadium (${stadiumName})">🏟️ DOME</span>`;
  }

  const wind = weather?.windSpeed ?? 0;
  const temp = weather?.temperature ?? 70;
  const cond = String(weather?.condition ?? 'clear').toLowerCase();

  if (cond.includes('snow')) {
    return `<span class="badge-venue weather-warn" title="Snow expected at ${stadiumName}">❄️ Snow</span>`;
  }

  if (cond.includes('rain') || cond.includes('precipitation')) {
    return `<span class="badge-venue weather-warn" title="Precipitation expected at ${stadiumName}">🌧️ Rain</span>`;
  }

  if (wind >= 15) {
    return `<span class="badge-venue weather-warn" title="High Wind: ${wind} mph at ${stadiumName} (Passing/Kicking impact)">💨 ${wind} mph</span>`;
  }

  if (temp <= 15) {
    return `<span class="badge-venue weather-warn" title="Freezing conditions: ${temp}°F at ${stadiumName}">❄️ ${temp}°F</span>`;
  }

  // Standard Outdoor: Clean, exception-based (no OUTDOOR tag, no sun icon)
  return '';
}

/**
 * Helper to get venue badge directly from a player object
 */
export function getVenueBadge(player, week = 1, liveSchedule = null) {
  if (!player) return '';
  const sched = getGameScheduleInfo(player.team, week, liveSchedule);
  return sched?.badgeHtml || '';
}
