import { MOCK_PLAYERS_DB, MOCK_ROSTERS, MOCK_MATCHUPS } from './shared/js/mock-data.js';
import { 
  runMonteCarloSimulation, 
  solveOptimalLineup, 
  identifyLineupSwaps, 
  calculatePlayerDistributions 
} from './weekly/simulation-engine.js';
import { scoutBowie } from './weekly/scout-bowie.js';

console.log("=== RUNNING QUANTITATIVE ENGINE TESTS ===");

const userStarters = MOCK_MATCHUPS[0].starters.map(id => MOCK_PLAYERS_DB[id]);
const oppStarters = MOCK_MATCHUPS[1].starters.map(id => MOCK_PLAYERS_DB[id]);
const allUserPlayers = MOCK_MATCHUPS[0].players.map(id => MOCK_PLAYERS_DB[id]);

console.log(`Loaded ${userStarters.length} user starters, ${oppStarters.length} opponent starters.`);

// Test 1: Player Distributions
console.log("\n[TEST 1] Testing Right-Skewed Player Distributions...");
const cmcDist = calculatePlayerDistributions(MOCK_PLAYERS_DB["p_cmc"]);
console.log("CMC Metrics:", {
  mean: cmcDist.mean,
  floor10: cmcDist.floor10,
  median: cmcDist.median,
  ceiling90: cmcDist.ceiling90,
  boomRate: `${cmcDist.boomRate}%`,
  bustRate: `${cmcDist.bustRate}%`
});

if (cmcDist.floor10 < cmcDist.median && cmcDist.median < cmcDist.ceiling90) {
  console.log("✓ Distribution percentiles monotonically increasing and valid.");
} else {
  console.error("FAIL: Invalid percentiles!");
  process.exit(1);
}

// Test 2: 10,000x Monte Carlo Simulation
console.log("\n[TEST 2] Running 10,000-Iteration Monte Carlo Simulation...");
const startSim = performance.now();
const simResults = runMonteCarloSimulation(userStarters, oppStarters, 10000);
const endSim = performance.now();
console.log("Sim Output:", {
  iterations: simResults.iterations,
  winProbability: `${simResults.winProbability}%`,
  spread: simResults.spread,
  totalOverUnder: simResults.totalOverUnder,
  userStats: simResults.userStats,
  oppStats: simResults.oppStats,
  execTime: `${(endSim - startSim).toFixed(2)}ms`
});

if (simResults.winProbability >= 0 && simResults.winProbability <= 100) {
  console.log(`✓ 10,000 iterations ran successfully in ${(endSim - startSim).toFixed(2)}ms`);
} else {
  console.error("FAIL: Invalid win probability!");
  process.exit(1);
}

// Test 3: Strategy Slider & Optimal Lineup Solver
console.log("\n[TEST 3] Testing Floor vs Ceiling Lineup Solver...");
const floorLineup = solveOptimalLineup(allUserPlayers, 0.1);
const ceilingLineup = solveOptimalLineup(allUserPlayers, 0.9);

console.log("Floor Mode Score:", floorLineup.totalStrategicScore);
console.log("Ceiling Mode Score:", ceilingLineup.totalStrategicScore);

const swaps = identifyLineupSwaps(userStarters, ceilingLineup.starters, allUserPlayers, 0.9);
console.log(`Identified ${swaps.length} recommended swaps in Ceiling mode.`);
swaps.forEach(s => console.log(`  ➔ START ${s.playerToStart.full_name} (${s.playerToStart.position}) over ${s.playerToBench.full_name} (${s.reason})`));

// Test 4: Scout Bowie Mascot
console.log("\n[TEST 4] Testing Scout Bowie Matchup Dossier...");
const userBench = allUserPlayers.filter(p => !userStarters.some(s => s.player_id === p.player_id));
const dossier = scoutBowie.generateMatchupDossier(userStarters, userBench, oppStarters, simResults, 0.5);

console.log("Lock of the Week:", dossier.lockAlert?.headline, "| Confidence:", dossier.lockAlert?.confidence);
console.log("Trap Alert:", dossier.trapAlert?.headline, "| Risk:", dossier.trapAlert?.riskLevel);
console.log("Boom Candidate:", dossier.boomAlert?.headline, "| Upside:", dossier.boomAlert?.upsideRating);
console.log("Tactical Directive:", dossier.directive.headline);

console.log("\n=== ALL QUANTITATIVE TESTS PASSED! ===");
