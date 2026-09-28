/**
 * 🐾 SCOUT BOWIE TEST SUITE: FAAB LAB MULTI-YEAR LEAGUE CRAWLER & OPPONENT PROFILING
 * Verifies recursive depth cap (maxPriorSeasons = 2), identity persistence,
 * claim pruning, localStorage caching, September aggression, and RB premium metrics.
 */

import assert from 'assert';
import { WaiverEngine } from '../waiver/waiver-engine.js';
import { WaiverEngine as OddsSuiteWaiverEngine } from '../odds-suite/js/waiverEngine.js';

console.log('🐾 Running FAAB Lab Multi-Year League Crawler & Profiling Tests...\n');

// 1. Verify Bridge Export
assert.strictEqual(WaiverEngine, OddsSuiteWaiverEngine, 'odds-suite/js/waiverEngine.js must re-export WaiverEngine');
console.log('✅ PASS: odds-suite/js/waiverEngine.js re-exports WaiverEngine');

// 2. Mock MockStorage for localStorage emulation in Node
class MockLocalStorage {
  constructor() {
    this.store = {};
  }
  getItem(key) {
    return this.store[key] || null;
  }
  setItem(key, value) {
    this.store[key] = String(value);
  }
  removeItem(key) {
    delete this.store[key];
  }
  clear() {
    this.store = {};
  }
}

// 3. Mock Sleeper Multi-Year API Structure
// Chain: 2026 (1354185157275303936) -> 2025 (1243330295776694272) -> 2024 (1121436020148404224) -> 2023 (939193379383042048 - Should NOT be reached)
const mockLeagues = {
  '1354185157275303936': {
    season: '2026',
    name: 'Scout Bowie Dynasty 2026',
    previous_league_id: '1243330295776694272',
    settings: { waiver_budget: 100 }
  },
  '1243330295776694272': {
    season: '2025',
    name: 'Scout Bowie Dynasty 2025',
    previous_league_id: '1121436020148404224',
    settings: { waiver_budget: 100 }
  },
  '1121436020148404224': {
    season: '2024',
    name: 'Scout Bowie Dynasty 2024',
    previous_league_id: '939193379383042048', // 2023 league
    settings: { waiver_budget: 100 }
  },
  '939193379383042048': {
    season: '2023',
    name: 'Scout Bowie Dynasty 2023 (SHOULD BE IGNORED)',
    previous_league_id: null,
    settings: { waiver_budget: 100 }
  }
};

const mockUsers = [
  { user_id: 'user_alpha', display_name: 'AlphaDog', username: 'alphadog' },
  { user_id: 'user_bravo', display_name: 'BargainHunterBob', username: 'bob' },
  { user_id: 'user_charlie', display_name: 'RbMaximus', username: 'max' }
];

const mockRosters2026 = [
  { roster_id: 1, owner_id: 'user_alpha' },
  { roster_id: 2, owner_id: 'user_bravo' },
  { roster_id: 3, owner_id: 'user_charlie' }
];

// Note: In 2025, roster IDs were swapped, testing cross-year user mapping!
const mockRosters2025 = [
  { roster_id: 1, owner_id: 'user_bravo' },
  { roster_id: 2, owner_id: 'user_alpha' },
  { roster_id: 3, owner_id: 'user_charlie' }
];

const mockRosters2024 = [
  { roster_id: 1, owner_id: 'user_charlie' },
  { roster_id: 2, owner_id: 'user_bravo' },
  { roster_id: 3, owner_id: 'user_alpha' }
];

// Mock Transactions across weeks
const mockTransactions = {
  // 2026: Week 1
  '1354185157275303936_1': [
    {
      type: 'waiver',
      status: 'complete',
      settings: { waiver_bid: 35 },
      roster_ids: [1], // user_alpha in 2026
      adds: { '101': 1 } // RB
    }
  ],
  // 2025: Week 2 (Sept)
  '1243330295776694272_2': [
    {
      type: 'waiver',
      status: 'complete',
      settings: { waiver_bid: 45 },
      roster_ids: [2], // user_alpha in 2025!
      adds: { '102': 2 } // RB
    },
    {
      type: 'waiver',
      status: 'failed',
      settings: { waiver_bid: 20 },
      roster_ids: [1], // user_bravo in 2025!
      adds: { '102': 1 }
    }
  ],
  // 2025: Week 6 (Oct)
  '1243330295776694272_6': [
    {
      type: 'waiver',
      status: 'complete',
      settings: { waiver_bid: 10 },
      roster_ids: [3], // user_charlie
      adds: { '201': 3 } // WR
    }
  ],
  // 2024: Week 3 (Sept)
  '1121436020148404224_3': [
    {
      type: 'waiver',
      status: 'complete',
      settings: { waiver_bid: 40 },
      roster_ids: [1], // user_charlie in 2024!
      adds: { '103': 1 } // RB
    },
    {
      type: 'waiver',
      status: 'complete',
      settings: { waiver_bid: 5 },
      roster_ids: [2], // user_bravo in 2024!
      adds: { '202': 2 } // WR
    },
    {
      type: 'waiver',
      status: 'complete',
      settings: { waiver_bid: 15 },
      roster_ids: [3], // user_alpha in 2024!
      adds: { '99999': 3 } // Unknown/retired player ID
    }
  ]
};

const mockPlayersMap = {
  '101': { player_id: '101', full_name: 'Isaiah Likely', position: 'RB' },
  '102': { player_id: '102', full_name: 'Jordan Mason', position: 'RB' },
  '103': { player_id: '103', full_name: 'Kyren Williams', position: 'RB' },
  '201': { player_id: '201', full_name: 'Demarcus Robinson', position: 'WR' },
  '202': { player_id: '202', full_name: 'Alec Pierce', position: 'WR' }
  // Note: 99999 is intentionally missing to test unknown position safety
};

let fetchedLeagues = [];

const mockFetch = async (url) => {
  const cleanUrl = url.split('?')[0];

  // Match /league/:id/transactions/:week
  const txMatch = cleanUrl.match(/\/league\/([^\/]+)\/transactions\/(\d+)/);
  if (txMatch) {
    const key = `${txMatch[1]}_${txMatch[2]}`;
    const tx = mockTransactions[key] || [];
    return { ok: true, json: async () => tx };
  }

  // Match /league/:id/users
  const userMatch = cleanUrl.match(/\/league\/([^\/]+)\/users/);
  if (userMatch) {
    return { ok: true, json: async () => mockUsers };
  }

  // Match /league/:id/rosters
  const rosterMatch = cleanUrl.match(/\/league\/([^\/]+)\/rosters/);
  if (rosterMatch) {
    const lId = rosterMatch[1];
    if (lId === '1354185157275303936') return { ok: true, json: async () => mockRosters2026 };
    if (lId === '1243330295776694272') return { ok: true, json: async () => mockRosters2025 };
    if (lId === '1121436020148404224') return { ok: true, json: async () => mockRosters2024 };
    return { ok: true, json: async () => [] };
  }

  // Match /league/:id
  const leagueMatch = cleanUrl.match(/\/league\/([^\/]+)/);
  if (leagueMatch) {
    const lId = leagueMatch[1];
    fetchedLeagues.push(lId);
    if (mockLeagues[lId]) {
      return { ok: true, json: async () => mockLeagues[lId] };
    }
  }

  return { ok: false, status: 404, json: async () => ({}) };
};

const engine = new WaiverEngine();
const mockStorage = new MockLocalStorage();

async function runTests() {
  // Test 1: Depth Cap & Crawling Execution
  fetchedLeagues = [];
  const result = await engine.crawlLeagueHistory('1354185157275303936', {
    maxPriorSeasons: 2,
    currentWeek: 1,
    forceRefresh: true,
    allPlayersMap: mockPlayersMap,
    fetchFn: mockFetch,
    localStorageObj: mockStorage
  });

  // Verify Depth Cap: Exactly 3 seasons crawled (2026, 2025, 2024)
  assert.strictEqual(result.seasons.length, 3, 'Should crawl exactly 3 seasons with maxPriorSeasons = 2');
  assert.deepStrictEqual(result.seasons.map(s => s.season), ['2026', '2025', '2024'], 'Crawled seasons should be 2026, 2025, 2024 in order');
  assert(!fetchedLeagues.includes('939193379383042048'), '2023 league MUST NOT be fetched (strictly capped)');
  console.log('✅ PASS: Crawl Depth Cap strictly enforced (2026, 2025, 2024 crawled; 2023 ignored)');

  // Test 2: Pruned Claims Ingestion
  assert(result.claims.length >= 6, `Expected at least 6 claims, got ${result.claims.length}`);
  const failedClaim = result.claims.find(c => c.status === 'failed');
  assert(failedClaim, 'Should capture failed waiver claims');
  assert.strictEqual(failedClaim.manager, 'BargainHunterBob', 'Failed claim should correctly map to manager BargainHunterBob');
  console.log('✅ PASS: Waiver claims (both complete and failed) captured with manager names');

  // Test 3: Safe Parsing for Missing/Retired Player ID
  const unknownPlayerClaim = result.claims.find(c => c.playerId === '99999');
  assert(unknownPlayerClaim, 'Claim for missing player 99999 must exist');
  assert.strictEqual(unknownPlayerClaim.pos, 'UNKNOWN', 'Missing player position should default to UNKNOWN without crashing');
  console.log('✅ PASS: Safe handling of missing/retired player IDs (pos = UNKNOWN)');

  // Test 4: Manager Profiling & Cross-Year Identity Persistence
  const alphaProfile = result.managerProfiles.find(m => m.ownerId === 'user_alpha');
  assert(alphaProfile, 'user_alpha profile must be found across years');
  // user_alpha spent:
  // 2026 W1: $35 (Sept)
  // 2025 W2: $45 (Sept)
  // 2024 W3: $15 (Sept, unknown pos)
  // Total Sept Spend = 35 + 45 + 15 = $95 across 3 seasons (300 budget)
  // Sept Spend Velocity = 95 / 300 = ~32%
  assert.strictEqual(alphaProfile.septSpend, 95, `Expected Alpha Sept Spend 95, got ${alphaProfile.septSpend}`);
  assert.strictEqual(alphaProfile.septSpendVelocity, 32, `Expected Alpha Sept Spend Velocity 32%, got ${alphaProfile.septSpendVelocity}%`);
  console.log(`✅ PASS: Cross-year manager profiling: AlphaDog Sept spend velocity = ${alphaProfile.septSpendVelocity}% across 3 seasons`);

  // Test 5: RB Premium Calculation
  const charlieProfile = result.managerProfiles.find(m => m.ownerId === 'user_charlie');
  assert(charlieProfile, 'user_charlie profile must be found');
  // Charlie won 103 ($40, RB) in 2024, and 201 ($10, WR) in 2025
  // Avg RB Bid = $40, Avg WR Bid = $10
  // RB Premium % = (40 - 10) / 10 = +300%
  assert.strictEqual(charlieProfile.avgRbBid, 40, 'Charlie avg RB bid should be 40');
  assert.strictEqual(charlieProfile.avgWrTeBid, 10, 'Charlie avg WR/TE bid should be 10');
  assert.strictEqual(charlieProfile.rbPremiumPct, 300, `Expected Charlie RB Premium 300%, got ${charlieProfile.rbPremiumPct}%`);
  assert.strictEqual(charlieProfile.archetype, 'RB Chaser 🏃', 'Charlie should be classified as RB Chaser 🏃');
  console.log(`✅ PASS: RB Premium calculated: ${charlieProfile.displayName} RB Premium = +${charlieProfile.rbPremiumPct}% (${charlieProfile.archetype})`);

  // Test 6: League Tendencies
  const tendencies = result.tendencies;
  assert(tendencies.avgStartingRbBid > 0, 'League starting RB avg bid should be > 0');
  assert(tendencies.septemberSpendVelocity > 0, 'League Sept spend velocity should be > 0');
  console.log(`✅ PASS: League Tendency Metrics: Starting RB Avg Bid = $${tendencies.avgStartingRbBid}, Sept Velocity = ${tendencies.septemberSpendVelocity}%, RB Premium = +${tendencies.leagueRbPremium}%`);

  // Test 7: LocalStorage Caching & Retrieval
  const cachedJson = mockStorage.getItem('sleeper_history_1354185157275303936');
  assert(cachedJson, 'localStorage sleeper_history_1354185157275303936 must exist');
  const parsedCache = JSON.parse(cachedJson);
  assert.strictEqual(parsedCache.seasons.length, 3, 'Cached seasons must have 3 seasons');
  assert.strictEqual(parsedCache.claims.length, result.claims.length, 'Cached claims must match');

  // Verify second run loads from cache without network calls
  fetchedLeagues = [];
  const cachedResult = await engine.crawlLeagueHistory('1354185157275303936', {
    maxPriorSeasons: 2,
    forceRefresh: false,
    allPlayersMap: mockPlayersMap,
    fetchFn: mockFetch,
    localStorageObj: mockStorage
  });
  assert.strictEqual(cachedResult.fromCache, true, 'Second call should load from cache');
  assert.strictEqual(fetchedLeagues.length, 0, 'No fetch calls should be made when reading from cache');
  console.log('✅ PASS: LocalStorage 24h caching works seamlessly with zero redundant fetches');

  console.log('\n🎉 ALL 7 TEST SUITES PASSED FLAWLESSLY! 🐾');
}

runTests().catch(err => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
