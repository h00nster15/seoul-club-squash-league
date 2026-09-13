/*
 * Seoul Club Squash League — workbook parser.
 *
 * Turns the league Excel workbook (the organiser's master file) into the plain
 * JSON the site renders. Works in Node (tools/publish.js) and in the browser
 * (drag-and-drop preview) — it only needs a SheetJS workbook object and the
 * XLSX utils.
 *
 * Workbook layout it understands (see README → "Workbook layout"):
 *   LEAGUE Standings   standings table, fixture list (week/date/court), rosters
 *   Teams              roster grid + substitutes with rank
 *   PLAYER PERFORMANCE ranking by bracket
 *   WK<n> Result       per-week match sheets with rubbers and game scores
 * "Player Contact Info" is deliberately never read.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LeagueParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
  const num = (v) => (typeof v === 'number' ? v : (str(v) !== '' && !isNaN(Number(v)) ? Number(v) : null));
  const isName = (v) => { const s = str(v); return s !== '' && s !== '0' && s !== '-'; };
  const teamName = (n) => (n === '' || n === null ? '' : `Team ${n}`);
  // Excel serial → YYYY-MM-DD (workbook is 1900-based, dates are whole days)
  const serialToISO = (n) => new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);
  const dateOf = (v) => {
    if (typeof v === 'number' && v > 30000 && v < 80000) return serialToISO(v);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const s = str(v);
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
  };
  // Loose key for matching a name across tabs (spelling drifts: "Seojin Lee" vs "Seo Jin Lee")
  const keyOf = (name) => str(name).toLowerCase().replace(/[^a-z0-9ㄱ-힝]/g, '');

  function grid(XLSX, ws) {
    if (!ws) return [];
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
  }
  const cell = (rows, r, c) => (rows[r] && rows[r][c] !== undefined ? rows[r][c] : '');
  const col = (letters) => letters.split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;

  // ---------- LEAGUE Standings ----------
  function parseStandings(rows) {
    const standings = [];
    const fixtures = [];
    let playoffs = null;
    let inTable = false;
    let inFixtures = false;
    let currentWeek = null;
    const C = { place: col('D'), team: col('E'), games: col('K'), pts: col('N') };
    const F = {
      week: col('B'), date: col('C'),
      c1: { home: col('E'), away: col('G'), hg: col('H'), ag: col('J'), hp: col('K'), ap: col('M') },
      c2: { home: col('O'), away: col('Q'), hg: col('R'), ag: col('T'), hp: col('U'), ap: col('W') },
    };
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const d = str(cell(rows, r, C.place));
      if (d === 'Place') { inTable = true; continue; }
      if (inTable) {
        const place = num(cell(rows, r, C.place));
        if (place !== null) {
          standings.push({
            place, team: str(cell(rows, r, C.team)),
            gamesWon: num(cell(rows, r, C.games)) || 0,
            teamPts: num(cell(rows, r, C.pts)) || 0,
          });
          continue;
        }
      }
      if (str(cell(rows, r, F.week)) === 'Week') { inTable = false; inFixtures = true; continue; }
      if (inFixtures) {
        const wk = str(cell(rows, r, F.week));
        if (/^play/i.test(wk)) { inFixtures = false; playoffs = parsePlayoffs(rows, r); break; }
        const w = num(wk);
        if (w !== null) currentWeek = w;
        const date = dateOf(cell(rows, r, F.date));
        if (!date && w === null) continue;
        for (const [court, cc] of [[1, F.c1], [2, F.c2]]) {
          const home = num(cell(rows, r, cc.home));
          const away = num(cell(rows, r, cc.away));
          if (home === null || away === null) continue;
          const hg = num(cell(rows, r, cc.hg)), ag = num(cell(rows, r, cc.ag));
          const hp = num(cell(rows, r, cc.hp)), ap = num(cell(rows, r, cc.ap));
          const played = hp !== null || ap !== null;
          fixtures.push({
            week: currentWeek, date, court,
            home: teamName(home), away: teamName(away),
            played,
            homeGames: played ? hg || 0 : null, awayGames: played ? ag || 0 : null,
            homePts: played ? hp || 0 : null, awayPts: played ? ap || 0 : null,
          });
        }
      }
    }
    return { standings, fixtures, playoffs };
  }

  function parsePlayoffs(rows, start) {
    const out = { date: '', rounds: [] };
    for (let r = start; r < Math.min(rows.length, start + 8); r++) {
      const d = dateOf(cell(rows, r, col('C')));
      if (d && !out.date) out.date = d;
      const label = str(cell(rows, r, col('D')));
      if (label && !/^(court|team)/i.test(label)) out.rounds.push({ round: label, session: str(cell(rows, r, col('B'))) });
    }
    return out;
  }

  // ---------- Teams ----------
  function parseTeams(rows) {
    const teams = [];
    const substitutes = [];
    let headerRow = -1;
    for (let r = 0; r < rows.length; r++) {
      const vals = rows[r].map(num);
      // the roster header is the row that reads 1,2,3,... across
      const nums = vals.filter((v) => v !== null);
      if (nums.length >= 5 && nums[0] === 1 && nums[1] === 2 && nums[2] === 3) { headerRow = r; break; }
    }
    if (headerRow >= 0) {
      rows[headerRow].forEach((v, c) => {
        const n = num(v);
        if (n === null) return;
        const players = [];
        for (let r = headerRow + 1; r < rows.length; r++) {
          const name = str(cell(rows, r, c));
          if (!isName(name)) break;
          players.push(name);
        }
        teams.push({ id: n, name: teamName(n), players });
      });
    }
    for (let r = 0; r < rows.length; r++) {
      if (str(cell(rows, r, col('B'))) === 'Substitutes') {
        for (let k = r + 1; k < rows.length; k++) {
          const name = str(cell(rows, k, col('B')));
          if (!isName(name)) { if (num(cell(rows, k, col('A'))) === null) break; else continue; }
          substitutes.push({ name, rank: num(cell(rows, k, col('C'))) });
        }
        break;
      }
    }
    return { teams, substitutes };
  }

  // ---------- PLAYER PERFORMANCE ----------
  function parsePerformance(rows) {
    const out = [];
    let bracket = null;
    let started = false;
    for (let r = 0; r < rows.length; r++) {
      const c = str(cell(rows, r, col('C')));
      if (c === 'Player' && str(cell(rows, r, col('B'))) === 'Bracket') { started = true; continue; }
      if (!started) continue;
      if (/^enter each/i.test(str(cell(rows, r, col('O'))))) break;
      const b = num(cell(rows, r, col('B')));
      if (b !== null) bracket = b;
      if (!isName(c)) continue;
      const rank = num(cell(rows, r, col('A')));
      if (rank === null) continue;
      out.push({
        bracket, rank, player: c,
        played: num(cell(rows, r, col('D'))) || 0,
        rubbers: num(cell(rows, r, col('E'))) || 0,
        gamesFor: num(cell(rows, r, col('F'))) || 0,
        gamesAgainst: num(cell(rows, r, col('G'))) || 0,
        avgRubbers: num(cell(rows, r, col('H'))),
        avgGames: num(cell(rows, r, col('I'))),
      });
    }
    return out;
  }

  // ---------- WK<n> Result ----------
  // Each sheet holds up to 5 match blocks. A block starts at a cell reading
  // "MATCH n"; two rows below is "Player | Team A | v | Team B | Score", then
  // four rubber rows: rank, home player, v, away player, home games, -, away games.
  function parseWeek(rows, week) {
    const matches = [];
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < (rows[r] || []).length; c++) {
        const m = /^MATCH\s+(\d+)/i.exec(str(cell(rows, r, c)));
        if (!m) continue;
        const hdr = r + 2;
        const home = str(cell(rows, hdr, c + 1));
        const away = str(cell(rows, hdr, c + 3));
        if (!/^Team\s*\d/i.test(home) || !/^Team\s*\d/i.test(away)) continue;
        const rubbers = [];
        for (let k = hdr + 1; k <= hdr + 4; k++) {
          const hp = str(cell(rows, k, c + 1)), ap = str(cell(rows, k, c + 3));
          if (!isName(hp) && !isName(ap)) continue;
          const hg = num(cell(rows, k, c + 4)), ag = num(cell(rows, k, c + 6));
          rubbers.push({
            rank: num(cell(rows, k, c)),
            homePlayer: isName(hp) ? hp : '', awayPlayer: isName(ap) ? ap : '',
            homeGames: hg || 0, awayGames: ag || 0,
          });
        }
        const played = rubbers.some((x) => x.homeGames + x.awayGames > 0);
        matches.push({
          week, number: Number(m[1]),
          home: home.replace(/\s+/g, ' '), away: away.replace(/\s+/g, ' '),
          played, rubbers,
        });
      }
    }
    return matches;
  }

  // ---------- put it together ----------
  function parseWorkbook(XLSX, wb, meta) {
    const names = wb.SheetNames;
    const find = (re) => names.find((n) => re.test(n));
    const standingsSheet = find(/standings/i);
    const teamsSheet = find(/^teams$/i);
    const perfSheet = find(/performance/i);

    const { standings, fixtures, playoffs } = parseStandings(grid(XLSX, wb.Sheets[standingsSheet]));
    const { teams, substitutes } = parseTeams(grid(XLSX, wb.Sheets[teamsSheet]));
    const performance = parsePerformance(grid(XLSX, wb.Sheets[perfSheet]));

    const weeks = [];
    for (const n of names) {
      const m = /^WK\s*(\d+)/i.exec(n);
      if (!m) continue;
      const week = Number(m[1]);
      const matches = parseWeek(grid(XLSX, wb.Sheets[n]), week);
      weeks.push({ week, matches });
    }
    weeks.sort((a, b) => a.week - b.week);

    // Season title lives on the Teams tab ("Seoul Club Squash League Teams - Fall 2026")
    let season = '';
    const tRows = grid(XLSX, wb.Sheets[teamsSheet]);
    outer: for (const row of tRows.slice(0, 3)) for (const v of row) {
      const s = str(v); const mm = /-\s*(.+)$/.exec(s);
      if (/league/i.test(s) && mm) { season = mm[1].trim(); break outer; }
    }

    // Link each fixture to its week sheet match (same pair of teams, either order)
    const byWeek = new Map(weeks.map((w) => [w.week, w.matches]));
    for (const f of fixtures) {
      const ms = byWeek.get(f.week) || [];
      const m = ms.find((x) => (x.home === f.home && x.away === f.away) || (x.home === f.away && x.away === f.home));
      if (!m) continue;
      f.matchNumber = m.number;
      f.swapped = m.home !== f.home; // week sheet lists the teams the other way round
    }

    // A substitute is someone playing for a team whose roster does not list them
    const roster = new Map(teams.map((t) => [t.name, new Set(t.players.map(keyOf))]));
    const onTeam = (team, player) => !!player && (roster.get(team) || new Set()).has(keyOf(player));
    for (const w of weeks) for (const m of w.matches) for (const rb of m.rubbers) {
      rb.homeSub = !!rb.homePlayer && !onTeam(m.home, rb.homePlayer);
      rb.awaySub = !!rb.awayPlayer && !onTeam(m.away, rb.awayPlayer);
    }

    return {
      league: 'Seoul Club Squash League',
      season,
      generatedAt: new Date().toISOString(),
      source: (meta && meta.source) || '',
      scoring: '1 point per game + 1 point per rubber + 4 points for the winning team (max. 20 team points)',
      standings, fixtures, playoffs, teams, substitutes, performance, weeks,
    };
  }

  return { parseWorkbook, keyOf };
});
