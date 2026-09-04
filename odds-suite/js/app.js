/**
 * 🐾 SCOUT BOWIE NFL SURVIVOR & ODDS SUITE APPLICATION CONTROLLER
 * High-Performance Client-Side State Manager & View Router
 */

import { SurvivorEngine } from './survivorEngine.js';

class OddsSuiteApp {
  constructor() {
    this.engine = new SurvivorEngine();
    this.state = {
      slateData: [],
      activeWeek: 1,
      poolSize: 100,
      strategy: 'contrarian', // 'survival' | 'contrarian'
      pathTarget: 'horizon', // 'horizon' | 'full_season'
      currentView: 'survivor', // 'survivor' | 'pickem' | 'parlay'
      lockedPicks: {}, // { [week]: teamCode }
      excludedTeams: new Set(),
      currentPathResult: null,
      weeklySpotlight: null,
      pickemConfidence: null,
      simResults: null,
      isSimulating: false
    };

    this.worker = null;
    this.init();
  }

  async init() {
    this.bindGlobalHandlers();
    this.initWorker();

    try {
      const res = await fetch('data/nfl_slate.json');
      if (!res.ok) throw new Error('Failed to load NFL slate data');
      this.state.slateData = await res.json();

      this.recalculateAll();
      this.renderAll();
      this.runMonteCarloSim();
    } catch (err) {
      console.error('Initialization error:', err);
      this.showToast('⚠️ Error loading NFL schedule slate.');
    }
  }

  initWorker() {
    try {
      this.worker = new Worker('js/simulationWorker.js');
      this.worker.onmessage = (e) => {
        const { type, percent, results, error } = e.data;
        if (type === 'progress') {
          this.updateSimProgress(percent);
        } else if (type === 'complete') {
          this.state.simResults = results;
          this.state.isSimulating = false;
          this.renderSimulationResults();
        } else if (type === 'error') {
          console.error('Worker simulation error:', error);
          this.state.isSimulating = false;
        }
      };
    } catch (e) {
      console.warn('Web Worker initialization fallback:', e);
      this.worker = null;
    }
  }

  bindGlobalHandlers() {
    window.onPoolSizeInput = (val) => this.onPoolSizeInput(val);
    window.onStrategySelect = (strat) => this.onStrategySelect(strat);
    window.onPathTargetSelect = (target) => this.onPathTargetSelect(target);
    window.onWeekSelect = (week) => this.onWeekSelect(week);
    window.switchView = (view) => this.switchView(view);
    window.toggleLockPick = (week, teamCode) => this.toggleLockPick(week, teamCode);
    window.toggleExcludeTeam = (teamCode) => this.toggleExcludeTeam(teamCode);
    window.resetOverrides = () => this.resetOverrides();
    window.runMonteCarloSim = () => this.runMonteCarloSim();
    window.copySurvivorPath = () => this.copySurvivorPath();
    window.copyPickemSheet = () => this.copyPickemSheet();
    window.triggerBowieEasterEgg = (el) => this.triggerBowieEasterEgg(el);
  }

  onPoolSizeInput(val) {
    const size = parseInt(val, 10) || 100;
    this.state.poolSize = size;
    const badge = document.getElementById('poolSizeVal');
    if (badge) badge.textContent = size.toLocaleString();

    const tag = document.getElementById('poolScaleTag');
    if (tag) {
      if (size <= 30) tag.textContent = 'Small Office Pool (Chalk Safe)';
      else if (size <= 250) tag.textContent = 'Mid-Size Pool (Balanced EV)';
      else if (size <= 1000) tag.textContent = 'Large Contest (Contrarian Leverage)';
      else tag.textContent = 'Mega Pool (Max Leverage)';
    }

    this.recalculateAll();
    this.renderAll();
    this.runMonteCarloSim();
  }

  onStrategySelect(strat) {
    this.state.strategy = strat;
    document.querySelectorAll('.strategy-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.strategy === strat);
    });

    this.recalculateAll();
    this.renderAll();
    this.runMonteCarloSim();
  }

  onPathTargetSelect(target) {
    this.state.pathTarget = target;
    const horizonBtn = document.getElementById('targetHorizonBtn');
    const fullBtn = document.getElementById('targetFullBtn');

    if (horizonBtn) horizonBtn.classList.toggle('active', target === 'horizon');
    if (fullBtn) fullBtn.classList.toggle('active', target === 'full_season');

    this.recalculateAll();
    this.renderAll();
    this.runMonteCarloSim();
  }

  onWeekSelect(week) {
    this.state.activeWeek = parseInt(week, 10) || 1;
    const weekSelect = document.getElementById('weekSelect');
    if (weekSelect) weekSelect.value = this.state.activeWeek;

    this.recalculateWeeklyViews();
    this.renderWeeklySpotlight();
    this.renderWeeklySlateTable();
    this.renderPickemConfidenceTable();
  }

  switchView(view) {
    if (view === 'parlay') {
      this.showToast('⚡ Parlay Engine is coming in the next release! 🐾');
      return;
    }

    this.state.currentView = view;
    document.querySelectorAll('.view-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.view === view);
    });

    document.getElementById('survivorView').style.display = view === 'survivor' ? 'block' : 'none';
    document.getElementById('pickemView').style.display = view === 'pickem' ? 'block' : 'none';

    if (view === 'pickem') {
      this.renderPickemConfidenceTable();
    }
  }

  toggleLockPick(week, teamCode) {
    const w = parseInt(week, 10);
    if (this.state.lockedPicks[w] === teamCode) {
      delete this.state.lockedPicks[w];
      this.showToast(`Unlocked Week ${w} pick. 🔓`);
    } else {
      this.state.lockedPicks[w] = teamCode;
      this.state.excludedTeams.delete(teamCode);
      this.showToast(`Locked ${teamCode} to Week ${w}! 🔒`);
    }

    this.recalculateAll();
    this.renderAll();
    this.runMonteCarloSim();
  }

  toggleExcludeTeam(teamCode) {
    if (this.state.excludedTeams.has(teamCode)) {
      this.state.excludedTeams.delete(teamCode);
      this.showToast(`Restored ${teamCode} to candidate pool. ✅`);
    } else {
      this.state.excludedTeams.add(teamCode);
      Object.keys(this.state.lockedPicks).forEach(w => {
        if (this.state.lockedPicks[w] === teamCode) delete this.state.lockedPicks[w];
      });
      this.showToast(`Excluded ${teamCode} from all survivor paths. 🚫`);
    }

    this.recalculateAll();
    this.renderAll();
    this.runMonteCarloSim();
  }

  resetOverrides() {
    this.state.lockedPicks = {};
    this.state.excludedTeams.clear();
    this.showToast('Reset all locks and exclusions to optimal default. 🔄');
    this.recalculateAll();
    this.renderAll();
    this.runMonteCarloSim();
  }

  recalculateAll() {
    if (!this.state.slateData || this.state.slateData.length === 0) return;

    this.state.currentPathResult = this.engine.findOptimal18WeekPath(this.state.slateData, {
      poolSize: this.state.poolSize,
      strategy: this.state.strategy,
      pathTarget: this.state.pathTarget,
      lockedPicks: this.state.lockedPicks,
      excludedTeams: Array.from(this.state.excludedTeams)
    });

    const horizonWeek = this.state.currentPathResult.targetHorizon;
    const horizonBtn = document.getElementById('targetHorizonBtn');
    if (horizonBtn) {
      horizonBtn.innerHTML = `<span>🎯 Target: Pool Finish (W${horizonWeek})</span>`;
    }

    this.recalculateWeeklyViews();
  }

  recalculateWeeklyViews() {
    const horizon = this.state.currentPathResult?.targetHorizon || 18;
    this.state.weeklySpotlight = this.engine.categorizeWeeklyPicks(this.state.activeWeek, this.state.slateData, {
      poolSize: this.state.poolSize,
      targetHorizon: horizon
    });

    this.state.pickemConfidence = this.engine.generatePickemConfidence(this.state.activeWeek, this.state.slateData);
  }

  runMonteCarloSim() {
    if (!this.state.currentPathResult || !this.state.slateData) return;

    this.state.isSimulating = true;
    const simBtn = document.getElementById('runSimBtn');
    if (simBtn) {
      simBtn.innerHTML = '<span>⚡ Simulating 10,000 Pools...</span>';
      simBtn.disabled = true;
    }

    const horizon = this.state.currentPathResult.targetHorizon || 11;

    if (this.worker) {
      this.worker.postMessage({
        path: this.state.currentPathResult.path,
        slateData: this.state.slateData,
        poolSize: this.state.poolSize,
        iterations: 10000,
        targetHorizon: horizon
      });
    } else {
      setTimeout(() => {
        const results = this.runSyncFallbackSim(
          this.state.currentPathResult.path,
          this.state.slateData,
          this.state.poolSize,
          10000,
          horizon
        );
        this.state.simResults = results;
        this.state.isSimulating = false;
        this.renderSimulationResults();
      }, 50);
    }
  }

  runSyncFallbackSim(userPath, slateData, poolSize, iterations, targetHorizon) {
    const userPicksByWeek = {};
    userPath.forEach(p => { userPicksByWeek[p.week] = p.teamCode; });
    const totalPoolSize = Math.max(2, Math.min(10000, Number(poolSize) || 100));
    const numOpponents = totalPoolSize - 1;

    let totalWinEquity = 0;
    let userSurvivedHorizon = 0;
    let userSurvived18 = 0;
    const poolEndWeeks = [];

    for (let iter = 1; iter <= iterations; iter++) {
      let userAlive = true;
      let opponentsAlive = numOpponents;
      let poolFinishWeek = 18;
      let poolEndedEarly = false;

      for (let w = 1; w <= 18; w++) {
        const weekData = slateData.find(s => s.week === w);
        if (!weekData) continue;

        const gameOutcomes = {};
        weekData.games.forEach(g => {
          const homeWon = Math.random() < g.homeWinProb;
          gameOutcomes[g.homeTeam] = homeWon;
          gameOutcomes[g.awayTeam] = !homeWon;
        });

        const myTeam = userPicksByWeek[w];
        const userSurvivesThisWeek = (myTeam && myTeam !== '—' && gameOutcomes[myTeam] === true);

        let survivingOpponents = 0;
        if (opponentsAlive > 0) {
          const pickDist = [];
          let cum = 0;
          weekData.games.forEach(g => {
            cum += g.homePickPct; pickDist.push({ team: g.homeTeam, cum, won: gameOutcomes[g.homeTeam] });
            cum += g.awayPickPct; pickDist.push({ team: g.awayTeam, cum, won: gameOutcomes[g.awayTeam] });
          });

          for (let opp = 0; opp < opponentsAlive; opp++) {
            const r = Math.random() * (cum || 1.0);
            const picked = pickDist.find(p => r <= p.cum) || pickDist[pickDist.length - 1];
            if (picked && picked.won) survivingOpponents++;
          }
        }

        if (w === targetHorizon && userAlive && userSurvivesThisWeek) {
          userSurvivedHorizon++;
        }

        if (userAlive && !userSurvivesThisWeek) {
          userAlive = false;
          if (survivingOpponents === 0 && opponentsAlive > 0) {
            totalWinEquity += (1 / (1 + opponentsAlive));
            poolFinishWeek = w;
            poolEndedEarly = true;
            break;
          }
        } else if (userAlive && userSurvivesThisWeek) {
          if (survivingOpponents === 0) {
            totalWinEquity += 1.0;
            poolFinishWeek = w;
            poolEndedEarly = true;
            break;
          }
        }

        opponentsAlive = survivingOpponents;
        if (!userAlive && opponentsAlive === 0) {
          poolFinishWeek = w;
          poolEndedEarly = true;
          break;
        }
      }

      if (!poolEndedEarly) {
        poolFinishWeek = 18;
        if (userAlive) {
          userSurvived18++;
          totalWinEquity += (1 / (1 + opponentsAlive));
        }
      }

      poolEndWeeks.push(poolFinishWeek);
    }

    const avgPoolEnd = Number((poolEndWeeks.reduce((a, b) => a + b, 0) / iterations).toFixed(1));
    const winEquityPct = Number(((totalWinEquity / iterations) * 100).toFixed(2));
    const randomBaselinePct = Number(((1 / totalPoolSize) * 100).toFixed(2));
    const edgeMultiple = Number((winEquityPct / Math.max(0.001, randomBaselinePct)).toFixed(1));

    return {
      iterations,
      poolSize: totalPoolSize,
      winEquityPct,
      randomBaselinePct,
      edgeMultiple,
      expectedPoolEndWeek: avgPoolEnd,
      picksNeededToWin: Math.round(avgPoolEnd),
      horizonSurvivalPct: Number(((userSurvivedHorizon / iterations) * 100).toFixed(1)),
      fullSeasonSurvivalPct: Number(((userSurvived18 / iterations) * 100).toFixed(2)),
      targetHorizon
    };
  }

  updateSimProgress(pct) {
    const simBtn = document.getElementById('runSimBtn');
    if (simBtn) {
      simBtn.innerHTML = `<span>⚡ Simulating (${pct}%)...</span>`;
    }
  }

  renderAll() {
    this.renderHeaderAdvice();
    this.renderSpotlightCards();
    this.renderWeeklySlateTable();
    this.renderPathMatrix();
    this.renderSimulationResults();
  }

  renderHeaderAdvice() {
    const adviceEl = document.getElementById('bowieSpeech');
    if (!adviceEl) return;

    const size = this.state.poolSize;
    const horizon = this.state.currentPathResult?.targetHorizon || 11;
    let text = '';

    if (size <= 40) {
      text = `"In a ${size}-person pool, the field is expected to be wiped out by Week ${horizon}. Don't save elite teams for December—deploy them now!" 🐾`;
    } else if (size <= 300) {
      text = `"In a ${size}-entry pool, aim for Week ${horizon}. Look for 1 or 2 high-EV leverage pivots while reserving top tier teams for the Week ${horizon} finish line." 🦴`;
    } else {
      text = `"In a massive ${size.toLocaleString()}-entry contest, the pool will likely last through Week 17–18. Fade heavy 30%+ national chalk to maximize your solo equity!" 🚀`;
    }

    adviceEl.textContent = text;
  }

  renderSpotlightCards() {
    const container = document.getElementById('spotlightGrid');
    if (!container || !this.state.weeklySpotlight) return;

    const { leverage, chalk, trap } = this.state.weeklySpotlight;

    container.innerHTML = `
      <!-- Top Leverage Pick -->
      <div class="spotlight-card card-leverage">
        <span class="spotlight-tag tag-leverage">⚡ Top Leverage Pick</span>
        <div class="spotlight-team-header">
          <div>
            <div class="spotlight-team-name">${leverage ? leverage.teamName : 'None'}</div>
            <div class="spotlight-opp">${leverage ? (leverage.isHome ? 'vs' : '@') + ' ' + leverage.oppName + ' (' + (leverage.spread < 0 ? leverage.spread : '+' + leverage.spread) + ')' : '—'}</div>
          </div>
          <button class="btn-secondary" onclick="toggleLockPick(${this.state.activeWeek}, '${leverage ? leverage.teamCode : ''}')" style="font-size:11px;padding:3px 8px;">
            ${this.state.lockedPicks[this.state.activeWeek] === (leverage ? leverage.teamCode : '') ? '🔒 Locked' : '🔒 Lock Pick'}
          </button>
        </div>
        <div class="spotlight-metrics-grid">
          <div>
            <div class="spotlight-metric-val" style="color:var(--accent);">${leverage ? leverage.ev : '—'}</div>
            <div class="spotlight-metric-lbl">Expected Value</div>
          </div>
          <div>
            <div class="spotlight-metric-val">${leverage ? (leverage.winProb * 100).toFixed(0) + '%' : '—'}</div>
            <div class="spotlight-metric-lbl">Win Odds</div>
          </div>
          <div>
            <div class="spotlight-metric-val" style="color:var(--muted);">${leverage ? (leverage.pickPct * 100).toFixed(1) + '%' : '—'}</div>
            <div class="spotlight-metric-lbl">Public Pick %</div>
          </div>
        </div>
        <div class="spotlight-desc">High win probability paired with modest public pick share generates immense pool leverage.</div>
      </div>

      <!-- Chalk Pick -->
      <div class="spotlight-card card-chalk">
        <span class="spotlight-tag tag-chalk">🏆 Slate Chalk Favorite</span>
        <div class="spotlight-team-header">
          <div>
            <div class="spotlight-team-name">${chalk ? chalk.teamName : 'None'}</div>
            <div class="spotlight-opp">${chalk ? (chalk.isHome ? 'vs' : '@') + ' ' + chalk.oppName + ' (' + (chalk.spread < 0 ? chalk.spread : '+' + chalk.spread) + ')' : '—'}</div>
          </div>
          <button class="btn-secondary" onclick="toggleLockPick(${this.state.activeWeek}, '${chalk ? chalk.teamCode : ''}')" style="font-size:11px;padding:3px 8px;">
            ${this.state.lockedPicks[this.state.activeWeek] === (chalk ? chalk.teamCode : '') ? '🔒 Locked' : '🔒 Lock Pick'}
          </button>
        </div>
        <div class="spotlight-metrics-grid">
          <div>
            <div class="spotlight-metric-val" style="color:var(--gold);">${chalk ? (chalk.winProb * 100).toFixed(0) + '%' : '—'}</div>
            <div class="spotlight-metric-lbl">Win Odds</div>
          </div>
          <div>
            <div class="spotlight-metric-val">${chalk ? chalk.ev : '—'}</div>
            <div class="spotlight-metric-lbl">Expected Value</div>
          </div>
          <div>
            <div class="spotlight-metric-val">${chalk ? (chalk.pickPct * 100).toFixed(1) + '%' : '—'}</div>
            <div class="spotlight-metric-lbl">Public Pick %</div>
          </div>
        </div>
        <div class="spotlight-desc">Safest raw survival odds on the board. Optimal for small pools and guaranteed progression.</div>
      </div>

      <!-- Trap Pick -->
      <div class="spotlight-card card-trap">
        <span class="spotlight-tag tag-trap">⚠️ Contrarian Trap Alert</span>
        <div class="spotlight-team-header">
          <div>
            <div class="spotlight-team-name">${trap ? trap.teamName : 'None'}</div>
            <div class="spotlight-opp">${trap ? (trap.isHome ? 'vs' : '@') + ' ' + trap.oppName + ' (' + (trap.spread < 0 ? trap.spread : '+' + trap.spread) + ')' : '—'}</div>
          </div>
          <button class="btn-secondary" onclick="toggleExcludeTeam('${trap ? trap.teamCode : ''}')" style="font-size:11px;padding:3px 8px;color:var(--danger);">
            ${this.state.excludedTeams.has(trap ? trap.teamCode : '') ? '🚫 Excluded' : '🚫 Exclude'}
          </button>
        </div>
        <div class="spotlight-metrics-grid">
          <div>
            <div class="spotlight-metric-val" style="color:var(--danger);">${trap ? (trap.pickPct * 100).toFixed(1) + '%' : '—'}</div>
            <div class="spotlight-metric-lbl">Over-Owned %</div>
          </div>
          <div>
            <div class="spotlight-metric-val">${trap ? (trap.winProb * 100).toFixed(0) + '%' : '—'}</div>
            <div class="spotlight-metric-lbl">Win Odds</div>
          </div>
          <div>
            <div class="spotlight-metric-val" style="color:var(--danger);">${trap ? trap.ev : '—'}</div>
            <div class="spotlight-metric-lbl">Expected Value</div>
          </div>
        </div>
        <div class="spotlight-desc">Heavy public ownership without elite win probability. A loss here wipes out a huge fraction of the pool!</div>
      </div>
    `;
  }

  renderWeeklySlateTable() {
    const container = document.getElementById('weeklySlateBody');
    if (!container || !this.state.weeklySpotlight) return;

    const picks = this.state.weeklySpotlight.all;
    const currentWeekPick = this.state.currentPathResult?.path.find(p => p.week === this.state.activeWeek)?.teamCode;

    container.innerHTML = picks.map(p => {
      const isPathPick = currentWeekPick === p.teamCode;
      const isLocked = this.state.lockedPicks[this.state.activeWeek] === p.teamCode;
      const isExcluded = this.state.excludedTeams.has(p.teamCode);

      const loc = p.isHome ? 'vs' : '@';
      const spreadStr = p.spread < 0 ? `${p.spread}` : `+${p.spread}`;

      return `
        <tr style="${isPathPick ? 'background: rgba(245, 158, 11, 0.08); font-weight:700;' : ''}">
          <td style="font-weight:800;color:#fff;">
            ${p.teamCode} <span style="font-size:11px;color:var(--muted);font-weight:400;">(${p.teamName})</span>
            ${isPathPick ? '<span class="spotlight-tag tag-chalk" style="margin-left:6px;font-size:9px;padding:1px 5px;">PATH PICK</span>' : ''}
          </td>
          <td>${loc} ${p.oppCode}</td>
          <td style="font-family:var(--font-mono);">${spreadStr}</td>
          <td>
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-family:var(--font-mono);min-width:34px;">${(p.winProb * 100).toFixed(0)}%</span>
              <div style="flex:1;height:5px;background:var(--panel2);border-radius:3px;overflow:hidden;">
                <div style="width:${p.winProb * 100}%;height:100%;background:${p.winProb >= 0.70 ? 'var(--accent)' : (p.winProb >= 0.55 ? 'var(--gold)' : 'var(--danger)')};"></div>
              </div>
            </div>
          </td>
          <td style="font-family:var(--font-mono);">${(p.pickPct * 100).toFixed(1)}%</td>
          <td style="font-family:var(--font-mono);font-weight:800;color:${p.ev >= 1.2 ? 'var(--accent)' : (p.ev >= 0.8 ? 'var(--gold)' : 'var(--danger)')};">${p.ev}</td>
          <td style="font-family:var(--font-mono);color:var(--muted);">${p.futureValue}</td>
          <td style="text-align:right;">
            <button class="btn-secondary" onclick="toggleLockPick(${this.state.activeWeek}, '${p.teamCode}')" style="padding:2px 8px;font-size:11px;margin-right:4px;">
              ${isLocked ? '🔒 Locked' : 'Lock'}
            </button>
            <button class="btn-secondary" onclick="toggleExcludeTeam('${p.teamCode}')" style="padding:2px 8px;font-size:11px;color:${isExcluded ? 'var(--accent)' : 'var(--danger)'};">
              ${isExcluded ? 'Include' : 'Exclude'}
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  renderPathMatrix() {
    const headerRow = document.getElementById('matrixHeaderRow');
    const tableBody = document.getElementById('matrixBody');
    if (!headerRow || !tableBody || !this.state.slateData) return;

    const horizonWeek = this.state.currentPathResult?.targetHorizon || 11;

    let headersHtml = '<th class="team-col">TEAM</th>';
    for (let w = 1; w <= 18; w++) {
      const isFinishCol = w === horizonWeek;
      headersHtml += `<th class="${isFinishCol ? 'matrix-finish-header' : ''}" title="${isFinishCol ? 'Expected Pool Finish Line (Week ' + w + ')' : 'Week ' + w}">W${w}</th>`;
    }
    headerRow.innerHTML = headersHtml;

    const pathPickMap = {};
    if (this.state.currentPathResult && this.state.currentPathResult.path) {
      this.state.currentPathResult.path.forEach(p => {
        pathPickMap[p.week] = p.teamCode;
      });
    }

    const TEAMS_LIST = [
      'KC', 'BAL', 'SF', 'DET', 'PHI', 'BUF', 'HOU', 'GB',
      'CIN', 'DAL', 'MIA', 'LAR', 'ATL', 'NYJ', 'CHI', 'TB',
      'PIT', 'JAX', 'IND', 'SEA', 'LAC', 'MIN', 'NO', 'CLE',
      'WAS', 'ARI', 'LV', 'TEN', 'DEN', 'NYG', 'NE', 'CAR'
    ];

    tableBody.innerHTML = TEAMS_LIST.map(team => {
      let rowHtml = `<td class="team-col">${team}</td>`;

      for (let w = 1; w <= 18; w++) {
        const game = this.engine.getTeamGame(team, w, this.state.slateData);
        const isFinishCol = w === horizonWeek;
        const isBeyond = w > horizonWeek;

        if (!game || game.isBye) {
          rowHtml += `<td class="cell-bye ${isFinishCol ? 'matrix-finish-col' : ''}" title="${team} Bye Week">—</td>`;
          continue;
        }

        const isPicked = pathPickMap[w] === team;
        const isLocked = this.state.lockedPicks[w] === team;
        const prob = game.winProb;

        let cellClass = 'cell-toss';
        if (prob >= 0.75) cellClass = 'cell-elite';
        else if (prob >= 0.65) cellClass = 'cell-fav';
        else if (prob < 0.45) cellClass = 'cell-dog';

        if (isPicked) cellClass += isLocked ? ' cell-locked' : ' cell-picked';
        if (isFinishCol) cellClass += ' matrix-finish-col';
        if (isBeyond && !isPicked) cellClass += ' cell-beyond-horizon';

        const loc = game.isHome ? 'vs' : '@';
        const titleText = `Week ${w}: ${team} ${loc} ${game.oppCode} (${(prob*100).toFixed(0)}% win odds, EV: ${this.engine.calculateEV(prob, game.pickPct, this.state.poolSize)})${isFinishCol ? ' 🏁 [EXPECTED POOL FINISH]' : ''}`;

        rowHtml += `
          <td class="${cellClass}" title="${titleText}" onclick="toggleLockPick(${w}, '${team}')" style="cursor:pointer;">
            <div style="font-weight:700;">${(prob * 100).toFixed(0)}%</div>
            <div style="font-size:9.5px;opacity:0.8;">${loc}${game.oppCode}</div>
          </td>
        `;
      }

      return `<tr>${rowHtml}</tr>`;
    }).join('');
  }

  renderPickemConfidenceTable() {
    const container = document.getElementById('pickemTableBody');
    if (!container || !this.state.pickemConfidence) return;

    container.innerHTML = this.state.pickemConfidence.map(g => {
      const loc = g.isHome ? 'vs' : '@';
      const spreadStr = g.spread < 0 ? `${g.spread}` : `+${g.spread}`;

      let tierClass = 'tier-low';
      if (g.confidence >= 12) tierClass = 'tier-high';
      else if (g.confidence >= 6) tierClass = 'tier-mid';

      return `
        <tr>
          <td>
            <span class="confidence-badge ${tierClass}">${g.confidence}</span>
          </td>
          <td style="font-weight:800;color:#fff;">
            ${g.pickedTeam} <span style="font-size:11px;color:var(--muted);font-weight:400;">(${g.pickedTeamName})</span>
          </td>
          <td>${loc} ${g.oppTeam} <span style="font-size:11px;color:var(--muted);">(${g.oppTeamName})</span></td>
          <td style="font-family:var(--font-mono);">${spreadStr}</td>
          <td>
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-family:var(--font-mono);min-width:34px;">${(g.winProb * 100).toFixed(0)}%</span>
              <div style="flex:1;height:5px;background:var(--panel2);border-radius:3px;overflow:hidden;">
                <div style="width:${g.winProb * 100}%;height:100%;background:${g.winProb >= 0.70 ? 'var(--accent)' : (g.winProb >= 0.55 ? 'var(--gold)' : 'var(--danger)')};"></div>
              </div>
            </div>
          </td>
          <td style="font-family:var(--font-mono);">${(g.pickPct * 100).toFixed(1)}%</td>
          <td>
            ${g.isLeveragePlay 
              ? `<span class="spotlight-tag tag-leverage" style="font-size:9.5px;margin:0;">⚡ +${g.edge}% EDGE</span>`
              : `<span style="color:var(--muted);font-size:11.5px;">Standard Chalk</span>`}
          </td>
        </tr>
      `;
    }).join('');
  }

  renderSimulationResults() {
    const simBtn = document.getElementById('runSimBtn');
    if (simBtn) {
      simBtn.innerHTML = '<span>⚡ Re-Run 10k Monte Carlo</span>';
      simBtn.disabled = false;
    }

    if (!this.state.simResults) return;

    const r = this.state.simResults;
    const equityEl = document.getElementById('simWinEquity');
    const edgeSubEl = document.getElementById('simEdgeSub');
    const finishEl = document.getElementById('simExpectedFinish');
    const finishSubEl = document.getElementById('simFinishSub');
    const picksEl = document.getElementById('simPicksNeeded');
    const oddsEl = document.getElementById('simHorizonOdds');
    const oddsSubEl = document.getElementById('simOddsSub');

    if (equityEl) equityEl.textContent = `${r.winEquityPct}%`;
    if (edgeSubEl) edgeSubEl.textContent = `${r.edgeMultiple}x edge vs ${r.randomBaselinePct}% baseline`;
    if (finishEl) finishEl.textContent = `Week ${r.expectedPoolEndWeek}`;
    if (finishSubEl) finishSubEl.textContent = `When all ${r.poolSize} opponents are expected to be out`;
    if (picksEl) picksEl.textContent = `${r.picksNeededToWin} Wins`;
    if (oddsEl) oddsEl.textContent = `${r.horizonSurvivalPct}%`;
    if (oddsSubEl) oddsSubEl.textContent = `Odds to reach Week ${r.targetHorizon} (${r.fullSeasonSurvivalPct}% full 18-wk)`;
  }

  copySurvivorPath() {
    if (!this.state.currentPathResult) return;
    const text = this.engine.formatClipboardSurvivorPath(this.state.currentPathResult, {
      poolSize: this.state.poolSize
    });

    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        this.showToast('📋 Copied Optimal Survivor Path to clipboard! 🐾');
      }).catch(() => {
        this.showToast('Copied path to clipboard!');
      });
    }
  }

  copyPickemSheet() {
    if (!this.state.pickemConfidence) return;
    const text = this.engine.formatClipboardPickem(this.state.pickemConfidence, this.state.activeWeek);

    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        this.showToast(`📋 Copied Week ${this.state.activeWeek} Pick'em Sheet to clipboard! 🐾`);
      }).catch(() => {
        this.showToast('Copied pick\'em sheet to clipboard!');
      });
    }
  }

  triggerBowieEasterEgg(el) {
    if (el) {
      el.style.transform = 'scale(1.3) rotate(360deg)';
      setTimeout(() => { el.style.transform = ''; }, 600);
    }
    const barkQuotes = [
      "Woof! Math never lies — always fade the consensus trap!",
      "10,000 simulations completed in milliseconds. Golden bones for all!",
      "Survivor is a game of survival AND leverage. Play to win the whole pool!",
      "Bark! Don't save elite teams for December if your pool ends in October."
    ];
    const q = barkQuotes[Math.floor(Math.random() * barkQuotes.length)];
    this.showToast(q);
  }

  showToast(msg) {
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => { toast.classList.remove('show'); }, 3000);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.oddsApp = new OddsSuiteApp();
});
