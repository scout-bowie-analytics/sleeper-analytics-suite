/**
 * 🐾 Scout Bowie Guided Feature Tour Engine
 * Zero-dependency, lightweight interactive walkthrough for the Weekly Lineup Optimizer.
 */

class ScoutBowieTour {
  constructor(options = {}) {
    this.options = Object.assign({
      storageKey: 'scout_bowie_sample_tour_seen',
      onComplete: null,
      onSkip: null
    }, options);

    this.currentStepIndex = 0;
    this.isActive = false;
    this.overlayEl = null;
    this.popoverEl = null;
    this.resizeHandler = this.reposition.bind(this);
    this.keydownHandler = this.handleKeydown.bind(this);

    // 8 Core Tour Steps
    this.steps = [
      {
        target: '.mascot-header-card, .scout-banner',
        title: '🐾 Scout Bowie Mascot Engine',
        text: 'Welcome to Scout Bowie HQ! Bowie analyzes matchup spreads, weather reports, and player distributions to deliver actionable quantitative takes for your matchup.',
        placement: 'bottom'
      },
      {
        target: '.optimizer-scoreboard, .matchup-scoreboard',
        title: '📊 10,000-Run Monte Carlo Win %',
        text: 'Instead of static averages, our simulation engine runs 10,000 game outcomes modeling true right-skewed point variance for both teams to compute your genuine win probability.',
        placement: 'bottom'
      },
      {
        target: '#demo-toggle-container',
        title: '⚡ Pre-Kickoff vs. Live Gameday Simulation',
        text: 'Switch between pre-game projection ranges and live mid-game tracking. In live mode, in-flight player scores dynamically update your live win odds in real-time!',
        placement: 'bottom'
      },
      {
        target: '#strategyPillGroup, .strategy-pill-group',
        title: '🎯 3-Way Instant Lineup Solver',
        text: 'Chasing an underdog upset? Select "Max Upside" to prioritize high-variance boom players. Facing a weak opponent? Select "Safe Floor" to minimize bust risk.',
        placement: 'bottom'
      },
      {
        target: '#activeAlertsBanner, .gameday-alert-banner, #hazardAlertBanner',
        title: '🚨 Scout Alert Sentinel',
        text: 'Scout Bowie automatically scans your active starters for 15+ mph wind warnings, late-swap FLEX eligibility traps, and injury designations before kickoff.',
        placement: 'bottom'
      },
      {
        target: '#startersTableBody tr:first-child .player-range-wrapper, #startersTableBody tr:first-child',
        title: '📈 Log-Normal Range Sliders & Vegas Dossier',
        text: 'Each starter shows a 10th percentile floor, expected points E[X], and 90th percentile ceiling. Click any player name to open their complete Vegas matchup dossier!',
        placement: 'top'
      },
      {
        target: '#swapsBanner, #btn-apply-optimal, #startersTableBody tr:first-child .swap-select-dropdown, #strategyPillGroup',
        title: '🔄 In-Place Table Swaps & 1-Click Apply',
        text: 'Make manual bench swaps right in the table or click "Apply Optimal Lineup" to automatically slot your highest-projected starters with strict position locking.',
        placement: 'top'
      },
      {
        target: '#densityChartCard, .chart-box, #densityChart',
        title: '📊 10k Monte Carlo Density Curves',
        text: 'Scroll down to visualize full probability curves for both rosters! Inspect where your distribution overlaps your opponent’s, view median peak outcomes, and hover for target score win odds.',
        placement: 'top'
      }
    ];
  }

  /**
   * Start the guided tour from step 0 (or specified step)
   */
  start(startStep = 0) {
    if (this.isActive) return;
    this.isActive = true;
    this.currentStepIndex = startStep;

    this.createElements();
    window.addEventListener('resize', this.resizeHandler, { passive: true });
    window.addEventListener('scroll', this.resizeHandler, { passive: true });
    document.addEventListener('keydown', this.keydownHandler);

    this.renderStep(this.currentStepIndex);
  }

  /**
   * Create backdrop and popover containers
   */
  createElements() {
    this.removeElements();

    // Backdrop with transparent cutout spotlight box
    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'tour-spotlight-overlay';
    this.overlayEl.id = 'tourSpotlightOverlay';

    // Spotlight box
    this.spotlightBox = document.createElement('div');
    this.spotlightBox.className = 'tour-spotlight-box';
    this.overlayEl.appendChild(this.spotlightBox);

    // Floating Popover Card
    this.popoverEl = document.createElement('div');
    this.popoverEl.className = 'tour-popover-card';
    this.popoverEl.id = 'tourPopoverCard';

    document.body.appendChild(this.overlayEl);
    document.body.appendChild(this.popoverEl);
  }

  /**
   * Remove tour DOM elements
   */
  removeElements() {
    if (this.overlayEl && this.overlayEl.parentNode) {
      this.overlayEl.parentNode.removeChild(this.overlayEl);
    }
    if (this.popoverEl && this.popoverEl.parentNode) {
      this.popoverEl.parentNode.removeChild(this.popoverEl);
    }
    this.overlayEl = null;
    this.popoverEl = null;
    this.spotlightBox = null;
  }

  /**
   * Render specific tour step
   */
  renderStep(index) {
    if (index < 0 || index >= this.steps.length) {
      this.finish();
      return;
    }

    this.currentStepIndex = index;
    const step = this.steps[index];

    // Locate target DOM element
    let targetEl = null;
    if (typeof step.target === 'string') {
      const selectors = step.target.split(',').map(s => s.trim());
      for (const sel of selectors) {
        const found = document.querySelector(sel);
        if (found && found.offsetParent !== null) {
          targetEl = found;
          break;
        }
      }
    }

    // If target not visible on page, skip to next step
    if (!targetEl) {
      if (index + 1 < this.steps.length) {
        this.renderStep(index + 1);
      } else {
        this.finish();
      }
      return;
    }

    // Smooth scroll into view with comfortable breathing room
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Build popover HTML
    const isFirst = index === 0;
    const isLast = index === this.steps.length - 1;
    const stepNum = index + 1;
    const totalSteps = this.steps.length;

    this.popoverEl.innerHTML = `
      <div class="tour-popover-header">
        <div class="tour-header-left">
          <img src="../assets/scout-bowie.webp" class="tour-avatar" alt="Scout Bowie" onerror="this.onerror=null; this.src='../Bowie.jpg';">
          <div class="tour-header-text">
            <span class="tour-brand">🐾 Scout Bowie Tour</span>
            <span class="tour-step-badge">Step ${stepNum} of ${totalSteps}</span>
          </div>
        </div>
        <button class="tour-close-btn" onclick="window.scoutBowieTour.skip()" title="Close Tour">&times;</button>
      </div>

      <div class="tour-popover-body">
        <h4 class="tour-step-title">${step.title}</h4>
        <p class="tour-step-desc">${step.text}</p>
      </div>

      <div class="tour-popover-footer">
        <button class="tour-btn tour-btn-skip" onclick="window.scoutBowieTour.skip()">Skip</button>
        <div class="tour-nav-group">
          ${!isFirst ? `<button class="tour-btn tour-btn-prev" onclick="window.scoutBowieTour.prev()">← Back</button>` : ''}
          <button class="tour-btn tour-btn-next" onclick="window.scoutBowieTour.next()">
            ${isLast ? 'Finish Tour 🎉' : 'Next Step →'}
          </button>
        </div>
      </div>
    `;

    // Position spotlight and popover
    setTimeout(() => {
      this.repositionTarget(targetEl, step.placement);
    }, 120);
  }

  /**
   * Reposition spotlight cutout and popover card relative to target
   */
  repositionTarget(targetEl, preferredPlacement = 'bottom') {
    if (!targetEl || !this.spotlightBox || !this.popoverEl) return;

    const rect = targetEl.getBoundingClientRect();
    const pad = 8;

    // Position Spotlight Box
    this.spotlightBox.style.top = `${Math.max(0, rect.top - pad)}px`;
    this.spotlightBox.style.left = `${Math.max(0, rect.left - pad)}px`;
    this.spotlightBox.style.width = `${rect.width + (pad * 2)}px`;
    this.spotlightBox.style.height = `${rect.height + (pad * 2)}px`;

    // Calculate Popover Position
    const popoverWidth = Math.min(380, window.innerWidth - 32);
    this.popoverEl.style.width = `${popoverWidth}px`;
    const popoverHeight = this.popoverEl.offsetHeight || 220;

    let top = 0;
    let left = rect.left + (rect.width / 2) - (popoverWidth / 2);

    // Clamp horizontal viewport bounds
    left = Math.max(16, Math.min(window.innerWidth - popoverWidth - 16, left));

    if (preferredPlacement === 'top' && rect.top > popoverHeight + 20) {
      top = rect.top - popoverHeight - 14;
    } else if (rect.bottom + popoverHeight + 20 < window.innerHeight) {
      top = rect.bottom + 14;
    } else if (rect.top > popoverHeight + 20) {
      top = rect.top - popoverHeight - 14;
    } else {
      top = Math.max(16, window.innerHeight - popoverHeight - 16);
    }

    this.popoverEl.style.top = `${top}px`;
    this.popoverEl.style.left = `${left}px`;
  }

  reposition() {
    if (!this.isActive) return;
    const step = this.steps[this.currentStepIndex];
    if (!step) return;

    let targetEl = null;
    const selectors = step.target.split(',').map(s => s.trim());
    for (const sel of selectors) {
      const found = document.querySelector(sel);
      if (found && found.offsetParent !== null) {
        targetEl = found;
        break;
      }
    }

    if (targetEl) {
      this.repositionTarget(targetEl, step.placement);
    }
  }

  next() {
    if (this.currentStepIndex + 1 < this.steps.length) {
      this.renderStep(this.currentStepIndex + 1);
    } else {
      this.finish();
    }
  }

  prev() {
    if (this.currentStepIndex > 0) {
      this.renderStep(this.currentStepIndex - 1);
    }
  }

  skip() {
    this.markSeen();
    this.cleanup();
    if (typeof this.options.onSkip === 'function') {
      this.options.onSkip();
    }
  }

  finish() {
    this.markSeen();
    this.cleanup();
    if (typeof this.options.onComplete === 'function') {
      this.options.onComplete();
    }
    if (window.weeklyApp && typeof window.weeklyApp.showToast === 'function') {
      window.weeklyApp.showToast('🐾 Tour complete! Have fun exploring your optimal lineup!');
    }
  }

  markSeen() {
    try {
      localStorage.setItem(this.options.storageKey, 'true');
    } catch (e) {}
  }

  cleanup() {
    this.isActive = false;
    this.removeElements();
    window.removeEventListener('resize', this.resizeHandler);
    window.removeEventListener('scroll', this.resizeHandler);
    document.removeEventListener('keydown', this.keydownHandler);
  }

  handleKeydown(e) {
    if (!this.isActive) return;
    if (e.key === 'Escape') {
      this.skip();
    } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
      this.next();
    } else if (e.key === 'ArrowLeft') {
      this.prev();
    }
  }
}

// Global Singleton Instance
if (typeof window !== 'undefined') {
  window.ScoutBowieTour = ScoutBowieTour;
  window.scoutBowieTour = new ScoutBowieTour();
  window.startGuidedTour = () => window.scoutBowieTour.start(0);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ScoutBowieTour };
}
