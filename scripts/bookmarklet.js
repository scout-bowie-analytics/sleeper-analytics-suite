/**
 * SCOUT BOWIE ESPN & YAHOO FANTASY ROSTER / MATCHUP BOOKMARKLET
 * 
 * Extracts matchup rosters, starting slots, and projected points from ESPN Fantasy & Yahoo Fantasy
 * and redirects to the Weekly Lineup Optimizer with Base64 payload.
 */

(function() {
  function extractFantasyMatchup() {
    const host = window.location.hostname || '';
    const isEspn = host.includes('espn.com');
    const isYahoo = host.includes('yahoo.com');

    if (!isEspn && !isYahoo) {
      alert('🏈 Scout Bowie Sync: Please run this bookmarklet on an active ESPN or Yahoo Fantasy Football matchup page!');
      return null;
    }

    const payload = {
      platform: isEspn ? 'espn' : 'yahoo',
      timestamp: Date.now(),
      userTeamName: 'Your Fantasy Team',
      oppTeamName: 'Opponent Team',
      userRoster: [],
      oppRoster: []
    };

    // =========================================================================
    // 1. ESPN FANTASY EXTRACTION
    // =========================================================================
    if (isEspn) {
      // Extract Team Names
      const teamHeaders = document.querySelectorAll('.team-name, .competitor__info .name, .matchup-header .team-info');
      if (teamHeaders.length >= 2) {
        payload.userTeamName = (teamHeaders[0].textContent || 'Your Team').trim();
        payload.oppTeamName = (teamHeaders[1].textContent || 'Opponent Team').trim();
      } else {
        const titleEl = document.querySelector('title');
        if (titleEl && titleEl.textContent) {
          payload.userTeamName = titleEl.textContent.split('|')[0].trim();
        }
      }

      // Query Table Rows
      const tables = document.querySelectorAll('.Table__TBODY, table.Table tbody');
      
      function parseEspnTable(tbody, isOpponent = false) {
        if (!tbody) return;
        const rows = tbody.querySelectorAll('tr.Table__TR');
        rows.forEach(tr => {
          // Check for empty/bye slot
          const slotCell = tr.querySelector('.lineup-slot, td:first-child');
          const playerCell = tr.querySelector('.player-column__athlete, .AnchorLink[href*="/nfl/player/"], .player-name');
          if (!playerCell) return;

          const playerName = playerCell.textContent.trim();
          if (!playerName || playerName.toLowerCase().includes('empty')) return;

          // Slot
          const slotText = slotCell ? slotCell.textContent.trim().toUpperCase() : 'BENCH';
          const isBench = slotText.includes('BENCH') || slotText === 'BE' || slotText === 'IR';
          const normalizedSlot = isBench ? 'BN' : (slotText || 'FLEX');

          // Position & Team metadata
          let position = 'FLEX';
          let team = '';
          const posTeamCell = tr.querySelector('.player-info, .player-column__position, .user-name + span');
          const metaText = posTeamCell ? posTeamCell.textContent.trim() : tr.textContent;
          
          const posMatch = metaText.match(/\b(QB|RB|WR|TE|K|D\/ST|DEF)\b/i);
          if (posMatch) {
            position = posMatch[1].toUpperCase().replace('D/ST', 'DEF');
          }

          const teamMatch = metaText.match(/\b(ARI|ATL|BAL|BUF|CAR|CHI|CIN|CLE|DAL|DEN|DET|GB|HOU|IND|JAX|KC|LAC|LAR|LV|MIA|MIN|NE|NO|NYG|NYJ|PHI|PIT|SEA|SF|TB|TEN|WAS)\b/i);
          if (teamMatch) {
            team = teamMatch[1].toUpperCase();
          }

          // Projected Points
          let proj = 0;
          const projCells = tr.querySelectorAll('.tar, td.col-projected, td.col-stat');
          projCells.forEach(td => {
            const val = parseFloat(td.textContent.trim());
            if (!isNaN(val) && val > 0 && val < 60) {
              proj = val;
            }
          });

          const playerObj = {
            name: playerName,
            position,
            team,
            slot: normalizedSlot,
            proj: proj || 10.0
          };

          if (isOpponent) {
            payload.oppRoster.push(playerObj);
          } else {
            payload.userRoster.push(playerObj);
          }
        });
      }

      if (tables.length >= 2) {
        parseEspnTable(tables[0], false);
        parseEspnTable(tables[1], true);
      } else if (tables.length === 1) {
        parseEspnTable(tables[0], false);
      }
    }

    // =========================================================================
    // 2. YAHOO FANTASY EXTRACTION
    // =========================================================================
    if (isYahoo) {
      // Extract Team Names
      const yTeamEls = document.querySelectorAll('.Ta-c.Fz-xxs a, .user-name a, #matchup-header .name a, .ysf-team-name');
      if (yTeamEls.length >= 2) {
        payload.userTeamName = (yTeamEls[0].textContent || 'Your Team').trim();
        payload.oppTeamName = (yTeamEls[1].textContent || 'Opponent Team').trim();
      }

      function parseYahooTable(table, isOpponent = false) {
        if (!table) return;
        const rows = table.querySelectorAll('tbody tr');
        rows.forEach(tr => {
          const nameEl = tr.querySelector('.ysf-player-name a, .name a, td.player .name');
          if (!nameEl) return;

          const playerName = nameEl.textContent.trim();
          if (!playerName || playerName.toLowerCase().includes('(empty)')) return;

          // Slot
          const slotEl = tr.querySelector('td.pos, td.first, .pos-label');
          const rawSlot = slotEl ? slotEl.textContent.trim().toUpperCase() : 'BN';
          const isBench = rawSlot === 'BN' || rawSlot === 'BENCH' || rawSlot === 'IR';
          const slot = isBench ? 'BN' : (rawSlot.replace('W/R/T', 'FLEX').replace('W/R', 'FLEX').replace('DEF', 'DEF'));

          // Position & Team metadata
          let position = 'FLEX';
          let team = '';
          const metaEl = tr.querySelector('.ysf-player-name span, td.player span');
          const metaText = metaEl ? metaEl.textContent : tr.textContent;

          const posMatch = metaText.match(/\b(QB|RB|WR|TE|K|DEF)\b/i);
          if (posMatch) position = posMatch[1].toUpperCase();

          const teamMatch = metaText.match(/\b(Ari|Atl|Bal|Buf|Car|Chi|Cin|Cle|Dal|Den|Det|GB|Hou|Ind|Jax|KC|LAC|LAR|LV|Mia|Min|NE|NO|NYG|NYJ|Phi|Pit|Sea|SF|TB|Ten|Was)\b/i);
          if (teamMatch) team = teamMatch[1].toUpperCase();

          // Projected Points
          let proj = 0;
          const projEl = tr.querySelector('td[data-stat="projected"], td.Ta-end.Fw-b, td.alt.last');
          if (projEl) {
            const pVal = parseFloat(projEl.textContent.trim());
            if (!isNaN(pVal) && pVal > 0) proj = pVal;
          }

          const playerObj = {
            name: playerName,
            position,
            team,
            slot,
            proj: proj || 10.0
          };

          if (isOpponent) {
            payload.oppRoster.push(playerObj);
          } else {
            payload.userRoster.push(playerObj);
          }
        });
      }

      const yTables = document.querySelectorAll('#statTable0, #statTable1, .ysf-roster-table');
      if (yTables.length >= 2) {
        parseYahooTable(yTables[0], false);
        parseYahooTable(yTables[1], true);
      } else if (yTables.length === 1) {
        parseYahooTable(yTables[0], false);
      }
    }

    return payload;
  }

  // Execute extraction
  const data = extractFantasyMatchup();
  if (!data || data.userRoster.length === 0) {
    alert('⚠️ Scout Bowie Sync: Could not find active players on this page. Please ensure you are viewing a lineup or matchup scoreboard.');
    return;
  }

  // Base64 encode JSON
  const jsonStr = JSON.stringify(data);
  const encoded = btoa(unescape(encodeURIComponent(jsonStr)));

  // Determine target base URL (local dev vs github pages deployment)
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const baseUrl = isLocal 
    ? `${window.location.protocol}//${window.location.host}/weekly/` 
    : 'https://scout-bowie-analytics.github.io/sleeper-analytics-suite/weekly/';

  const targetUrl = `${baseUrl}#import=${encodeURIComponent(encoded)}`;

  // Also copy to clipboard as seamless backup
  try {
    navigator.clipboard.writeText(jsonStr);
  } catch (e) {}

  // Open in new tab or navigate
  const opened = window.open(targetUrl, '_blank');
  if (!opened) {
    window.location.href = targetUrl;
  }
})();
