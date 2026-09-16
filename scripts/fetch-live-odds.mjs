/**
 * 🐾 SCOUT BOWIE NFL LIVE ODDS SYNC PIPELINE
 * Fetches real-time consensus lines from The Odds API v4,
 * normalizes team names, updates point spreads, totals, and moneylines,
 * and synchronizes data/nfl_slate.json.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Verify API Key
const apiKey = process.env.ODDS_API_KEY;
if (!apiKey) {
  console.error('❌ Error: ODDS_API_KEY environment variable is not set.');
  console.error('👉 Please configure your The Odds API key in GitHub Secrets or set ODDS_API_KEY locally.');
  process.exit(1);
}

// 2. Team Name Normalization Dictionary
const TEAM_NAME_TO_CODE = {
  'Arizona Cardinals': 'ARI',
  'Atlanta Falcons': 'ATL',
  'Baltimore Ravens': 'BAL',
  'Buffalo Bills': 'BUF',
  'Carolina Panthers': 'CAR',
  'Chicago Bears': 'CHI',
  'Cincinnati Bengals': 'CIN',
  'Cleveland Browns': 'CLE',
  'Dallas Cowboys': 'DAL',
  'Denver Broncos': 'DEN',
  'Detroit Lions': 'DET',
  'Green Bay Packers': 'GB',
  'Houston Texans': 'HOU',
  'Indianapolis Colts': 'IND',
  'Jacksonville Jaguars': 'JAX',
  'Kansas City Chiefs': 'KC',
  'Las Vegas Raiders': 'LV',
  'Los Angeles Chargers': 'LAC',
  'Los Angeles Rams': 'LAR',
  'Miami Dolphins': 'MIA',
  'Minnesota Vikings': 'MIN',
  'New England Patriots': 'NE',
  'New Orleans Saints': 'NO',
  'New York Giants': 'NYG',
  'New York Jets': 'NYJ',
  'Philadelphia Eagles': 'PHI',
  'Pittsburgh Steelers': 'PIT',
  'San Francisco 49ers': 'SF',
  'Seattle Seahawks': 'SEA',
  'Tampa Bay Buccaneers': 'TB',
  'Tennessee Titans': 'TEN',
  'Washington Commanders': 'WAS',
  'Washington Football Team': 'WAS',
  'Washington Redskins': 'WAS',
  'Oakland Raiders': 'LV',
  'San Diego Chargers': 'LAC',
  'St. Louis Rams': 'LAR'
};

function normalizeTeamCode(name) {
  if (!name) return null;
  const trimmed = name.trim();
  if (TEAM_NAME_TO_CODE[trimmed]) return TEAM_NAME_TO_CODE[trimmed];
  
  // Case-insensitive lookup fallback
  const lower = trimmed.toLowerCase();
  for (const [fullName, code] of Object.entries(TEAM_NAME_TO_CODE)) {
    if (fullName.toLowerCase() === lower || fullName.toLowerCase().includes(lower)) {
      return code;
    }
  }
  return null;
}

function americanToImplied(odds) {
  const n = Number(odds);
  if (isNaN(n) || n === 0) return 0.5;
  if (n < 0) return -n / (-n + 100);
  return 100 / (n + 100);
}

// 3. Locate Target nfl_slate.json Files
function findSlateFilePaths() {
  const candidates = [
    path.resolve(process.cwd(), 'data/nfl_slate.json'),
    path.resolve(process.cwd(), 'odds-suite/data/nfl_slate.json'),
    path.resolve(__dirname, '../data/nfl_slate.json'),
    path.resolve(__dirname, '../odds-suite/data/nfl_slate.json'),
    path.resolve(__dirname, '../../data/nfl_slate.json'),
    path.resolve(__dirname, '../../odds-suite/data/nfl_slate.json')
  ];

  const uniquePaths = Array.from(new Set(candidates));
  const existing = uniquePaths.filter(p => fs.existsSync(p));
  
  if (existing.length > 0) {
    return existing;
  }

  // If none exist yet, default to root ./data/nfl_slate.json
  const defaultPath = path.resolve(process.cwd(), 'data/nfl_slate.json');
  return [defaultPath];
}

// 4. Preferred Bookmaker Priority
const PREFERRED_BOOKMAKERS = [
  'draftkings',
  'fanduel',
  'betmgm',
  'bovada',
  'caesars',
  'pointsbetus',
  'williamhill_us',
  'betrivers',
  'lowvig',
  'betonlineag'
];

function extractBestMarketData(game) {
  if (!game || !Array.isArray(game.bookmakers) || game.bookmakers.length === 0) {
    return null;
  }

  // Sort bookmakers by priority
  const sortedBooks = [...game.bookmakers].sort((a, b) => {
    const idxA = PREFERRED_BOOKMAKERS.indexOf(a.key);
    const idxB = PREFERRED_BOOKMAKERS.indexOf(b.key);
    const scoreA = idxA === -1 ? 999 : idxA;
    const scoreB = idxB === -1 ? 999 : idxB;
    return scoreA - scoreB;
  });

  const homeTeamName = game.home_team;
  const awayTeamName = game.away_team;

  let spread = null;
  let spreadOdds = -110;
  let total = null;
  let totalOverOdds = -110;
  let totalUnderOdds = -110;
  let homeMoneyline = null;
  let awayMoneyline = null;
  let bookmakerUsed = null;

  for (const book of sortedBooks) {
    const markets = book.markets || [];

    // Point Spread
    if (spread === null) {
      const spreadMarket = markets.find(m => m.key === 'spreads');
      if (spreadMarket && Array.isArray(spreadMarket.outcomes)) {
        const homeOutcome = spreadMarket.outcomes.find(o => o.name === homeTeamName);
        if (homeOutcome && homeOutcome.point !== undefined) {
          spread = Number(homeOutcome.point);
          spreadOdds = Number(homeOutcome.price) || -110;
          if (!bookmakerUsed) bookmakerUsed = book.title || book.key;
        }
      }
    }

    // Totals (O/U)
    if (total === null) {
      const totalsMarket = markets.find(m => m.key === 'totals');
      if (totalsMarket && Array.isArray(totalsMarket.outcomes)) {
        const overOutcome = totalsMarket.outcomes.find(o => o.name === 'Over');
        const underOutcome = totalsMarket.outcomes.find(o => o.name === 'Under');
        if (overOutcome && overOutcome.point !== undefined) {
          total = Number(overOutcome.point);
          totalOverOdds = Number(overOutcome.price) || -110;
          totalUnderOdds = underOutcome ? (Number(underOutcome.price) || -110) : -110;
          if (!bookmakerUsed) bookmakerUsed = book.title || book.key;
        }
      }
    }

    // Moneyline (H2H)
    if (homeMoneyline === null || awayMoneyline === null) {
      const h2hMarket = markets.find(m => m.key === 'h2h');
      if (h2hMarket && Array.isArray(h2hMarket.outcomes)) {
        const homeOutcome = h2hMarket.outcomes.find(o => o.name === homeTeamName);
        const awayOutcome = h2hMarket.outcomes.find(o => o.name === awayTeamName);
        if (homeOutcome && awayOutcome) {
          homeMoneyline = Number(homeOutcome.price);
          awayMoneyline = Number(awayOutcome.price);
          if (!bookmakerUsed) bookmakerUsed = book.title || book.key;
        }
      }
    }

    // Stop if all found
    if (spread !== null && total !== null && homeMoneyline !== null && awayMoneyline !== null) {
      break;
    }
  }

  return {
    spread,
    spreadOdds,
    total,
    totalOverOdds,
    totalUnderOdds,
    homeMoneyline,
    awayMoneyline,
    bookmaker: bookmakerUsed || 'Consensus'
  };
}

async function main() {
  console.log('⚡ SCOUT BOWIE LIVE ODDS SYNC ⚡\n');
  const slatePaths = findSlateFilePaths();

  if (slatePaths.length === 0) {
    console.error('❌ Error: Could not locate data/nfl_slate.json.');
    process.exit(1);
  }

  console.log(`📁 Found ${slatePaths.length} slate file(s) to synchronize:`);
  slatePaths.forEach(p => console.log(`   ➔ ${p}`));

  // 1. Fetch from The Odds API v4
  const apiUrl = `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;
  console.log('\n🌐 Requesting live NFL lines from The Odds API v4...');

  let apiGames = [];
  try {
    const res = await fetch(apiUrl);
    
    // Log API quota usage if headers present
    const remaining = res.headers.get('x-requests-remaining');
    const used = res.headers.get('x-requests-used');
    if (remaining !== null) {
      console.log(`📊 The Odds API Quota: ${remaining} remaining (used: ${used || '0'})`);
    }

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${errorText}`);
    }

    apiGames = await res.json();
    console.log(`✅ Successfully fetched ${apiGames.length} upcoming NFL matchups from The Odds API.`);
  } catch (err) {
    console.error(`❌ Failed to fetch odds from The Odds API: ${err.message}`);
    process.exit(1);
  }

  if (!Array.isArray(apiGames) || apiGames.length === 0) {
    console.log('⚠️ No active or upcoming NFL games returned by The Odds API (e.g. offseason or midweek lull). Slate unchanged.');
    process.exit(0);
  }

  // 2. Build Lookup Map from API Games: Key = `${homeCode}_${awayCode}`
  const apiLookup = new Map();
  let parsedGamesCount = 0;

  apiGames.forEach(g => {
    const homeCode = normalizeTeamCode(g.home_team);
    const awayCode = normalizeTeamCode(g.away_team);

    if (!homeCode || !awayCode) {
      console.warn(`⚠️ Warning: Unrecognized team in game: "${g.away_team}" @ "${g.home_team}"`);
      return;
    }

    const marketData = extractBestMarketData(g);
    if (!marketData) return;

    const key = `${homeCode}_${awayCode}`;
    apiLookup.set(key, {
      homeCode,
      awayCode,
      commenceTime: g.commence_time,
      ...marketData
    });
    parsedGamesCount++;
  });

  console.log(`🎯 Normalized ${parsedGamesCount} live matchups ready for slate merging.\n`);

  // 3. Update Each Slate File
  for (const slatePath of slatePaths) {
    let slateData;
    try {
      const raw = fs.readFileSync(slatePath, 'utf8');
      slateData = JSON.parse(raw);
    } catch (e) {
      console.error(`❌ Failed reading JSON from ${slatePath}: ${e.message}`);
      continue;
    }

    let updatedCount = 0;

    slateData.forEach(weekObj => {
      if (!Array.isArray(weekObj.games)) return;

      weekObj.games.forEach(g => {
        const key = `${g.homeTeam}_${g.awayTeam}`;
        if (!apiLookup.has(key)) return;

        const live = apiLookup.get(key);
        let modified = false;

        // Update Spread
        if (live.spread !== null) {
          g.spread = live.spread;
          g.spreadOdds = live.spreadOdds || -110;
          modified = true;
        }

        // Update Total
        if (live.total !== null) {
          g.total = live.total;
          g.totalOverOdds = live.totalOverOdds || -110;
          g.totalUnderOdds = live.totalUnderOdds || -110;
          modified = true;
        }

        // Update Moneylines & Calibrated Win Probabilities
        if (live.homeMoneyline !== null && live.awayMoneyline !== null) {
          g.homeMoneyline = live.homeMoneyline;
          g.awayMoneyline = live.awayMoneyline;

          const hImp = americanToImplied(live.homeMoneyline);
          const aImp = americanToImplied(live.awayMoneyline);
          const sumImp = hImp + aImp;

          if (sumImp > 0) {
            g.homeWinProb = Number((hImp / sumImp).toFixed(2));
            g.awayWinProb = Number((1 - g.homeWinProb).toFixed(2));
          }
          modified = true;
        }

        if (modified) {
          updatedCount++;
          console.log(`  🔄 [W${weekObj.week}] ${g.awayTeam} @ ${g.homeTeam} ➔ Spread: ${g.spread > 0 ? '+' + g.spread : g.spread} (${g.spreadOdds}) | Total: ${g.total} | ML: ${g.homeTeam} ${g.homeMoneyline > 0 ? '+' + g.homeMoneyline : g.homeMoneyline} / ${g.awayTeam} ${g.awayMoneyline > 0 ? '+' + g.awayMoneyline : g.awayMoneyline} [${live.bookmaker}]`);
        }
      });
    });

    // Ensure target folder exists and write updated slate back to disk with 2-space indentation
    const dir = path.dirname(slatePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(slatePath, JSON.stringify(slateData, null, 2) + '\n', 'utf8');
    console.log(`\n💾 Saved ${updatedCount} live odds updates to: ${slatePath}`);
  }

  console.log('\n🎉 Live Odds Sync Complete! All lines synchronized successfully. 🐾');
}

main().catch(err => {
  console.error('Fatal error running odds sync:', err);
  process.exit(1);
});
