/**
 * 🐾 SCOUT BOWIE TEST SUITE: DROP PROTECTION & CONTEXTUAL FAAB MULTIPLIERS
 * Verifies:
 * 1. Puka Nacua and Travis Etienne are strictly drop-protected and NEVER suggested for drops.
 * 2. Ollie Gordon taking over for Devon Achane (Achane out for year) receives a ~50%+ FAAB bid ($50-$55),
 *    NOT diluted by generic $18 historical averages.
 * 3. Contrast test: Minor 1-week rental receives a standard rental bid ($18-$25).
 */

import assert from 'assert';
import { WaiverEngine } from '../waiver/waiver-engine.js';

console.log('🐾 Running Drop Protection & Contextual FAAB Tests...\n');

const engine = new WaiverEngine();

// =========================================================================
// TEST 1: isDropProtected Helper
// =========================================================================
const pukaNacua = {
  player_id: '9228',
  full_name: 'Puka Nacua',
  position: 'WR',
  team: 'LAR',
  status: 'Inactive',
  injury_status: 'OUT',
  projected_pts: 0.0,
  raw_projected_pts: 16.5,
  search_rank: 12
};

const travisEtienne = {
  player_id: '7543',
  full_name: 'Travis Etienne Jr.',
  position: 'RB',
  team: 'JAX',
  status: 'Active',
  injury_status: 'QUESTIONABLE',
  projected_pts: 0.0,
  raw_projected_pts: 14.8,
  search_rank: 18
};

const schoonmaker = {
  player_id: '9502',
  full_name: 'Luke Schoonmaker',
  position: 'TE',
  team: 'DAL',
  status: 'Active',
  injury_status: null,
  projected_pts: 3.2,
  raw_projected_pts: 3.2,
  search_rank: 350
};

const achaneInjured = {
  player_id: '9226',
  full_name: "De'Von Achane",
  position: 'RB',
  team: 'MIA',
  status: 'IR',
  injury_status: 'IR',
  injury_notes: 'Achilles tear, out for the year',
  depth_chart_order: 1,
  projected_pts: 0.0,
  raw_projected_pts: 16.5,
  search_rank: 15
};

assert.strictEqual(engine.isDropProtected(pukaNacua), true, 'Puka Nacua must be drop protected');
assert.strictEqual(engine.isDropProtected(travisEtienne), true, 'Travis Etienne must be drop protected');
assert.strictEqual(engine.isDropProtected(schoonmaker), false, 'Luke Schoonmaker must NOT be drop protected');
// Achane is out for season with torn achilles so he loses drop protection if IR slots are full
assert.strictEqual(engine.isDropProtected(achaneInjured), false, 'Achane with out for year note is not drop protected on full IR');
console.log('✅ PASS: isDropProtected correctly protects stars and allows droppable assets');

// =========================================================================
// TEST 2: analyzeUserRoster NEVER Selects Puka or Etienne as Weakest Bench Drop
// =========================================================================
const mockUserRoster = {
  roster_id: 1,
  starters: ['101', '102'],
  players: ['101', '102', '9228', '7543', '9502'], // Starters + Puka + Etienne + Schoonmaker
  reserve: []
};

const allPlayersMap = {
  '101': { player_id: '101', full_name: 'Patrick Mahomes', position: 'QB', team: 'KC', projected_pts: 21.0 },
  '102': { player_id: '102', full_name: 'Amon-Ra St. Brown', position: 'WR', team: 'DET', projected_pts: 18.0 },
  '9228': pukaNacua,
  '7543': travisEtienne,
  '9502': schoonmaker
};

const analysis = engine.analyzeUserRoster(
  mockUserRoster,
  allPlayersMap,
  {},
  {},
  null,
  { league: { settings: { reserve_slots: 0 } } } // 0 open IR slots
);

// Even though Puka and Etienne have 0 projected points and Schoonmaker has 3.2:
// Schoonmaker MUST be selected as weakestBench, NOT Puka or Etienne!
assert.strictEqual(analysis.weakestBench.player_id, '9502', `Weakest bench must be Schoonmaker (9502), got ${analysis.weakestBench.full_name}`);
console.log(`✅ PASS: analyzeUserRoster selected ${analysis.weakestBench.full_name} for drop, completely protecting Puka Nacua & Travis Etienne!`);

// =========================================================================
// TEST 3: processWaiverWire Drop Pairing Verification
// =========================================================================
const freeAgents = [
  {
    player_id: '8888',
    full_name: 'Ollie Gordon II',
    position: 'RB',
    team: 'MIA',
    projected_pts: 14.5
  }
];

const processed = engine.processWaiverWire(freeAgents, analysis, { userFaab: 100 });
assert.strictEqual(processed[0].suggestedDrop.player.player_id, '9502', 'Suggested drop must be Schoonmaker');
assert(processed[0].suggestedDrop.text.includes('Luke Schoonmaker'), 'Drop text must name Luke Schoonmaker');
assert(!processed[0].suggestedDrop.text.includes('Puka'), 'Drop text must NOT mention Puka');
assert(!processed[0].suggestedDrop.text.includes('Etienne'), 'Drop text must NOT mention Etienne');
console.log(`✅ PASS: processWaiverWire suggested: "${processed[0].suggestedDrop.text}"`);

// =========================================================================
// TEST 4: What if ALL bench players are drop-protected?
// =========================================================================
const allProtectedRoster = {
  roster_id: 1,
  starters: ['101'],
  players: ['101', '9228', '7543'], // Only starters + Puka + Etienne
  reserve: []
};

const protectedAnalysis = engine.analyzeUserRoster(allProtectedRoster, allPlayersMap, {}, {}, null, { league: { settings: { reserve_slots: 0 } } });
assert.strictEqual(protectedAnalysis.weakestBench, null, 'weakestBench must be null when all bench players are protected');

const protectedProcessed = engine.processWaiverWire(freeAgents, protectedAnalysis, { userFaab: 100 });
assert.strictEqual(protectedProcessed[0].suggestedDrop.type, 'BENCH_PROTECTED', 'Drop pairing must be BENCH_PROTECTED');
assert.strictEqual(protectedProcessed[0].suggestedDrop.text, 'Bench Protected (No Safe Drop Available)');
console.log('✅ PASS: When all bench players are stars, system reports Bench Protected without offering drops');

// =========================================================================
// TEST 5: Contextual FAAB for Ollie Gordon (Devon Achane Out for Year)
// =========================================================================
const playersWithAchaneAndGordon = {
  '9226': achaneInjured,
  '8888': {
    player_id: '8888',
    full_name: 'Ollie Gordon II',
    position: 'RB',
    team: 'MIA',
    depth_chart_order: 2,
    status: 'Active',
    injury_status: null
  }
};

const inheritance = engine.computeRoleInheritance(playersWithAchaneAndGordon, {});
const gordonInh = inheritance.get('8888');
assert(gordonInh, 'Ollie Gordon must have inherited role from Achane');
assert.strictEqual(gordonInh.isSeasonEnding, true, 'Achane injury must be flagged isSeasonEnding');
assert.strictEqual(gordonInh.isEliteRb1, true, 'Achane must be flagged isEliteRb1');
assert(gordonInh.roleDesc.includes('Season-Ending Takeover'), `Expected roleDesc to mention Season-Ending Takeover, got: ${gordonInh.roleDesc}`);
console.log(`✅ PASS: computeRoleInheritance tagged Ollie Gordon: "${gordonInh.roleDesc}"`);

// Now compute FAAB bid for Ollie Gordon in a league with historical $18 flier average
const gordonPlayerObj = {
  player_id: '8888',
  full_name: 'Ollie Gordon II',
  position: 'RB',
  team: 'MIA',
  isNextManUp: true,
  inheritance: gordonInh,
  trending_adds: 45000
};

// Historical transactions where normal RB bid is $18 (which previously dragged bids down)
const mockHistory = [
  { position: 'RB', bid: 18 },
  { position: 'RB', bid: 15 },
  { position: 'RB', bid: 20 }
];

const faabContext = {
  currentWeek: 2,
  userFaab: 100,
  historicalTransactions: mockHistory,
  tendencies: {
    leagueRbPremium: 18, // Aggressive RB league
    septemberSpendVelocity: 35
  }
};

const gordonBid = engine.calculateSmartFaabBid(gordonPlayerObj, 8.5, 100, faabContext);
const gordonTiers = engine.calculateFaabBids(gordonPlayerObj, 8.5, 100, faabContext);

console.log(`\n💰 Ollie Gordon FAAB Recommendation:`);
console.log(`- Targeted Bid: $${gordonBid.dollars} (${gordonBid.percent}%)`);
console.log(`- Aggressive Bid: $${gordonTiers.aggressive.dollars} (${gordonTiers.aggressive.percent}%)`);
console.log(`- Speculative Bid: $${gordonTiers.speculative.dollars} (${gordonTiers.speculative.percent}%)`);

// Assertions:
// Targeted bid MUST be >= $50 (50% of budget), NOT dragged down to $18!
assert(gordonBid.dollars >= 50, `Ollie Gordon bid must be >= $50, got $${gordonBid.dollars}`);
assert(gordonTiers.aggressive.dollars >= 75, `Aggressive bid must be >= $75, got $${gordonTiers.aggressive.dollars}`);
console.log('✅ PASS: Ollie Gordon receives high-conviction contextual FAAB bid ($50-$55+), not $18!');

// =========================================================================
// TEST 6: Contrast: 1-Week Short Rental RB
// =========================================================================
const minorInjStarter = {
  player_id: '9999',
  full_name: 'Some Injured RB',
  position: 'RB',
  team: 'DEN',
  status: 'Active',
  injury_status: 'QUESTIONABLE',
  injury_notes: 'Mild ankle sprain, day to day',
  depth_chart_order: 1,
  projected_pts: 13.0
};

const backupRental = {
  player_id: '8889',
  full_name: 'Backup Rental RB',
  position: 'RB',
  team: 'DEN',
  depth_chart_order: 2,
  status: 'Active',
  injury_status: null
};

const rentalInhMap = engine.computeRoleInheritance({ '9999': minorInjStarter, '8889': backupRental }, {});
const rentalInh = rentalInhMap.get('8889');

const rentalPlayerObj = {
  player_id: '8889',
  full_name: 'Backup Rental RB',
  position: 'RB',
  team: 'DEN',
  isNextManUp: true,
  inheritance: rentalInh,
  trending_adds: 5000
};

const rentalBid = engine.calculateSmartFaabBid(rentalPlayerObj, 3.0, 100, faabContext);
console.log(`- Short-term rental bid: $${rentalBid.dollars} (${rentalBid.percent}%)`);
assert(rentalBid.dollars <= 25, `Rental bid should be <= $25, got $${rentalBid.dollars}`);
console.log('✅ PASS: Contextual sensitivity verified: short rental gets ~$18-$25 while season takeover gets $55+!');

console.log('\n🎉 ALL DROP PROTECTION & CONTEXTUAL FAAB TESTS PASSED FLAWLESSLY! 🐾');
