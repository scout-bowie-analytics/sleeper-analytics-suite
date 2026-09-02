/**
 * 🐾 Scout Bowie Methodology & Documentation Engine
 * In-App interactive dark-glass documentation modal.
 */

export class ScoutBowieDocsModal {
  constructor() {
    this.activeTab = 'sim';
    this.isOpen = false;
    this.init();
  }

  init() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('scoutDocsModalOverlay')) return;

    // Create Modal HTML
    const overlay = document.createElement('div');
    overlay.className = 'docs-modal-overlay';
    overlay.id = 'scoutDocsModalOverlay';
    overlay.onclick = (e) => {
      if (e.target === overlay) this.close();
    };

    overlay.innerHTML = `
      <div class="docs-modal-card" onclick="event.stopPropagation()">
        <!-- Header -->
        <div class="docs-header">
          <div class="docs-header-left">
            <img src="../assets/scout-bowie.webp" class="docs-avatar" alt="Scout Bowie" onerror="this.onerror=null; this.src='../Bowie.jpg'; if (this.src.includes('/weekly/')) this.src='../assets/scout-bowie.webp';">
            <div class="docs-title-group">
              <h2>🐾 Scout Bowie Quantitative Methodology & Docs</h2>
              <p>Under the hood: 10,000x Monte Carlo, Brownian Bridge Decay, FAAB Math, & Vegas Market Signals</p>
            </div>
          </div>
          <button class="docs-close-btn" onclick="window.closeDocsModal()" title="Close Documentation">&times;</button>
        </div>

        <!-- Tabs Navigation -->
        <div class="docs-nav-tabs">
          <button class="docs-tab-btn active" data-tab="sim" onclick="window.switchDocsTab('sim')">
            🎲 10K Monte Carlo
          </button>
          <button class="docs-tab-btn" data-tab="worm" onclick="window.switchDocsTab('worm')">
            📈 In-Game Swing & Decay
          </button>
          <button class="docs-tab-btn" data-tab="waiver" onclick="window.switchDocsTab('waiver')">
            📡 Waiver Radar & FAAB
          </button>
          <button class="docs-tab-btn" data-tab="sentinel" onclick="window.switchDocsTab('sentinel')">
            🚨 Alert Sentinel & Wind
          </button>
          <button class="docs-tab-btn" data-tab="draft" onclick="window.switchDocsTab('draft')">
            🎯 Draft Reach & CDF
          </button>
        </div>

        <!-- Content Body -->
        <div class="docs-body">
          
          <!-- Tab 1: Monte Carlo Simulation Engine -->
          <div id="docsTab_sim" class="docs-section active">
            <div class="docs-card-box">
              <h3>🎲 Why 10,000 Monte Carlo Runs Instead of Static Averages?</h3>
              <p>In fantasy football, single projected averages (e.g. <em>"14.5 pts"</em>) fail because fantasy scoring is highly <strong>right-skewed</strong>. Touchdowns create massive non-linear spikes, while injuries or game scripts create low-scoring bust tails.</p>
              <p>Scout Bowie runs <strong>10,000 full game iterations</strong> for every matchup. Each player's score is sampled from a parameterized <strong>log-normal distribution</strong> matching historical variance:</p>
              <div class="docs-formula-box">
                X ~ Lognormal(&mu;, &sigma;&sup2;) &nbsp;|&nbsp; Floor₁₀ = e^(&mu; - 1.28&sigma;), &nbsp; Ceiling₉₀ = e^(&mu; + 1.28&sigma;)
              </div>
            </div>

            <div class="docs-card-box">
              <h3>🎯 3-Way Quantitative Lineup Solver</h3>
              <p>Our linear optimizer selects starters under strict positional lock rules across 3 distinct matchup objectives:</p>
              <ul>
                <li><strong style="color:#facc15;">Balanced / Mean:</strong> Maximizes total expected points E[Total] when facing an even opponent.</li>
                <li><strong style="color:#34d399;">Max Upside (Boom Hunting):</strong> When trailing as an underdog, slots high-variance players whose 90th percentile ceilings maximize genuine win probability.</li>
                <li><strong style="color:#38bdf8;">Safe Floor (Lead Defense):</strong> When favored by +15+ points, prioritizes high 10th percentile floor starters to minimize bust risk (&lt; 10 pts).</li>
              </ul>
            </div>
          </div>

          <!-- Tab 2: In-Game Win Probability & Brownian Decay -->
          <div id="docsTab_worm" class="docs-section">
            <div class="docs-card-box">
              <h3>📈 Brownian Bridge Square-Root Time-Decay</h3>
              <p>During live gameday Sunday action, static simulations become obsolete. As game clocks tick down, remaining point uncertainty collapses toward zero following a <strong>Brownian bridge square-root decay</strong> model:</p>
              <div class="docs-formula-box">
                &sigma;_rem(t) = &sigma;_base &times; &radic;( t_remaining / 60 mins )
              </div>
              <p><strong>Key Mathematical Properties:</strong></p>
              <ul>
                <li><strong>Halftime (30 min left):</strong> Player standard deviation shrinks to <code>&radic;(0.50) &approx; 70.7%</code> of pre-game baseline.</li>
                <li><strong>Late 4th Quarter (5 min left):</strong> Uncertainty contracts to <code>&radic;(5/60) &approx; 28.8%</code>.</li>
                <li><strong>Final Whistle (0 min left):</strong> Points are 100% banked. Variance strictly collapses to <strong>&sigma; = 0.0</strong> with zero residual uncertainty.</li>
              </ul>
            </div>

            <div class="docs-card-box">
              <h3>⚡ Milestone Swing Detection & Two-Tone Canvas</h3>
              <p>The Two-Tone In-Game Swing Chart automatically flags pivotal momentum shifts as interactive milestone dots whenever:</p>
              <ul>
                <li>A single drive or touchdown triggers a <strong>&Delta; &ge; 7.5% win probability swing</strong>.</li>
                <li>The lead crosses the <strong>50% Coin Flip Midline</strong> between teams.</li>
              </ul>
            </div>
          </div>

          <!-- Tab 3: Waiver Radar & FAAB Lab -->
          <div id="docsTab_waiver" class="docs-section">
            <div class="docs-card-box">
              <h3>📡 Net Projected Starter Delta (&Delta; Pts)</h3>
              <p>Instead of sorting waiver targets by raw season points, the Waiver Radar calculates your exact <strong>Net Roster Delta</strong> against your weakest current starter at that slot:</p>
              <div class="docs-formula-box">
                &Delta; Pts = E[Waiver Player Projected Pts] - E[Current Weakest Starter Projected Pts]
              </div>
              <p>Free agents with positive &Delta; points immediately improve your starting lineup's expected output!</p>
            </div>

            <div class="docs-card-box">
              <h3>💰 Smart FAAB Allocation Formula</h3>
              <p>Recommended bid amounts are dynamically calibrated using starter upgrade leverage and waiver wire market velocity:</p>
              <ul>
                <li><span class="docs-pill docs-pill-gold">Conservative (0–4% FAAB)</span>: Speculative bench stashes, handcuffs, and bye-week kickers/defense streamers.</li>
                <li><span class="docs-pill docs-pill-emerald">Aggressive (8–15% FAAB)</span>: Immediate high-confidence starter upgrades with positive weekly delta.</li>
                <li><span class="docs-pill docs-pill-rose">All-In (25–40%+ FAAB)</span>: Season-altering bellcow injury takeovers and top-tier breakout starters.</li>
              </ul>
            </div>
          </div>

          <!-- Tab 4: Alert Sentinel & Weather Engine -->
          <div id="docsTab_sentinel" class="docs-section">
            <div class="docs-card-box">
              <h3>🚨 Gameday Hazard Detection Sentinel</h3>
              <p>Scout Bowie continuously audits your active lineup for three primary gameday failure modes:</p>
              <ul>
                <li><strong>💨 Wind Spikes (&ge; 18 mph):</strong> High open-stadium winds significantly suppress deep pass efficiency, passing yards, and 45+ yard field goals.</li>
                <li><strong>🛡️ Late-Swap Flexibility Trap:</strong> Starters playing in late afternoon (4:25 PM) or primetime (SNF/MNF) should occupy the FLEX slot rather than dedicated RB/WR slots to maximize last-minute pivot flexibility if a game-time injury occurs.</li>
                <li><strong>📉 Lineup Drift Monitor:</strong> Flags an active roster that trails optimal strategy projection by &ge; 3.0 points.</li>
              </ul>
            </div>
          </div>

          <!-- Tab 5: Draft Companion & CDF Reach Probabilities -->
          <div id="docsTab_draft" class="docs-section">
            <div class="docs-card-box">
              <h3>🎯 Cumulative Distribution Function (CDF) Reach Probability</h3>
              <p>During live drafts, Bowie calculates the exact mathematical probability that a target player will survive until your next draft pick using an empirical CDF model of historical ADP standard deviation:</p>
              <div class="docs-formula-box">
                P(Available at Pick k) = 1 - &Phi;( (k - ADP) / &sigma;_adp )
              </div>
              <p>This tells you whether you can safely wait a round to draft your target or if you must reach now before the impending positional cliff.</p>
            </div>
          </div>

        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Escape key closes modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });
  }

  open(initialTab = 'sim') {
    this.init();
    const overlay = document.getElementById('scoutDocsModalOverlay');
    if (overlay) {
      overlay.classList.add('active');
      this.isOpen = true;
      this.switchTab(initialTab);
    }
  }

  close() {
    const overlay = document.getElementById('scoutDocsModalOverlay');
    if (overlay) {
      overlay.classList.remove('active');
      this.isOpen = false;
    }
  }

  switchTab(tabKey) {
    this.activeTab = tabKey;
    const overlay = document.getElementById('scoutDocsModalOverlay');
    if (!overlay) return;

    // Update tab buttons
    const tabs = overlay.querySelectorAll('.docs-tab-btn');
    tabs.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabKey);
    });

    // Update sections
    const sections = overlay.querySelectorAll('.docs-section');
    sections.forEach(sec => {
      sec.classList.toggle('active', sec.id === `docsTab_${tabKey}`);
    });
  }
}

// Global Singleton Instance & Helpers
export const scoutBowieDocs = new ScoutBowieDocsModal();

if (typeof window !== 'undefined') {
  window.scoutBowieDocs = scoutBowieDocs;
  window.openDocsModal = (tab) => scoutBowieDocs.open(tab);
  window.closeDocsModal = () => scoutBowieDocs.close();
  window.switchDocsTab = (tab) => scoutBowieDocs.switchTab(tab);
}
