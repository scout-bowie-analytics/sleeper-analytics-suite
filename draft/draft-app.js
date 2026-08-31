/**
 * LIVE DRAFT COMPANION - SHELL & AFK QUEUE GENERATOR SCRIPT
 */

export const DEFAULT_DEFENSES = [
  { name: 'San Francisco 49ers', pos: 'DEF', team: 'SF', adp: '150', rank: 150 },
  { name: 'Baltimore Ravens', pos: 'DEF', team: 'BAL', adp: '155', rank: 155 },
  { name: 'Dallas Cowboys', pos: 'DEF', team: 'DAL', adp: '160', rank: 160 },
  { name: 'Pittsburgh Steelers', pos: 'DEF', team: 'PIT', adp: '165', rank: 165 },
  { name: 'Kansas City Chiefs', pos: 'DEF', team: 'KC', adp: '170', rank: 170 }
];

export const DEFAULT_KICKERS = [
  { name: 'Justin Tucker', pos: 'K', team: 'BAL', adp: '155', rank: 155 },
  { name: 'Brandon Aubrey', pos: 'K', team: 'DAL', adp: '152', rank: 152 },
  { name: 'Harrison Butker', pos: 'K', team: 'KC', adp: '160', rank: 160 },
  { name: 'Jake Moody', pos: 'K', team: 'SF', adp: '168', rank: 168 },
  { name: 'Evan McPherson', pos: 'K', team: 'CIN', adp: '172', rank: 172 }
];

export function generateAfkQueue(options = {}) {
  const slotVal = options.slot !== undefined ? options.slot : 'random';
  const totalTeams = parseInt(options.totalTeams, 10) || 12;
  const scoringFormat = options.scoringFormat || 'half_ppr';
  const strategy = options.strategy || 'balanced';
  const playerDb = Array.isArray(options.playerDb) && options.playerDb.length > 0 ? options.playerDb : [];
  const activeKeepers = options.keeperIds instanceof Set ? options.keeperIds : new Set();

  const isKnownSlot = slotVal !== 'random' && !isNaN(parseInt(slotVal, 10)) && parseInt(slotVal, 10) >= 1 && parseInt(slotVal, 10) <= totalTeams;
  const slot = isKnownSlot ? parseInt(slotVal, 10) : null;

  const validPlayers = playerDb.filter(p => {
    if (p.sleeper_id && activeKeepers.has(p.sleeper_id)) return false;
    const inj = String(p.injury_status || '').trim().toUpperCase();
    if (inj === 'IR' || inj === 'OUT' || inj === 'PUP') return false;
    return true;
  });

  function getScoreAdj(p, currentRound = 1) {
    let adj = 0;
    if (scoringFormat === 'full_ppr') {
      if (p.pos === 'WR') adj -= 3.0;
      if (p.pos === 'RB' && (p.depth?.includes('Pass') || p.depth?.includes('Space') || ['Christian McCaffrey','Jahmyr Gibbs','De\'Von Achane','Bijan Robinson'].includes(p.name))) adj -= 2.5;
    } else if (scoringFormat === 'standard') {
      if (p.pos === 'RB') adj -= 3.0;
      if (p.pos === 'WR') adj += 2.0;
    }
    if (p.signal === 'BUY') adj -= 4.0;
    if (p.signal === 'CAUTION') adj += 4.0;

    if (strategy === 'zero_rb' && currentRound >= 6 && p.pos === 'RB') {
      adj -= 8.0;
    }
    if (strategy === 'hero_rb') {
      if (currentRound <= 2 && p.pos === 'RB') adj -= 6.0;
      if (currentRound >= 7 && p.pos === 'RB') adj -= 4.0;
    }
    return adj;
  }

  if (isKnownSlot) {
    const roundCards = [];
    const chosenNames = new Set();
    let qbCount = 0;
    let teCount = 0;
    let rbCount = 0;

    for (let r = 1; r <= 16; r++) {
      const isOdd = (r % 2 === 1);
      const pickNo = isOdd ? (r - 1) * totalTeams + slot : r * totalTeams - slot + 1;

      let primaryTarget = null;
      let fallbacks = [];

      if (r === 15) {
        const defs = validPlayers.filter(p => p.pos === 'DEF' && !chosenNames.has(p.name));
        const pool = defs.length >= 3 ? defs : [...defs, ...DEFAULT_DEFENSES.filter(d => !chosenNames.has(d.name))];
        primaryTarget = pool[0] || DEFAULT_DEFENSES[0];
        fallbacks = pool.slice(1, 3);
      } else if (r === 16) {
        const kickers = validPlayers.filter(p => p.pos === 'K' && !chosenNames.has(p.name));
        const pool = kickers.length >= 3 ? kickers : [...kickers, ...DEFAULT_KICKERS.filter(k => !chosenNames.has(k.name))];
        primaryTarget = pool[0] || DEFAULT_KICKERS[0];
        fallbacks = pool.slice(1, 3);
      } else {
        const allowQB = (qbCount === 0 && r <= 12) || (qbCount >= 1 && r >= 13);
        const allowTE = (teCount === 0 && r <= 13) || (teCount >= 1 && r >= 14);

        let allowRB = true;
        if (strategy === 'zero_rb') {
          if (r <= 5) allowRB = false;
        } else if (strategy === 'hero_rb') {
          if (rbCount >= 1 && r >= 3 && r <= 6) allowRB = false;
        }

        const candidates = validPlayers.filter(p => {
          if (chosenNames.has(p.name)) return false;
          if (p.pos === 'K' || p.pos === 'DEF') return false;
          if (p.pos === 'QB' && !allowQB) return false;
          if (p.pos === 'TE' && !allowTE) return false;
          if (p.pos === 'RB' && !allowRB) return false;
          return true;
        });

        const scoredCandidates = candidates.map(p => {
          const adpVal = parseFloat(p.adp) || (p.rank || 100);
          const dist = Math.abs(adpVal - pickNo);
          const effRank = (p.rank || 100) + getScoreAdj(p, r);
          let posPriority = 0;
          if (p.pos === 'QB') {
            if (r >= 4 && r <= 8 && ['Josh Allen', 'Lamar Jackson', 'Jayden Daniels', 'Joe Burrow', 'Drake Maye'].includes(p.name)) {
              posPriority = -8;
            } else if (r >= 9 && qbCount === 0) {
              posPriority = -12;
            }
          }
          if (p.pos === 'TE') {
            if (r >= 3 && r <= 6 && ['Brock Bowers', 'Trey McBride'].includes(p.name)) {
              posPriority = -6;
            } else if (r >= 8 && teCount === 0) {
              posPriority = -8;
            }
          }
          const totalScore = effRank + (dist * 0.45) + posPriority;
          return { player: p, score: totalScore, adpVal };
        });

        scoredCandidates.sort((a, b) => a.score - b.score);

        if (scoredCandidates.length > 0) {
          primaryTarget = scoredCandidates[0].player;
          fallbacks = scoredCandidates.slice(1, 3).map(c => c.player);
        }
      }

      if (primaryTarget) {
        chosenNames.add(primaryTarget.name);
        if (primaryTarget.pos === 'QB') qbCount++;
        if (primaryTarget.pos === 'TE') teCount++;
        if (primaryTarget.pos === 'RB') rbCount++;
      }

      roundCards.push({
        round: r,
        pickNo: pickNo,
        primaryTarget: primaryTarget,
        fallbacks: fallbacks
      });
    }

    const masterQueue = [];
    const masterSet = new Set();

    function addPlayerToMaster(p) {
      if (p && !masterSet.has(p.name)) {
        masterSet.add(p.name);
        masterQueue.push(p);
      }
    }

    roundCards.forEach(rc => {
      if (rc.round <= 14) {
        addPlayerToMaster(rc.primaryTarget);
        rc.fallbacks.forEach(f => addPlayerToMaster(f));
      }
    });

    if (masterQueue.length < 32) {
      const extraSleepers = validPlayers
        .filter(p => !masterSet.has(p.name) && p.pos !== 'K' && p.pos !== 'DEF')
        .sort((a, b) => (parseFloat(a.adp) || 999) - (parseFloat(b.adp) || 999));
      for (const ep of extraSleepers) {
        addPlayerToMaster(ep);
        if (masterQueue.length >= 32) break;
      }
    }

    const defRound = roundCards.find(rc => rc.round === 15);
    if (defRound) {
      addPlayerToMaster(defRound.primaryTarget);
      defRound.fallbacks.forEach(f => addPlayerToMaster(f));
    }
    const kRound = roundCards.find(rc => rc.round === 16);
    if (kRound) {
      addPlayerToMaster(kRound.primaryTarget);
      kRound.fallbacks.forEach(f => addPlayerToMaster(f));
    }

    return {
      mode: 'slot',
      slot: slot,
      totalTeams: totalTeams,
      scoringFormat: scoringFormat,
      strategy: strategy,
      rounds: roundCards,
      masterQueue: masterQueue.slice(0, 38)
    };

  } else {
    const tiers = [
      {
        id: 1,
        title: strategy === 'zero_rb' ? 'Tier 1: Alpha WR1 Fortress (Zero RB)' : strategy === 'hero_rb' ? 'Tier 1: Hero Anchor RB & WR1s' : 'Tier 1: Elite Anchor Foundations',
        rounds: 'Rounds 1–2 · Top 20 ADP',
        description: strategy === 'zero_rb'
          ? 'Elite WR1 alpha pass-catchers only. Completely ignores RBs to establish an unbeatable wide receiver ceiling.'
          : strategy === 'hero_rb'
          ? '1-2 Elite Anchor RBs alongside elite WR1 targets to lock in your foundation.'
          : 'Elite workhorse RBs and alpha WR1 targets. Provides an elite floor for any early draft slot.',
        filter: p => {
          const adp = parseFloat(p.adp) || p.rank || 99;
          if (strategy === 'zero_rb') return (adp <= 20 || p.rank <= 20) && p.pos === 'WR';
          return (adp <= 20 || p.rank <= 20) && (p.pos === 'RB' || p.pos === 'WR');
        },
        limit: 10
      },
      {
        id: 2,
        title: strategy === 'zero_rb' ? 'Tier 2: WR Depth Surge & Elite Onesies' : strategy === 'hero_rb' ? 'Tier 2: WR Influx & Elite Onesies (No RBs)' : 'Tier 2: Core Skill & Elite Onesie Options',
        rounds: 'Rounds 3–5 · ADP 21–55',
        description: (strategy === 'zero_rb' || strategy === 'hero_rb')
          ? 'Stacked with WR2 co-alphas, slot receivers, plus Tier-1 positional cheat codes (Josh Allen, Lamar Jackson, Brock Bowers, Trey McBride).'
          : 'Hero RBs, WR2 co-alphas, plus Tier-1 positional cheat codes (Josh Allen, Lamar Jackson, Brock Bowers, Trey McBride).',
        filter: p => {
          const adp = parseFloat(p.adp) || p.rank || 99;
          if (strategy === 'zero_rb' || strategy === 'hero_rb') {
            return adp > 20 && adp <= 55 && (p.pos === 'WR' || p.pos === 'QB' || p.pos === 'TE');
          }
          return adp > 20 && adp <= 55 && (p.pos === 'RB' || p.pos === 'WR' || p.pos === 'QB' || p.pos === 'TE');
        },
        limit: 12
      },
      {
        id: 3,
        title: strategy === 'zero_rb' ? 'Tier 3: High-Volume RB Influx & Flex Value' : 'Tier 3: Starting Flex & Mid-Round Floor',
        rounds: 'Rounds 6–9 · ADP 56–100',
        description: strategy === 'zero_rb'
          ? 'Aggressive injection of pass-catching RBs and high-touch backfields to solidify starting RB slots.'
          : 'High-volume starting skill players, breakout second-year targets, and high-floor QB/TE anchors.',
        filter: p => {
          const adp = parseFloat(p.adp) || p.rank || 99;
          return adp > 55 && adp <= 100 && (p.pos === 'RB' || p.pos === 'WR' || p.pos === 'QB' || p.pos === 'TE');
        },
        limit: 10
      },
      {
        id: 4,
        title: 'Tier 4: High-Upside Sleepers & Handcuffs',
        rounds: 'Rounds 10–14 · ADP 101–150',
        description: 'Late-round league winners, elite rookie upside stashes, and contingent bellcow handcuffs.',
        filter: p => {
          const adp = parseFloat(p.adp) || p.rank || 99;
          return adp > 100 && (p.pos === 'RB' || p.pos === 'WR' || p.pos === 'QB' || p.pos === 'TE');
        },
        limit: 8
      },
      {
        id: 5,
        title: 'Tier 5: Late Round D/ST & Kicker Streamers',
        rounds: 'Rounds 15–16',
        description: 'Top-tier defense pass rush matchups and dome kickers locked strictly at the end.',
        filter: p => p.pos === 'DEF' || p.pos === 'K',
        limit: 4
      }
    ];

    const masterQueue = [];
    const masterSet = new Set();
    const tierCards = [];

    tiers.forEach(t => {
      let pool = validPlayers.filter(t.filter);
      if (t.id === 5 && pool.length < 4) {
        pool = [...DEFAULT_DEFENSES.slice(0, 2), ...DEFAULT_KICKERS.slice(0, 2)];
      }
      pool.sort((a, b) => ((a.rank || 100) + getScoreAdj(a, t.id * 3)) - ((b.rank || 100) + getScoreAdj(b, t.id * 3)));
      const selected = pool.slice(0, t.limit);

      tierCards.push({
        tierId: t.id,
        title: t.title,
        rounds: t.rounds,
        description: t.description,
        players: selected
      });

      selected.forEach(p => {
        if (!masterSet.has(p.name)) {
          masterSet.add(p.name);
          masterQueue.push(p);
        }
      });
    });

    return {
      mode: 'universal',
      slot: 'random',
      totalTeams: totalTeams,
      scoringFormat: scoringFormat,
      strategy: strategy,
      tiers: tierCards,
      masterQueue: masterQueue.slice(0, 40)
    };
  }
}

export function formatQueuePlainText(queueData) {
  if (!queueData) return '';
  const { mode, slot, totalTeams, scoringFormat, strategy, rounds, tiers, masterQueue } = queueData;
  const formatLabel = scoringFormat === 'full_ppr' ? 'Full PPR' : scoringFormat === 'standard' ? 'Standard' : 'Half PPR';
  const strategyLabel = strategy === 'hero_rb' ? 'Hero RB' : strategy === 'zero_rb' ? 'Zero RB' : 'Balanced (BPA)';
  const slotLabel = mode === 'slot' ? `Pick #${slot} (${slot}.01)` : 'Universal / Random Slot';

  let txt = `🐾 Scout Bowie Auto-Draft Queue (${slotLabel} • ${totalTeams}-Team ${formatLabel} • ${strategyLabel})\n\n`;
  
  if (mode === 'slot' && rounds) {
    txt += `--- ROUND TARGETS ---\n`;
    rounds.forEach(r => {
      const pName = r.primaryTarget ? `${r.primaryTarget.name} (${r.primaryTarget.pos} - ${r.primaryTarget.team || 'NFL'})` : 'BPA';
      const fbNames = (r.fallbacks || []).map(f => `${f.name} (${f.pos})`).join(', ');
      txt += `R${r.round} (Pick #${r.pickNo}): ${pName}${fbNames ? ` [Fallbacks: ${fbNames}]` : ''}\n`;
    });
    txt += `\n`;
  } else if (tiers) {
    txt += `--- TIER STRATEGY BLUEPRINT ---\n`;
    tiers.forEach(t => {
      txt += `${t.title} (${t.rounds}): ${t.description}\n`;
    });
    txt += `\n`;
  }

  txt += `--- MASTER SLEEPER QUEUE (Star in App Top-to-Bottom) ---\n`;
  masterQueue.forEach((p, idx) => {
    txt += `${idx + 1}. ${p.name} (${p.pos} - ${p.team || 'NFL'})${p.adp ? ` · ADP ${p.adp}` : ''}\n`;
  });

  txt += `\nGenerated by Sleeper Analytics Suite • Scout Bowie War Room`;
  return txt;
}

export class DraftCompanionShell {
  constructor() {
    this.draftId = null;
    this.currentPick = 1;
  }

  init() {
    console.log("Draft Companion Shell mounted with AFK Queue Engine.");
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    window.draftApp = new DraftCompanionShell();
    window.draftApp.init();
  });
}

