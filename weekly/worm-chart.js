/**
 * Scout Bowie In-Game Win Probability Tracker & Two-Tone Worm Chart Engine
 * Vanilla JS & SVG renderer with real-time time-series state management.
 */

export class WormChartEngine {
  constructor(options = {}) {
    this.containerId = options.containerId || 'wormChartContainer';
    this.bottomBarId = options.bottomBarId || 'wormBottomBar';
    this.drawerId = options.drawerId || 'wormDrawerPanel';
    this.isDrawerOpen = false;
    this.history = [];
    this.currentSnapshotIdx = -1;
    this.isPlaying = false;
    this.playbackTimer = null;
    this.leagueId = null;
    this.week = 1;
    this.userTeamName = 'Your Team';
    this.oppTeamName = 'Opponent';
    this.userAvatar = '';
    this.oppAvatar = '';
    this.onSnapshotSelected = options.onSnapshotSelected || null;
    this.worker = null;
    this.initWorker();
  }

  /**
   * Initialize Web Worker for non-blocking 10k simulations
   */
  initWorker() {
    try {
      if (typeof window !== 'undefined' && window.Worker) {
        this.worker = new Worker('./monte-carlo-worker.js');
        this.worker.onmessage = (e) => {
          if (e.data && e.data.action === 'SIMULATION_COMPLETE') {
            this.handleWorkerSimResult(e.data.results);
          }
        };
      }
    } catch (err) {
      console.warn('Web Worker initialization fallback to sync mode:', err);
      this.worker = null;
    }
  }

  /**
   * Dispatch 10k Monte Carlo simulation to Web Worker
   */
  simulateInGame(userStarters, oppStarters, context = {}) {
    return new Promise((resolve) => {
      if (this.worker) {
        const jobId = `sim_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        const handler = (e) => {
          if (e.data && e.data.action === 'SIMULATION_COMPLETE' && e.data.results?.jobId === jobId) {
            this.worker.removeEventListener('message', handler);
            resolve(e.data.results);
          }
        };
        this.worker.addEventListener('message', handler);
        this.worker.postMessage({
          action: 'SIMULATE',
          jobId,
          userStarters,
          oppStarters,
          numIterations: 10000,
          context
        });
      } else {
        // Fallback synchronous execution
        import('./weekly-app.js').then(app => {
          // If worker unavailable, resolve via standard runner
          resolve(null);
        });
      }
    });
  }

  handleWorkerSimResult(results) {
    // Process background worker response
  }

  /**
   * Storage Key for Cross-Session Continuity
   */
  getStorageKey(leagueId, week) {
    return `scout_bowie_worm_${leagueId || 'demo'}_w${week || 1}`;
  }

  /**
   * Load Historical Snapshots from LocalStorage
   */
  loadHistory(leagueId, week) {
    this.leagueId = leagueId;
    this.week = week;
    const key = this.getStorageKey(leagueId, week);
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.history = parsed;
          this.currentSnapshotIdx = this.history.length - 1;
          return this.history;
        }
      }
    } catch (e) {
      console.warn('Error loading worm chart history:', e);
    }
    this.history = [];
    this.currentSnapshotIdx = -1;
    return [];
  }

  /**
   * Save Snapshots to LocalStorage
   */
  saveHistory(leagueId, week) {
    const key = this.getStorageKey(leagueId || this.leagueId, week || this.week);
    try {
      localStorage.setItem(key, JSON.stringify(this.history));
    } catch (e) {
      console.warn('Error saving worm chart history:', e);
    }
  }

  /**
   * Append a Live Snapshot
   */
  recordSnapshot(snapshot) {
    if (!snapshot) return;
    const now = Date.now();
    const entry = {
      timestamp: snapshot.timestamp || now,
      timeLabel: snapshot.timeLabel || this.formatTimeLabel(now),
      userScore: Number((snapshot.userScore || 0).toFixed(1)),
      opponentScore: Number((snapshot.opponentScore || 0).toFixed(1)),
      userWinPct: Math.max(0.1, Math.min(99.9, Number((snapshot.userWinPct ?? 50).toFixed(1)))),
      opponentWinPct: Math.max(0.1, Math.min(99.9, Number((snapshot.opponentWinPct ?? (100 - (snapshot.userWinPct ?? 50))).toFixed(1)))),
      keyEvent: snapshot.keyEvent || null,
      isSwing: Boolean(snapshot.isSwing),
      quarter: snapshot.quarter || null,
      clock: snapshot.clock || null
    };

    // Calculate swing delta vs previous point
    if (this.history.length > 0) {
      const last = this.history[this.history.length - 1];
      const delta = Math.abs(entry.userWinPct - last.userWinPct);
      if (delta >= 7.5) {
        entry.isSwing = true;
      }
    }

    this.history.push(entry);
    this.currentSnapshotIdx = this.history.length - 1;
    this.saveHistory(this.leagueId, this.week);

    this.render();
    this.updateBottomBar();
  }

  /**
   * Ensure Initial Kickoff Baseline Exists
   */
  ensureKickoffBaseline(initialWinProb = 50, userTeam = 'Your Team', oppTeam = 'Opponent') {
    this.userTeamName = userTeam;
    this.oppTeamName = oppTeam;

    if (this.history.length === 0) {
      const kickoffTime = Date.now() - 3600000 * 3; // 3 hours ago
      this.history.push({
        timestamp: kickoffTime,
        timeLabel: '1:00 PM (Kickoff)',
        userScore: 0.0,
        opponentScore: 0.0,
        userWinPct: Number(initialWinProb.toFixed(1)),
        opponentWinPct: Number((100 - initialWinProb).toFixed(1)),
        keyEvent: '🏈 Matchup Kickoff',
        isSwing: false,
        quarter: '1Q',
        clock: '15:00'
      });
      this.currentSnapshotIdx = 0;
      this.saveHistory(this.leagueId, this.week);
    }
  }

  /**
   * Generate Interactive Demo Gameday Timeline (Mid-Matchup 4:20 PM State)
   */
  loadDemoTimeline(userTeam = 'Quantum Blitz', oppTeam = 'Apex Predators', baseWinProb = 79.1) {
    this.userTeamName = userTeam || 'Quantum Blitz';
    this.oppTeamName = oppTeam || 'Apex Predators';
    this.leagueId = 'demo_championship_league_2025';
    this.week = 1;

    const baseTime = Date.now() - 28800000; // 8 hours ago

    this.history = [
      {
        timestamp: baseTime,
        timeLabel: '1:00 PM',
        userScore: 0.0,
        opponentScore: 0.0,
        userWinPct: 62.4,
        opponentWinPct: 37.6,
        keyEvent: '🏈 1:00 PM Early Window Kickoff',
        isSwing: false,
        quarter: '1Q',
        clock: '15:00'
      },
      {
        timestamp: baseTime + 1200000,
        timeLabel: '1:20 PM',
        userScore: 9.1,
        opponentScore: 2.3,
        userWinPct: 69.8,
        opponentWinPct: 30.2,
        keyEvent: '⚡ Christian McCaffrey 18yd rush + 2 rec',
        isSwing: true,
        quarter: '1Q',
        clock: '6:45'
      },
      {
        timestamp: baseTime + 2400000,
        timeLabel: '1:40 PM',
        userScore: 14.8,
        opponentScore: 11.2,
        userWinPct: 64.2,
        opponentWinPct: 35.8,
        keyEvent: '⚠️ Opponent Saquon Barkley 4yd TD plunge',
        isSwing: false,
        quarter: '1Q',
        clock: '0:30'
      },
      {
        timestamp: baseTime + 3600000,
        timeLabel: '2:00 PM',
        userScore: 28.5,
        opponentScore: 16.4,
        userWinPct: 78.5,
        opponentWinPct: 21.5,
        keyEvent: '🚀 Christian McCaffrey 42yd TD breakaway!',
        isSwing: true,
        quarter: '2Q',
        clock: '8:15'
      },
      {
        timestamp: baseTime + 5400000,
        timeLabel: '2:30 PM',
        userScore: 36.2,
        opponentScore: 31.0,
        userWinPct: 68.1,
        opponentWinPct: 31.9,
        keyEvent: '⚡ Sam LaPorta 18yd TD grab; Opponent TD answer',
        isSwing: true,
        quarter: '2Q',
        clock: '0:00 (Half)'
      },
      {
        timestamp: baseTime + 7200000,
        timeLabel: '3:00 PM',
        userScore: 48.7,
        opponentScore: 49.5,
        userWinPct: 48.6,
        opponentWinPct: 51.4,
        keyEvent: '🚨 MOMENTUM FLIP: Opponent CeeDee Lamb 2TD explosion',
        isSwing: true,
        quarter: '3Q',
        clock: '11:20'
      },
      {
        timestamp: baseTime + 8400000,
        timeLabel: '3:20 PM',
        userScore: 52.1,
        opponentScore: 58.6,
        userWinPct: 39.2,
        opponentWinPct: 60.8,
        keyEvent: '⚠️ Opponent FG; Quantum Blitz trail by 6.5 pts',
        isSwing: true,
        quarter: '3Q',
        clock: '4:10'
      },
      {
        timestamp: baseTime + 10200000,
        timeLabel: '3:50 PM',
        userScore: 68.4,
        opponentScore: 62.0,
        userWinPct: 72.4,
        opponentWinPct: 27.6,
        keyEvent: '🔥 Amon-Ra St. Brown 32yd TD & 2-pt conversion!',
        isSwing: true,
        quarter: '4Q',
        clock: '8:45'
      },
      {
        timestamp: baseTime + 12000000,
        timeLabel: '4:20 PM',
        userScore: 78.9,
        opponentScore: 68.4,
        userWinPct: 79.1,
        opponentWinPct: 20.9,
        keyEvent: '🏁 1:00 PM Games Final • 4:25 PM Afternoon Window Kicking Off',
        isSwing: true,
        quarter: '4:20 PM',
        clock: '15:00'
      }
    ];

    this.currentSnapshotIdx = this.history.length - 1;
    this.saveHistory(this.leagueId, this.week);
    this.render();
    this.updateBottomBar();
  }

  /**
   * Format timestamp into friendly hour:minute string
   */
  formatTimeLabel(timestamp) {
    const d = new Date(timestamp);
    let hours = d.getHours();
    const minutes = d.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${hours}:${minutes} ${ampm}`;
  }

  /**
   * Toggle Bottom Drawer Open/Closed
   */
  toggleDrawer() {
    this.isDrawerOpen = !this.isDrawerOpen;
    const drawer = document.getElementById(this.drawerId);
    const bottomBar = document.getElementById(this.bottomBarId);
    const chevron = document.getElementById('wormDrawerChevron');

    if (drawer) {
      drawer.classList.toggle('active', this.isDrawerOpen);
    }
    if (bottomBar) {
      bottomBar.classList.toggle('drawer-open', this.isDrawerOpen);
    }
    if (chevron) {
      chevron.innerHTML = this.isDrawerOpen ? '&#9660;' : '&#9650;';
    }

    if (this.isDrawerOpen) {
      this.render();
    }
  }

  openDrawer() {
    if (!this.isDrawerOpen) this.toggleDrawer();
  }

  closeDrawer() {
    if (this.isDrawerOpen) this.toggleDrawer();
  }

  /**
   * Update Collapsed Bottom Live Bar
   */
  updateBottomBar() {
    if (typeof document === 'undefined') return;
    const bar = document.getElementById(this.bottomBarId);
    if (!bar) return;
    bar.style.display = (this.history && this.history.length > 0) ? 'flex' : 'none';
  }

  /**
   * Scrub Timeline to a specific snapshot index
   */
  scrubTo(index) {
    if (index < 0 || index >= this.history.length) return;
    this.currentSnapshotIdx = index;
    this.render();
    this.updateBottomBar();

    if (this.onSnapshotSelected) {
      this.onSnapshotSelected(this.history[index]);
    }
  }

  /**
   * Play / Animate Timeline
   */
  togglePlay() {
    if (this.isPlaying) {
      this.pauseTimeline();
    } else {
      this.playTimeline();
    }
  }

  playTimeline() {
    this.isPlaying = true;
    const playBtn = document.getElementById('wormPlayBtn');
    if (playBtn) playBtn.innerHTML = '⏸ Pause';

    if (this.currentSnapshotIdx >= this.history.length - 1) {
      this.currentSnapshotIdx = 0;
    }

    clearInterval(this.playbackTimer);
    this.playbackTimer = setInterval(() => {
      if (this.currentSnapshotIdx < this.history.length - 1) {
        this.scrubTo(this.currentSnapshotIdx + 1);
      } else {
        this.pauseTimeline();
      }
    }, 1200);
  }

  pauseTimeline() {
    this.isPlaying = false;
    clearInterval(this.playbackTimer);
    const playBtn = document.getElementById('wormPlayBtn');
    if (playBtn) playBtn.innerHTML = '▶ Replay Matchup';
  }

  /**
   * Render SVG Two-Tone Split Worm Chart
   */
  render() {
    if (typeof document === 'undefined') return;
    const container = document.getElementById(this.containerId);
    if (!container) return;

    if (!this.history || this.history.length === 0) {
      container.innerHTML = `
        <div class="worm-empty-state">
          <div style="font-size:24px;margin-bottom:6px;">📈</div>
          <div style="font-weight:700;color:#fff;">Awaiting Live In-Game Gameday Snapshots</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px;">Win probability swings will chart live in real-time as games kick off.</div>
        </div>
      `;
      return;
    }

    const rect = container.getBoundingClientRect();
    const width = Math.max(700, Math.floor(rect.width || 960));
    const height = Math.max(160, Math.floor((rect.height || 220) - 40)); // Reserve 40px for top status strip
    const padTop = 16;
    const padBottom = 26;
    const padLeft = 45;
    const padRight = 75;
    const chartW = width - padLeft - padRight;
    const chartH = height - padTop - padBottom;
    const midY = padTop + chartH * 0.5; // Exact 50% Coin Flip Line

    const data = this.history;
    const totalPts = data.length;

    // Fixed full-day domain: 1:00 PM Kickoff to ~11:00 PM Final (10 hours total window)
    const tStart = data[0].timestamp;
    const isFullDayFinal = data.some(d => d.quarter?.includes('FINAL') && d.timeLabel?.includes('10:45'));
    const totalDurationMs = isFullDayFinal 
      ? Math.max(3600000, data[data.length - 1].timestamp - tStart) 
      : (10 * 3600 * 1000); // 10-hour standard NFL Sunday slate
    const tEnd = tStart + totalDurationMs;

    // Coordinate mapping (fills dynamically across fixed domain)
    const getX = (timestamp) => {
      const frac = Math.max(0.0, Math.min(1.0, (timestamp - tStart) / (tEnd - tStart)));
      return padLeft + frac * chartW;
    };
    const getY = (winPct) => padTop + chartH * (1.0 - Math.max(0.01, Math.min(99.99, winPct)) / 100.0);

    const points = data.map((d, i) => ({
      x: Number(getX(d.timestamp).toFixed(1)),
      y: Number(getY(d.userWinPct).toFixed(1)),
      winPct: d.userWinPct,
      oppWinPct: d.opponentWinPct,
      raw: d,
      idx: i
    }));

    // Build smooth cubic bezier line path
    let linePathD = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];

      const cp1x = Number((p1.x + (p2.x - p0.x) / 6).toFixed(1));
      const cp1y = Number((p1.y + (p2.y - p0.y) / 6).toFixed(1));
      const cp2x = Number((p2.x - (p3.x - p1.x) / 6).toFixed(1));
      const cp2y = Number((p2.y - (p3.y - p1.y) / 6).toFixed(1));

      linePathD += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }

    const firstX = points[0].x;
    const lastX = points[points.length - 1].x;

    // Upper Area Path (User Team > 50% Area)
    const upperAreaD = `${linePathD} L ${lastX} ${midY} L ${firstX} ${midY} Z`;

    // Lower Area Path (Opponent Team > 50% Area)
    const lowerAreaD = `${linePathD} L ${lastX} ${midY} L ${firstX} ${midY} Z`;

    const activeIdx = Math.min(this.currentSnapshotIdx >= 0 ? this.currentSnapshotIdx : points.length - 1, points.length - 1);
    const activePoint = points[activeIdx] || points[points.length - 1];

    // Static Milestone Dots (Strictly pinned to line)
    const swingPinsHtml = points.map(p => {
      const isCurrent = p.idx === activeIdx;
      const isSwing = p.raw.isSwing;
      if (!isSwing && !isCurrent && p.idx !== 0 && p.idx !== points.length - 1) return '';
      
      const pinColor = p.winPct >= 50 ? '#34d399' : '#c084fc';
      return `
        <g class="worm-pin" onclick="window.scrubWormTimeline(${p.idx})" style="cursor:pointer;">
          <circle cx="${p.x}" cy="${p.y}" r="${isCurrent ? 5.5 : 3.5}" fill="${pinColor}" stroke="#0f172a" stroke-width="1.5" />
          ${isCurrent ? `<circle cx="${p.x}" cy="${p.y}" r="9" fill="none" stroke="${pinColor}" stroke-width="1.5" opacity="0.6" />` : ''}
        </g>
      `;
    }).join('');

    // Fixed Full-Slate X-Axis Time Ticks (1:00 PM -> 4:25 PM -> 8:20 PM -> FINAL)
    const fixedTicks = [
      { label: '1:00 PM', x: padLeft, anchor: 'start' },
      { label: '4:25 PM', x: Number((padLeft + chartW * 0.34).toFixed(1)), anchor: 'middle' },
      { label: '8:20 PM (SNF)', x: Number((padLeft + chartW * 0.73).toFixed(1)), anchor: 'middle' },
      { label: 'FINAL', x: Number((padLeft + chartW).toFixed(1)), anchor: 'end' }
    ];

    const timeTicksHtml = fixedTicks.map(t => `
      <text x="${t.x}" y="${height - 6}" font-size="9.5" fill="#64748b" font-family="monospace" text-anchor="${t.anchor}" font-weight="700">
        ${t.label}
      </text>
    `).join('');

    const diff = Number((activePoint.raw.userScore - activePoint.raw.opponentScore).toFixed(1));
    const signDiff = diff >= 0 ? `+${diff}` : `${diff}`;
    const tagX = Math.min(activePoint.x + 10, width - 70);

    container.innerHTML = `
      <div class="worm-chart-wrapper" style="width:100%;height:100%;display:flex;flex-direction:column;">
        
        <!-- Pinned Top Momentum Event Strip -->
        <div class="worm-status-strip">
          <span class="wss-scores">
            <span style="color:#fff;font-weight:700;">${this.userTeamName}: <strong style="color:#34d399;">${activePoint.raw.userScore.toFixed(1)}</strong></span>
            <span style="color:#64748b;">vs</span>
            <span style="color:#fff;font-weight:700;">${this.oppTeamName}: <strong style="color:#c084fc;">${activePoint.raw.opponentScore.toFixed(1)}</strong></span>
            <span class="wss-margin ${diff >= 0 ? 'margin-pos' : 'margin-neg'}">${signDiff} pt lead</span>
          </span>
          ${activePoint.raw.keyEvent ? `<span class="wss-event">${activePoint.raw.keyEvent}</span>` : ''}
        </div>

        <!-- SVG Two-Tone Canvas -->
        <div style="flex:1;min-height:0;position:relative;">
          <svg viewBox="0 0 ${width} ${height}" class="worm-svg-canvas" preserveAspectRatio="xMidYMid meet">
            <defs>
              <!-- User Area Gradient (Above 50%) -->
              <linearGradient id="userAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#34d399" stop-opacity="0.35" />
                <stop offset="100%" stop-color="#34d399" stop-opacity="0.02" />
              </linearGradient>

              <!-- Opponent Area Gradient (Below 50%) -->
              <linearGradient id="oppAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#c084fc" stop-opacity="0.02" />
                <stop offset="100%" stop-color="#c084fc" stop-opacity="0.35" />
              </linearGradient>

              <!-- Clip to Upper Half (>= 50%) -->
              <clipPath id="upperHalfClip">
                <rect x="0" y="0" width="${width}" height="${midY}" />
              </clipPath>

              <!-- Clip to Lower Half (<= 50%) -->
              <clipPath id="lowerHalfClip">
                <rect x="0" y="${midY}" width="${width}" height="${height - midY}" />
              </clipPath>
            </defs>

            <!-- 50% Midline (Coin Flip) -->
            <line x1="${padLeft}" y1="${midY}" x2="${width - padRight}" y2="${midY}" stroke="rgba(255,255,255,0.18)" stroke-dasharray="4 4" stroke-width="1.2" />
            <text x="${padLeft + 6}" y="${midY - 5}" fill="rgba(255,255,255,0.4)" font-size="9" font-family="monospace" font-weight="700">
              50% COIN FLIP
            </text>

            <!-- 75% and 25% Gridlines -->
            <line x1="${padLeft}" y1="${getY(75)}" x2="${width - padRight}" y2="${getY(75)}" stroke="rgba(52, 211, 153, 0.08)" stroke-width="1" />
            <text x="${padLeft - 6}" y="${getY(75) + 3}" fill="#34d399" font-size="9" font-family="monospace" text-anchor="end" opacity="0.6">75%</text>

            <line x1="${padLeft}" y1="${getY(25)}" x2="${width - padRight}" y2="${getY(25)}" stroke="rgba(192, 132, 252, 0.08)" stroke-width="1" />
            <text x="${padLeft - 6}" y="${getY(25) + 3}" fill="#c084fc" font-size="9" font-family="monospace" text-anchor="end" opacity="0.6">25%</text>

            <!-- Two-Tone Fills -->
            <path d="${upperAreaD}" fill="url(#userAreaGrad)" clip-path="url(#upperHalfClip)" />
            <path d="${lowerAreaD}" fill="url(#oppAreaGrad)" clip-path="url(#lowerHalfClip)" />

            <!-- Main Win Probability Curve -->
            <path d="${linePathD}" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />

            <!-- Static Pinned Milestone Dots -->
            ${swingPinsHtml}

            <!-- Active Point Win % Callout Tag (Directly pinned at active head) -->
            <g transform="translate(${tagX}, ${activePoint.y})">
              <rect x="-4" y="-14" width="62" height="30" rx="4" fill="rgba(15, 23, 42, 0.85)" stroke="rgba(255,255,255,0.15)" stroke-width="1" />
              <text x="2" y="-3" fill="#34d399" font-size="10.5" font-weight="800" font-family="monospace">${activePoint.winPct}%</text>
              <text x="34" y="-3" fill="#94a3b8" font-size="7.5" font-weight="700">${this.userTeamName.substring(0, 4)}</text>
              <text x="2" y="11" fill="#c084fc" font-size="10.5" font-weight="800" font-family="monospace">${activePoint.oppWinPct}%</text>
              <text x="34" y="11" fill="#94a3b8" font-size="7.5" font-weight="700">${this.oppTeamName.substring(0, 4)}</text>
            </g>

            <!-- Time Ticks -->
            ${timeTicksHtml}
          </svg>
        </div>
      </div>
    `;

    // Render Timeline Slider Scrubber
    this.renderScrubberControls();
  }

  /**
   * Render Scrubber Slider in Drawer Header
   */
  renderScrubberControls() {
    if (typeof document === 'undefined') return;
    const scrubber = document.getElementById('wormTimelineScrubber');
    if (!scrubber) return;

    scrubber.min = 0;
    scrubber.max = Math.max(0, this.history.length - 1);
    scrubber.value = this.currentSnapshotIdx >= 0 ? this.currentSnapshotIdx : this.history.length - 1;
  }
}
