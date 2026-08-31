/**
 * SCOUT BOWIE SCOUTING REPORT & MATCHUP DOSSIER ENGINE
 * Generates actionable advice, Lock of the Week, Trap / Weather Alerts,
 * Boom Upside Weapons, and tactical game plan directives.
 * 
 * Strict Data Contract:
 * - Active Starters only for Lock, Trap, and Boom designations
 * - Standardized numerical metrics: proj, floor, ceil, ceilingSurge, boomRate, bustRate
 * - Safe numeric fallback interpolation preventing NaN / undefined output
 */

import { calculatePlayerDistributions } from './simulation-engine.js';

export class ScoutBowie {
  constructor() {
    this.name = "Scout Bowie";
    this.avatar = "../assets/scout-bowie.webp";
    this.title = "Director of Canine Analytics";
  }

  /**
   * Generate Full Matchup Dossier with Tactical Directives and Weather Callouts
   */
  generateMatchupDossier(userStarters = [], userBench = [], oppStarters = [], simulation = {}, strategyWeight = 0.5) {
    const winProbability = Number((simulation?.winProbability ?? 50).toFixed(1));
    const spread = Number((simulation?.spread ?? 0).toFixed(1));

    if (!userStarters || userStarters.length === 0) {
      return null;
    }

    // Ensure all players have evaluated distributions
    const evaluatedStarters = userStarters.map(p => (p.floor !== undefined ? p : calculatePlayerDistributions(p)));
    const evaluatedBench = userBench.map(p => (p.floor !== undefined ? p : calculatePlayerDistributions(p)));

    // 1. Identify Lock of the Week (Highest floor-to-bust ratio among Active Starters)
    const lockCandidates = [...evaluatedStarters].sort((a, b) => {
      const floorA = Number(a.floor ?? a.floor10 ?? a.mean ?? 10);
      const floorB = Number(b.floor ?? b.floor10 ?? b.mean ?? 10);
      const bustA = Number(a.bustRate ?? 15);
      const bustB = Number(b.bustRate ?? 15);
      const scoreA = (floorA * 1.8) - (bustA * 0.5);
      const scoreB = (floorB * 1.8) - (bustB * 0.5);
      return scoreB - scoreA;
    });
    const lockCandidate = lockCandidates[0] || evaluatedStarters[0];

    const lockFloor = Number(lockCandidate.floor ?? lockCandidate.floor10 ?? 0).toFixed(1);
    const lockAlert = lockCandidate ? {
      player: lockCandidate,
      tag: "LOCK OF THE WEEK",
      confidence: "98.5% HIGH CONFIDENCE",
      headline: `${lockCandidate.full_name} (${lockCandidate.team} - ${lockCandidate.position})`,
      analysis: `Solid 10th-percentile floor of ${lockFloor} pts. Projected volume provides bedrock scoring floor in your starting lineup.`
    } : null;

    // 2. Identify Trap Alert or Weather Warning (Active Starters only, excluding Lock)
    const weatherAlertStarter = evaluatedStarters.find(p => {
      if (p.player_id === lockCandidate?.player_id) return false;
      const w = p.gameSchedule?.weather;
      if (!w || w.isDome) return false;
      if ((w.windSpeed ?? 0) >= 15 && (p.position === 'QB' || p.position === 'K' || String(p.archetype).includes('Deep') || String(p.archetype).includes('Volatile'))) {
        return true;
      }
      return false;
    });

    let trapAlert = null;

    if (weatherAlertStarter) {
      const w = weatherAlertStarter.gameSchedule.weather;
      const stadium = weatherAlertStarter.gameSchedule.stadiumName || "Outdoor Stadium";
      trapAlert = {
        player: weatherAlertStarter,
        tag: "WEATHER WARNING",
        riskLevel: w.isSevereWind ? "SEVERE WEATHER" : "WEATHER ALERT",
        headline: `${weatherAlertStarter.full_name} (${weatherAlertStarter.team} - ${weatherAlertStarter.position})`,
        analysis: `⚠️ Weather Warning: ${weatherAlertStarter.full_name} faces ${w.windSpeed ?? 18} mph sustained winds at ${stadium}, reducing deep-ball efficiency and field goal range.`
      };
    } else {
      const nonLockStarters = evaluatedStarters.filter(p => 
        p.player_id !== lockCandidate?.player_id && 
        p.position !== 'DEF'
      );

      const trapCandidates = (nonLockStarters.length > 0 ? nonLockStarters : evaluatedStarters).sort((a, b) => {
        const floorA = Number(a.floor ?? a.floor10 ?? a.mean ?? 10);
        const floorB = Number(b.floor ?? b.floor10 ?? b.mean ?? 10);
        const bustA = Number(a.bustRate ?? 15);
        const bustB = Number(b.bustRate ?? 15);
        const scoreA = (bustA * 1.5) - (floorA * 0.8);
        const scoreB = (bustB * 1.5) - (floorB * 0.8);
        return scoreB - scoreA;
      });
      const trapCandidate = trapCandidates[0] || evaluatedStarters[1] || evaluatedStarters[0];

      if (trapCandidate) {
        const trapBust = Number(trapCandidate.bustRate ?? 15).toFixed(1);
        const trapFloor = Number(trapCandidate.floor ?? trapCandidate.floor10 ?? 0).toFixed(1);
        trapAlert = {
          player: trapCandidate,
          tag: "TRAP ALERT",
          riskLevel: (trapCandidate.bustRate ?? 15) > 20 ? "ELEVATED RISK" : "MODERATE RISK",
          headline: `${trapCandidate.full_name} (${trapCandidate.team} - ${trapCandidate.position})`,
          analysis: `Carries a ${trapBust}% bust probability with a 10th-percentile floor of ${trapFloor} pts. Downside risk exists against this week's defense.`
        };
      }
    }

    // 3. Identify Boom Candidate from Active Starters (Highest absolute ceiling surge)
    const nonLockForBoom = evaluatedStarters.filter(p => p.player_id !== lockCandidate?.player_id);
    const boomPool = nonLockForBoom.length > 0 ? nonLockForBoom : evaluatedStarters;

    const boomCandidate = [...boomPool].sort((a, b) => {
      const surgeA = Number(a.ceilingSurge ?? ((a.ceil ?? a.ceiling90 ?? 0) - (a.proj ?? a.mean ?? 0)));
      const surgeB = Number(b.ceilingSurge ?? ((b.ceil ?? b.ceiling90 ?? 0) - (b.proj ?? b.mean ?? 0)));
      return surgeB - surgeA;
    })[0] || evaluatedStarters[0];

    const upsideDelta = Number((boomCandidate.ceilingSurge ?? ((boomCandidate.ceil ?? boomCandidate.ceiling90 ?? 0) - (boomCandidate.proj ?? boomCandidate.mean ?? 0))).toFixed(1));
    const boomCeiling = Number(boomCandidate.ceil ?? boomCandidate.ceiling90 ?? 0).toFixed(1);
    const boomRate = Number(boomCandidate.boomRate ?? 25).toFixed(1);

    const boomAlert = boomCandidate ? {
      player: boomCandidate,
      tag: "BOOM UPSIDE WEAPON",
      upsideRating: `+${upsideDelta} pts Ceiling Surge`,
      headline: `${boomCandidate.full_name} (${boomCandidate.team} - ${boomCandidate.position})`,
      analysis: `High-variance ceiling reaching a 90th percentile ceiling of ${boomCeiling} pts (${boomRate}% boom rate). Prime weapon when chasing upside.`
    } : null;

    // 4. Identify Bench Wildcard (Highest 90th percentile ceiling or widest range variance among Bench RB / WR / TE)
    const benchSkillPlayers = evaluatedBench.filter(p => 
      ['RB', 'WR', 'TE'].includes(p.position) && !p.isInactive && Number(p.proj ?? p.mean ?? 0) > 0
    );

    let benchWildcard = null;
    if (benchSkillPlayers.length > 0) {
      const sortedWildcards = [...benchSkillPlayers].sort((a, b) => {
        const ceilA = Number(a.ceil ?? a.ceiling90 ?? 0);
        const ceilB = Number(b.ceil ?? b.ceiling90 ?? 0);
        const surgeA = ceilA - Number(a.proj ?? a.mean ?? 0);
        const surgeB = ceilB - Number(b.proj ?? b.mean ?? 0);
        if (ceilB !== ceilA) return ceilB - ceilA;
        return surgeB - surgeA;
      });

      const candidate = sortedWildcards[0];
      if (candidate) {
        const ceilVal = Number(candidate.ceil ?? candidate.ceiling90 ?? 0);
        const projVal = Number(candidate.proj ?? candidate.mean ?? 0);
        const boomProb = Number((candidate.boomRate ?? 25) / 100);
        const delta = Math.max(0, ceilVal - projVal);

        benchWildcard = {
          player: candidate,
          name: candidate.full_name,
          team: candidate.team,
          pos: candidate.position,
          proj: projVal,
          ceil: ceilVal,
          boomProb: boomProb,
          tag: "BENCH WILDCARD",
          headline: `${candidate.full_name} (${candidate.team} - ${candidate.position})`,
          ceilingPotential: `+${delta.toFixed(1)} pts Ceiling Potential`,
          analysis: `Carries high volatility with a ${ceilVal.toFixed(1)} pt ceiling (${(boomProb * 100).toFixed(0)}% boom chance). Viable lottery ticket if chasing an extreme deficit.`
        };
      }
    }

    // 5. Tactical Game Plan Directive
    let directive = {
      status: "BALANCED",
      badgeClass: "badge-cyan",
      headline: "Neutral Game Plan: Maximize Expected Points",
      advice: "Matchup is neck-and-neck. Select 'Balanced (E[X])' to maximize median expected points."
    };

    if (winProbability >= 55) {
      directive = {
        status: "HEAVY FAVORITE",
        badgeClass: "badge-green",
        headline: `Floor Preservation Mode (Win Prob: ${winProbability}%)`,
        advice: `You hold a projected +${Math.abs(spread).toFixed(1)} point edge. Select 'Safe Floor' to choke out variance and bench risky boom-or-bust players.`
      };
    } else if (winProbability <= 45) {
      directive = {
        status: "UNDERDOG ALERT",
        badgeClass: "badge-red",
        headline: `Upside Aggression Required (Win Prob: ${winProbability}%)`,
        advice: `You are a ${Math.abs(spread).toFixed(1)} point underdog. Select 'Max Upside' to embrace right-tail volatility and start high-ceiling flex weapons.`
      };
    }

    // 6. Bowie Mascot Soundbite
    const soundbites = [
      `"I've crunched 10,000 iterations in my quantum canine processor. Here is the optimal playbook!"`,
      `"Never fear variance when the math is on your side. Let's secure the championship trophy!"`,
      `"Sniffing out weather penalties and value-over-replacement across the entire starting lineup."`
    ];
    const quote = soundbites[Math.floor(Math.random() * soundbites.length)];

    return {
      lockAlert,
      trapAlert,
      boomAlert,
      benchWildcard,
      directive,
      quote
    };
  }
}

export const scoutBowie = new ScoutBowie();
