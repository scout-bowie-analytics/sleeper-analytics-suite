/**
 * 🐾 WAIVER WIRE RADAR & FAAB OPTIMIZER APPLICATION CONTROLLER
 * High-performance, client-side controller managing league ingestion,
 * filter/sort state, paired drop rendering, and 1-click clipboard export.
 */

import { SleeperApiClient } from '../shared/js/sleeper-api.js';
import { MOCK_PLAYERS_DB, MOCK_FREE_AGENTS_DB, MOCK_MASTER_PLAYERS_POOL, MOCK_LEAGUE_INFO, MOCK_ROSTERS, MOCK_USERS } from '../shared/js/mock-data.js';
import { WaiverEngine } from './waiver-engine.js';

class WaiverApp {
  constructor() {
    this.api = new SleeperApiClient();
    this.engine = new WaiverEngine();

    this.state = {
      allPlayersMap: {},
      currentLeague: null,
      rosters: [],
      users: [],
      userRoster: null,
      userAnalysis: null,
      processedTargets: [],
      filteredTargets: [],
      selectedStrategy: null,
      selectedPosition: 'ALL',
      currentFilter: 'all',
      currentSort: 'delta_desc',
      searchQuery: '',
      userFaab: 100,
      isDemoMode: false
    };

    // Global Bindings for HTML Event Handlers
    window.switchSetupTab = (tab) => this.switchSetupTab(tab);
    window.onFetchLeagues = () => this.onFetchLeagues();
    window.onSelectLeague = () => this.onSelectLeague();
    window.initWaiverFromSelection = () => this.initWaiverFromSelection();
    window.loadSampleWaiverPool = () => this.loadSampleWaiverPool();
    window.openSetupModal = () => this.openSetupModal();
    window.closeSetupModal = () => this.closeSetupModal();
    window.onToggleStrategy = (strat) => this.onToggleStrategy(strat);
    window.onFilterPosition = (pos) => this.onFilterPosition(pos);
    window.onFilterCategory = (filter) => this.onFilterCategory(filter);
    window.onSortChanged = () => this.onSortChanged();
    window.onSearchInput = () => this.onSearchInput();
    window.onFaabBudgetChanged = () => this.onFaabBudgetChanged();
    window.copyClaimPriorityList = () => this.copyClaimPriorityList();
    window.triggerBowieEasterEgg = (el) => this.triggerBowieEasterEgg(el);

    this.init();
  }

  async init() {
    // Check URL parameters for direct sample load
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('sample') === 'true' || urlParams.get('demo') === 'true') {
      await this.loadSampleWaiverPool();
    }
  }

  switchSetupTab(tab) {
    const tabLeagueBtn = document.getElementById('tabLeagueBtn');
    const tabSampleBtn = document.getElementById('tabSampleBtn');
    const tabLeagueContent = document.getElementById('tabLeagueContent');
    const tabSampleContent = document.getElementById('tabSampleContent');

    if (tab === 'league') {
      tabLeagueBtn.classList.add('active');
      tabSampleBtn.classList.remove('active');
      tabLeagueContent.style.display = 'block';
      tabSampleContent.style.display = 'none';
    } else {
      tabLeagueBtn.classList.remove('active');
      tabSampleBtn.classList.add('active');
      tabLeagueContent.style.display = 'none';
      tabSampleContent.style.display = 'block';
    }
  }

  openSetupModal() {
    const modal = document.getElementById('setupModal');
    if (modal) modal.style.display = 'flex';
  }

  closeSetupModal() {
    const modal = document.getElementById('setupModal');
    if (modal) modal.style.display = 'none';
  }

  showToast(msg) {
    const toast = document.getElementById('bowieToast');
    const toastMsg = document.getElementById('bowieToastMsg');
    if (toast && toastMsg) {
      toastMsg.textContent = msg;
      toast.style.transform = 'translateY(0)';
      toast.style.opacity = '1';
      setTimeout(() => {
        toast.style.transform = 'translateY(140px)';
        toast.style.opacity = '0';
      }, 4000);
    }
  }

  triggerBowieEasterEgg(imgEl) {
    const quotes = [
      "Bowie's Golden Bone: Don't chase last week's points—target volume and offensive pace! 🐾",
      "Always check for open IR slots! It's a free waiver add without dropping any bench depth.",
      "DEF Streamer Alert: Target defenses facing backup QBs or implied totals under 18.5 pts!",
      "Handcuff Rule: When an elite bellcow goes down, volume is 80% of fantasy production."
    ];
    const quote = quotes[Math.floor(Math.random() * quotes.length)];
    this.showToast(quote);
    if (imgEl) {
      imgEl.style.transform = 'scale(1.15) rotate(-8deg)';
      setTimeout(() => { imgEl.style.transform = 'scale(1)'; }, 300);
    }
  }

  /**
   * Load and parse Live Sleeper League input
   */
  async onFetchLeagues() {
    const input = document.getElementById('sleeperInput');
    const query = input ? input.value.trim() : '';
    if (!query) {
      this.showToast('Please enter a Sleeper username or League ID.');
      return;
    }

    try {
      this.showToast('🐾 Sniffing out league rosters on Sleeper API...');
      const leagues = await this.api.fetchUserLeagues(query);

      const leagueSelectGroup = document.getElementById('leagueSelectGroup');
      const leagueDropdown = document.getElementById('leagueDropdown');
      leagueDropdown.innerHTML = '';

      if (Array.isArray(leagues) && leagues.length > 0) {
        leagues.forEach(l => {
          const opt = document.createElement('option');
          opt.value = l.league_id;
          opt.textContent = `${l.name} (${l.total_rosters || 12} Teams - ${l.season || '2024'})`;
          leagueDropdown.appendChild(opt);
        });
        leagueSelectGroup.style.display = 'block';
        await this.onSelectLeague();
      } else {
        throw new Error(`No active leagues found for "${query}".`);
      }
    } catch (e) {
      console.warn('Waiver league lookup error:', e);
      this.showToast(`Error: ${e.message}`);
    }
  }

  async onSelectLeague() {
    const leagueDropdown = document.getElementById('leagueDropdown');
    const leagueId = leagueDropdown.value;
    if (!leagueId) return;

    try {
      const [league, rosters, users] = await Promise.all([
        this.api.getLeague(leagueId),
        this.api.getRosters(leagueId),
        this.api.getUsers(leagueId)
      ]);

      this.state.currentLeague = league;
      this.state.rosters = rosters;
      this.state.users = users;

      const teamSelectGroup = document.getElementById('teamSelectGroup');
      const teamDropdown = document.getElementById('teamDropdown');
      teamDropdown.innerHTML = '';

      rosters.forEach(r => {
        const owner = users.find(u => u.user_id === r.owner_id);
        const opt = document.createElement('option');
        opt.value = r.roster_id;
        const teamName = (owner && owner.metadata && owner.metadata.team_name) || (owner && owner.display_name) || `Team ${r.roster_id}`;
        opt.textContent = teamName;
        teamDropdown.appendChild(opt);
      });

      teamSelectGroup.style.display = 'block';
      document.getElementById('launchWaiverBtn').style.display = 'block';
    } catch (e) {
      this.showToast(`Failed to load rosters: ${e.message}`);
    }
  }

  async initWaiverFromSelection() {
    const teamDropdown = document.getElementById('teamDropdown');
    const rosterId = Number(teamDropdown.value);
    const userRoster = this.state.rosters.find(r => r.roster_id === rosterId);

    this.state.userRoster = userRoster;
    this.closeSetupModal();
    this.showToast('🐾 Analyzing available free agents and calculating net deltas...');

    // Load master players map and projections
    await this.loadAllWaiverData();
  }

  /**
   * Load Simulated Sample League Waiver Pool (Demo)
   */
  async loadSampleWaiverPool() {
    this.state.isDemoMode = true;
    this.state.currentLeague = MOCK_LEAGUE_INFO;
    this.state.rosters = MOCK_ROSTERS;
    this.state.users = MOCK_USERS;
    this.state.userRoster = MOCK_ROSTERS[0]; // Quantum Blitz

    this.closeSetupModal();
    this.showToast('🏆 Loaded Sample League Waiver Wire (Week 1 Demo)! 🐾');

    await this.loadAllWaiverData();
  }

  async loadAllWaiverData() {
    // 1. Fetch / Cache Master Players Database
    let allPlayers = null;
    if (this.state.isDemoMode) {
      allPlayers = MOCK_MASTER_PLAYERS_POOL;
    } else {
      allPlayers = await this.api.fetchAllPlayers();
      if (!allPlayers || Object.keys(allPlayers).length === 0) {
        allPlayers = MOCK_MASTER_PLAYERS_POOL;
      }
    }
    this.state.allPlayersMap = allPlayers;

    // 2. Fetch Weekly Projections & Real-Time Trending Players in Parallel
    const [weekProjections, trendingAdds, trendingDrops] = await Promise.all([
      this.api.getProjections(this.state.currentLeague?.season || '2024', 1, this.state.currentLeague ? this.state.currentLeague.scoring_settings : null),
      this.api.getTrendingPlayers('add', 24, 100),
      this.api.getTrendingPlayers('drop', 24, 100)
    ]);

    const trendingAddsMap = {};
    (trendingAdds || []).forEach(t => {
      if (t && t.player_id) trendingAddsMap[String(t.player_id)] = Number(t.count) || 0;
    });

    const trendingDropsMap = {};
    (trendingDrops || []).forEach(t => {
      if (t && t.player_id) trendingDropsMap[String(t.player_id)] = Number(t.count) || 0;
    });

    // 3. User Roster Analysis (with drop trends)
    this.state.userAnalysis = this.engine.analyzeUserRoster(
      this.state.userRoster,
      this.state.allPlayersMap,
      weekProjections,
      trendingDropsMap
    );

    // 4. Extract Free Agent Pool (with trending adds & drops)
    const freeAgents = this.engine.extractFreeAgents(
      this.state.allPlayersMap,
      this.state.rosters,
      weekProjections,
      trendingAddsMap,
      trendingDropsMap
    );

    // 5. Process Net Deltas, FAAB Bids, and Streaming Matrix
    this.state.processedTargets = this.engine.processWaiverWire(
      freeAgents,
      this.state.userAnalysis,
      { userFaab: this.state.userFaab }
    );

    // Update UI Header
    document.getElementById('mainApp').style.display = 'block';
    const leagueName = (this.state.currentLeague && this.state.currentLeague.name) || 'Fantasy League';
    document.getElementById('leagueTitle').textContent = `${leagueName} • Waiver Wire Radar`;
    document.getElementById('leagueSub').textContent = `Available Free Agent Pool: ${this.state.processedTargets.length} targets evaluated against active bench`;

    // Scout Bowie Contextual Reaction
    const irLock = this.state.userAnalysis && this.state.userAnalysis.hasIrLockWarning;
    const nextManUp = this.state.processedTargets.find(p => p.isNextManUp && p.inheritance);
    const topTrend = this.state.processedTargets.find(p => p.trend && p.trend.type === 'UP' && p.trend.count >= 100000);
    const tipEl = document.getElementById('bowieRadarTip');
    if (tipEl) {
      if (irLock) {
        tipEl.innerHTML = `<strong style="color:#f59e0b;">⚠️ ROSTER LOCK WARNING:</strong> <span style="color:#fde68a;">${this.state.userAnalysis.lockedPlayer.full_name}</span> is now listed as <strong>${this.state.userAnalysis.lockedPlayer.currentStatus}</strong> in your IR slot! Remove them before submitting waiver claims or Sleeper will block your moves. 🐾`;
      } else if (nextManUp) {
        tipEl.innerHTML = `<strong>🚨 NEXT MAN UP ALERT:</strong> <span style="color:#fca5a5;">${nextManUp.full_name} (${nextManUp.position})</span> has inherited ${nextManUp.inheritance.roleDesc}! Bumping projection to ${nextManUp.projected_pts} pts and scaling FAAB bid to Must-Add. 🐾`;
      } else if (topTrend) {
        tipEl.innerHTML = `<strong>📈 MARKET VELOCITY:</strong> <span style="color:#4ade80;">${topTrend.full_name}</span> is exploding across Sleeper with <strong style="color:#86efac;">${topTrend.trend.formatted} adds</strong> in the last 24h! 🐾`;
      } else {
        tipEl.textContent = `"Scanning available free agents against your bench. Prioritizing positive net projection upgrades, streaming matchups, and high-contingent handcuffs." 🐾`;
      }
    }

    this.applyFiltersAndSort();
  }

  onToggleStrategy(strategy) {
    if (this.state.selectedStrategy === strategy) {
      this.state.selectedStrategy = null; // Toggle off
    } else {
      this.state.selectedStrategy = strategy;
    }
    document.querySelectorAll('#strategyPillsGroup .filter-pill').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.strategy === this.state.selectedStrategy);
    });
    this.applyFiltersAndSort();
  }

  onFilterPosition(pos) {
    this.state.selectedPosition = pos || 'ALL';
    document.querySelectorAll('#posPillsGroup .filter-pill').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.pos === this.state.selectedPosition);
    });
    this.applyFiltersAndSort();
  }

  onFilterCategory(filter) {
    if (['upgrade', 'trending', 'streamer', 'handcuff', 'ir_stash'].includes(filter)) {
      this.onToggleStrategy(filter);
    } else {
      this.onFilterPosition(filter === 'all' ? 'ALL' : filter);
    }
  }

  onSortChanged() {
    const sortSelect = document.getElementById('waiverSort');
    if (sortSelect) {
      this.state.currentSort = sortSelect.value;
      this.applyFiltersAndSort();
    }
  }

  onSearchInput() {
    const searchInput = document.getElementById('waiverSearch');
    if (searchInput) {
      this.state.searchQuery = searchInput.value.toLowerCase().trim();
      this.applyFiltersAndSort();
    }
  }

  onFaabBudgetChanged() {
    const faabInput = document.getElementById('userFaabInput');
    const val = Number(faabInput.value) || 100;
    this.state.userFaab = Math.max(0, val);
    
    // Re-calculate FAAB bids for processed targets
    if (this.state.processedTargets && this.state.processedTargets.length > 0) {
      this.state.processedTargets.forEach(p => {
        p.faabBids = this.engine.calculateFaabBids(p, p.netDelta, this.state.userFaab);
      });
      this.applyFiltersAndSort();
      this.showToast(`Updated FAAB budget to $${this.state.userFaab}`);
    }
  }

  applyFiltersAndSort() {
    let list = [...this.state.processedTargets];

    // Dimension A: Filter by Strategy Toggle (if active)
    const strat = this.state.selectedStrategy;
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

    // Dimension B: Filter by Position (ALL / QB / RB / WR / TE / FLEX / K / DEF)
    const pos = this.state.selectedPosition;
    if (pos === 'FLEX') {
      list = list.filter(p => ['RB', 'WR', 'TE'].includes(p.position));
    } else if (pos && pos !== 'ALL') {
      list = list.filter(p => p.position === pos);
    }

    // Dimension C: Filter by Search Query
    const q = this.state.searchQuery;
    if (q) {
      list = list.filter(p => {
        const name = (p.full_name || p.name || '').toLowerCase();
        const team = (p.team || '').toLowerCase();
        const playerPos = (p.position || '').toLowerCase();
        return name.includes(q) || team.includes(q) || playerPos.includes(q);
      });
    }

    // Dimension D: Sort Order
    const s = this.state.currentSort;
    if (s === 'trending_adds_desc') {
      list.sort((a, b) => (b.trending_adds || 0) - (a.trending_adds || 0));
    } else if (s === 'delta_desc') {
      list.sort((a, b) => b.netDelta - a.netDelta);
    } else if (s === 'proj_desc') {
      list.sort((a, b) => (b.projected_pts || b.return_baseline_pts || 0) - (a.projected_pts || a.return_baseline_pts || 0));
    } else if (s === 'faab_desc') {
      list.sort((a, b) => b.faabBids.targeted.dollars - a.faabBids.targeted.dollars);
    } else if (s === 'handcuff_desc') {
      list.sort((a, b) => b.contingent_score - a.contingent_score);
    }

    this.state.filteredTargets = list;
    this.renderWaiverCards(list);
  }

  renderWaiverCards(targets = []) {
    const container = document.getElementById('waiverCardsList');
    if (!container) return;

    if (targets.length === 0) {
      container.innerHTML = `
        <div class="waiver-empty-state">
          <div style="font-size: 28px; margin-bottom: 8px;">🐾</div>
          <div style="font-weight: 700; color: #fff; font-size: 15px;">No Free Agents Matching Current Filters</div>
          <div style="font-size: 12px; margin-top: 4px;">Try switching categories or clearing your search term.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = targets.slice(0, 40).map(item => {
      const posClass = `pos-${item.position || 'FLEX'}`;
      const avatarUrl = item.player_id && item.position !== 'DEF'
        ? `https://sleepercdn.com/content/nfl/players/thumb/${item.player_id}.jpg`
        : `https://sleepercdn.com/images/v2/icons/player_default.webp`;

      const badgesHtml = item.badges.map(b => {
        let badgeClass = 'badge-upgrade';
        if (b.type === 'next_man_up') badgeClass = 'badge-next-man-up';
        else if (b.type === 'ir_stash') badgeClass = 'badge-ir-stash';
        else if (b.type === 'golden_bone') badgeClass = 'badge-golden-bone';
        else if (b.type === 'streamer') badgeClass = 'badge-streamer';
        else if (b.type === 'handcuff') badgeClass = 'badge-handcuff';
        else if (b.type === 'free_add') badgeClass = 'badge-free-add';
        return `<span class="waiver-badge ${badgeClass}">${b.label}</span>`;
      }).join('');

      const deltaClass = item.netDelta > 0 ? 'net-delta-positive' : 'net-delta-neutral';
      const deltaPrefix = item.netDelta > 0 ? `+${item.netDelta}` : `${item.netDelta}`;
      
      // Check if suggested drop candidate has high drops
      let dropPlayerText = item.suggestedDrop ? item.suggestedDrop.text : 'Drop Bench Asset';
      if (item.suggestedDrop?.player?.trend && item.suggestedDrop.player.trend.type === 'DOWN') {
        dropPlayerText += ` <span class="ticker-pill ticker-down" style="font-size:9.5px;padding:0.5px 5px;" title="${item.suggestedDrop.player.trend.count.toLocaleString()} Sleeper drops in last 24h">${item.suggestedDrop.player.trend.formatted}</span>`;
      }

      let projDisplayHtml = `<span style="color:var(--text);font-weight:700;">${item.projected_pts} pts proj</span>`;
      if (item.isNextManUp && item.inheritance) {
        projDisplayHtml = `<span style="color:#fca5a5;font-weight:800;">${item.projected_pts} pts proj</span> <span style="font-size:10.5px;color:#f87171;font-weight:600;" title="Real-time depth chart override: Starter is sidelined">(🚨 Inherited Starter Role • Raw: ${item.raw_projected_pts})</span>`;
      } else if (item.isIrStash) {
        projDisplayHtml = `<span style="color:#c084fc;font-weight:800;">0.0 pts (Week 1)</span> <span style="font-size:10.5px;color:#d8b4fe;font-weight:600;" title="Projected scoring baseline upon return from IR/PUP">(⏳ ~${item.return_baseline_pts} pts Post-Return)</span>`;
      }

      // Stock Ticker Badge for Active Player
      const tickerBadgeHtml = item.trend
        ? `<span class="ticker-pill ${item.trend.type === 'UP' ? 'ticker-up' : 'ticker-down'}" title="${item.trend.type === 'UP' ? '+' : '-'}${item.trend.count.toLocaleString()} Sleeper ${item.trend.type === 'UP' ? 'adds' : 'drops'} (24h)">${item.trend.formatted}</span>`
        : '';

      return `
        <div class="waiver-card ${item.isGoldenBone ? 'golden-bone-card' : ''} ${item.isNextManUp ? 'next-man-up-card' : ''}">
          <!-- Col 1: Player Profile -->
          <div class="waiver-player-profile">
            <img src="${avatarUrl}" class="waiver-avatar-img" alt="${item.full_name}" onerror="this.onerror=null; this.src='https://sleepercdn.com/images/v2/icons/player_default.webp';">
            <div class="waiver-player-info">
              <div class="waiver-player-name" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                <span>${item.full_name || item.name || 'Free Agent'}</span>
                ${tickerBadgeHtml}
              </div>
              <div class="waiver-player-meta">
                <span class="pos-tag ${posClass}">${item.position}</span>
                <span>${item.team || 'FA'}</span>
                <span>&bull;</span>
                ${projDisplayHtml}
                <span>vs ${item.opponent || 'OPP'}</span>
              </div>
              <div class="waiver-badges-row">${badgesHtml}</div>
            </div>
          </div>

          <!-- Col 2: FAAB Bid Range -->
          <div class="faab-bid-matrix">
            <div class="faab-tier-row">
              <span class="faab-tier-label">🎯 Targeted Value:</span>
              <span class="faab-tier-val target-val">$${item.faabBids.targeted.dollars} (${item.faabBids.targeted.percent}%)</span>
            </div>
            <div class="faab-tier-row">
              <span class="faab-tier-label">🔥 Aggressive (Must-Win):</span>
              <span class="faab-tier-val">$${item.faabBids.aggressive.dollars} (${item.faabBids.aggressive.percent}%)</span>
            </div>
            <div class="faab-tier-row">
              <span class="faab-tier-label">🎲 Speculative Flier:</span>
              <span class="faab-tier-val">$${item.faabBids.speculative.dollars} (${item.faabBids.speculative.percent}%)</span>
            </div>
          </div>

          <!-- Col 3: Paired Suggested Drop -->
          <div class="suggested-drop-card">
            <div class="drop-header-row">
              <span>Suggested Action</span>
              <span class="net-delta-pill ${deltaClass}">Net: ${deltaPrefix} pts</span>
            </div>
            <div class="drop-player-name">${dropPlayerText}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  copyClaimPriorityList() {
    const list = this.state.filteredTargets.length > 0 ? this.state.filteredTargets : this.state.processedTargets;
    const text = this.engine.formatClipboardClaimList(list, this.state.currentLeague || {});

    if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        this.showToast('📋 Copied Waiver Priority Claim List to clipboard! Ready to paste into Sleeper. 🐾');
      }).catch(() => {
        this.fallbackCopyText(text);
      });
    } else {
      this.fallbackCopyText(text);
    }
  }

  fallbackCopyText(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    this.showToast('📋 Copied Waiver Priority Claim List to clipboard!');
  }
}

// Global Singleton Instance
window.waiverApp = new WaiverApp();
