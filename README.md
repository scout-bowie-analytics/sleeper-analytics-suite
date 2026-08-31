# 🐾 Sleeper Analytics Suite

[![Live Portal](https://img.shields.io/badge/Live%20Portal-Scout%20Bowie%20HQ-4fd1a5?style=for-the-badge)](https://scout-bowie-analytics.github.io/sleeper-analytics-suite/)
[![Draft War Room](https://img.shields.io/badge/Draft%20War%20Room-Live-2dd4bf?style=for-the-badge)](https://scout-bowie-analytics.github.io/sleeper-analytics-suite/draft/)
[![Weekly Optimizer](https://img.shields.io/badge/Weekly%20Optimizer-10k%20Sims-f59e0b?style=for-the-badge)](https://scout-bowie-analytics.github.io/sleeper-analytics-suite/weekly/)

A quantitative, client-side fantasy football analytics suite and live draft command center featuring real-time Sleeper API synchronization, 10,000-run Monte Carlo weekly matchup simulations, dynamic VORP cliff alerts, Normal CDF reach probability modeling, and ESPN / Yahoo bookmarklet importing.

---

## ⚡ Suite Tools & Features

### 1. Live Draft Companion & AFK Queue Builder
- **Real-Time Board Sync**: Seamless synchronization with active Sleeper draft rooms via public API.
- **Normal CDF Reach Probability**: Computes exact mathematical probabilities that target players will survive to your next pick.
- **⚡ AFK Queue Blueprint Generator**: Generates customized 35-player queues to star in Sleeper when you cannot attend live. Supports **Balanced (BPA)**, **Hero RB**, and **Zero RB** draft strategies.
- **Dynamic VORP & Scarcity Alerts**: Value Over Replacement Player delta calculations with positional cliff warnings.

### 2. Weekly Lineup Optimizer & Gameday Command Center
- **10,000-Iteration Monte Carlo Engine**: True win probabilities and right-skewed Log-Normal point distributions.
- **🏈 ESPN & Yahoo Bookmarklet Importer**: 1-click cross-platform matchup ingestion directly into the simulation engine.
- **Interactive Lineup Solver**: 3 instant presets (Safe Floor, Balanced Median, Maximum Ceiling/Upside) with late-swap FLEX priority locking.
- **Live Gameday Scoreboard**: Dynamic in-flight win probability adjustments as NFL games progress from pre-kickoff to final.
- **Scout Alert Engine**: Real-time hazard monitoring for inactives, high-wind weather spikes, and lineup drift with Discord webhook & email alerts.

---

## 🚀 Live Access

- **Suite Hub**: [https://scout-bowie-analytics.github.io/sleeper-analytics-suite/](https://scout-bowie-analytics.github.io/sleeper-analytics-suite/)
- **Draft War Room**: [https://scout-bowie-analytics.github.io/sleeper-analytics-suite/draft/](https://scout-bowie-analytics.github.io/sleeper-analytics-suite/draft/)
- **Weekly Lineup Optimizer**: [https://scout-bowie-analytics.github.io/sleeper-analytics-suite/weekly/](https://scout-bowie-analytics.github.io/sleeper-analytics-suite/weekly/)

---

## 🤝 Contributing & Suggestions

Community contributions, feature ideas, and feedback are warmly welcomed!

- **Feature Requests & Bug Reports**: Open an [Issue](https://github.com/scout-bowie-analytics/sleeper-analytics-suite/issues) to suggest new models, platform importers, or UI enhancements.
- **Pull Requests**: Fork the repository, create a feature branch, and submit a PR.
- **Scouting Feedback**: Have ideas for Scout Bowie's matchup algorithm or queue logic? Let us know in Issues!

---

## 🔒 Privacy & Architecture

- **Zero Server Footprint**: Runs 100% client-side in the browser using modern TypedArrays and asynchronous Web Workers.
- **Zero API Keys or Login Required**: Connects seamlessly via Sleeper's public API and client-side bookmarklet payloads. No personal credentials are ever stored or transmitted.
