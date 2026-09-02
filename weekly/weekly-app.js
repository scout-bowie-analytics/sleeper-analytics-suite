/**
 * WEEKLY LINEUP OPTIMIZER - APPLICATION CONTROLLER
 * 
 * Features:
 * - Strict positional slot locking (QB, RB, WR, TE, FLEX, SUPER_FLEX, K, DEF)
 * - In-place dropdown swapping with eligible bench players only
 * - Dynamic two-way state synchronization and instant re-simulation
 * - Full player metadata resolution & headshots
 * - Scout Bowie alerts & 10,000x Monte Carlo engine
 */

import { sleeperApi } from '../shared/js/sleeper-api.js';
import { MOCK_PLAYERS_DB } from '../shared/js/mock-data.js';
import { getGameScheduleInfo, fetchLiveNflSchedule } from '../shared/js/nfl-schedule.js';
import { 
  runMonteCarloSimulation, 
  solveOptimalLineup, 
  identifyLineupSwaps, 
  calculatePlayerDistributions 
} from './simulation-engine.js';
import { scoutBowie } from './scout-bowie.js';
import { fetchLiveVegasOdds, getTeamVegasContext, setOddsApiKey, CONFIG as ODDS_CONFIG } from '../shared/js/vegas-odds.js';
import { WaiverEngine } from '../waiver/waiver-engine.js';

/**
 * Strict Positional Eligibility Helper
 */
export function isPlayerEligibleForSlot(position, slotType) {
  if (!position || !slotType) return false;
  const p = String(position).toUpperCase().trim();
  const s = String(slotType).toUpperCase().trim();
  
  if (s === p) return true;
  if (s === 'FLEX' || s === 'WRRB_FLEX' || s === 'REC_FLEX') {
    return ['RB', 'WR', 'TE'].includes(p);
  }
  if (s === 'WR_RB' || s === 'RB_WR') {
    return ['RB', 'WR'].includes(p);
  }
  if (s === 'WR_TE' || s === 'TE_WR') {
    return ['WR', 'TE'].includes(p);
  }
  if (s === 'SUPER_FLEX' || s === 'OP') {
    return ['QB', 'RB', 'WR', 'TE'].includes(p);
  }
  if (s === 'BN' || s === 'BENCH') {
    return true;
  }
  return false;
}

/**
 * Get human-readable eligible slots list for a player
 */
export function getEligibleSlotsForPosition(position) {
  const p = String(position || 'FLEX').toUpperCase().trim();
  if (p === 'QB') return ['QB', 'SUPER_FLEX'];
  if (p === 'RB') return ['RB', 'FLEX', 'SUPER_FLEX'];
  if (p === 'WR') return ['WR', 'FLEX', 'SUPER_FLEX'];
  if (p === 'TE') return ['TE', 'FLEX', 'SUPER_FLEX'];
  if (p === 'K') return ['K'];
  if (p === 'DEF') return ['DEF'];
  return ['FLEX'];
}

/**
 * Clean trailing injury/status strings from player full names
 */
export function getCleanPlayerName(fullName) {
  if (!fullName) return 'Unknown Player';
  return fullName
    .replace(/\s+(Questionable|Ques|Doubtful|Out|IR|PUP|Suspended|Sus|Healthy|Active|Probable|COV|NA|DNR|IR-R)\b.*$/i, '')
    .trim();
}

/**
 * Dedicated Player Status Badge Helper
 */
export function getPlayerStatusBadge(injuryStatus) {
  const status = String(injuryStatus || '').toUpperCase().trim();
  if (!status || status === 'HEALTHY' || status === 'ACTIVE') {
    return '<span class="badge-status healthy">HEALTHY</span>';
  }
  if (status === 'QUESTIONABLE' || status === 'QUESTION' || status === 'QUES') {
    return '<span class="badge-status ques">QUESTIONABLE</span>';
  }
  if (status === 'DOUBTFUL') {
    return '<span class="badge-status doubtful">DOUBTFUL</span>';
  }
  if (status === 'OUT' || status === 'IR' || status === 'IR-R' || status === 'INJURED_RESERVE') {
    return '<span class="badge-status out">OUT / IR</span>';
  }
  if (status === 'PUP' || status === 'SUS' || status === 'SUSPENDED') {
    return '<span class="badge-status pup">PUP</span>';
  }
  return `<span class="badge-status ques">${status}</span>`;
}

/**
 * Visual Floating Global Range Slider Bar Component (0 to 35 pt scale)
 * Floor and Ceiling numbers dynamically track the capsule endpoints
 */
export function renderProjectionRangeBar(dist) {
  const MAX_PTS = 35;
  const floor = Number(dist.floor ?? dist.floor10 ?? 0);
  const ceil = Number(dist.ceil ?? dist.ceiling90 ?? 0);
  const proj = Number(dist.proj ?? dist.mean ?? 0);
  const gameState = dist.gameState || 'UPCOMING';
  const banked = Number(dist.points_scored ?? dist.actual_pts ?? 0);

  if (dist.isInactive || (floor === 0 && ceil === 0 && proj === 0 && banked === 0)) {
    return `
      <div class="range-container" title="Inactive: 0.0 pts">
        <div class="range-global-track" style="opacity:0.4;display:flex;align-items:center;justify-content:center;">
          <span style="font-size:9.5px;font-weight:700;color:var(--muted);letter-spacing:0.04em;">0.0 PTS (INACTIVE)</span>
        </div>
      </div>
    `;
  }

  // 1. FINAL Game State: Locked final score bar
  if (gameState === 'FINAL' || dist.isFinal) {
    const finalPct = Math.max(2, Math.min(100, (banked / MAX_PTS) * 100));
    return `
      <div class="range-container" title="Game Final: ${banked.toFixed(1)} pts locked">
        <div class="range-global-track" style="background:rgba(255,255,255,0.03);">
          <div class="range-banked-segment" style="width: ${finalPct.toFixed(1)}%; background: rgba(148, 163, 184, 0.35); border: 1px solid rgba(148, 163, 184, 0.6); border-radius: 4px; height: 100%; position: absolute; left: 0; top: 0;"></div>
          <div class="range-pin" style="left: ${finalPct.toFixed(1)}%;">
            <span class="range-pin-bubble" style="background: rgba(30,41,59,0.95); border-color:#94a3b8; color:#fff; font-weight:800;">🏁 ${banked.toFixed(1)}</span>
          </div>
          <span class="range-endpoint floor" style="left: 0%; transform: translateX(0%); color:#94a3b8;">FINAL</span>
          <span class="range-endpoint ceil" style="left: ${finalPct.toFixed(1)}%; transform: translateX(-100%); color:#94a3b8;">${banked.toFixed(1)} pts</span>
        </div>
      </div>
    `;
  }

  // 2. IN_PROGRESS Game State: Solid Banked Points + Dashed Projected Remaining
  if (gameState === 'IN_PROGRESS') {
    const bankedPct = Math.max(0, Math.min(100, (banked / MAX_PTS) * 100));
    const floorPct = Math.max(0, Math.min(100, (floor / MAX_PTS) * 100));
    const ceilPct = Math.max(0, Math.min(100, (ceil / MAX_PTS) * 100));
    const projPct = Math.max(0, Math.min(100, (proj / MAX_PTS) * 100));
    const remainingWidth = Math.max(4, ceilPct - floorPct);

    return `
      <div class="range-container" title="Live Gameday: ${banked.toFixed(1)} pts banked | Live Projected: ${proj.toFixed(1)} pts (Floor: ${floor.toFixed(1)} · Ceil: ${ceil.toFixed(1)})">
        <div class="range-global-track">
          <!-- Banked Points Segment -->
          ${banked > 0 ? `<div class="range-banked-segment" style="width: ${bankedPct.toFixed(1)}%; background: rgba(16, 185, 129, 0.5); border: 1px solid rgba(16, 185, 129, 0.85); border-radius: 4px 0 0 4px; height: 100%; position: absolute; left: 0; top: 0; z-index: 1;"></div>` : ''}

          <!-- Remaining Projected Uncertainty Capsule -->
          <div class="range-floating-capsule in-progress" style="left: ${floorPct.toFixed(1)}%; width: ${remainingWidth.toFixed(1)}%; border: 1px dashed rgba(56, 189, 248, 0.6); background: rgba(56, 189, 248, 0.16);"></div>

          <!-- Live Expected Pin & Bubble -->
          <div class="range-pin" style="left: ${projPct.toFixed(1)}%; z-index: 3;">
            <span class="range-pin-bubble" style="background: rgba(16, 185, 129, 0.95); border-color: #10b981; color: #fff;">${proj.toFixed(1)}</span>
          </div>

          <span class="range-endpoint floor" style="left: ${floorPct.toFixed(1)}%; transform: translateX(-50%); color: #10b981;">${floor.toFixed(1)}</span>
          <span class="range-endpoint ceil" style="left: ${ceilPct.toFixed(1)}%; transform: translateX(-50%); color: var(--gold);">${ceil.toFixed(1)}</span>
        </div>
      </div>
    `;
  }

  // 3. Standard UPCOMING Game State
  const floorPct = Math.max(0, Math.min(100, (floor / MAX_PTS) * 100));
  const ceilPct = Math.max(0, Math.min(100, (ceil / MAX_PTS) * 100));
  const projPct = Math.max(0, Math.min(100, (proj / MAX_PTS) * 100));
  const barWidth = Math.max(4, ceilPct - floorPct);

  // Boundary clipping guards
  const floorTransform = floorPct < 8 ? 'transform: translateX(0%);' : (floorPct > 92 ? 'transform: translateX(-100%);' : 'transform: translateX(-50%);');
  const ceilTransform = ceilPct > 92 ? 'transform: translateX(-100%);' : (ceilPct < 8 ? 'transform: translateX(0%);' : 'transform: translateX(-50%);');

  return `
    <div class="range-container" title="Floor (10th): ${floor.toFixed(1)} pts | Expected E[X]: ${proj.toFixed(1)} pts | Ceiling (90th): ${ceil.toFixed(1)} pts (0-35 pt scale)">
      <div class="range-global-track">
        <!-- Floating Range Capsule (0 to 35 pt scale) -->
        <div class="range-floating-capsule" style="left: ${floorPct.toFixed(1)}%; width: ${barWidth.toFixed(1)}%;"></div>
        
        <!-- Expected Value Pin & Top Floating Badge -->
        <div class="range-pin" style="left: ${projPct.toFixed(1)}%;">
          <span class="range-pin-bubble">${proj.toFixed(1)}</span>
        </div>

        <!-- Dynamic Floor & Ceiling Anchors (Positioned below the bar) -->
        <span class="range-endpoint floor" style="left: ${floorPct.toFixed(1)}%; ${floorTransform}">${floor.toFixed(1)}</span>
        <span class="range-endpoint ceil" style="left: ${ceilPct.toFixed(1)}%; ${ceilTransform}">${ceil.toFixed(1)}</span>
      </div>
    </div>
  `;
}

class WeeklyOptimizerController {
  constructor() {
    this.state = {
      season: '2026',
      week: 1,
      seasonType: 'regular',
      currentLeague: null,
      loadedLeagues: [],
      detectedUserId: null,
      userRosterId: 1,
      leagueUsers: [],
      leagueRosters: [],
      userRoster: null,
      oppRoster: null,
      userPlayers: [],
      userStarters: [],
      userBench: [],
      oppStarters: [],
      starterSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
      slotRequirements: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 },
      strategyMode: 'balanced',
      strategyWeight: 0.5,
      optimalSolution: null,
      recommendedSwaps: [],
      simResults: null,
      liveSchedule: null,
      liveOdds: null,
      isLoading: false,
      alertSettings: this.loadAlertSettings(),
      activeAlerts: [],
      waiverFaab: 100,
      waiverTargets: [],
      selectedWaiverStrategy: null,
      selectedWaiverPos: 'ALL',
      waiverSearchQuery: '',
      waiverCurrentSort: 'delta_desc',
      isWaiverDrawerOpen: false
    };

    this.waiverEngine = new WaiverEngine();
    this.chartInstance = null;
    this.bowieQuotes = [
      "\"10,000 iterations computed! Keep an eye on our Golden Bone Lock of the Week and watch out for Bowie Bark Warnings.\" 🐾",
      "\"Sniffing out optimal flex leverage! Never bench a high-floor volume monster when protecting a lead.\" 🐾",
      "\"Underdog situation? Crank that slider toward Ceiling (90th percentile) to embrace positive variance!\" 🐾",
      "\"Golden bones awarded to bulletproof starters. Let's capture the victory!\" 🐾"
    ];
  }

  async init() {
    // Bind all handlers to window immediately
    this.bindGlobalHandlers();

    // Check URL parameters or hash for direct ESPN / Yahoo bookmarklet import
    const checkHashImport = async () => {
      if (typeof window !== 'undefined' && window.location) {
        const hash = window.location.hash || '';
        const search = window.location.search || '';
        if (hash.includes('import=') || search.includes('import=')) {
          try {
            const raw = hash.includes('import=') 
              ? hash.split('import=')[1] 
              : new URLSearchParams(search).get('import');
            if (raw) {
              const decodedStr = decodeURIComponent(escape(atob(decodeURIComponent(raw))));
              const payload = JSON.parse(decodedStr);
              if (payload && (payload.userRoster || payload.oppRoster)) {
                await this.importMatchupPayload(payload);
                return true;
              }
            }
          } catch (err) {
            console.warn('URL matchup import parse error:', err);
            this.showToast('⚠️ Could not import matchup data. Please verify payload.');
          }
        }
      }
      return false;
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', () => checkHashImport());
    }

    const imported = await checkHashImport();
    if (imported) return;

    // Check URL parameters for direct sample / demo matchup load
    const urlParams = (typeof window !== 'undefined' && window.location) ? new URLSearchParams(window.location.search) : null;
    const isSampleParam = urlParams && (urlParams.get('sample') === 'true' || urlParams.get('demo') === 'true');

    if (isSampleParam) {
      // Directly load the sample matchup and bypass the setup modal
      this.closeSetupModal();
      await this.loadSampleChampionship();
      return;
    }

    // Ensure setup modal is open and visible for normal launch
    this.openSetupModal();

    // 1. Resolve live NFL state from Sleeper (season, week)
    try {
      const nflState = await sleeperApi.getNflState();
      if (nflState) {
        this.state.season = nflState.season || '2026';
        // During preseason ('pre'), the upcoming fantasy matchup is Regular Season Week 1!
        const isPreseason = (nflState.season_type === 'pre');
        const activeWeek = isPreseason ? 1 : (parseInt(nflState.week, 10) || 1);
        this.state.week = activeWeek;
        this.state.seasonType = isPreseason ? 'regular' : (nflState.season_type || 'regular');

        const weekSelect = document.getElementById('modalWeekSelect');
        if (weekSelect) {
          weekSelect.value = String(activeWeek);
        }
      }
    } catch (e) {
      console.warn('NFL State resolution:', e);
    }

    // 2. Preload full player database in background
    sleeperApi.loadPlayersDatabase().catch(e => {
      console.warn('Player DB background load:', e);
    });
  }

  bindGlobalHandlers() {
    window.onFetchLeagues = () => this.onFetchLeagues();
    window.onSelectLeague = () => this.onSelectLeague();
    window.initMatchupFromSelection = () => this.initMatchupFromSelection();
    window.initDemoMatchup = () => this.loadSampleChampionship();
    window.loadSampleChampionship = () => this.loadSampleChampionship();
    window.switchSetupTab = (tab) => this.switchSetupTab(tab);
    window.openSetupModal = () => this.openSetupModal();
    window.closeDrawer = () => this.closeDrawer();
    window.openPlayerDrawer = (id) => this.openPlayerDrawer(id);
    window.onStrategyChange = (val) => this.onStrategyChange(parseFloat(val));
    window.onStrategyModeChange = (mode) => this.onStrategyModeChange(mode);
    window.optimizeLineup = (mode) => this.optimizeLineup(mode);
    window.applyOptimalLineup = () => this.applyOptimalLineup();
    window.onStarterDropdownChange = (slotIndex, newPlayerId) => this.onStarterDropdownChange(slotIndex, newPlayerId);
    window.onConfirmSwap = (slotIndex, newPlayerId) => this.onConfirmSwap(slotIndex, newPlayerId);
    window.onCancelSwapPreview = (slotIndex) => this.onCancelSwapPreview(slotIndex);
    
    // Keyboard shortcut: Escape cancels active swap preview or drawer
    if (typeof window !== 'undefined' && !window.__escapeKeyBound) {
      window.__escapeKeyBound = true;
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          if (this.state.activeSwapPreview) {
            this.onCancelSwapPreview(this.state.activeSwapPreview.slotIdx);
          }
        }
      });
    }

    window.triggerBowieEasterEgg = (el) => this.triggerBowieEasterEgg(el);
    window.setOddsApiKey = (key) => setOddsApiKey(key);
    window.onTeamViewChange = (view) => this.onTeamViewChange(view);
    window.toggleLiveGamedayDemo = () => this.toggleLiveGamedayDemo();
    window.toggleLiveMode = () => this.toggleLiveGamedayDemo();
    window.openAlertsModal = () => this.openAlertsModal();
    window.closeAlertsModal = () => this.closeAlertsModal();
    window.saveAlertPreferences = () => this.saveAlertPreferences();
    window.testDiscordWebhook = () => this.testDiscordWebhook();
    window.testEmailNotification = () => this.testEmailNotification();
    window.dispatchGamedayAlerts = () => this.dispatchGamedayAlerts();
    window.onDiscordInputChanged = () => this.onDiscordInputChanged();
    window.onEmailInputChanged = () => this.onEmailInputChanged();
    window.importRawMatchupJson = () => this.importRawMatchupJson();
    window.importMatchupPayload = (payload) => this.importMatchupPayload(payload);
    window.openWaiverDrawer = () => this.openWaiverDrawer();
    window.closeWaiverDrawer = () => this.closeWaiverDrawer();
    window.onDrawerStrategyToggle = (strat) => this.onDrawerStrategyToggle(strat);
    window.onDrawerPosFilter = (pos) => this.onDrawerPosFilter(pos);
    window.onDrawerSearchInput = () => this.onDrawerSearchInput();
    window.onDrawerSearchPlayer = (name) => this.onDrawerSearchPlayer(name);
    window.onDrawerSortChanged = () => this.onDrawerSortChanged();
    window.onDrawerFaabChanged = () => this.onDrawerFaabChanged();
    window.copyDrawerClaims = () => this.copyDrawerClaims();
  }

  renderLoadingTables() {
    if (typeof document === 'undefined') return;
    const loadingHtml = `
      <tr>
        <td colspan="7" style="text-align:center;padding:32px;color:var(--muted);font-size:13px;">
          <div style="display:inline-flex;align-items:center;gap:10px;">
            <span class="pulse-dot"></span>
            <span>Loading Sleeper NFL database & calculating player distributions...</span>
          </div>
        </td>
      </tr>
    `;
    const sBody = document.getElementById('startersTableBody');
    const bBody = document.getElementById('benchTableBody');
    if (sBody) sBody.innerHTML = loadingHtml;
    if (bBody) bBody.innerHTML = loadingHtml;
  }

  switchSetupTab(tab) {
    if (typeof document === 'undefined') return;
    const tabLeagueBtn = document.getElementById('tabLeagueBtn');
    const tabImportBtn = document.getElementById('tabImportBtn');
    const tabDemoBtn = document.getElementById('tabDemoBtn');
    const tabLeagueContent = document.getElementById('tabLeagueContent');
    const tabImportContent = document.getElementById('tabImportContent');
    const tabDemoContent = document.getElementById('tabDemoContent');

    if (tabLeagueBtn) tabLeagueBtn.classList.toggle('active', tab === 'league');
    if (tabImportBtn) tabImportBtn.classList.toggle('active', tab === 'import');
    if (tabDemoBtn) tabDemoBtn.classList.toggle('active', tab === 'demo');

    if (tabLeagueContent) tabLeagueContent.style.display = (tab === 'league') ? 'block' : 'none';
    if (tabImportContent) tabImportContent.style.display = (tab === 'import') ? 'block' : 'none';
    if (tabDemoContent) tabDemoContent.style.display = (tab === 'demo') ? 'block' : 'none';
  }

  openSetupModal() {
    if (typeof document === 'undefined') return;
    const setupModal = document.getElementById('setupModal');
    if (setupModal) setupModal.style.display = 'flex';
  }

  closeSetupModal() {
    if (typeof document === 'undefined') return;
    const setupModal = document.getElementById('setupModal');
    const mainApp = document.getElementById('mainApp');
    if (setupModal) setupModal.style.display = 'none';
    if (mainApp) mainApp.style.display = 'block';
  }

  /**
   * Fetch League & Users when League ID or Username is submitted
   */
  async onFetchLeagues() {
    const input = document.getElementById('sleeperInput').value.trim();
    const statusEl = document.getElementById('modalStatus');
    statusEl.textContent = 'Searching Sleeper API...';

    if (!input) {
      statusEl.textContent = 'Please enter a Sleeper Username or League ID.';
      return;
    }

    try {
      if (/^\d+$/.test(input)) {
        const league = await sleeperApi.getLeague(input);
        if (!league || !league.league_id) throw new Error('League not found.');
        this.state.loadedLeagues = [league];
        this.populateLeagueDropdown([league]);
        statusEl.textContent = 'League loaded! Select your team below.';
      } else if (input === 'demo_championship_league_2025' || input === 'demo') {
        await this.initDemoMatchup();
        return;
      } else {
        const user = await sleeperApi.getUserByUsername(input);
        if (!user || !user.user_id) throw new Error(`User "${input}" not found.`);
        this.state.detectedUserId = user.user_id;

        const year = new Date().getFullYear().toString();
        const leagues = await sleeperApi.getUserLeagues(user.user_id, year);
        if (!leagues || leagues.length === 0) {
          throw new Error(`No active leagues found for user ${input}.`);
        }

        this.state.loadedLeagues = leagues;
        this.populateLeagueDropdown(leagues, user.user_id);
        statusEl.textContent = `Found ${leagues.length} league(s) for ${user.display_name || input}. Select your team.`;
      }
    } catch (err) {
      console.warn('Error fetching league:', err);
      statusEl.style.color = 'var(--caution)';
      statusEl.textContent = "Bowie couldn't sniff out that league ID or username. Double-check your spelling or try loading a sample matchup!";
      this.showToast("🐾 Bowie couldn't sniff out that league ID or username. Double-check your spelling or try loading a sample matchup!");
    }
  }

  populateLeagueDropdown(leagues, userId = null) {
    const leagueDropdown = document.getElementById('leagueDropdown');
    const leagueSelectGroup = document.getElementById('leagueSelectGroup');

    leagueDropdown.innerHTML = '';
    leagues.forEach((l, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = `${l.name} (${l.total_rosters || 12} Teams - ${l.season || '2024'})`;
      leagueDropdown.appendChild(opt);
    });

    if (leagues.length > 1) {
      leagueSelectGroup.style.display = 'block';
    } else {
      leagueSelectGroup.style.display = 'none';
    }

    this.onSelectLeague();
  }

  async onSelectLeague() {
    const idx = parseInt(document.getElementById('leagueDropdown').value, 10) || 0;
    const league = this.state.loadedLeagues[idx] || this.state.loadedLeagues[0];
    this.state.currentLeague = league;

    const statusEl = document.getElementById('modalStatus');
    statusEl.textContent = 'Loading league rosters & users...';

    try {
      const [users, rosters] = await Promise.all([
        sleeperApi.getUsers(league.league_id),
        sleeperApi.getRosters(league.league_id)
      ]);

      this.state.leagueUsers = users;
      this.state.leagueRosters = rosters;

      const teamDropdown = document.getElementById('teamDropdown');
      teamDropdown.innerHTML = '';

      rosters.forEach(r => {
        const u = users.find(usr => usr.user_id === r.owner_id);
        const teamName = u ? (u.metadata?.team_name || u.display_name || `Owner ${u.user_id.substring(0,6)}`) : `Team ${r.roster_id}`;
        const opt = document.createElement('option');
        opt.value = r.roster_id;
        opt.dataset.ownerId = r.owner_id || '';
        opt.textContent = `${teamName} (Roster #${r.roster_id})`;

        if (this.state.detectedUserId && r.owner_id === this.state.detectedUserId) {
          opt.selected = true;
        }

        teamDropdown.appendChild(opt);
      });

      document.getElementById('teamSelectGroup').style.display = 'block';
      document.getElementById('weekSelectGroup').style.display = 'block';
      document.getElementById('launchOptimizerBtn').style.display = 'block';
      statusEl.style.color = 'var(--accent)';
      statusEl.textContent = `✓ Loaded "${league.name}" (${rosters.length} teams). Select your team and click Launch Lineup Optimizer.`;
    } catch (err) {
      console.error('Error loading league members:', err);
      statusEl.style.color = 'var(--caution)';
      statusEl.textContent = `Error loading league members: ${err.message || 'Unknown error'}`;
    }
  }

  async initMatchupFromSelection() {
    const teamDropdown = document.getElementById('teamDropdown');
    const selectedRosterId = parseInt(teamDropdown.value, 10) || 1;
    const selectedWeek = parseInt(document.getElementById('modalWeekSelect').value, 10) || 1;

    this.state.userRosterId = selectedRosterId;
    this.state.week = selectedWeek;

    const statusEl = document.getElementById('modalStatus');
    statusEl.textContent = 'Ingesting matchup, player distributions, and running 10k Monte Carlo...';

    this.renderLoadingTables();
    await this.loadMatchupData(this.state.currentLeague, selectedWeek, selectedRosterId);
    this.closeSetupModal();
  }

  async loadSampleChampionship() {
    this.state.isDemoMode = true;
    this.state.isLiveDemo = false;
    this.state.isLiveGamedayMode = false;

    // Reset all mock player entities in MOCK_PLAYERS_DB to pre-game state
    Object.values(MOCK_PLAYERS_DB).forEach(p => {
      p.points_banked = 0;
      p.actual_points = 0;
      p.points_scored = 0;
      p.actual_pts = 0;
      p.is_final = false;
      p.isFinal = false;
      p.is_live = false;
      p.isLive = false;
      p.gameState = 'UPCOMING';
      p.remainingFraction = 1.0;
    });

    this.state.currentLeague = await sleeperApi.getLeague('demo_championship_league_2025');
    this.state.week = 1;
    this.state.userRosterId = 1;
    this.renderLoadingTables();
    await this.loadMatchupData(this.state.currentLeague, 1, 1);
    this.closeSetupModal();
    this.showToast('🏆 Loaded Sample Championship (Pre-Kickoff Optimizer View)! 🐾');

    // Auto-launch Guided Feature Tour on first-time sample exploration
    setTimeout(() => {
      try {
        const tourSeen = localStorage.getItem('scout_bowie_sample_tour_seen');
        if (!tourSeen && window.scoutBowieTour) {
          window.scoutBowieTour.start(0);
        }
      } catch (e) {}
    }, 600);
  }

  async initDemoMatchup() {
    return this.loadSampleChampionship();
  }

  /**
   * Manual Fallback: Ingest Raw Matchup JSON from Textarea
   */
  async importRawMatchupJson() {
    if (typeof document === 'undefined') return;
    const textarea = document.getElementById('rawMatchupJson');
    const rawVal = textarea ? textarea.value.trim() : '';

    if (!rawVal) {
      this.showToast('⚠️ Please paste a valid JSON matchup payload.');
      return;
    }

    let payload = null;
    try {
      payload = JSON.parse(rawVal);
    } catch (parseErr) {
      console.warn('JSON parsing error:', parseErr);
      this.showToast('Invalid JSON format: Please check your JSON syntax.');
      return;
    }

    try {
      if (!payload || (!payload.userRoster && !payload.oppRoster)) {
        throw new Error('Payload must contain userRoster or oppRoster array.');
      }
      await this.importMatchupPayload(payload);
    } catch (ingestErr) {
      console.error('Import failed:', ingestErr);
      this.showToast(`Import failed: ${ingestErr.message}`);
    }
  }

  /**
   * Resolve imported player against Sleeper catalog or mock DB with full projections and distributions
   */
  async resolvePlayerMetadata(importedPlayer) {
    const rawName = (importedPlayer.name || 'Unknown Player').trim();
    const cleanName = getCleanPlayerName(rawName).toLowerCase().replace(/[^a-z0-9]/g, '');
    let pos = String(importedPlayer.position || 'FLEX').toUpperCase().replace('D/ST', 'DEF');
    const team = String(importedPlayer.team || '').toUpperCase();

    // 1. Query Sleeper DB (check memory cache first, then fetch)
    const allPlayers = sleeperApi.playersMap || await sleeperApi.fetchAllPlayers();
    let matchedPlayer = null;

    if (allPlayers && Object.keys(allPlayers).length > 0) {
      // Direct name match
      for (const id in allPlayers) {
        const p = allPlayers[id];
        if (!p.full_name) continue;
        const pClean = p.full_name.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (pClean === cleanName) {
          if (!pos || pos === 'FLEX' || p.position === pos) {
            matchedPlayer = p;
            break;
          }
        }
      }

      // If DEF/DST, match by team code or defense name
      if (!matchedPlayer && (pos === 'DEF' || importedPlayer.slot === 'DEF' || rawName.toLowerCase().includes('defense') || rawName.toLowerCase().includes('d/st'))) {
        pos = 'DEF';
        for (const id in allPlayers) {
          const p = allPlayers[id];
          if (p.position === 'DEF' && (p.team === team || (p.last_name && cleanName.includes(p.last_name.toLowerCase())))) {
            matchedPlayer = p;
            break;
          }
        }
      }
    }

    const playerId = matchedPlayer?.player_id || `imported_${cleanName}_${Math.random().toString(36).substring(2, 7)}`;
    const playerName = matchedPlayer?.full_name || rawName;
    const finalPos = matchedPlayer?.position || pos || 'FLEX';
    const finalTeam = matchedPlayer?.team || team || 'FA';
    const proj = (typeof importedPlayer.proj === 'number' && importedPlayer.proj > 0) 
      ? importedPlayer.proj 
      : (parseFloat(importedPlayer.proj) || 10.0);

    // Compute distribution curves
    const dist = calculatePlayerDistributions(finalPos, proj, 'standard');
    const avatar = matchedPlayer?.player_id 
      ? `https://sleepercdn.com/content/nfl/players/thumb/${matchedPlayer.player_id}.jpg`
      : 'https://sleepercdn.com/images/v2/icons/player_default.webp';

    const sched = getGameScheduleInfo(finalTeam, this.state.week || 1, this.state.liveSchedule);

    return {
      player_id: playerId,
      full_name: playerName,
      name: playerName,
      position: finalPos,
      team: finalTeam,
      projected_pts: Number(proj.toFixed(1)),
      base_projected_pts: Number(proj.toFixed(1)),
      expected_pts: dist.mean,
      floor_pts: dist.floor,
      ceiling_pts: dist.ceiling,
      distribution: dist,
      injury_status: matchedPlayer?.injury_status || null,
      avatar,
      slot: importedPlayer.slot || 'FLEX',
      gameSchedule: sched,
      points_banked: 0,
      actual_pts: 0,
      points_scored: 0,
      gameState: 'UPCOMING'
    };
  }

  /**
   * Ingest Normalized Matchup Payload from Bookmarklet or Raw JSON
   */
  async importMatchupPayload(payload) {
    if (!payload) return;

    this.state.isDemoMode = false;
    this.state.isLiveDemo = false;
    this.state.isLiveGamedayMode = false;
    this.state.isImportedMatchup = true;

    const userTeamName = payload.userTeamName || 'Your Fantasy Team';
    const oppTeamName = payload.oppTeamName || 'Opponent Team';
    this.state.userTeamName = userTeamName;
    this.state.oppTeamName = oppTeamName;

    this.renderLoadingTables();

    // 1. Ensure Sleeper DB and schedule are loaded
    await sleeperApi.fetchAllPlayers();
    if (!this.state.liveSchedule) {
      this.state.liveSchedule = await fetchLiveNflSchedule(this.state.season || '2026', this.state.week || 1);
    }
    if (!this.state.liveOdds) {
      this.state.liveOdds = await fetchLiveVegasOdds().catch(() => null);
    }

    // 2. Resolve User Players
    const rawUserRoster = Array.isArray(payload.userRoster) ? payload.userRoster : [];
    const resolvedUserPlayers = await Promise.all(rawUserRoster.map(p => this.resolvePlayerMetadata(p)));

    // Separate starters vs bench
    let userStarters = resolvedUserPlayers.filter(p => p.slot !== 'BN' && p.slot !== 'BENCH' && p.slot !== 'IR');
    let userBench = resolvedUserPlayers.filter(p => p.slot === 'BN' || p.slot === 'BENCH' || p.slot === 'IR');

    // If all were tagged bench or none tagged starters, solve optimal baseline
    if (userStarters.length === 0 && resolvedUserPlayers.length > 0) {
      const opt = solveOptimalLineup(resolvedUserPlayers, 'balanced', this.state.starterSlots, {
        week: this.state.week,
        liveSchedule: this.state.liveSchedule
      });
      userStarters = opt.starters;
      userBench = opt.bench;
    }

    // 3. Resolve Opponent Players
    const rawOppRoster = Array.isArray(payload.oppRoster) ? payload.oppRoster : [];
    const resolvedOppPlayers = await Promise.all(rawOppRoster.map(p => this.resolvePlayerMetadata(p)));

    let oppStarters = resolvedOppPlayers.filter(p => p.slot !== 'BN' && p.slot !== 'BENCH' && p.slot !== 'IR');
    let oppBench = resolvedOppPlayers.filter(p => p.slot === 'BN' || p.slot === 'BENCH' || p.slot === 'IR');

    if (oppStarters.length === 0 && resolvedOppPlayers.length > 0) {
      const oppOpt = solveOptimalLineup(resolvedOppPlayers, 'balanced', this.state.starterSlots, {
        week: this.state.week,
        liveSchedule: this.state.liveSchedule
      });
      oppStarters = oppOpt.starters;
      oppBench = oppOpt.bench;
    } else if (oppStarters.length === 0 && userStarters.length > 0) {
      // Fallback mirror opponent if only single roster was synced
      oppStarters = userStarters.map(p => ({
        ...p,
        player_id: `opp_${p.player_id}`,
        projected_pts: Math.max(5, Number((p.projected_pts - 1.2).toFixed(1)))
      }));
    }

    this.state.userStarters = userStarters.map(p => this.resolveLivePlayerGamedayState(p));
    this.state.userBench = userBench.map(p => this.resolveLivePlayerGamedayState(p));
    this.state.userPlayers = [...this.state.userStarters, ...this.state.userBench];

    this.state.oppStarters = oppStarters.map(p => this.resolveLivePlayerGamedayState(p));
    this.state.oppBench = oppBench.map(p => this.resolveLivePlayerGamedayState(p));
    this.state.oppPlayers = [...this.state.oppStarters, ...this.state.oppBench];

    this.state.activeView = 'user';

    // 4. Update Header UI
    if (typeof document !== 'undefined') {
      const userTeamNameEl = document.getElementById('userTeamName');
      const oppTeamNameEl = document.getElementById('oppTeamName');
      const leagueTitleEl = document.getElementById('leagueTitle');
      const leagueSubEl = document.getElementById('leagueSub');
      const simTitleBadgeEl = document.getElementById('simTitleBadge') || document.getElementById('weekBadge');
      const oppViewBtn = document.getElementById('viewOppBtn');

      if (userTeamNameEl) userTeamNameEl.textContent = userTeamName;
      if (oppTeamNameEl) oppTeamNameEl.textContent = oppTeamName;
      if (oppViewBtn) oppViewBtn.textContent = `Opponent (${oppTeamName})`;

      const platformLabel = (payload.platform || 'Custom').toUpperCase();
      if (leagueTitleEl) leagueTitleEl.textContent = `${platformLabel} Fantasy Matchup`;
      if (leagueSubEl) leagueSubEl.textContent = `${userTeamName} vs. ${oppTeamName} • Synced via Scout Bowie`;
      if (simTitleBadgeEl) simTitleBadgeEl.textContent = `${platformLabel} IMPORT • 10K SIMS`;
    }

    this.closeSetupModal();
    this.recomputeOptimization();
    this.loadWaiverTargets();
    
    const platformName = payload.platform ? payload.platform.toUpperCase() : 'ESPN/Yahoo';
    this.showToast(`🏆 Synced ${platformName} matchup successfully via Scout Bowie! 🐾`);

    // Clean hash from browser URL without triggering reload
    if (typeof window !== 'undefined' && window.location.hash && window.location.hash.includes('import=')) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }

  /**
   * Safe GoatCounter Analytics Event Tracker
   */
  trackEvent(eventName, title = '') {
    try {
      if (typeof window !== 'undefined' && window.goatcounter && typeof window.goatcounter.count === 'function') {
        window.goatcounter.count({
          path: eventName,
          title: title || eventName,
          event: true
        });
      }
    } catch (e) {
      console.warn('Analytics event tracking error:', e);
    }
  }

  /* ==========================================================================
     SCOUT BOWIE GAMEDAY ALERT ENGINE & SETTINGS
     ========================================================================== */

  loadAlertSettings() {
    const defaultSettings = {
      discordWebhook: '',
      email: '',
      alerts: {
        inactive: true,
        lateswap: true,
        weather: true,
        drift: true
      }
    };
    try {
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('scout_bowie_alert_settings');
        if (stored) {
          const parsed = JSON.parse(stored);
          return {
            discordWebhook: parsed.discordWebhook || '',
            email: parsed.email || '',
            alerts: {
              ...defaultSettings.alerts,
              ...(parsed.alerts || {})
            }
          };
        }
      }
    } catch (e) {
      console.warn('Failed to load alert settings from localStorage:', e);
    }
    return defaultSettings;
  }

  saveAlertPreferences() {
    const webhookInput = document.getElementById('discord-webhook-input');
    const emailInput = document.getElementById('email-input');
    const toggleInactive = document.getElementById('alert-toggle-inactive');
    const toggleLateSwap = document.getElementById('alert-toggle-lateswap');
    const toggleWeather = document.getElementById('alert-toggle-weather');
    const toggleDrift = document.getElementById('alert-toggle-drift');

    const updatedSettings = {
      discordWebhook: webhookInput ? webhookInput.value.trim() : (this.state.alertSettings?.discordWebhook || ''),
      email: emailInput ? emailInput.value.trim() : (this.state.alertSettings?.email || ''),
      alerts: {
        inactive: toggleInactive ? toggleInactive.checked : true,
        lateswap: toggleLateSwap ? toggleLateSwap.checked : true,
        weather: toggleWeather ? toggleWeather.checked : true,
        drift: toggleDrift ? toggleDrift.checked : true
      }
    };

    this.state.alertSettings = updatedSettings;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('scout_bowie_alert_settings', JSON.stringify(updatedSettings));
      }
    } catch (e) {
      console.warn('Failed to persist alert settings:', e);
    }

    this.trackEvent('save-alert-preferences', 'Saved Gameday Alert Preferences');
    this.closeAlertsModal();
    this.runGamedayAlertSweeps();
    this.showToast('Gameday alert preferences saved! Bowie is on watch. 🐾');
  }

  openAlertsModal() {
    this.trackEvent('open-alerts-modal', 'Opened Alert Settings Modal');
    const settings = this.state.alertSettings || this.loadAlertSettings();
    this.state.alertSettings = settings;

    const webhookInput = document.getElementById('discord-webhook-input');
    const emailInput = document.getElementById('email-input');
    const discordBtn = document.getElementById('btn-test-discord');
    const emailBtn = document.getElementById('btn-test-email');
    const toggleInactive = document.getElementById('alert-toggle-inactive');
    const toggleLateSwap = document.getElementById('alert-toggle-lateswap');
    const toggleWeather = document.getElementById('alert-toggle-weather');
    const toggleDrift = document.getElementById('alert-toggle-drift');

    if (webhookInput) webhookInput.value = settings.discordWebhook || '';
    if (emailInput) emailInput.value = settings.email || '';
    if (toggleInactive) toggleInactive.checked = settings.alerts?.inactive !== false;
    if (toggleLateSwap) toggleLateSwap.checked = settings.alerts?.lateswap !== false;
    if (toggleWeather) toggleWeather.checked = settings.alerts?.weather !== false;
    if (toggleDrift) toggleDrift.checked = settings.alerts?.drift !== false;

    // Update button states based on saved settings
    if (discordBtn) {
      discordBtn.disabled = false;
      if (settings.discordWebhook && (settings.discordWebhook.includes('discord.com/api/webhooks') || settings.discordWebhook.includes('discordapp.com/api/webhooks'))) {
        discordBtn.textContent = 'Connected ✓';
        discordBtn.classList.add('connected');
      } else {
        discordBtn.textContent = 'Connect';
        discordBtn.classList.remove('connected');
      }
    }

    if (emailBtn) {
      emailBtn.disabled = false;
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (settings.email && emailRegex.test(settings.email)) {
        emailBtn.textContent = 'Connected ✓';
        emailBtn.classList.add('connected');
      } else {
        emailBtn.textContent = 'Connect';
        emailBtn.classList.remove('connected');
      }
    }

    const modal = document.getElementById('alertsModalOverlay');
    if (modal) modal.classList.add('active');
  }

  onDiscordInputChanged() {
    const webhookInput = document.getElementById('discord-webhook-input');
    const discordBtn = document.getElementById('btn-test-discord');
    const currentSaved = this.state.alertSettings?.discordWebhook || '';
    const currentVal = webhookInput ? webhookInput.value.trim() : '';

    if (discordBtn) {
      if (currentVal && currentVal === currentSaved && (currentVal.includes('discord.com/api/webhooks') || currentVal.includes('discordapp.com/api/webhooks'))) {
        discordBtn.textContent = 'Connected ✓';
        discordBtn.classList.add('connected');
      } else {
        discordBtn.textContent = 'Connect';
        discordBtn.classList.remove('connected');
      }
    }
  }

  onEmailInputChanged() {
    const emailInput = document.getElementById('email-input');
    const emailBtn = document.getElementById('btn-test-email');
    const currentSaved = this.state.alertSettings?.email || '';
    const currentVal = emailInput ? emailInput.value.trim() : '';

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (emailBtn) {
      if (currentVal && currentVal === currentSaved && emailRegex.test(currentVal)) {
        emailBtn.textContent = 'Connected ✓';
        emailBtn.classList.add('connected');
      } else {
        emailBtn.textContent = 'Connect';
        emailBtn.classList.remove('connected');
      }
    }
  }

  closeAlertsModal() {
    const modal = document.getElementById('alertsModalOverlay');
    if (modal) modal.classList.remove('active');
  }

  async testDiscordWebhook() {
    const webhookInput = document.getElementById('discord-webhook-input');
    const webhookUrl = webhookInput ? webhookInput.value.trim() : (this.state.alertSettings?.discordWebhook || '');

    if (!webhookUrl || (!webhookUrl.includes('discord.com/api/webhooks') && !webhookUrl.includes('discordapp.com/api/webhooks'))) {
      this.showToast('Please enter a valid Discord Webhook URL (https://discord.com/api/webhooks/...) ⚠️');
      return;
    }

    const testBtn = document.getElementById('btn-test-discord');
    if (testBtn) {
      testBtn.disabled = true;
      testBtn.textContent = 'Connecting...';
      testBtn.classList.remove('connected');
    }

    const payload = {
      username: "Scout Bowie",
      avatar_url: "https://raw.githubusercontent.com/scout-bowie-analytics/sleeper-analytics-suite/main/assets/scout-bowie.webp",
      embeds: [
        {
          title: "🔔 Scout Bowie Alert Engine Connected!",
          description: "Your gameday monitoring is active. You will receive real-time pings for inactives, late-swaps, weather spikes, and lineup drift.",
          color: 2278750, // 0x22c55e (Green)
          fields: [
            { name: "Team Monitored", value: this.state.userTeamName || "Your Fantasy Team", inline: true },
            { name: "League", value: this.state.currentLeague?.name || "Active League", inline: true },
            { name: "Status", value: "🟢 Active & Sweeping", inline: true }
          ],
          footer: {
            text: `Bowie's Fantasy Football Toolbox • Week ${this.state.week || 1}`
          },
          timestamp: new Date().toISOString()
        }
      ]
    };

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok || response.status === 204) {
        // Automatically save to state & localStorage
        this.state.alertSettings = {
          ...(this.state.alertSettings || this.loadAlertSettings()),
          discordWebhook: webhookUrl
        };
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('scout_bowie_alert_settings', JSON.stringify(this.state.alertSettings));
          }
        } catch (e) {}

        if (testBtn) {
          testBtn.textContent = 'Connected ✓';
          testBtn.classList.add('connected');
          testBtn.disabled = false;
        }

        this.showToast('✅ Connected! Discord Webhook verified.');
        this.trackEvent('test-discord-webhook-success', 'Discord Webhook Verified');
      } else {
        if (testBtn) {
          testBtn.textContent = 'Connect';
          testBtn.classList.remove('connected');
          testBtn.disabled = false;
        }
        this.showToast(`❌ Discord Webhook responded with status ${response.status}. Check URL permissions.`);
      }
    } catch (err) {
      console.warn('Discord Webhook test failed:', err);
      if (testBtn) {
        testBtn.textContent = 'Connect';
        testBtn.classList.remove('connected');
        testBtn.disabled = false;
      }
      this.showToast('⚠️ Could not dispatch to Discord. Check your Webhook URL or network connection.');
    }
  }

  async testEmailNotification() {
    const emailInput = document.getElementById('email-input');
    const email = emailInput ? emailInput.value.trim() : (this.state.alertSettings?.email || '');

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      this.showToast('Please enter a valid email address ⚠️');
      return;
    }

    const testBtn = document.getElementById('btn-test-email');
    if (testBtn) {
      testBtn.disabled = true;
      testBtn.textContent = 'Connecting...';
      testBtn.classList.remove('connected');
    }

    const payload = {
      to: email,
      subject: "🔔 Scout Bowie Alert Engine Connected!",
      htmlText: "<div style='font-family:sans-serif;padding:24px;background:#0f172a;color:#f8fafc;border-radius:12px;max-width:500px;'><h2 style='color:#22c55e;margin-top:0;'>🔔 Scout Bowie Alert Engine Connected!</h2><p style='color:#cbd5e1;line-height:1.5;'>Your gameday monitoring is active. You will receive email sweeps for inactives, late swaps, and lineup drift.</p><hr style='border:none;border-top:1px solid #334155;margin:20px 0;'><p style='color:#64748b;font-size:12px;margin:0;'>Bowie's Fantasy Football Toolbox</p></div>"
    };

    try {
      const response = await fetch('https://scout-bowie-alerts.duzunic.workers.dev', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        // Automatically save to state & localStorage
        this.state.alertSettings = {
          ...(this.state.alertSettings || this.loadAlertSettings()),
          email: email
        };
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('scout_bowie_alert_settings', JSON.stringify(this.state.alertSettings));
          }
        } catch (e) {}

        if (testBtn) {
          testBtn.textContent = 'Connected ✓';
          testBtn.classList.add('connected');
          testBtn.disabled = false;
        }

        this.showToast('✅ Connected! Check your inbox for confirmation.');
        this.trackEvent('test-email-notification-success', `Test Email Sent to ${email}`);
      } else {
        if (testBtn) {
          testBtn.textContent = 'Connect';
          testBtn.classList.remove('connected');
          testBtn.disabled = false;
        }
        const errorText = await response.text().catch(() => '');
        this.showToast(`❌ Failed to send test email (status ${response.status}). ${errorText ? errorText.slice(0, 80) : ''}`);
      }
    } catch (err) {
      console.warn('Email relay error:', err);
      if (testBtn) {
        testBtn.textContent = 'Connect';
        testBtn.classList.remove('connected');
        testBtn.disabled = false;
      }
      this.showToast(`❌ Failed to send test email: ${err.message || 'Network error'}`);
    }
  }

  /* Modular Alert Evaluators */

  evalInactiveStarters(starters) {
    if (!starters || !Array.isArray(starters)) return [];
    const inactiveStatuses = new Set(['out', 'ir', 'pup', 'doubtful', 'inactive', 'suspended', 'covid', 'dnr']);
    const alerts = [];

    starters.forEach(p => {
      const status = (p.injury_status || '').toLowerCase();
      const isMarkedInactive = inactiveStatuses.has(status) || p.isInactive || (p.projected_pts === 0 && p.injury_status);
      if (isMarkedInactive) {
        alerts.push({
          type: 'inactive',
          player: p,
          severity: 'critical',
          title: `🚨 INACTIVE STARTER: ${p.full_name} (${p.position || 'FLEX'} - ${p.team || 'FA'})`,
          message: `${p.full_name} is designated ${p.injury_status ? p.injury_status.toUpperCase() : 'OUT'} and currently assigned to starting slot [${p.slotAssigned || p.position}]. Swap immediately!`
        });
      }
    });
    return alerts;
  }

  evalLateSwapRisks(starters, bench) {
    if (!starters || !Array.isArray(starters)) return [];
    const alerts = [];

    starters.forEach(p => {
      const slot = String(p.slotAssigned || p.position || '');
      const isPrimarySlot = ['RB', 'WR', 'TE'].some(pos => slot === pos || slot.startsWith(pos)) && !['FLEX', 'SUPER_FLEX', 'WRRB_FLEX', 'REC_FLEX', 'BN'].includes(slot);
      const isQuestionable = (p.injury_status || '').toLowerCase() === 'questionable';
      const sched = p.gameSchedule || getGameScheduleInfo(p.team, this.state.week, this.state.liveSchedule);
      const timeStr = sched?.time || '';
      const isLateGame = timeStr.includes('4:') || timeStr.includes('8:') || timeStr.includes('Mon') || timeStr.includes('Thu') || timeStr.includes('Sun Night') || Boolean(sched?.isLateKickoff);

      if (isPrimarySlot && isQuestionable && isLateGame) {
        alerts.push({
          type: 'lateswap',
          player: p,
          severity: 'warning',
          title: `🛡️ LATE-SWAP RISK: ${p.full_name} in ${slot}`,
          message: `${p.full_name} is Questionable for a late kickoff (${timeStr || 'Late Window'}). Move to FLEX slot to protect late-swap options if deactivated.`
        });
      }
    });
    return alerts;
  }

  evalWeatherSpikes(starters) {
    if (!starters || !Array.isArray(starters)) return [];
    const alerts = [];
    const weatherSensitivePositions = new Set(['QB', 'WR', 'K']);

    starters.forEach(p => {
      if (weatherSensitivePositions.has(p.position)) {
        const sched = p.gameSchedule || getGameScheduleInfo(p.team, this.state.week, this.state.liveSchedule);
        const isDome = sched?.isDome || sched?.venueType === 'dome';
        const windMph = sched?.windMph || (p.team === 'CHI' || p.team === 'BUF' || p.team === 'CLE' ? 18 : 6);
        if (!isDome && windMph >= 18) {
          alerts.push({
            type: 'weather',
            player: p,
            severity: 'caution',
            title: `💨 HIGH WIND SPIKE: ${p.full_name} (${p.team})`,
            message: `Sustained winds of ${windMph} mph expected at ${sched?.stadiumName || 'Open Stadium'}. May suppress deep passing efficiency. Review bench pivot options (e.g. C.J. Stroud in dome) if seeking floor stability.`
          });
        }
      }
    });
    return alerts;
  }

  evalLineupDrift(currentStarters, optimalSolution) {
    if (!currentStarters || !optimalSolution || !optimalSolution.starters) return [];
    const currentTotal = currentStarters.reduce((acc, p) => acc + (p.projected_pts || 0), 0);
    const optimalTotal = optimalSolution.starters.reduce((acc, p) => acc + (p.projected_pts || 0), 0);
    const drift = optimalTotal - currentTotal;

    if (drift >= 3.0) {
      return [{
        type: 'drift',
        severity: 'warning',
        drift: Number(drift.toFixed(1)),
        currentTotal: Number(currentTotal.toFixed(1)),
        optimalTotal: Number(optimalTotal.toFixed(1)),
        title: `📉 LINEUP DRIFT: -${drift.toFixed(1)} Pts vs Optimal`,
        message: `Your active starters (${currentTotal.toFixed(1)} pts) trail the optimal strategy projection (${optimalTotal.toFixed(1)} pts) by ${drift.toFixed(1)} points. Review Sit/Start swaps.`
      }];
    }
    return [];
  }

  runGamedayAlertSweeps() {
    const config = this.state.alertSettings?.alerts || { inactive: true, lateswap: true, weather: true, drift: true };
    const alerts = [];

    if (config.inactive !== false) {
      alerts.push(...this.evalInactiveStarters(this.state.userStarters));
    }
    if (config.lateswap !== false) {
      alerts.push(...this.evalLateSwapRisks(this.state.userStarters, this.state.userBench));
    }
    if (config.weather !== false) {
      alerts.push(...this.evalWeatherSpikes(this.state.userStarters));
    }
    if (config.drift !== false && this.state.optimalSolution) {
      alerts.push(...this.evalLineupDrift(this.state.userStarters, this.state.optimalSolution));
    }

    this.state.activeAlerts = alerts;

    // Update Top Navigation Alert Badge
    const totalHazards = alerts.length;
    const navBadge = document.getElementById('navAlertBadgeCount') || document.querySelector('#btn-gameday-alerts .alert-count-badge');
    if (navBadge) {
      if (totalHazards > 0) {
        navBadge.textContent = String(totalHazards);
        navBadge.style.display = 'inline-flex';
      } else {
        navBadge.style.display = 'none';
        navBadge.textContent = '0';
      }
    }

    // Update High-Visibility Gameday Alert Banner
    const banner = document.getElementById('gamedayAlertBanner');
    const itemsContainer = document.getElementById('gamedayAlertItems');
    const headline = document.getElementById('gamedayAlertHeadline');
    const icon = document.getElementById('gamedayAlertIcon');

    if (!banner || !itemsContainer) return;

    if (alerts.length === 0) {
      banner.style.display = 'none';
      return;
    }

    const hasCritical = alerts.some(a => a.severity === 'critical');
    banner.style.display = 'flex';
    banner.classList.toggle('critical-hazard', hasCritical);

    if (icon) icon.textContent = hasCritical ? '🚨' : '⚠️';
    if (headline) {
      headline.textContent = hasCritical 
        ? `${alerts.length} CRITICAL GAMEDAY HAZARD${alerts.length > 1 ? 'S' : ''} DETECTED`
        : `${alerts.length} GAMEDAY ALERT${alerts.length > 1 ? 'S' : ''} ACTIVE`;
    }

    itemsContainer.innerHTML = alerts.map(a => {
      const pillClass = a.severity === 'critical' ? 'pill-critical' : (a.severity === 'warning' ? 'pill-warning' : 'pill-caution');
      return `
        <div class="gameday-alert-pill ${pillClass}">
          <span>${a.title}</span>
          <span style="color:var(--muted);">&bull;</span>
          <span style="font-weight:400;color:#cbd5e1;">${a.message}</span>
        </div>
      `;
    }).join('');
  }

  /**
   * Rich HTML Gameday Alert Email Payload Generator
   */
  buildGamedayAlertEmailHtml(hazards = [], teamName = 'Your Fantasy Team', leagueName = 'Active League', weekNumber = 1) {
    const inactives = hazards.filter(h => h.type === 'inactive');
    const lateSwaps = hazards.filter(h => h.type === 'lateswap');
    const weathers = hazards.filter(h => h.type === 'weather');
    const drifts = hazards.filter(h => h.type === 'drift');

    let inactivesHtml = '';
    if (inactives.length > 0) {
      inactivesHtml = `
        <div style="margin-bottom: 20px; padding: 16px; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.35); border-left: 4px solid #ef4444; border-radius: 8px;">
          <h3 style="color: #fca5a5; margin: 0 0 10px 0; font-size: 15px;">
            🚨 Critical Inactive Starters (${inactives.length})
          </h3>
          ${inactives.map(item => `
            <div style="margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid rgba(239, 68, 68, 0.15);">
              <div style="font-weight: 700; color: #fff; font-size: 14px;">${item.title}</div>
              <div style="color: #cbd5e1; font-size: 13px; margin-top: 3px; line-height: 1.4;">${item.message}</div>
            </div>
          `).join('')}
        </div>
      `;
    }

    let lateSwapsHtml = '';
    if (lateSwaps.length > 0) {
      lateSwapsHtml = `
        <div style="margin-bottom: 20px; padding: 16px; background: rgba(234, 179, 8, 0.08); border: 1px solid rgba(234, 179, 8, 0.35); border-left: 4px solid #eab308; border-radius: 8px;">
          <h3 style="color: #fde047; margin: 0 0 10px 0; font-size: 15px;">
            🛡️ Late-Swap Sentinel (${lateSwaps.length})
          </h3>
          ${lateSwaps.map(item => `
            <div style="margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid rgba(234, 179, 8, 0.15);">
              <div style="font-weight: 700; color: #fff; font-size: 14px;">${item.title}</div>
              <div style="color: #cbd5e1; font-size: 13px; margin-top: 3px; line-height: 1.4;">${item.message}</div>
            </div>
          `).join('')}
        </div>
      `;
    }

    let weatherHtml = '';
    if (weathers.length > 0) {
      weatherHtml = `
        <div style="margin-bottom: 20px; padding: 16px; background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.35); border-left: 4px solid #38bdf8; border-radius: 8px;">
          <h3 style="color: #7dd3fc; margin: 0 0 10px 0; font-size: 15px;">
            💨 Weather Spike Warnings (${weathers.length})
          </h3>
          ${weathers.map(item => `
            <div style="margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid rgba(56, 189, 248, 0.15);">
              <div style="font-weight: 700; color: #fff; font-size: 14px;">${item.title}</div>
              <div style="color: #cbd5e1; font-size: 13px; margin-top: 3px; line-height: 1.4;">${item.message}</div>
            </div>
          `).join('')}
        </div>
      `;
    }

    let driftHtml = '';
    if (drifts.length > 0) {
      driftHtml = `
        <div style="margin-bottom: 20px; padding: 16px; background: rgba(168, 85, 247, 0.08); border: 1px solid rgba(168, 85, 247, 0.35); border-left: 4px solid #a855f7; border-radius: 8px;">
          <h3 style="color: #c084fc; margin: 0 0 10px 0; font-size: 15px;">
            📉 Lineup Drift Monitor (${drifts.length})
          </h3>
          ${drifts.map(item => `
            <div style="margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid rgba(168, 85, 247, 0.15);">
              <div style="font-weight: 700; color: #fff; font-size: 14px;">${item.title}</div>
              <div style="color: #cbd5e1; font-size: 13px; margin-top: 3px; line-height: 1.4;">${item.message}</div>
            </div>
          `).join('')}
        </div>
      `;
    }

    const appUrl = (typeof window !== 'undefined' && window.location?.href) ? window.location.href : 'https://scout-bowie-analytics.github.io/sleeper-analytics-suite/weekly/index.html';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 20px 10px; background-color: #0b0f17; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 600px; margin: 0 auto; background: #0f172a; border: 1px solid #1e293b; border-radius: 14px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.5);">
          <tr>
            <td style="padding: 24px 28px; background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border-bottom: 1px solid #334155;">
              <div style="display: inline-block; padding: 4px 10px; background: rgba(234, 179, 8, 0.15); border: 1px solid rgba(234, 179, 8, 0.4); border-radius: 6px; color: #eab308; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">
                🐕 SCOUT BOWIE GAMEDAY ALERT
              </div>
              <h1 style="margin: 0 0 4px 0; font-size: 20px; font-weight: 800; color: #ffffff;">
                ${teamName}
              </h1>
              <div style="color: #94a3b8; font-size: 13px;">
                ${leagueName} &bull; <strong style="color: #e2e8f0;">Week ${weekNumber} Kickoff Sweep</strong>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 28px;">
              <p style="margin: 0 0 18px 0; color: #cbd5e1; font-size: 14px; line-height: 1.5;">
                Scout Bowie completed a kickoff sweep of your active roster. Found <strong>${hazards.length}</strong> active hazard${hazards.length > 1 ? 's' : ''} requiring immediate lineup management:
              </p>

              ${inactivesHtml}
              ${lateSwapsHtml}
              ${weatherHtml}
              ${driftHtml}

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top: 24px;">
                <tr>
                  <td align="center">
                    <a href="${appUrl}" style="display: inline-block; padding: 12px 28px; background: #eab308; color: #0f172a; font-weight: 800; font-size: 14px; text-decoration: none; border-radius: 8px; box-shadow: 0 4px 12px rgba(234, 179, 8, 0.35);">
                      Open Scout Bowie Optimizer ➔
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 16px 28px; background: #0b0f17; border-top: 1px solid #1e293b; color: #64748b; font-size: 12px; text-align: center;">
              Bowie's Fantasy Football Toolbox &bull; Automated Quantitative Gameday Engine
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;
  }

  /**
   * Rich Discord Embed Generator
   */
  buildDiscordAlertEmbed(hazards = [], teamName = 'Your Fantasy Team', leagueName = 'Active League', weekNumber = 1) {
    const inactives = hazards.filter(h => h.type === 'inactive');
    const lateSwaps = hazards.filter(h => h.type === 'lateswap');
    const weathers = hazards.filter(h => h.type === 'weather');
    const drifts = hazards.filter(h => h.type === 'drift');

    // Dynamic Color Calculation:
    // Red: 0xEF4444 (15680580) for Critical Inactives
    // Amber: 0xF59E0B (16096779) for Late-Swap / Weather
    // Blue: 0x3B82F6 (3900150) for Lineup Drift only
    // Green: 0x22C55E (2278750) if clean
    let color = 2278750;
    if (inactives.length > 0) {
      color = 15680580; // 0xEF4444 Red
    } else if (lateSwaps.length > 0 || weathers.length > 0) {
      color = 16096779; // 0xF59E0B Amber
    } else if (drifts.length > 0) {
      color = 3900150; // 0x3B82F6 Blue
    }

    const fields = [];

    // 1. Inactive Starters Field
    if (inactives.length > 0) {
      fields.push({
        name: `🚨 Inactive Starters (${inactives.length})`,
        value: inactives.map(item => `• **${item.player?.full_name || 'Player'}** (${item.player?.position || 'FLEX'} - ${item.player?.team || 'FA'}): Designated \`${(item.player?.injury_status || 'OUT').toUpperCase()}\` in slot [${item.player?.slotAssigned || item.player?.position || 'Starter'}]. Swap out before kickoff!`).join('\n'),
        inline: false
      });
    }

    // 2. Late-Swap Sentinel Field
    if (lateSwaps.length > 0) {
      fields.push({
        name: `🛡️ Late-Swap Sentinel (${lateSwaps.length})`,
        value: lateSwaps.map(item => `• **${item.player?.full_name || 'Player'}** (${item.player?.position}): Questionable for late kickoff (${item.player?.gameSchedule?.time || 'Late Game'}). Move from \`${item.player?.slotAssigned || 'Primary'}\` to \`FLEX\` for late-swap flexibility.`).join('\n'),
        inline: false
      });
    }

    // 3. Weather Warnings Field
    if (weathers.length > 0) {
      fields.push({
        name: `💨 Weather Warnings (${weathers.length})`,
        value: weathers.map(item => `• **${item.player?.full_name || 'Player'}** (${item.player?.position} - ${item.player?.team}): High sustained winds at ${item.player?.gameSchedule?.stadiumName || 'Open Stadium'}. May suppress passing and kicking volume.`).join('\n'),
        inline: false
      });
    }

    // 4. Lineup Optimization / Drift Field
    if (drifts.length > 0) {
      fields.push({
        name: `📉 Lineup Optimization Deficit (-${drifts[0].drift} Pts)`,
        value: `Active Starters: **${drifts[0].currentTotal} pts** vs Optimal: **${drifts[0].optimalTotal} pts**.\n*Review Sit/Start recommendations in Scout Bowie dashboard.*`,
        inline: false
      });
    }

    // If no hazards found
    if (fields.length === 0) {
      fields.push({
        name: '🟢 Lineup Status',
        value: 'All active starters are healthy and optimized for kickoff! No hazards detected.',
        inline: false
      });
    }

    return {
      title: `🚨 Scout Bowie Gameday Alert • Week ${weekNumber}`,
      description: `Monitored Roster: **${teamName}** (${leagueName})\n*Scout Bowie completed automated kickoff sweeps for your active starting lineup:*`,
      color: color,
      fields: fields,
      thumbnail: {
        url: "https://raw.githubusercontent.com/scout-bowie-analytics/sleeper-analytics-suite/main/assets/scout-bowie.webp"
      },
      footer: {
        text: `Scout Bowie Fantasy Toolbox • Generated at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      },
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Unified Gameday Alert Dispatcher (Discord Webhook + Cloudflare Email Relay)
   */
  async dispatchGamedayAlerts() {
    const settings = this.state.alertSettings || this.loadAlertSettings();
    const webhookUrl = settings?.discordWebhook ? settings.discordWebhook.trim() : '';
    const email = settings?.email ? settings.email.trim() : '';

    if (!webhookUrl && !email) {
      this.showToast('⚠️ Please connect Email or Discord first to receive alerts.');
      this.openAlertsModal();
      return;
    }

    const alerts = this.state.activeAlerts || [];
    if (alerts.length === 0) {
      this.showToast('No active hazards to dispatch! Your lineup is in great shape. 🐾');
      return;
    }

    const dispatchBtn = document.getElementById('btn-dispatch-alerts') || document.getElementById('dispatchAlertsBtn');
    if (dispatchBtn) {
      dispatchBtn.disabled = true;
      dispatchBtn.innerHTML = '<span>⏳ Dispatching...</span>';
    }

    const teamName = this.state.userTeamName || 'Your Fantasy Team';
    const leagueName = this.state.currentLeague?.name || 'Active League';
    const weekNumber = this.state.week || 1;

    const dispatches = [];

    // 1. Dispatch Discord Webhook if configured
    if (webhookUrl && (webhookUrl.includes('discord.com/api/webhooks') || webhookUrl.includes('discordapp.com/api/webhooks'))) {
      const discordPayload = {
        username: "Scout Bowie",
        avatar_url: "https://raw.githubusercontent.com/scout-bowie-analytics/sleeper-analytics-suite/main/assets/scout-bowie.webp",
        embeds: [this.buildDiscordAlertEmbed(alerts, teamName, leagueName, weekNumber)]
      };

      dispatches.push(
        fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(discordPayload)
        }).then(res => {
          if (!res.ok && res.status !== 204) {
            throw new Error(`Discord returned status ${res.status}`);
          }
          return { channel: 'Discord' };
        })
      );
    }

    // 2. Dispatch Cloudflare Email Relay if configured
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (email && emailRegex.test(email)) {
      const emailPayload = {
        to: email,
        subject: `🚨 Scout Bowie Alert: Week ${weekNumber} Lineup Hazards (${alerts.length} Issue${alerts.length > 1 ? 's' : ''})`,
        htmlText: this.buildGamedayAlertEmailHtml(alerts, teamName, leagueName, weekNumber)
      };

      dispatches.push(
        fetch('https://scout-bowie-alerts.duzunic.workers.dev', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(emailPayload)
        }).then(async res => {
          if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new Error(`Email relay returned status ${res.status}: ${errText}`);
          }
          return { channel: 'Email' };
        })
      );
    }

    try {
      const results = await Promise.allSettled(dispatches);
      const successfulChannels = results
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value.channel);

      const failedChannels = results
        .filter(r => r.status === 'rejected')
        .map(r => r.reason?.message || 'Unknown error');

      if (successfulChannels.length > 0) {
        this.showToast(`📢 Dispatched active hazard alerts to ${successfulChannels.join(' & ')}! 🐾`);
        this.trackEvent('dispatch-unified-alerts-success', `Dispatched ${alerts.length} alerts to ${successfulChannels.join(', ')}`);
      } else if (failedChannels.length > 0) {
        this.showToast(`❌ Dispatch failed: ${failedChannels[0]}`);
      }
    } catch (e) {
      console.warn('Dispatch alerts error:', e);
      this.showToast('⚠️ Could not complete alert dispatch. Check your network or settings.');
    } finally {
      if (dispatchBtn) {
        dispatchBtn.disabled = false;
        dispatchBtn.innerHTML = '<span>📢 Dispatch Alerts</span>';
      }
    }
  }

  /**
   * Parse league slot requirements from roster_positions
   */
  parseSlotRequirements(rosterPositions) {
    const reqs = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPER_FLEX: 0, K: 0, DEF: 0 };
    (rosterPositions || []).forEach(pos => {
      if (pos === 'QB') reqs.QB++;
      else if (pos === 'RB') reqs.RB++;
      else if (pos === 'WR') reqs.WR++;
      else if (pos === 'TE') reqs.TE++;
      else if (pos === 'FLEX' || pos === 'WRRB_FLEX' || pos === 'REC_FLEX') reqs.FLEX++;
      else if (pos === 'SUPER_FLEX') reqs.SUPER_FLEX++;
      else if (pos === 'K') reqs.K++;
      else if (pos === 'DEF') reqs.DEF++;
    });

    const totalStarters = Object.values(reqs).reduce((a, b) => a + b, 0);
    if (totalStarters === 0) {
      return { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 };
    }
    return reqs;
  }

  /**
   * Core Matchup Loader & Strict Positional Slot Resolver
   */
  async loadMatchupData(league, week, userRosterId = 1) {
    try {
      this.state.isImportedMatchup = false;
      // 1. Guard: Ensure player database is loaded
      await sleeperApi.loadPlayersDatabase();

      const leagueId = league?.league_id || 'demo_championship_league_2025';
      const season = league?.season || this.state.season || '2026';
      const scoringSettings = league?.scoring_settings || null;
      this.state.season = season;

      // 2. Fetch rosters, users, matchups, projections, live ESPN schedule, and Vegas odds in parallel
      const [rosters, users, matchups, projections, liveSchedule, liveOdds] = await Promise.all([
        sleeperApi.getRosters(leagueId),
        sleeperApi.getUsers(leagueId),
        sleeperApi.getMatchups(leagueId, week),
        sleeperApi.getProjections(season, week, scoringSettings),
        fetchLiveNflSchedule(season, week),
        fetchLiveVegasOdds().catch(e => {
          console.warn('Vegas odds background resolution:', e);
          return null;
        })
      ]);

      this.state.leagueRosters = rosters;
      this.state.leagueUsers = users;
      this.state.liveSchedule = liveSchedule;
      this.state.liveOdds = liveOdds;
      this.state.projections = projections;

      // 3. Find User Roster and Opponent Roster
      const userRoster = rosters.find(r => r.roster_id === userRosterId) || rosters[0];
      const userMatchup = (matchups && matchups.find(m => m.roster_id === userRoster.roster_id)) 
        || (matchups && matchups[0]) 
        || { starters: userRoster.starters || [], players: userRoster.players || [], matchup_id: 1 };

      const oppMatchup = (matchups && matchups.find(m => m.matchup_id === userMatchup.matchup_id && m.roster_id !== userRoster.roster_id))
        || (matchups && matchups.find(m => m.roster_id !== userRoster.roster_id))
        || (rosters[1] ? { starters: rosters[1].starters || [], players: rosters[1].players || [], roster_id: rosters[1].roster_id } : userMatchup);

      const oppRoster = rosters.find(r => r.roster_id === oppMatchup.roster_id) || rosters[1] || rosters[0];

      // 4. Starting Roster Slot Configuration (filter out BN / IR / TAXI)
      const rawPositions = league?.roster_positions || [
        "QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"
      ];
      const starterSlots = rawPositions.filter(p => !['BN', 'IR', 'TAXI', 'RESERVE'].includes(p));
      const slotReqs = this.parseSlotRequirements(starterSlots);
      this.state.league = league;
      this.state.leagueData = league;
      this.state.rawRosterPositions = rawPositions;
      this.state.starterSlots = starterSlots;
      this.state.slotRequirements = slotReqs;

      // 5. Ingest User Roster Players with Strict Slot Eligibility
      const rawUserStarters = (userMatchup.starters || userRoster.starters || []).filter(id => id && id !== '0' && id !== 'null');
      const rawUserAllPlayers = (userMatchup.players || userRoster.players || []).filter(id => id && id !== '0' && id !== 'null');

      const allUserResolved = rawUserAllPlayers.map(pid => {
        return sleeperApi.getPlayerMetadata(pid, projections[pid], scoringSettings, week, liveSchedule);
      }).filter(Boolean);

      const rawStarterMetas = rawUserStarters.map(pid => {
        return sleeperApi.getPlayerMetadata(pid, projections[pid], scoringSettings, week, liveSchedule);
      }).filter(Boolean);

      // Strict Lineup Solver creates exact valid starters and bench adhering to primary slots + FLEX
      const userOpt = solveOptimalLineup(
        allUserResolved.length > 0 ? allUserResolved : rawStarterMetas,
        'balanced',
        starterSlots,
        { week, liveSchedule, currentStarters: rawStarterMetas }
      );

      let userStarters = userOpt.starters;
      let userBench = userOpt.bench;

      // 6. Ingest Opponent Roster with Strict Slot Eligibility
      const rawOppStarters = (oppMatchup.starters || oppRoster.starters || []).filter(id => id && id !== '0' && id !== 'null');
      const rawOppAllPlayers = (oppMatchup.players || oppRoster.players || []).filter(id => id && id !== '0' && id !== 'null');

      const allOppResolved = rawOppAllPlayers.map(pid => {
        return sleeperApi.getPlayerMetadata(pid, projections[pid], scoringSettings, week, liveSchedule);
      }).filter(Boolean);

      const rawOppStarterMetas = rawOppStarters.map(pid => {
        return sleeperApi.getPlayerMetadata(pid, projections[pid], scoringSettings, week, liveSchedule);
      }).filter(Boolean);

      const oppPool = allOppResolved.length > 0 ? allOppResolved : rawOppStarterMetas;
      let oppStarters = [];
      let oppBench = [];

      if (oppPool.length > 0) {
        const oppOpt = solveOptimalLineup(
          oppPool,
          'balanced',
          starterSlots,
          { week, liveSchedule, currentStarters: rawOppStarterMetas }
        );
        oppStarters = oppOpt.starters;
        oppBench = oppOpt.bench;
      } else if (userStarters.length > 0) {
        oppStarters = userStarters.map(p => ({ ...p, projected_pts: Math.max(5, p.projected_pts - 1.5) }));
      }

      // Ingest live gameday points and game states
      this.state.userStarters = userStarters.map(p => this.resolveLivePlayerGamedayState(p, userMatchup));
      this.state.userBench = userBench.map(p => this.resolveLivePlayerGamedayState(p, userMatchup));
      this.state.userPlayers = [...this.state.userStarters, ...this.state.userBench];
      this.state.oppStarters = oppStarters.map(p => this.resolveLivePlayerGamedayState(p, oppMatchup));
      this.state.oppBench = oppBench.map(p => this.resolveLivePlayerGamedayState(p, oppMatchup));
      this.state.oppPlayers = [...this.state.oppStarters, ...this.state.oppBench];

      this.state.userRoster = userRoster;
      this.state.oppRoster = oppRoster;
      this.state.activeView = 'user';

      // 7. Update Header & Team Display
      const userObj = users.find(u => u.user_id === userRoster.owner_id);
      const oppObj = users.find(u => u.user_id === oppRoster.owner_id);

      const userTeamName = userObj ? (userObj.metadata?.team_name || userObj.display_name) : `Team ${userRoster.roster_id}`;
      const oppTeamName = oppObj ? (oppObj.metadata?.team_name || oppObj.display_name) : `Team ${oppRoster.roster_id}`;
      this.state.oppTeamName = oppTeamName;

      if (typeof document !== 'undefined') {
        const oppViewBtn = document.getElementById('viewOppBtn');
        if (oppViewBtn) {
          oppViewBtn.textContent = `Opponent (${oppTeamName})`;
        }

        const userAvatar = (userObj && userObj.avatar && (userObj.avatar.startsWith('http') || userObj.avatar.startsWith('data:'))) 
          ? userObj.avatar
          : (userObj && userObj.avatar
            ? `https://sleepercdn.com/avatars/thumbs/${userObj.avatar}`
            : 'https://sleepercdn.com/images/v2/icons/player_default.webp');

        const oppAvatar = (oppObj && oppObj.avatar && (oppObj.avatar.startsWith('http') || oppObj.avatar.startsWith('data:')))
          ? oppObj.avatar
          : (oppObj && oppObj.avatar
            ? `https://sleepercdn.com/avatars/thumbs/${oppObj.avatar}`
            : 'https://sleepercdn.com/images/v2/icons/player_default.webp');

        const userTeamNameEl = document.getElementById('userTeamName');
        const oppTeamNameEl = document.getElementById('oppTeamName');
        const userAvatarEl = document.getElementById('userAvatar');
        const oppAvatarEl = document.getElementById('oppAvatar');
        const leagueTitleEl = document.getElementById('leagueTitle');
        const leagueSubEl = document.getElementById('leagueSub');
        const simTitleBadgeEl = document.getElementById('simTitleBadge') || document.getElementById('weekBadge');

        if (userTeamNameEl) userTeamNameEl.textContent = userTeamName;
        if (oppTeamNameEl) oppTeamNameEl.textContent = oppTeamName;
        if (userAvatarEl) userAvatarEl.src = userAvatar;
        if (oppAvatarEl) oppAvatarEl.src = oppAvatar;

        if (leagueTitleEl) leagueTitleEl.textContent = `${league?.name || 'Sleeper League'} • Matchup`;
        if (leagueSubEl) leagueSubEl.textContent = `${userTeamName} vs. ${oppTeamName} • Week ${week}`;
        if (simTitleBadgeEl) simTitleBadgeEl.textContent = `PRE-KICKOFF • WEEK ${week} OPTIMIZER`;
      }

      this.recomputeOptimization();
      this.loadWaiverTargets();
    } catch (err) {
      console.error('Error loading matchup data:', err);
    }
  }

  /**
   * Ingest Live Gameday Points and Game Clock States
   */
  resolveLivePlayerGamedayState(player, matchup = null) {
    if (!player) return player;
    const sched = player.gameSchedule || getGameScheduleInfo(player.team, this.state.week, this.state.liveSchedule);

    // Extract live fantasy points from Sleeper matchup
    const pid = String(player.player_id);
    let pointsScored = 0;
    if (matchup?.players_points && typeof matchup.players_points[pid] === 'number') {
      pointsScored = matchup.players_points[pid];
    } else if (player.points_scored !== undefined) {
      pointsScored = player.points_scored;
    } else if (player.actual_pts !== undefined) {
      pointsScored = player.actual_pts;
    }

    // Determine live game status
    let gameState = player.gameState || 'UPCOMING';
    const statusState = sched?.statusState || 'pre';
    const statusDetail = String(sched?.statusDetail || '');
    const period = sched?.period || 0;
    const displayClock = sched?.displayClock || '';

    if (this.state.isLiveDemo) {
      gameState = player.gameState || 'UPCOMING';
    } else if (player.isFinal || player.is_final || (statusState === 'post' && pointsScored > 0)) {
      gameState = 'FINAL';
    } else if (player.isLive || player.is_live || (statusState === 'in' && period > 0) || (pointsScored > 0 && (statusDetail.includes('Q') || statusDetail.includes('Half')))) {
      gameState = 'IN_PROGRESS';
    } else {
      gameState = 'UPCOMING';
    }

    const quarterLabel = player.gameQuarter || (period ? (period <= 4 ? `${period}Q` : 'OT') : (statusDetail.includes('Half') ? 'HALF' : '3Q'));
    const clockLabel = player.gameClock || displayClock || (statusDetail.includes(' ') ? statusDetail.split(' ').pop() : '8:45');

    return {
      ...player,
      base_projected_pts: player.base_projected_pts ?? player.projected_pts,
      points_scored: Number(pointsScored.toFixed(1)),
      actual_pts: Number(pointsScored.toFixed(1)),
      gameState,
      gameQuarter: quarterLabel,
      gameClock: clockLabel,
      gameSchedule: sched
    };
  }

  /**
   * 3-Way Segmented Strategy Mode Handler (floor, balanced, ceiling)
   */
  onStrategyModeChange(mode) {
    if (!['floor', 'balanced', 'ceiling'].includes(mode)) mode = 'balanced';
    this.state.strategyMode = mode;
    this.state.strategyWeight = (mode === 'floor' ? 0 : mode === 'ceiling' ? 1 : 0.5);

    // Track strategy pill switch event
    this.trackEvent(`strategy-pill-${mode}`, `Switched Strategy Pill to ${mode.toUpperCase()}`);

    // Update pill UI classes
    document.querySelectorAll('.strategy-pill').forEach(btn => {
      if (btn.dataset.mode === mode) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Re-solve optimal lineup and apply instantly
    this.optimizeLineup(mode);
  }

  /**
   * Solve & Apply Optimal Lineup for the Chosen Strategy Mode
   */
  optimizeLineup(mode = 'balanced') {
    // 1. Solve optimal starting roster for the selected mode with late-swap FLEX & slot stability
    const optimalSolution = solveOptimalLineup(this.state.userPlayers, mode, this.state.starterSlots, {
      week: this.state.week,
      liveSchedule: this.state.liveSchedule,
      currentStarters: this.state.userStarters
    });
    this.state.optimalSolution = optimalSolution;

    // Apply optimal starters and bench directly to state
    this.state.userStarters = [...optimalSolution.starters];
    this.state.userBench = [...optimalSolution.bench];

    const modeLabels = {
      floor: 'Safe Floor (10th %ile)',
      balanced: 'Balanced E[X] Projections',
      ceiling: 'Max Upside (90th %ile)'
    };
    this.showToast(`Lineup optimized for ${modeLabels[mode] || mode}! 🐾`);

    // 2. Re-simulate and re-render dashboard
    this.recomputeOptimization();
  }

  /**
   * Team View Toggle Handler (Your Lineup vs Opponent)
   */
  onTeamViewChange(view) {
    this.state.activeView = view;

    // Track lineup view toggle event
    this.trackEvent(`toggle-lineup-view-${view}`, `Toggled Lineup View to ${view === 'opp' ? 'Opponent' : 'User'}`);

    const userBtn = document.getElementById('viewUserBtn');
    const oppBtn = document.getElementById('viewOppBtn');
    const strategyGroup = document.getElementById('strategyPillGroup');
    const startersTitle = document.getElementById('startersTableTitle');
    const startersBadge = document.getElementById('startersTableBadge');
    const benchTitle = document.getElementById('benchTableTitle');

    if (userBtn) userBtn.classList.toggle('active', view === 'user');
    if (oppBtn) oppBtn.classList.toggle('active', view === 'opp');

    if (view === 'opp') {
      if (strategyGroup) strategyGroup.classList.add('disabled');
      if (startersTitle) startersTitle.textContent = `${this.state.oppTeamName || 'Opponent'} Starting Lineup`;
      if (startersBadge) {
        startersBadge.textContent = 'OPPONENT';
        startersBadge.className = 'fmt-badge';
        startersBadge.style.color = '#38bdf8';
        startersBadge.style.borderColor = 'rgba(56,189,248,0.3)';
        startersBadge.style.background = 'rgba(56,189,248,0.12)';
      }
      if (benchTitle) benchTitle.textContent = `${this.state.oppTeamName || 'Opponent'} Bench & Reserves`;

      this.renderStartersTable(this.state.oppStarters, null, null, true);
      this.renderBenchTable(this.state.oppBench, null, null, true);
    } else {
      if (strategyGroup) strategyGroup.classList.remove('disabled');
      if (startersTitle) startersTitle.textContent = 'Active Starting Lineup';
      if (startersBadge) {
        startersBadge.textContent = 'STARTERS';
        startersBadge.className = 'fmt-badge active';
        startersBadge.style.color = '';
        startersBadge.style.borderColor = '';
        startersBadge.style.background = '';
      }
      if (benchTitle) benchTitle.textContent = 'Bench & Reserves';

      this.renderStartersTable(this.state.userStarters, this.state.optimalSolution, this.state.bowieDossier, false);
      this.renderBenchTable(this.state.userBench, this.state.optimalSolution, this.state.bowieDossier, false);
    }
  }

  recomputeOptimization() {
    const currentMode = this.state.strategyMode || 'balanced';

    // 1. Solve optimal starting lineup mapped to immutable starterSlots template
    const optimalSolution = solveOptimalLineup(this.state.userPlayers, currentMode, this.state.starterSlots, {
      week: this.state.week,
      liveSchedule: this.state.liveSchedule,
      currentStarters: this.state.userStarters
    });
    this.state.optimalSolution = optimalSolution;

    // 2. Identify recommended Sit / Start swaps
    const recommendedSwaps = identifyLineupSwaps(
      this.state.userStarters,
      optimalSolution.starters,
      this.state.userPlayers,
      this.state.strategyWeight
    );
    this.state.recommendedSwaps = recommendedSwaps;

    // 3. Run 10,000x Monte Carlo Simulation
    const simResults = runMonteCarloSimulation(this.state.userStarters, this.state.oppStarters, 10000);
    this.state.simResults = simResults;

    // 4. Scout Bowie Tactical Dossier
    const bowieDossier = scoutBowie.generateMatchupDossier(
      this.state.userStarters,
      this.state.userBench,
      this.state.oppStarters,
      simResults,
      this.state.strategyWeight,
      optimalSolution?.starters || []
    );
    this.state.bowieDossier = bowieDossier;

    // 5. Render UI Components
    if (typeof document !== 'undefined') {
      this.renderScoreboard(simResults);
      this.renderScoutBowie(bowieDossier);
      this.renderSwapsBanner(recommendedSwaps);

      if (this.state.activeView === 'opp') {
        this.onTeamViewChange('opp');
      } else {
        this.renderStartersTable(this.state.userStarters, optimalSolution, bowieDossier, false);
        this.renderBenchTable(this.state.userBench, optimalSolution, bowieDossier, false);
      }

      this.renderDensityChart(simResults);
      this.runGamedayAlertSweeps();
    }
  }

  renderScoreboard(simResults) {
    const { winProbability, spread, userStats, oppStats, execTimeMs } = simResults;

    const winProbEl = document.getElementById('winProbNumber');
    const meterFillEl = document.getElementById('meterFill');
    const spreadTextEl = document.getElementById('spreadText');
    const userProjPtsEl = document.getElementById('userProjPts');
    const oppProjPtsEl = document.getElementById('oppProjPts');
    const simPerfTextEl = document.getElementById('simPerfText');
    const userFloorTotalEl = document.getElementById('userFloorTotal');
    const userCeilTotalEl = document.getElementById('userCeilTotal');

    if (winProbEl) {
      winProbEl.textContent = `${winProbability}%`;
      winProbEl.style.color = winProbability >= 50 ? 'var(--accent)' : 'var(--caution)';
    }

    if (meterFillEl) {
      meterFillEl.style.width = `${winProbability}%`;
    }

    if (spreadTextEl) {
      const spreadSign = spread >= 0 ? `-${Math.abs(spread)}` : `+${Math.abs(spread)}`;
      spreadTextEl.textContent = `SPREAD: ${spreadSign} | TOTAL EXP: ${simResults.totalOverUnder} pts`;
    }

    // Banked vs Projected Score Calculation
    const startersList = [...(this.state.userStarters || []), ...(this.state.oppStarters || [])];
    const userBanked = (this.state.userStarters || []).reduce((acc, p) => acc + (p.points_scored || p.points_banked || p.actual_pts || p.actual_points || 0), 0);
    const oppBanked = (this.state.oppStarters || []).reduce((acc, p) => acc + (p.points_scored || p.points_banked || p.actual_pts || p.actual_points || 0), 0);

    // Automatic Matchup State Detection
    const hasLiveGames = startersList.some(p => p.is_live || p.isLive || p.gameState === 'IN_PROGRESS' || (p.points_scored || p.points_banked || p.actual_pts || p.actual_points) > 0);
    const hasFinalGames = startersList.some(p => p.is_final || p.isFinal || p.gameState === 'FINAL');
    const allGamesFinished = startersList.length > 0 && startersList.every(p => p.is_final || p.isFinal || p.gameState === 'FINAL');
    const isLiveGameday = (hasLiveGames || hasFinalGames || userBanked > 0 || oppBanked > 0) && !allGamesFinished;

    const isDemo = Boolean(this.state.isDemoMode || this.state.currentLeague?.league_id === 'demo_championship_league_2025');

    // 1. Render Automatic Status Indicator Badge
    const statusBadgeEl = document.getElementById('matchup-status-badge');
    if (statusBadgeEl) {
      if (allGamesFinished) {
        statusBadgeEl.innerHTML = `<span class="badge-final">🏁 MATCHUP FINAL</span>`;
      } else if (isLiveGameday) {
        statusBadgeEl.innerHTML = `<span class="badge-live"><span class="pulse-dot" style="background:#ef4444;"></span> LIVE GAMEDAY</span>`;
      } else {
        statusBadgeEl.innerHTML = `<span class="badge-pregame">⚡ PRE-KICKOFF OPTIMIZER</span>`;
      }
    }

    // 2. Render Demo Toggle Switch (if in demo mode)
    const demoToggleContainer = document.getElementById('demo-toggle-container');
    const demoTogglePre = document.getElementById('demoTogglePre');
    const demoToggleLive = document.getElementById('demoToggleLive');
    if (demoToggleContainer) {
      if (isDemo) {
        demoToggleContainer.style.display = 'inline-flex';
        if (demoTogglePre && demoToggleLive) {
          if (this.state.isLiveDemo) {
            demoTogglePre.className = 'demo-toggle-segment';
            demoToggleLive.className = 'demo-toggle-segment active live';
          } else {
            demoTogglePre.className = 'demo-toggle-segment active pre';
            demoToggleLive.className = 'demo-toggle-segment';
          }
        }
      } else {
        demoToggleContainer.style.display = 'none';
      }
    }

    // 3. Render Top Format Badge
    const simTitleBadgeEl = document.getElementById('simTitleBadge') || document.getElementById('weekBadge');
    if (simTitleBadgeEl) {
      if (allGamesFinished) {
        simTitleBadgeEl.innerHTML = `MATCHUP FINAL &middot; WEEK ${this.state.week}`;
      } else if (isLiveGameday) {
        simTitleBadgeEl.innerHTML = `<span style="color:#ef4444;font-weight:800;display:inline-flex;align-items:center;gap:6px;"><span class="pulse-dot" style="background:#ef4444;"></span> LIVE GAMEDAY TRACKER &middot; WEEK ${this.state.week}</span>`;
      } else {
        simTitleBadgeEl.innerHTML = `PRE-KICKOFF &middot; WEEK ${this.state.week} OPTIMIZER`;
      }
    }

    if (userProjPtsEl) {
      if (isLiveGameday) {
        userProjPtsEl.innerHTML = `<span>${userStats.mean} pts</span> <span style="font-size:11.5px;color:#38bdf8;font-weight:700;margin-left:4px;">(Banked: ${userBanked.toFixed(1)})</span>`;
      } else {
        userProjPtsEl.textContent = `${userStats.mean} pts`;
      }
    }

    if (oppProjPtsEl) {
      if (isLiveGameday) {
        oppProjPtsEl.innerHTML = `<span>${oppStats.mean} pts</span> <span style="font-size:11.5px;color:#38bdf8;font-weight:700;margin-left:4px;">(Banked: ${oppBanked.toFixed(1)})</span>`;
      } else {
        oppProjPtsEl.textContent = `${oppStats.mean} pts`;
      }
    }

    if (simPerfTextEl) simPerfTextEl.textContent = `10k SIMS IN ${execTimeMs}ms`;

    if (userFloorTotalEl && userCeilTotalEl) {
      const totalFloor = (this.state.userStarters || []).reduce((acc, p) => {
        const dist = calculatePlayerDistributions(p);
        return acc + dist.floor10;
      }, 0);
      const totalCeil = (this.state.userStarters || []).reduce((acc, p) => {
        const dist = calculatePlayerDistributions(p);
        return acc + dist.ceiling90;
      }, 0);

      userFloorTotalEl.textContent = `${totalFloor.toFixed(1)} pts`;
      userCeilTotalEl.textContent = `${totalCeil.toFixed(1)} pts`;
    }
  }

  /**
   * Toggle Live Gameday Interactive Simulation Scenario (Dual-State Demo)
   */
  toggleLiveGamedayDemo() {
    this.state.isLiveDemo = !this.state.isLiveDemo;
    this.state.isLiveGamedayMode = this.state.isLiveDemo;

    if (this.state.isLiveDemo) {
      // Mid-Sunday NFL Live Gameday Progress State (Finals, Live 3Q/4Q, Late Games)
      const liveScenarioMap = {
        // Quantum Blitz Starters
        'p_josh_allen': { gameState: 'IN_PROGRESS', points_scored: 16.8, gameQuarter: '3Q', gameClock: '6:14', remainingFraction: 0.38, isFinal: false, is_final: false, is_live: true, isLive: true },
        'p_cmc': { gameState: 'FINAL', points_scored: 24.8, isFinal: true, is_final: true, remainingFraction: 0, is_live: false, isLive: false },
        'p_deandre_swift': { gameState: 'UPCOMING', points_scored: 0.0, isFinal: false, is_final: false, remainingFraction: 1.0, is_live: false, isLive: false },
        'p_amonra': { gameState: 'IN_PROGRESS', points_scored: 15.2, gameQuarter: '4Q', gameClock: '11:20', remainingFraction: 0.20, isFinal: false, is_final: false, is_live: true, isLive: true },
        'p_justin_jefferson': { gameState: 'UPCOMING', points_scored: 0.0, isFinal: false, is_final: false, remainingFraction: 1.0, is_live: false, isLive: false },
        'p_sam_laporta': { gameState: 'FINAL', points_scored: 15.6, isFinal: true, is_final: true, remainingFraction: 0, is_live: false, isLive: false },
        'p_devonta_smith': { gameState: 'IN_PROGRESS', points_scored: 10.4, gameQuarter: '3Q', gameClock: '4:30', remainingFraction: 0.35, isFinal: false, is_final: false, is_live: true, isLive: true },
        'p_brandon_aubrey': { gameState: 'UPCOMING', points_scored: 0.0, isFinal: false, is_final: false, remainingFraction: 1.0, is_live: false, isLive: false },
        'p_baltimore_def': { gameState: 'UPCOMING', points_scored: 0.0, isFinal: false, is_final: false, remainingFraction: 1.0, is_live: false, isLive: false },

        // Quantum Blitz Bench
        'p_malik_nabers': { gameState: 'FINAL', points_scored: 21.4, isFinal: true, is_final: true, remainingFraction: 0, is_live: false, isLive: false },
        'p_brock_bowers': { gameState: 'FINAL', points_scored: 14.2, isFinal: true, is_final: true, remainingFraction: 0, is_live: false, isLive: false },
        'p_cj_stroud': { gameState: 'IN_PROGRESS', points_scored: 14.8, gameQuarter: '3Q', gameClock: '5:40', remainingFraction: 0.40, isFinal: false, is_final: false, is_live: true, isLive: true },
        'p_jaxon_smith': { gameState: 'UPCOMING', points_scored: 0.0, isFinal: false, is_final: false, remainingFraction: 1.0, is_live: false, isLive: false },
        'p_zach_charbonnet': { gameState: 'UPCOMING', points_scored: 0.0, isFinal: false, is_final: false, remainingFraction: 1.0, is_live: false, isLive: false },

        // Apex Predators Starters
        'p_lamar_jackson': { gameState: 'IN_PROGRESS', points_scored: 15.6, gameQuarter: '3Q', gameClock: '8:15', remainingFraction: 0.42, isFinal: false, is_final: false, is_live: true, isLive: true },
        'p_saquon_barkley': { gameState: 'FINAL', points_scored: 22.4, isFinal: true, is_final: true, remainingFraction: 0, is_live: false, isLive: false },
        'p_breece_hall': { gameState: 'UPCOMING', points_scored: 0.0, isFinal: false, is_final: false, remainingFraction: 1.0, is_live: false, isLive: false },
        'p_ceedee_lamb': { gameState: 'IN_PROGRESS', points_scored: 14.8, gameQuarter: '4Q', gameClock: '9:45', remainingFraction: 0.20, isFinal: false, is_final: false, is_live: true, isLive: true },
        'p_jamarr_chase': { gameState: 'IN_PROGRESS', points_scored: 11.2, gameQuarter: '3Q', gameClock: '2:10', remainingFraction: 0.35, isFinal: false, is_final: false, is_live: true, isLive: true },
        'p_travis_kelce': { gameState: 'UPCOMING', points_scored: 0.0, isFinal: false, is_final: false, remainingFraction: 1.0, is_live: false, isLive: false },
        'p_niko_collins': { gameState: 'UPCOMING', points_scored: 0.0, isFinal: false, is_final: false, remainingFraction: 1.0, is_live: false, isLive: false },
        'p_justin_tucker': { gameState: 'UPCOMING', points_scored: 0.0, isFinal: false, is_final: false, remainingFraction: 1.0, is_live: false, isLive: false },
        'p_sf_def': { gameState: 'FINAL', points_scored: 9.0, isFinal: true, is_final: true, remainingFraction: 0, is_live: false, isLive: false }
      };

      const applyLiveState = (p, fallbackIdx = 0) => {
        const live = liveScenarioMap[p.player_id];
        if (live) {
          return {
            ...p,
            ...live,
            actual_pts: live.points_scored,
            points_banked: live.points_scored
          };
        }
        const base = Number(p.base_projected_pts ?? p.projected_pts ?? 12);
        if (fallbackIdx < 3) {
          const finalScore = Number((base * 1.15).toFixed(1));
          return { ...p, gameState: 'FINAL', points_scored: finalScore, actual_pts: finalScore, points_banked: finalScore, remainingFraction: 0, isFinal: true, is_final: true };
        } else if (fallbackIdx < 6) {
          const banked = Number((base * 0.65).toFixed(1));
          return { ...p, gameState: 'IN_PROGRESS', points_scored: banked, actual_pts: banked, points_banked: banked, gameQuarter: '3Q', gameClock: '8:45', remainingFraction: 0.38, isFinal: false, is_final: false, is_live: true };
        } else {
          return { ...p, gameState: 'UPCOMING', points_scored: 0.0, actual_pts: 0.0, points_banked: 0.0, remainingFraction: 1.0, isFinal: false, is_final: false, is_live: false };
        }
      };

      this.state.userStarters = this.state.userStarters.map((p, idx) => applyLiveState(p, idx));
      this.state.userBench = (this.state.userBench || []).map((p, idx) => applyLiveState(p, idx + 9));
      this.state.oppStarters = this.state.oppStarters.map((p, idx) => applyLiveState(p, idx));
      this.state.oppBench = (this.state.oppBench || []).map((p, idx) => applyLiveState(p, idx + 9));

      this.showToast("🔴 Switched to Live Gameday Simulation! (Mixed Final + Live 3Q/4Q + Late Games) 🐾");
    } else {
      const resetToUpcoming = (p) => ({
        ...p,
        gameState: 'UPCOMING',
        points_scored: 0.0,
        actual_pts: 0.0,
        points_banked: 0.0,
        actual_points: 0.0,
        remainingFraction: 1.0,
        isFinal: false,
        is_final: false,
        isLive: false,
        is_live: false
      });

      this.state.userStarters = this.state.userStarters.map(resetToUpcoming);
      this.state.userBench = (this.state.userBench || []).map(resetToUpcoming);
      this.state.oppStarters = this.state.oppStarters.map(resetToUpcoming);
      this.state.oppBench = (this.state.oppBench || []).map(resetToUpcoming);

      this.showToast("⚡ Switched to Pre-Kickoff Optimizer! (Full ranges & unbanked projections) 🐾");
    }

    this.recomputeOptimization();
  }

  renderScoutBowie(dossier) {
    const { lockAlert, trapAlert, boomAlert, benchWildcard, directive } = dossier;

    const lockPlayer = document.getElementById('lockPlayerName');
    const lockDesc = document.getElementById('lockDesc');
    const lockConf = document.getElementById('lockConf');

    const trapPlayer = document.getElementById('trapPlayerName');
    const trapDesc = document.getElementById('trapDesc');
    const trapRisk = document.getElementById('trapRisk');

    const boomPlayer = document.getElementById('boomPlayerName');
    const boomDesc = document.getElementById('boomDesc');
    const boomSurge = document.getElementById('boomSurge');

    const wildcardCard = document.getElementById('wildcardCard');
    const wildcardPlayer = document.getElementById('wildcardPlayerName');
    const wildcardDesc = document.getElementById('wildcardDesc');
    const wildcardSurge = document.getElementById('wildcardSurge');

    const bowieTip = document.getElementById('bowieScoutTip');

    if (lockPlayer && lockAlert) {
      lockPlayer.textContent = lockAlert.headline;
      lockDesc.textContent = lockAlert.analysis;
      lockConf.textContent = lockAlert.confidence;
    }

    if (trapPlayer && trapAlert) {
      trapPlayer.textContent = trapAlert.headline;
      trapDesc.textContent = trapAlert.analysis;
      trapRisk.textContent = trapAlert.riskLevel;
    }

    if (boomPlayer && boomAlert) {
      boomPlayer.textContent = boomAlert.headline;
      boomDesc.textContent = boomAlert.analysis;
      boomSurge.textContent = boomAlert.upsideRating;
    }

    if (wildcardCard) {
      if (benchWildcard) {
        wildcardCard.style.display = 'block';
        if (wildcardPlayer) wildcardPlayer.textContent = benchWildcard.headline;
        if (wildcardDesc) wildcardDesc.textContent = benchWildcard.analysis;
        if (wildcardSurge) wildcardSurge.textContent = benchWildcard.ceilingPotential;
      } else {
        wildcardCard.style.display = 'none';
      }
    }

    if (bowieTip && directive) {
      bowieTip.textContent = `"${directive.advice}" 🐾`;
    }
  }

  renderSwapsBanner(swaps) {
    const banner = document.getElementById('swapsBanner');
    const list = document.getElementById('swapsList');
    const applyBtn = document.getElementById('btn-apply-optimal') || (banner ? banner.querySelector('button') : null);

    if (!banner || !list) return;

    banner.style.display = 'flex';

    if (!swaps || swaps.length === 0) {
      list.innerHTML = `<span style="color:var(--accent);font-weight:600;">✓ Current lineup is 100% optimal for this strategy weight.</span>`;
      if (applyBtn) {
        applyBtn.disabled = true;
        applyBtn.style.opacity = '0.45';
        applyBtn.style.cursor = 'default';
        applyBtn.textContent = 'Lineup Optimal ✓';
      }
    } else {
      list.innerHTML = swaps.map(s => `
        <div style="display:inline-flex;align-items:center;gap:6px;">
          <span class="fmt-badge active" style="background:rgba(79,209,165,0.15);color:var(--accent);font-weight:800;">START ${s.playerToStart.full_name} (${s.playerToStart.position})</span>
          <span style="color:var(--muted);font-size:11px;">over</span>
          <span class="fmt-badge" style="background:rgba(229,99,107,0.15);color:var(--caution);">${s.playerToBench.full_name}</span>
          <span style="color:var(--gold);font-size:11px;">(${s.reason})</span>
        </div>
      `).join('');
      if (applyBtn) {
        applyBtn.disabled = false;
        applyBtn.style.opacity = '1';
        applyBtn.style.cursor = 'pointer';
        applyBtn.textContent = 'Apply Optimal Lineup ➔';
      }
    }
  }

  /**
   * Determine Scout Alert Badge with Lock, Bark Warn, Boom, Optimal precedence
   */
  getScoutAlertBadge(player, optimalStarterIds, dossier) {
    const isOptimal = !optimalStarterIds || optimalStarterIds.size === 0 || optimalStarterIds.has(player.player_id);

    // If starter is SUB-OPTIMAL (there is a superior bench option):
    if (!isOptimal) {
      const swap = (this.state.recommendedSwaps || []).find(s => s.playerToBench?.player_id === player.player_id);
      if (swap && swap.playerToStart) {
        const sName = getCleanPlayerName(swap.playerToStart.full_name).split(' ').pop().toUpperCase();
        return `<span class="badge-suboptimal fmt-badge" style="color:var(--caution);border-color:rgba(229,99,107,0.4);background:rgba(229,99,107,0.15);font-size:9.5px;font-weight:800;" title="Suboptimal: Start ${swap.playerToStart.full_name} instead">⚠️ START ${sName}</span>`;
      }
      return '<span class="badge-suboptimal fmt-badge" style="color:var(--caution);border-color:rgba(229,99,107,0.4);background:rgba(229,99,107,0.15);font-size:9.5px;font-weight:800;">⚠️ SUB-OPTIMAL</span>';
    }

    const lockId = dossier?.lockAlert?.player?.player_id;
    const trapId = dossier?.trapAlert?.player?.player_id;
    const boomId = dossier?.boomAlert?.player?.player_id;

    if (player.player_id === lockId) {
      return '<span class="badge-lock golden-bone-badge">🐾 LOCK</span>';
    }
    if (player.player_id === trapId) {
      return '<span class="badge-warn bowie-bark-badge">⚠️ BARK WARN</span>';
    }
    if (player.player_id === boomId) {
      return '<span class="badge-boom boom-candidate-badge">🚀 BOOM</span>';
    }
    return '<span class="badge-optimal fmt-badge active" style="font-size:9.5px;">OPTIMAL</span>';
  }

  /**
   * Render Starters Table Rows with In-Place Swap Dropdowns (or read-only for Opponent)
   */
  renderStartersTable(starters, optimalSolution, dossier, isOpponent = false) {
    const startersBody = document.getElementById('startersTableBody');
    if (!startersBody) return;

    if (!isOpponent) {
      optimalSolution = optimalSolution || this.state.optimalSolution;
      dossier = dossier || this.state.bowieDossier;
    }

    if (!starters || starters.length === 0) {
      startersBody.innerHTML = `<tr><td colspan="6" class="empty-state">No starting players found on this roster.</td></tr>`;
      return;
    }

    const optimalStarterIds = new Set((optimalSolution?.starters || []).map(p => p.player_id));

    startersBody.innerHTML = starters.map((player, slotIdx) => {
      const dist = calculatePlayerDistributions(player);
      const slotType = (this.state.starterSlots && this.state.starterSlots[slotIdx]) || player.slot || player.slotAssigned || player.position || 'FLEX';
      const isFlex = slotType === 'FLEX' || slotType === 'WRRB_FLEX' || slotType === 'REC_FLEX' || slotType === 'FLX';
      const displaySlot = isFlex ? 'FLEX' : slotType;
      const posClass = isFlex ? 'pos-FLEX slot-flex' : `pos-${slotType}`;
      const alertBadge = isOpponent ? '<span class="text-muted">—</span>' : this.getScoutAlertBadge(player, optimalStarterIds, dossier);
      const sched = getGameScheduleInfo(player.team, this.state.week, this.state.liveSchedule);
      const cleanName = getCleanPlayerName(player.full_name);
      
      // Dynamic live gameday status badge
      let statusBadge = getPlayerStatusBadge(player.injury_status);
      if (dist.gameState === 'IN_PROGRESS') {
        statusBadge = `<span class="badge-live-pulse" title="Live NFL Game Active"><span class="live-dot"></span> ${dist.gameQuarter || '3Q'} ${dist.gameClock || '8:45'}</span><span class="badge-pts-banked">${(dist.points_scored || 0).toFixed(1)} pts</span>`;
      } else if (dist.gameState === 'FINAL' || dist.isFinal) {
        statusBadge = `<span class="badge-final" title="Game Final"><span style="font-size:9.5px;">🏁</span> FINAL &middot; ${(dist.points_scored || 0).toFixed(1)} pts</span>`;
      }

      const rangeBarHtml = renderProjectionRangeBar(dist);
      const avatarUrl = player.avatar || 'https://sleepercdn.com/images/v2/icons/player_default.webp';

      const isPreviewingThisSlot = !isOpponent && this.state.activeSwapPreview && this.state.activeSwapPreview.slotIdx === slotIdx;
      const candidate = isPreviewingThisSlot ? this.state.activeSwapPreview.candidate : null;
      const candDist = candidate ? calculatePlayerDistributions(candidate) : null;
      const candCleanName = candidate ? getCleanPlayerName(candidate.full_name) : '';
      const candAvatar = candidate ? (candidate.avatar || 'https://sleepercdn.com/images/v2/icons/player_default.webp') : null;

      let playerCellHtml = '';
      let rangeCellHtml = '';
      let alertCellHtml = '';
      let actionCellHtml = '';

      if (isPreviewingThisSlot && candidate && candDist) {
        const projDelta = Number((candDist.mean - dist.mean).toFixed(1));
        const floorDelta = Number((candDist.floor10 - dist.floor10).toFixed(1));
        const ceilDelta = Number((candDist.ceiling90 - dist.ceiling90).toFixed(1));

        playerCellHtml = `
          <div style="display:flex;align-items:center;gap:8px;width:100%;">
            <div style="position:relative;width:34px;height:34px;flex-shrink:0;">
              <img src="${candAvatar}" class="player-thumb" style="width:34px;height:34px;border:1.5px solid var(--accent);" alt="${candCleanName}">
              <img src="${avatarUrl}" style="position:absolute;bottom:-3px;right:-3px;width:16px;height:16px;border-radius:50%;border:1px solid #0f172a;opacity:0.85;" title="Replacing ${cleanName}">
            </div>
            <div style="min-width:0;flex:1;">
              <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
                <span style="font-weight:800;color:var(--accent);">${candCleanName}</span>
                <span style="font-size:10px;color:var(--muted);text-decoration:line-through;">${cleanName}</span>
              </div>
              <div style="font-size:11px;color:#94a3b8;">${candidate.position} - ${candidate.team || 'FA'} &bull; vs ${candidate.opponent || 'OPP'}</div>
            </div>
          </div>
        `;

        rangeCellHtml = `
          <div style="display:flex;flex-direction:column;gap:3px;min-width:180px;">
            ${renderProjectionRangeBar(candDist)}
            <div class="preview-delta-bar">
              <span class="preview-delta-pill ${floorDelta > 0.3 ? 'pos' : floorDelta < -0.3 ? 'neg' : 'neu'}">Floor: ${floorDelta >= 0 ? '+' : ''}${floorDelta.toFixed(1)}</span>
              <span class="preview-delta-pill ${projDelta > 0.3 ? 'pos' : projDelta < -0.3 ? 'neg' : 'neu'}">Exp: ${projDelta >= 0 ? '+' : ''}${projDelta.toFixed(1)}</span>
              <span class="preview-delta-pill ${ceilDelta > 0.3 ? 'pos' : ceilDelta < -0.3 ? 'neg' : 'neu'}">Ceil: ${ceilDelta >= 0 ? '+' : ''}${ceilDelta.toFixed(1)}</span>
            </div>
          </div>
        `;

        alertCellHtml = `<span class="badge-preview-tag" style="background:rgba(79,209,165,0.18);border:1px solid rgba(79,209,165,0.4);color:var(--accent);font-size:10px;font-weight:800;padding:2px 6px;border-radius:4px;white-space:nowrap;">PREVIEWING</span>`;

        actionCellHtml = `
          <td class="col-swap col-action" onclick="event.stopPropagation();">
            <div style="display:flex;align-items:center;gap:6px;width:100%;">
              <button class="btn-ghost-cancel" onclick="window.onCancelSwapPreview(${slotIdx})" title="Cancel swap preview">✕ Cancel</button>
              <button class="btn-ghost-confirm" onclick="window.onConfirmSwap(${slotIdx}, '${candidate.player_id}')" title="Confirm lineup swap">✔️ Confirm</button>
            </div>
          </td>
        `;
      } else {
        playerCellHtml = `
          <div style="display:flex;align-items:center;gap:8px;width:100%;">
            <img src="${avatarUrl}" class="player-thumb" alt="${cleanName}" onerror="this.src='https://sleepercdn.com/images/v2/icons/player_default.webp'">
            <div style="min-width:0;flex:1;">
              <div style="font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${cleanName}</div>
              <div>${sched.html}</div>
            </div>
          </div>
        `;

        rangeCellHtml = rangeBarHtml;
        alertCellHtml = alertBadge;

        if (isOpponent) {
          actionCellHtml = `
            <td class="col-swap col-action" onclick="event.stopPropagation();">
              <span class="badge-status healthy" style="background:rgba(56,189,248,0.12);border-color:rgba(56,189,248,0.3);color:#38bdf8;font-size:10px;padding:4px 8px;font-weight:700;letter-spacing:0.02em;">OPP STARTER</span>
            </td>
          `;
        } else {
          // Find all eligible bench players for this specific slot
          const eligibleBench = (this.state.userBench || []).filter(b => 
            isPlayerEligibleForSlot(b.position, slotType)
          );

          let dropdownOptions = `
            <option value="${player.player_id}" selected>
              ✓ Active: ${cleanName} (${player.position} | ${dist.mean} pts)
            </option>
          `;

          if (eligibleBench.length > 0) {
            dropdownOptions += eligibleBench.map(b => {
              const bDist = calculatePlayerDistributions(b);
              const bCleanName = getCleanPlayerName(b.full_name);
              return `<option value="${b.player_id}">➔ Swap: ${bCleanName} (${b.position} - ${b.team} | ${bDist.mean} pts)</option>`;
            }).join('');
          } else {
            dropdownOptions += `<option disabled>(No eligible bench players)</option>`;
          }

          actionCellHtml = `
            <td class="col-swap col-action" onclick="event.stopPropagation();">
              <select class="select-input starter-swap-select" style="padding:5px 8px;font-size:11.5px;width:100%;cursor:pointer;" onchange="window.onStarterDropdownChange(${slotIdx}, this.value)">
                ${dropdownOptions}
              </select>
            </td>
          `;
        }
      }

      return `
        <tr class="suggest-row player-row ${isPreviewingThisSlot ? 'ghost-preview-row' : ''}" onclick="openPlayerDrawer('${(candidate && isPreviewingThisSlot) ? candidate.player_id : player.player_id}')">
          <td class="col-slot"><span class="pos-tag ${posClass}">${displaySlot}</span></td>
          <td class="col-player">${playerCellHtml}</td>
          <td class="col-status">${statusBadge}</td>
          <td class="col-range">${rangeCellHtml}</td>
          <td class="col-scout-alert col-alert">${alertCellHtml}</td>
          ${actionCellHtml}
        </tr>
      `;
    }).join('');
  }

  /**
   * Two-Way Dropdown Swap Handler (Two-Stage Preview & Confirm)
   */
  onStarterDropdownChange(slotIdx, newPlayerId) {
    if (!newPlayerId) return;

    const currentStarter = this.state.userStarters[slotIdx];
    if (!currentStarter) return;

    if (currentStarter.player_id === newPlayerId) {
      // User selected active starter again -> cancel preview
      this.state.activeSwapPreview = null;
      this.renderStartersTable(this.state.userStarters, this.state.optimalSolution, this.state.bowieDossier, false);
      return;
    }

    const newBenchPlayer = (this.state.userBench || []).find(p => p.player_id === newPlayerId);
    if (!newBenchPlayer) return;

    const slotType = (this.state.starterSlots && this.state.starterSlots[slotIdx]) || currentStarter.slotAssigned || currentStarter.position || 'FLEX';

    // Strict Positional Verification
    if (!isPlayerEligibleForSlot(newBenchPlayer.position, slotType)) {
      alert(`${newBenchPlayer.full_name} (${newBenchPlayer.position}) is not eligible for the ${slotType} slot.`);
      this.state.activeSwapPreview = null;
      this.renderStartersTable(this.state.userStarters, this.state.optimalSolution, this.state.bowieDossier, false);
      return;
    }

    // Activate visual comparison preview without mutating lineup yet
    this.state.activeSwapPreview = {
      slotIdx,
      currentStarter,
      candidate: newBenchPlayer,
      candidateId: newPlayerId
    };

    this.renderStartersTable(this.state.userStarters, this.state.optimalSolution, this.state.bowieDossier, false);
  }

  /**
   * Confirm and Commit the Lineup Swap
   */
  onConfirmSwap(slotIdx, newPlayerId) {
    if (!newPlayerId) return;

    const currentStarter = this.state.userStarters[slotIdx];
    if (!currentStarter) return;

    const newBenchPlayer = (this.state.userBench || []).find(p => p.player_id === newPlayerId);
    if (!newBenchPlayer) return;

    const slotType = (this.state.starterSlots && this.state.starterSlots[slotIdx]) || currentStarter.slotAssigned || currentStarter.position || 'FLEX';

    // Perform two-way swap
    newBenchPlayer.slotAssigned = slotType;
    currentStarter.slotAssigned = 'BN';

    // Replace starter in exact slot
    this.state.userStarters[slotIdx] = newBenchPlayer;

    // Replace bench player with previous starter
    this.state.userBench = this.state.userBench.filter(p => p.player_id !== newPlayerId);
    this.state.userBench.push(currentStarter);

    // Clear active preview
    this.state.activeSwapPreview = null;

    this.showToast(`Swapped in ${newBenchPlayer.full_name} for ${currentStarter.full_name} at ${slotType}! 🐾`);
    this.recomputeOptimization();
  }

  /**
   * Cancel Active Swap Preview
   */
  onCancelSwapPreview(slotIdx) {
    this.state.activeSwapPreview = null;
    this.renderStartersTable(this.state.userStarters, this.state.optimalSolution, this.state.bowieDossier, false);
  }

  /**
   * Render Bench Table Rows (Strict Column Alignment with Starters Table)
   */
  renderBenchTable(bench, optimalSolution, dossier, isOpponent = false) {
    const benchBody = document.getElementById('benchTableBody');
    if (!benchBody) return;

    if (!bench || bench.length === 0) {
      benchBody.innerHTML = `<tr><td colspan="6" class="empty-state">No bench players on this roster.</td></tr>`;
      return;
    }

    const optimalStarterIds = new Set((optimalSolution?.starters || []).map(p => p.player_id));

    benchBody.innerHTML = bench.map(player => {
      const dist = calculatePlayerDistributions(player);
      const isRecommended = !isOpponent && optimalStarterIds.has(player.player_id);
      const posClass = `pos-${player.position || 'FLEX'}`;
      const sched = getGameScheduleInfo(player.team, this.state.week, this.state.liveSchedule);
      const alertBadge = isOpponent ? '<span class="text-muted">—</span>' : this.getScoutAlertBadge(player, optimalStarterIds, dossier);
      const cleanName = getCleanPlayerName(player.full_name);
      
      // Dynamic live gameday status badge
      let statusBadge = getPlayerStatusBadge(player.injury_status);
      if (dist.gameState === 'IN_PROGRESS') {
        statusBadge = `<span class="badge-live-pulse" title="Live NFL Game Active"><span class="live-dot"></span> ${dist.gameQuarter || '3Q'} ${dist.gameClock || '8:45'}</span><span class="badge-pts-banked">${(dist.points_scored || 0).toFixed(1)} pts</span>`;
      } else if (dist.gameState === 'FINAL' || dist.isFinal) {
        statusBadge = `<span class="badge-final" title="Game Final"><span style="font-size:9.5px;">🏁</span> FINAL &middot; ${(dist.points_scored || 0).toFixed(1)} pts</span>`;
      }

      const rangeBarHtml = renderProjectionRangeBar(dist);
      const avatarUrl = player.avatar || 'https://sleepercdn.com/images/v2/icons/player_default.webp';

      // Eligible slot badges dynamically filtered by active league roster positions
      const leaguePositions = this.state.rawRosterPositions || this.state.starterSlots || this.state.leagueData?.roster_positions;
      const eligibleSlots = getEligibleSlotsForPosition(player.position, leaguePositions);
      const slotBadges = eligibleSlots.map(s => `<span class="fmt-badge active" style="font-size:9.5px;">${s}</span>`).join(' ');

      let alertDisplay = '<span class="text-muted">—</span>';
      if (isRecommended) {
        // Find who this bench player would replace among starters
        const swap = (this.state.recommendedSwaps || []).find(s => s.playerToStart?.player_id === player.player_id);
        if (swap && swap.playerToBench) {
          const bName = getCleanPlayerName(swap.playerToBench.full_name).split(' ').pop();
          alertDisplay = `<span class="badge-scout swap" title="Recommended Start over ${swap.playerToBench.full_name}">🚀 START OVER ${bName.toUpperCase()}</span>`;
        } else {
          alertDisplay = '<span class="badge-scout swap">🚀 START REC</span>';
        }
      } else if (!isOpponent && alertBadge.includes('LOCK')) {
        alertDisplay = '<span class="badge-lock golden-bone-badge">🐾 LOCK</span>';
      } else if (!isOpponent && alertBadge.includes('WARN')) {
        alertDisplay = '<span class="badge-warn bowie-bark-badge">⚠️ BARK WARN</span>';
      } else if (!isOpponent && dossier?.benchWildcard?.player?.player_id === player.player_id) {
        alertDisplay = '<span class="dossier-pill wildcard-pill" style="font-size:9.5px;padding:3px 7px;">🎲 WILDCARD</span>';
      } else if (dist.ceilingSurge >= 8.5) {
        alertDisplay = '<span class="badge-scout upside">⚡ HIGH CEILING</span>';
      }

      return `
        <tr class="suggest-row player-row" onclick="openPlayerDrawer('${player.player_id}')">
          <td class="col-slot"><span class="pos-tag ${posClass}">${player.position || 'FLEX'}</span></td>
          <td class="col-player">
            <div style="display:flex;align-items:center;gap:8px;width:100%;">
              <img src="${avatarUrl}" class="player-thumb" alt="${cleanName}" onerror="this.src='https://sleepercdn.com/images/v2/icons/player_default.webp'">
              <div style="min-width:0;flex:1;">
                <div style="font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${cleanName}</div>
                <div>${sched.html}</div>
              </div>
            </div>
          </td>
          <td class="col-status">${statusBadge}</td>
          <td class="col-range">${rangeBarHtml}</td>
          <td class="col-scout-alert col-alert">${alertDisplay}</td>
          <td class="col-eligible col-eligible-slots col-action">${isOpponent ? '<span class="text-muted">—</span>' : slotBadges}</td>
        </tr>
      `;
    }).join('');
  }

  applyOptimalLineup() {
    this.trackEvent('apply-optimal-lineup', 'Clicked Apply Optimal Lineup Banner');

    if (!this.state.optimalSolution) return;

    const currentStarterIds = this.state.userStarters.map(p => p.player_id).join(',');
    const optimalStarterIds = this.state.optimalSolution.starters.map(p => p.player_id).join(',');

    if (currentStarterIds === optimalStarterIds) {
      this.showToast("Current lineup is already 100% optimal! 🐾");
      return;
    }

    this.state.userStarters = [...this.state.optimalSolution.starters];
    this.state.userBench = [...this.state.optimalSolution.bench];
    this.recomputeOptimization();
    this.showToast("All optimal Sit/Start swaps applied in place! Bowie approves. 🐾");
  }

  openPlayerDrawer(playerId) {
    const all = [
      ...this.state.userStarters,
      ...this.state.userBench,
      ...this.state.oppStarters,
      ...(this.state.oppBench || [])
    ];
    const player = all.find(p => p.player_id === playerId);
    if (!player) return;

    this.trackEvent('open-player-modal', `Opened Player Modal for ${player.full_name} (${player.position || 'FLEX'} - ${player.team || 'FA'})`);

    const dist = calculatePlayerDistributions(player);
    const sched = getGameScheduleInfo(player.team, this.state.week, this.state.liveSchedule);

    const dName = document.getElementById('dPlayerName');
    const dPos = document.getElementById('dPlayerPos');
    const dTeam = document.getElementById('dPlayerTeam');
    const dOpp = document.getElementById('dPlayerOpp');
    const dMean = document.getElementById('dPlayerMean');
    const dFloor = document.getElementById('dPlayerFloor');
    const dCeiling = document.getElementById('dPlayerCeiling');
    const dBust = document.getElementById('dPlayerBust');
    const dBoom = document.getElementById('dPlayerBoom');

    if (dName) dName.textContent = player.full_name;
    if (dPos) {
      dPos.textContent = player.position || 'FLEX';
      dPos.className = `pos-tag pos-${player.position || 'FLEX'}`;
    }
    if (dTeam) dTeam.textContent = player.team;
    if (dOpp) {
      if (dist.gameState === 'IN_PROGRESS') {
        dOpp.innerHTML = `<span class="badge-live-pulse" style="margin-right:6px;"><span class="live-dot"></span> ${dist.gameQuarter || '3Q'} ${dist.gameClock || '8:45'}</span> ${sched.text} &middot; <span style="color:#94a3b8;">${sched.stadiumName}</span>`;
      } else if (dist.gameState === 'FINAL' || dist.isFinal) {
        dOpp.innerHTML = `<span class="badge-final" style="margin-right:6px;">🏁 FINAL</span> ${sched.text} &middot; <span style="color:#94a3b8;">${sched.stadiumName}</span>`;
      } else {
        dOpp.innerHTML = `${sched.text} &middot; <span style="color:#94a3b8;">${sched.stadiumName}</span>`;
      }
    }

    const projPts = Number((player.projected_pts ?? player.proj ?? dist.mean) || 0);
    if (dMean) {
      if (dist.gameState === 'IN_PROGRESS') {
        dMean.innerHTML = `<span>${dist.mean.toFixed(1)} pts</span> <span style="font-size:12px;color:#10b981;font-weight:700;margin-left:6px;">(Banked: ${(dist.points_scored || 0).toFixed(1)})</span>`;
      } else if (dist.gameState === 'FINAL' || dist.isFinal) {
        dMean.innerHTML = `<span>${dist.mean.toFixed(1)} pts</span> <span style="font-size:12px;color:#94a3b8;font-weight:700;margin-left:6px;">(Final Score)</span>`;
      } else {
        dMean.textContent = `${projPts.toFixed(1)} pts`;
      }
    }

    const week = parseInt(this.state.week, 10) || 1;
    const seasonAvg = (player.seasonAvg !== undefined && player.seasonAvg !== null) ? Number(player.seasonAvg) : (player.season_avg !== undefined && player.season_avg !== null ? Number(player.season_avg) : null);
    const deltaEl = document.getElementById('dPlayerMeanDelta');
    if (deltaEl) {
      if (seasonAvg !== null && !isNaN(seasonAvg) && week > 1) {
        const diff = projPts - seasonAvg;
        if (diff >= 0) {
          deltaEl.innerHTML = `<span class="metric-sub text-emerald">▲ +${diff.toFixed(1)} vs Avg (${seasonAvg.toFixed(1)})</span>`;
        } else {
          deltaEl.innerHTML = `<span class="metric-sub text-rose">▼ ${diff.toFixed(1)} vs Avg (${seasonAvg.toFixed(1)})</span>`;
        }
      } else {
        deltaEl.innerHTML = `<span class="metric-sub text-muted">Week 1 Opener</span>`;
      }
    }

    // Row 1 & 2 Metrics
    if (dFloor) dFloor.textContent = `${Number(dist.floor10).toFixed(1)} pts`;
    if (dCeiling) dCeiling.textContent = `${Number(dist.ceiling90).toFixed(1)} pts`;
    if (dBust) dBust.textContent = `${dist.bustRate}%`;
    if (dBoom) dBoom.textContent = `${dist.boomRate}%`;

    // Row 3: Matchup Context & Vegas Outlook
    const vegas = getTeamVegasContext(player.team, this.state.liveOdds);

    const hash = Math.abs((player.player_id || '10').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0));
    const rank = (hash % 28) + 3;
    let matchDesc = 'Neutral Matchup';
    let rankColor = 'var(--text)';
    if (rank >= 22) { matchDesc = 'Favorable Matchup'; rankColor = '#10b981'; }
    else if (rank <= 10) { matchDesc = 'Tough Matchup'; rankColor = '#f43f5e'; }

    const oppRankEl = document.getElementById('dPlayerOppRank');
    if (oppRankEl) {
      oppRankEl.innerHTML = `#${rank} vs ${player.position || 'FLEX'} &middot; <span style="color:${rankColor};font-weight:700;">${matchDesc}</span>`;
    }

    const impliedTotalEl = document.getElementById('dPlayerImpliedTotal');
    if (impliedTotalEl) {
      impliedTotalEl.textContent = `${vegas.impliedTotal.toFixed(1)} pts (O/U: ${vegas.overUnder.toFixed(1)})`;
    }

    const gameScriptEl = document.getElementById('dPlayerGameScript');
    if (gameScriptEl) {
      const spreadSign = vegas.spread > 0 ? `+${vegas.spread.toFixed(1)}` : `${vegas.spread.toFixed(1)}`;
      const scriptColor = vegas.spread <= -6.5 ? 'var(--accent)' : (vegas.spread >= 6.5 ? '#38bdf8' : 'var(--text)');
      gameScriptEl.innerHTML = `${spreadSign} &middot; <span style="font-weight:700;color:${scriptColor};">${vegas.shortScript}</span>`;
    }

    const venueEnvEl = document.getElementById('dPlayerVenueEnv');
    if (venueEnvEl) {
      venueEnvEl.textContent = (sched.isDome || sched.venueType === 'dome') 
        ? '🏟️ Indoor Dome (0% Wind Risk)' 
        : 'Open-Air Stadium';
    }

    document.getElementById('drawerOverlay').classList.add('active');
    document.getElementById('playerDrawer').classList.add('active');
  }

  closeDrawer() {
    document.getElementById('drawerOverlay').classList.remove('active');
    document.getElementById('playerDrawer').classList.remove('active');
  }

  renderDensityChart(simResults) {
    const canvas = document.getElementById('densityChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const ctx = canvas.getContext('2d');
    const { chartData, userStats, oppStats, winProbability, spread } = simResults;

    // 1. Polish Header Win Rate Badge
    const chartWinBadge = document.getElementById('chartWinBadge');
    if (chartWinBadge) {
      const spreadAbs = Math.abs(spread).toFixed(1);
      if (winProbability >= 55) {
        chartWinBadge.className = 'badge-winrate favored';
        chartWinBadge.innerHTML = `🏆 ${winProbability}% WIN PROBABILITY (Favored by +${spreadAbs} pts)`;
      } else if (winProbability < 45) {
        chartWinBadge.className = 'badge-winrate underdog';
        chartWinBadge.innerHTML = `⚡ ${winProbability}% WIN PROBABILITY (Underdog by -${spreadAbs} pts)`;
      } else {
        chartWinBadge.className = 'badge-winrate coinflip';
        const sign = spread >= 0 ? `+${spreadAbs}` : `-${spreadAbs}`;
        chartWinBadge.innerHTML = `⚖️ ${winProbability}% WIN PROBABILITY (${sign} pt margin)`;
      }
    }

    if (this.chartInstance) {
      this.chartInstance.destroy();
    }

    const gradientUser = ctx.createLinearGradient(0, 0, 0, 240);
    gradientUser.addColorStop(0, 'rgba(79, 209, 165, 0.4)');
    gradientUser.addColorStop(1, 'rgba(79, 209, 165, 0.01)');

    const gradientOpp = ctx.createLinearGradient(0, 0, 0, 240);
    gradientOpp.addColorStop(0, 'rgba(56, 189, 248, 0.35)');
    gradientOpp.addColorStop(1, 'rgba(56, 189, 248, 0.01)');

    // Vertical Median Lines & Peak Badges Plugin
    const densityAnnotationsPlugin = {
      id: 'densityAnnotations',
      afterDraw(chart) {
        const { ctx, chartArea: { top, bottom, left, right }, scales: { x } } = chart;
        if (!userStats || !oppStats || !chartData?.labels) return;

        const labels = chartData.labels;
        const userMedian = userStats.median;
        const oppMedian = oppStats.median;

        let uIdx = labels.reduce((closestIdx, curr, idx) => Math.abs(curr - userMedian) < Math.abs(labels[closestIdx] - userMedian) ? idx : closestIdx, 0);
        let oIdx = labels.reduce((closestIdx, curr, idx) => Math.abs(curr - oppMedian) < Math.abs(labels[closestIdx] - oppMedian) ? idx : closestIdx, 0);

        const xUser = x.getPixelForValue(uIdx);
        const xOpp = x.getPixelForValue(oIdx);

        ctx.save();

        // 1. Draw User Median Dashed Line (Green #4fd1a5)
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(79, 209, 165, 0.85)';
        ctx.lineWidth = 1.5;
        ctx.moveTo(xUser, top + 26);
        ctx.lineTo(xUser, bottom);
        ctx.stroke();

        // 2. Draw Opponent Median Dashed Line (Cyan #38bdf8)
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
        ctx.lineWidth = 1.5;
        ctx.moveTo(xOpp, top + 26);
        ctx.lineTo(xOpp, bottom);
        ctx.stroke();

        ctx.setLineDash([]);

        // Helper to draw floating peak badge
        const drawBadge = (text, xPos, yPos, bgColor, borderColor, textColor) => {
          ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
          const textWidth = ctx.measureText(text).width;
          const badgeWidth = textWidth + 14;
          const badgeHeight = 20;
          const badgeX = Math.max(left + 4, Math.min(right - badgeWidth - 4, xPos - badgeWidth / 2));
          const badgeY = yPos;

          // Glassmorphic background
          ctx.fillStyle = bgColor;
          ctx.strokeStyle = borderColor;
          ctx.lineWidth = 1;
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, 4);
          } else {
            ctx.rect(badgeX, badgeY, badgeWidth, badgeHeight);
          }
          ctx.fill();
          ctx.stroke();

          // Label
          ctx.fillStyle = textColor;
          ctx.fillText(text, badgeX + 7, badgeY + 14);
        };

        drawBadge(`🟢 You: ${userStats.mean} pts`, xUser, top + 4, 'rgba(15, 34, 25, 0.95)', 'rgba(79, 209, 165, 0.6)', '#4fd1a5');
        drawBadge(`🔵 Opp: ${oppStats.mean} pts`, xOpp, top + 4, 'rgba(14, 28, 45, 0.95)', 'rgba(56, 189, 248, 0.6)', '#38bdf8');

        ctx.restore();
      }
    };

    this.chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: chartData.labels,
        datasets: [
          {
            label: 'Your Lineup',
            data: chartData.userDensity,
            borderColor: '#4fd1a5',
            backgroundColor: gradientUser,
            fill: true,
            tension: 0.38,
            borderWidth: 2,
            pointRadius: 0
          },
          {
            label: 'Opponent Lineup',
            data: chartData.oppDensity,
            borderColor: '#38bdf8',
            backgroundColor: gradientOpp,
            fill: true,
            tension: 0.38,
            borderWidth: 2,
            pointRadius: 0
          }
        ]
      },
      plugins: [densityAnnotationsPlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'top',
            labels: { color: '#8b96ab', font: { size: 11 } }
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.94)',
            titleColor: '#ffffff',
            titleFont: { size: 12, weight: 'bold' },
            bodyColor: '#e2e8f0',
            bodyFont: { size: 11.5 },
            borderColor: 'rgba(255, 255, 255, 0.1)',
            borderWidth: 1,
            padding: { top: 10, bottom: 10, left: 14, right: 14 },
            cornerRadius: 8,
            displayColors: false,
            callbacks: {
              title: (items) => `🎯 Target: ${items[0].label} pts`,
              label: () => null, // Suppress density clutter completely
              afterBody: (items) => {
                const idx = items[0].dataIndex;
                const uReach = chartData.userReach ? chartData.userReach[idx] : 0;
                const oReach = chartData.oppReach ? chartData.oppReach[idx] : 0;
                const score = items[0].label;
                return [
                  `🟢 You (≥ ${score} pts): ${uReach}%`,
                  `🔵 Opponent (≥ ${score} pts): ${oReach}%`
                ];
              }
            }
          }
        },
        scales: {
          x: {
            title: {
              display: true,
              text: 'Model Points Output',
              color: '#94a3b8',
              font: { size: 11, weight: '600' },
              padding: { top: 6, bottom: 2 }
            },
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#8b96ab', font: { size: 10 } }
          },
          y: {
            title: {
              display: true,
              text: 'Likelihood (% of Sims)',
              color: '#94a3b8',
              font: { size: 11, weight: '600' },
              padding: { bottom: 6 }
            },
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#8b96ab', font: { size: 10 }, callback: (v) => `${v}%` }
          }
        }
      }
    });
  }

  showToast(msg) {
    if (typeof document === 'undefined') return;
    const toast = document.getElementById('bowieToast');
    const toastMsg = document.getElementById('bowieToastMsg');
    if (!toast || !toastMsg) return;

    toastMsg.textContent = msg;
    toast.classList.add('show');

    setTimeout(() => {
      toast.classList.remove('show');
    }, 3200);
  }

  triggerBowieEasterEgg(el) {
    if (!el) return;
    el.classList.remove('wiggle');
    void el.offsetWidth;
    el.classList.add('wiggle');

    const tip = document.getElementById('bowieScoutTip');
    if (tip) {
      const quote = this.bowieQuotes[Math.floor(Math.random() * this.bowieQuotes.length)];
      tip.textContent = quote;
    }
  }

  /* ==========================================================================
     WAIVER WIRE RADAR DRAWER ENGINE & ACTIONS
     ========================================================================== */

  async loadWaiverTargets() {
    try {
      const waiverBtn = document.getElementById('btnOpenWaiverDrawer');
      if (this.state.isImportedMatchup) {
        // ESPN / Yahoo / Custom imports only sync the 2 matchup rosters without league waiver wire databases
        if (waiverBtn) waiverBtn.style.display = 'none';
        if (this.state.isWaiverDrawerOpen) this.closeWaiverDrawer();
        return;
      } else {
        if (waiverBtn) waiverBtn.style.display = 'inline-flex';
      }

      if (!this.waiverEngine) {
        this.waiverEngine = new WaiverEngine();
      }

      // Check if we have master players pool
      let allPlayersMap = this.masterPlayersPool || {};
      if (Object.keys(allPlayersMap).length === 0) {
        allPlayersMap = await sleeperApi.fetchAllPlayers().catch(() => ({}));
      }

      const isDemo = Boolean(this.state.isDemoMode || this.state.currentLeague?.league_id === 'demo_championship_league_2025' || Object.keys(allPlayersMap).length === 0);
      if (isDemo) {
        allPlayersMap = { ...MOCK_PLAYERS_DB, ...allPlayersMap };
      }

      const allRosterPool = [
        ...(this.state.userPlayers || []),
        ...(this.state.userStarters || []),
        ...(this.state.userBench || [])
      ];
      allRosterPool.forEach(p => {
        if (p && p.player_id) {
          allPlayersMap[String(p.player_id)] = p;
        }
      });

      // Ensure full league rosters are loaded
      let leagueRosters = this.state.leagueRosters;
      if ((!leagueRosters || leagueRosters.length === 0) && this.state.currentLeague?.league_id && !isDemo) {
        leagueRosters = await sleeperApi.getRosters(this.state.currentLeague.league_id).catch(() => []);
        this.state.leagueRosters = leagueRosters;
      }

      // Live 24h Trending Adds & Drops
      const [trendingAdds, trendingDrops] = await Promise.all([
        sleeperApi.getTrendingPlayers('add', 24, 100).catch(() => []),
        sleeperApi.getTrendingPlayers('drop', 24, 100).catch(() => [])
      ]);

      const trendingAddsMap = {};
      (trendingAdds || []).forEach(item => {
        if (item && item.player_id) trendingAddsMap[item.player_id] = item.count;
      });

      const trendingDropsMap = {};
      (trendingDrops || []).forEach(item => {
        if (item && item.player_id) trendingDropsMap[item.player_id] = item.count;
      });

      const projections = this.state.projections || {};
      const scoringSettings = this.state.league?.scoring_settings || null;

      // Extract User Analysis from weekly roster
      const userRosterObj = this.state.userRoster || {
        starters: (this.state.userStarters || []).map(p => p.player_id),
        players: (this.state.userPlayers || []).map(p => p.player_id),
        reserve: (this.state.userReserve || []).map(p => p.player_id)
      };

      const userAnalysis = this.waiverEngine.analyzeUserRoster(
        userRosterObj,
        allPlayersMap,
        projections,
        trendingDropsMap,
        scoringSettings
      );
      this.state.userAnalysis = userAnalysis;

      // Extract Free Agent Pool (accurately excluding all rostered players across every team)
      const freeAgents = this.waiverEngine.extractFreeAgents(
        allPlayersMap,
        leagueRosters || [userRosterObj],
        projections,
        trendingAddsMap,
        trendingDropsMap,
        scoringSettings
      );

      // Automatically calculate remaining FAAB budget from Sleeper league settings & user roster
      const totalBudget = Number(this.state.league?.settings?.waiver_budget ?? 100);
      const budgetUsed = Number(this.state.userRoster?.settings?.waiver_budget_used ?? 0);
      const remainingFaab = Math.max(0, totalBudget - budgetUsed);

      if (!this.state.hasManualFaabOverride) {
        this.state.waiverFaab = remainingFaab;
        const faabInput = document.getElementById('drawerFaabInput');
        if (faabInput) faabInput.value = remainingFaab;
      }

      // Fetch NFL state to check season kickoff dates
      let nflState = this.state.nflState;
      if (!nflState) {
        try {
          nflState = await sleeperApi.getNflState();
          this.state.nflState = nflState;
        } catch (e) {
          nflState = null;
        }
      }

      const now = new Date();
      const seasonStartDate = nflState?.season_start_date ? new Date(nflState.season_start_date) : null;
      const isBeforeKickoff = seasonStartDate ? (now < seasonStartDate) : true;
      const leagueStatus = this.state.league?.status || '';
      const currentWeek = Number(this.state.currentWeek ?? nflState?.week ?? 1);
      const isPreSeasonType = nflState?.season_type === 'pre' || this.state.league?.season_type === 'pre';
      
      // Check if league has had 0 fantasy points scored yet across all teams (pre-kickoff)
      const leagueHasNoPoints = Array.isArray(this.state.leagueRosters) 
        ? this.state.leagueRosters.every(r => (r.settings?.fpts ?? 0) === 0)
        : true;

      const isWeek0 = isBeforeKickoff || 
                      isPreSeasonType || 
                      leagueStatus === 'pre_draft' || 
                      leagueStatus === 'drafting' || 
                      (currentWeek <= 1 && leagueHasNoPoints);

      // Fetch historical waiver transactions if in-season
      let historicalTransactions = [];
      try {
        if (this.state.currentLeagueId && currentWeek > 1) {
          const txList = await sleeperApi.getTransactions(this.state.currentLeagueId, currentWeek - 1);
          if (Array.isArray(txList)) {
            historicalTransactions = txList
              .filter(t => t.type === 'waiver' && t.status === 'complete' && t.settings?.waiver_bid !== undefined)
              .map(t => ({
                bid: Number(t.settings.waiver_bid) || 0,
                roster_id: t.roster_ids?.[0],
                adds: t.adds
              }));
          }
        }
      } catch (e) {
        console.warn('Waiver transaction history unavailable:', e);
      }

      // Process Net Deltas, FAAB Bids, and Streaming Matrix
      this.state.waiverTargets = this.waiverEngine.processWaiverWire(
        freeAgents,
        userAnalysis,
        {
          userFaab: this.state.waiverFaab,
          isWeek0,
          currentWeek,
          leagueSettings: this.state.league?.settings,
          historicalTransactions
        }
      );

      // Count positive net upgrades
      const upgrades = this.state.waiverTargets.filter(p => p.netDelta > 0 && !p.isIrStash);
      const upgradeCount = upgrades.length;

      // Update badges in header and floating trigger
      const headerBadge = document.getElementById('waiverUpgradeBadge');
      const floatBadge = document.getElementById('floatingUpgradeBadge');
      if (headerBadge) {
        headerBadge.textContent = `+${upgradeCount}`;
        headerBadge.style.display = upgradeCount > 0 ? 'inline-block' : 'none';
      }
      if (floatBadge) {
        floatBadge.textContent = `+${upgradeCount}`;
        floatBadge.style.display = upgradeCount > 0 ? 'inline-block' : 'none';
      }

      const summaryEl = document.getElementById('waiverDrawerSummary');
      if (summaryEl) {
        summaryEl.textContent = `Found ${upgradeCount} net upgrades against your bench.`;
      }

      // Render top trending market velocity in drawer
      const topTrending = this.state.waiverTargets
        .filter(p => p.trending_adds && p.trending_adds >= 5000)
        .sort((a, b) => (b.trending_adds || 0) - (a.trending_adds || 0))
        .slice(0, 6);

      const velBanner = document.getElementById('drawerMarketVelocityBanner');
      const velChips = document.getElementById('drawerMarketVelocityChips');
      if (velBanner && velChips) {
        if (topTrending.length > 0) {
          velChips.innerHTML = topTrending.map(p => `
            <button class="market-velocity-chip" onclick="weeklyOptimizer.onDrawerSearchPlayer('${(p.full_name || p.name || '').replace(/'/g, "\\'")}')" title="Filter to ${p.full_name}" style="font-size:10.5px;padding:1.5px 7px;">
              <span>${p.full_name || p.name}</span>
              <span class="chip-adds" style="font-size:10px;">▲ +${this.waiverEngine.formatTrendingCount(p.trending_adds)}</span>
            </button>
          `).join('');
          velBanner.style.display = 'flex';
        } else {
          velBanner.style.display = 'none';
        }
      }

      this.renderWaiverDrawer();
    } catch (err) {
      console.warn('loadWaiverTargets error:', err);
    }
  }

  openWaiverDrawer() {
    this.state.isWaiverDrawerOpen = true;
    document.body.classList.add('waiver-drawer-open');
    document.getElementById('waiverDrawerOverlay')?.classList.add('active');
    document.getElementById('waiverRadarDrawer')?.classList.add('active');
    if (!this.state.waiverTargets || this.state.waiverTargets.length === 0) {
      this.loadWaiverTargets();
    } else {
      this.renderWaiverDrawer();
    }
  }

  closeWaiverDrawer() {
    this.state.isWaiverDrawerOpen = false;
    document.body.classList.remove('waiver-drawer-open');
    document.getElementById('waiverDrawerOverlay')?.classList.remove('active');
    document.getElementById('waiverRadarDrawer')?.classList.remove('active');
  }

  clearDrawerSearch() {
    const input = document.getElementById('drawerWaiverSearch');
    if (input) input.value = '';
    this.state.waiverSearchQuery = '';
  }

  onDrawerStrategyToggle(strategy) {
    this.clearDrawerSearch();
    if (this.state.selectedWaiverStrategy === strategy) {
      this.state.selectedWaiverStrategy = null;
    } else {
      this.state.selectedWaiverStrategy = strategy;
    }
    document.querySelectorAll('#drawerStrategyPills .filter-pill').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.strategy === this.state.selectedWaiverStrategy);
    });
    this.renderWaiverDrawer();
  }

  onDrawerPosFilter(pos) {
    this.clearDrawerSearch();
    this.state.selectedWaiverPos = pos || 'ALL';
    document.querySelectorAll('#drawerPosPills .filter-pill').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.pos === this.state.selectedWaiverPos);
    });
    this.renderWaiverDrawer();
  }

  onDrawerSearchInput() {
    const input = document.getElementById('drawerWaiverSearch');
    if (input) {
      this.state.waiverSearchQuery = input.value.toLowerCase().trim();
      this.renderWaiverDrawer();
    }
  }

  onDrawerSearchPlayer(name) {
    const input = document.getElementById('drawerWaiverSearch');
    const cleanName = (name || '').toLowerCase().trim();

    // Toggle off if clicking the currently active search
    if (this.state.waiverSearchQuery === cleanName) {
      this.clearDrawerSearch();
      this.renderWaiverDrawer();
      this.showToast(`Cleared player filter 🐾`);
      return;
    }

    if (input) {
      input.value = name;
      this.state.waiverSearchQuery = cleanName;
      // Reset position to ALL so the player is immediately visible
      this.state.selectedWaiverPos = 'ALL';
      document.querySelectorAll('#drawerPosPills .filter-pill').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.pos === 'ALL');
      });
      this.renderWaiverDrawer();
      this.showToast(`Filtering drawer for ${name} 🐾`);
    }
  }

  onDrawerSortChanged() {
    const select = document.getElementById('drawerWaiverSort');
    if (select) {
      this.state.waiverCurrentSort = select.value;
      this.renderWaiverDrawer();
    }
  }

  onDrawerFaabChanged() {
    const input = document.getElementById('drawerFaabInput');
    if (input) {
      const val = Math.max(0, Number(input.value) || 0);
      this.state.waiverFaab = val;
      this.state.hasManualFaabOverride = true;
      if (this.state.waiverTargets) {
        this.state.waiverTargets.forEach(p => {
          p.faabBids = this.waiverEngine.calculateFaabBids(p, p.netDelta, this.state.waiverFaab);
        });
      }
      this.renderWaiverDrawer();
      this.showToast(`Updated FAAB budget to $${val}`);
    }
  }

  renderWaiverDrawer() {
    const container = document.getElementById('drawerWaiverCardsList');
    if (!container) return;

    let list = [...(this.state.waiverTargets || [])];

    // Dimension A: Strategy
    const strat = this.state.selectedWaiverStrategy;
    if (strat === 'upgrade') {
      list = list.filter(p => p.netDelta > 0 && !p.isIrStash);
    } else if (strat === 'trending') {
      list = list.filter(p => (p.trending_adds && p.trending_adds >= 5000) || p.trend?.type === 'UP');
    } else if (strat === 'streamer') {
      list = list.filter(p => p.streamingScore >= 75 && !p.isIrStash);
    } else if (strat === 'handcuff') {
      list = list.filter(p => p.contingent_score >= 75 && !p.isIrStash);
    } else if (strat === 'ir_stash') {
      list = list.filter(p => p.isIrStash);
    }

    // Dimension B: Position (with Kicker exclusion from ALL)
    const pos = this.state.selectedWaiverPos;
    if (pos === 'ALL') {
      list = list.filter(p => p.position !== 'K');
    } else if (pos === 'FLEX') {
      list = list.filter(p => ['RB', 'WR', 'TE'].includes(p.position));
    } else if (pos) {
      list = list.filter(p => p.position === pos);
    }

    // Dimension C: Search
    const q = this.state.waiverSearchQuery;
    if (q) {
      list = list.filter(p => {
        const name = (p.full_name || p.name || '').toLowerCase();
        const team = (p.team || '').toLowerCase();
        return name.includes(q) || team.includes(q);
      });
    }

    // Sort
    const sort = this.state.waiverCurrentSort;
    if (sort === 'trending_adds_desc') {
      list.sort((a, b) => (b.trending_adds || 0) - (a.trending_adds || 0));
    } else if (sort === 'delta_desc') {
      list.sort((a, b) => b.netDelta - a.netDelta);
    } else if (sort === 'proj_desc') {
      list.sort((a, b) => b.projected_pts - a.projected_pts);
    } else if (sort === 'faab_desc') {
      list.sort((a, b) => (b.faabBids?.aggressive?.dollars || 0) - (a.faabBids?.aggressive?.dollars || 0));
    } else if (sort === 'handcuff_desc') {
      list.sort((a, b) => (b.contingent_score || 0) - (a.contingent_score || 0));
    }

    if (list.length === 0) {
      container.innerHTML = `<div class="waiver-empty-state">No free agents match your filter criteria.</div>`;
      return;
    }

    // Limit to top 30 in drawer for optimal DOM performance
    const renderList = list.slice(0, 30);
    container.innerHTML = renderList.map(player => {
      const deltaPrefix = player.netDelta > 0 ? '+' : '';
      let netNumClass = 'net-val-neutral';
      if (player.netDelta > 1.5) {
        netNumClass = 'net-val-positive';
      } else if (player.netDelta < -1.5) {
        netNumClass = 'net-val-negative';
      }
      
      let tickerHtml = '';
      if (player.trend && player.trend.type === 'UP') {
        tickerHtml = `<span class="ticker-pill ticker-up" title="${player.trend.count} adds in 24h">${player.trend.formatted}</span>`;
      }

      let dropTickerHtml = '';
      if (player.suggestedDrop?.player?.trend && player.suggestedDrop.player.trend.type === 'DOWN') {
        dropTickerHtml = `<span class="ticker-pill ticker-down" title="${player.suggestedDrop.player.trend.count} drops in 24h">${player.suggestedDrop.player.trend.formatted}</span>`;
      }

      const bidLabel = player.faabBid?.label || `$${player.faabBids?.targeted?.dollars ?? 0} (${player.faabBids?.targeted?.percent ?? 0}%)`;
      const isFree = Boolean(player.faabBid?.isFreeAdd);

      const avatarUrl = player.avatar || (player.position === 'DEF' 
        ? `https://sleepercdn.com/images/team_logos/nfl/${(player.team || player.player_id || '').toLowerCase()}.png`
        : `https://sleepercdn.com/images/v2/icons/player_default.webp`);
      const resolvedName = player.full_name || player.name || (player.position === 'DEF' ? `${player.team || player.player_id} Defense` : `Player ${player.player_id}`);

      return `
        <div class="drawer-waiver-card ${player.isGoldenBone ? 'golden-bone-card' : ''}">
          <div class="drawer-card-top-row">
            <div class="drawer-card-player-info">
              <img src="${avatarUrl}" class="waiver-player-avatar" style="width:40px;height:40px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.onerror=null; this.src='https://sleepercdn.com/images/v2/icons/player_default.webp';" alt="${resolvedName}">
              <div style="min-width:0;flex:1;">
                <div class="drawer-player-name-row">
                  <span class="drawer-player-name">${resolvedName}</span>
                  ${tickerHtml}
                </div>
                <div class="drawer-player-meta">
                  <span class="pos-tag pos-${player.position}" style="font-size:9.5px;padding:1px 5px;">${player.position}</span>
                  <span>${player.team || 'FA'}</span>
                  <span>&bull;</span>
                  <span style="color:var(--text);font-weight:700;">${player.projected_pts} pts</span>
                </div>
              </div>
            </div>

            <div class="drawer-net-delta" style="flex-shrink:0;font-size:12.5px;font-family:var(--font-mono, monospace);white-space:nowrap;">
              <span style="color:var(--muted);font-weight:600;">NET:</span> <span class="${netNumClass}">${deltaPrefix}${player.netDelta} PTS</span>
            </div>
          </div>

          <div class="drawer-card-bottom-row">
            <div class="drawer-suggested-drop">
              <span style="color:var(--muted);font-weight:500;">Suggested:</span>
              <span style="font-weight:700;color:#fff;">${player.suggestedDrop?.text || 'Add to Bench'}</span>
              ${dropTickerHtml}
            </div>
            <div class="drawer-faab-bid">
              FAAB: <span style="color: ${isFree ? '#34d399' : 'var(--gold)'}; font-weight: 800;">${bidLabel}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  copyDrawerClaims() {
    if (!this.state.waiverTargets || this.state.waiverTargets.length === 0) return;
    const topTargets = this.state.waiverTargets.slice(0, 10);
    const leagueName = (this.state.currentLeague && this.state.currentLeague.name) || 'Weekly Matchup';
    const text = this.waiverEngine.generateClipboardPriorityList(topTargets, { leagueName, userFaab: this.state.waiverFaab });
    
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        this.showToast('📋 Copied Waiver Priority Claims to clipboard! 🐾');
      }).catch(() => {
        this.showToast('Priority list generated! 🐾');
      });
    }
  }
}

// Instantiate and bind immediately in browser environments
if (typeof window !== 'undefined') {
  const app = new WeeklyOptimizerController();
  window.weeklyOptimizer = app;
  app.bindGlobalHandlers();

  window.addEventListener('DOMContentLoaded', () => {
    app.init();
  });
}

export { WeeklyOptimizerController };
