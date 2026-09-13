/* Seoul Club Squash League — renders data/league.js (or a previewed workbook) */
(function () {
  'use strict';

  const $ = (sel, el) => (el || document).querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDate = (iso, withDay = true) => {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    return `${withDay ? DAYS[d.getDay()] + ' ' : ''}${d.getDate()} ${MONTHS[d.getMonth()]}`;
  };
  const today = () => new Date().toISOString().slice(0, 10);

  let data = window.LEAGUE_DATA || null;
  let preview = false;

  // ---------- derived numbers ----------
  function derive(d) {
    const keyOf = window.LeagueParser.keyOf;
    const teamOf = new Map(); // player key → team name
    d.teams.forEach((t) => t.players.forEach((p) => teamOf.set(keyOf(p), t.name)));

    const rec = new Map(); // team → {p,w,l,d}
    d.standings.forEach((s) => rec.set(s.team, { p: 0, w: 0, l: 0, d: 0 }));
    d.fixtures.filter((f) => f.played).forEach((f) => {
      const h = rec.get(f.home) || rec.set(f.home, { p: 0, w: 0, l: 0, d: 0 }).get(f.home);
      const a = rec.get(f.away) || rec.set(f.away, { p: 0, w: 0, l: 0, d: 0 }).get(f.away);
      h.p++; a.p++;
      if (f.homePts > f.awayPts) { h.w++; a.l++; } else if (f.homePts < f.awayPts) { a.w++; h.l++; } else { h.d++; a.d++; }
    });

    const matchIndex = new Map(); // `${week}:${number}` → match
    d.weeks.forEach((w) => w.matches.forEach((m) => matchIndex.set(`${w.week}:${m.number}`, m)));

    const player = new Map(); // key → {name, w, l, gf, ga}
    const bump = (name, won, gf, ga) => {
      const k = keyOf(name);
      const p = player.get(k) || player.set(k, { name, w: 0, l: 0, gf: 0, ga: 0 }).get(k);
      if (won) p.w++; else p.l++;
      p.gf += gf; p.ga += ga;
    };
    d.weeks.forEach((w) => w.matches.forEach((m) => {
      if (!m.played) return;
      m.rubbers.forEach((r) => {
        if (r.homeGames + r.awayGames === 0 || !r.homePlayer || !r.awayPlayer) return;
        bump(r.homePlayer, r.homeGames > r.awayGames, r.homeGames, r.awayGames);
        bump(r.awayPlayer, r.awayGames > r.homeGames, r.awayGames, r.homeGames);
      });
    }));

    const upcomingWeek = (() => {
      const t = today();
      const pending = d.fixtures.filter((f) => !f.played && f.date >= t).sort((a, b) => a.date.localeCompare(b.date));
      if (pending.length) return pending[0].week;
      const anyPending = d.fixtures.filter((f) => !f.played).sort((a, b) => a.week - b.week);
      return anyPending.length ? anyPending[0].week : null;
    })();

    const x = { keyOf, teamOf, rec, matchIndex, player, upcomingWeek };
    x.rankings = computeRankings(d, x);
    return x;
  }

  // ---------- individual rankings (Elo-style, seeded by bracket) ----------
  // Every rubber moves both players' ratings: K = 32 for a 3–2, 40 for a 3–1,
  // 48 for a 3–0. Seeds: bracket 1 = 1600 … bracket 5 = 1200 (a sub is seeded
  // by the bracket they cover). Processed week by week, in fixture order.
  const SEED = { 1: 1600, 2: 1500, 3: 1400, 4: 1300, 5: 1200 };
  const PROVISIONAL = 3; // matches before a rating counts as settled
  function computeRankings(d, x) {
    const bracketOf = new Map();
    d.teams.forEach((t) => t.players.forEach((p, i) => bracketOf.set(x.keyOf(p), Math.min(i + 1, 5))));
    d.substitutes.forEach((s) => { const k = x.keyOf(s.name); if (!bracketOf.has(k)) bracketOf.set(k, s.rank || 3); });
    d.performance.forEach((p) => { const k = x.keyOf(p.player); if (!bracketOf.has(k)) bracketOf.set(k, p.bracket || 3); });

    const R = new Map();
    const get = (name) => {
      const k = x.keyOf(name);
      if (!R.has(k)) {
        const b = bracketOf.get(k) || 3;
        R.set(k, { key: k, name, bracket: b, seed: SEED[b], rating: SEED[b], played: 0, w: 0, l: 0, gf: 0, ga: 0, form: [], history: [] });
      }
      return R.get(k);
    };
    // Everyone on a roster or the sub list gets an entry even before playing
    d.teams.forEach((t) => t.players.forEach(get));
    d.substitutes.forEach((s) => get(s.name));

    const weeks = [...d.weeks].sort((a, b) => a.week - b.week);
    let lastPlayedWeek = null;
    for (const w of weeks) {
      const ordered = [];
      const seen = new Set();
      d.fixtures.filter((f) => f.week === w.week).sort((a, b) => a.date.localeCompare(b.date) || a.court - b.court).forEach((f) => {
        const m = f.matchNumber != null ? x.matchIndex.get(`${w.week}:${f.matchNumber}`) : null;
        if (m && !seen.has(m)) { seen.add(m); ordered.push(m); }
      });
      w.matches.forEach((m) => { if (!seen.has(m)) ordered.push(m); });
      let any = false;
      for (const m of ordered) {
        if (!m.played) continue;
        for (const r of m.rubbers) {
          if (!r.homePlayer || !r.awayPlayer || r.homeGames + r.awayGames === 0) continue;
          any = true;
          const a = get(r.homePlayer), b = get(r.awayPlayer);
          const ea = 1 / (1 + Math.pow(10, (b.rating - a.rating) / 400));
          const aWon = r.homeGames > r.awayGames;
          const gd = Math.abs(r.homeGames - r.awayGames);
          const K = 32 * (1 + 0.25 * (gd - 1));
          const delta = K * ((aWon ? 1 : 0) - ea);
          a.rating += delta; b.rating -= delta;
          a.played++; b.played++;
          if (aWon) { a.w++; b.l++; } else { b.w++; a.l++; }
          a.gf += r.homeGames; a.ga += r.awayGames; b.gf += r.awayGames; b.ga += r.homeGames;
          a.form.push({ week: w.week, won: aWon, vs: b.name, score: `${r.homeGames}–${r.awayGames}` });
          b.form.push({ week: w.week, won: !aWon, vs: a.name, score: `${r.awayGames}–${r.homeGames}` });
        }
      }
      if (any) { lastPlayedWeek = w.week; R.forEach((p) => p.history.push({ week: w.week, rating: p.rating })); }
    }

    const list = [...R.values()];
    for (const p of list) {
      const prev = p.history.length >= 2 ? p.history[p.history.length - 2].rating : p.seed;
      p.delta = p.rating - prev;             // movement since the previous week with results
      p.provisional = p.played < PROVISIONAL;
      p.team = x.teamOf.get(p.key) || 'Sub';
    }
    const ranked = list.filter((p) => p.played > 0).sort((a, b) => b.rating - a.rating || b.w - a.w || (b.gf - b.ga) - (a.gf - a.ga) || a.name.localeCompare(b.name));
    ranked.forEach((p, i) => { p.rank = i + 1; });
    const unranked = list.filter((p) => p.played === 0).sort((a, b) => a.bracket - b.bracket || a.name.localeCompare(b.name));
    return { ranked, unranked, lastPlayedWeek };
  }

  function renderRankings(d, x) {
    const { ranked, unranked, lastPlayedWeek } = x.rankings;
    const rows = ranked.map((p) => {
      const mv = Math.round(p.delta);
      const form = p.form.slice(-6).map((f) => `<i class="dot ${f.won ? 'w' : 'l'}" title="Wk ${f.week}: ${f.won ? 'beat' : 'lost to'} ${esc(f.vs)} ${f.score}"></i>`).join('');
      return `<tr>
        <td class="n muted">${p.rank}</td>
        <td class="team">${esc(p.name)}${p.provisional ? '<span class="sub" title="Fewer than 3 matches — rating still settling">prov.</span>' : ''}</td>
        <td class="muted">${esc(p.team)}</td><td class="n muted">${p.bracket}</td>
        <td class="n pts">${Math.round(p.rating)}</td>
        <td class="n ${mv > 0 ? 'w' : mv < 0 ? 'l' : 'muted'}">${mv > 0 ? '▲' : mv < 0 ? '▼' : '·'} ${Math.abs(mv) || ''}</td>
        <td class="n">${p.played}</td><td class="n">${p.w}–${p.l}</td><td class="n">${p.gf}–${p.ga}</td>
        <td class="form">${form}</td></tr>`;
    }).join('');
    const pending = unranked.map((p) => `<span class="chip">${esc(p.name)} <span class="muted">${esc(p.team)} · B${p.bracket}</span></span>`).join('');
    $('#tab-rankings').innerHTML = `
      <div class="card">
        <h2>Individual rankings <span class="sub">${ranked.length} players rated${lastPlayedWeek ? ' · after week ' + lastPlayedWeek : ''}</span></h2>
        ${ranked.length ? `<div class="tablewrap"><table>
          <thead><tr><th class="n">#</th><th>Player</th><th>Team</th><th class="n" title="Bracket / string">Br</th><th class="n">Rating</th><th class="n" title="Change since the previous week">Δ</th><th class="n" title="Rubbers played">P</th><th class="n">W–L</th><th class="n">Games</th><th>Form</th></tr></thead>
          <tbody>${rows}</tbody></table></div>` : '<div class="muted">No rubbers played yet.</div>'}
        <div class="note">Elo-style rating across all brackets. Everyone starts from a seed by string (1: 1600 · 2: 1500 · 3: 1400 · 4: 1300 · 5: 1200); each rubber moves both players by up to 32 points (×1.25 for 3–1, ×1.5 for 3–0), more when the underdog wins. Δ is the change since the previous week's results; <b>prov.</b> = fewer than ${PROVISIONAL} rubbers played.</div>
      </div>
      ${unranked.length ? `<div class="card"><h2>Not yet rated <span class="sub">${unranked.length} players without a rubber this season</span></h2><div class="chips">${pending}</div></div>` : ''}`;
  }

  // ---------- standings ----------
  function renderStandings(d, x) {
    const zone = 4;
    const rows = d.standings.map((s) => {
      const r = x.rec.get(s.team) || { p: 0, w: 0, l: 0, d: 0 };
      return `<tr class="${s.place <= zone ? 'zone' : ''}">
        <td class="n muted">${s.place}</td><td class="team">${esc(s.team)}</td>
        <td class="n">${r.p}</td><td class="n">${r.w}</td><td class="n">${r.l}</td>
        <td class="n">${s.gamesWon}</td><td class="n pts">${s.teamPts}</td></tr>`;
    }).join('');
    const po = d.playoffs && d.playoffs.date ? `Play-offs ${fmtDate(d.playoffs.date)}${d.playoffs.rounds.length ? ' · ' + d.playoffs.rounds.map((r) => r.round).join(' & ') : ''}` : '';

    const next = d.fixtures.filter((f) => f.week === x.upcomingWeek && !f.played);
    const lastWeek = Math.max(0, ...d.fixtures.filter((f) => f.played).map((f) => f.week));
    const last = d.fixtures.filter((f) => f.played && f.week === lastWeek);

    $('#tab-standings').innerHTML = `
      <div class="cols">
        <div class="card">
          <h2>Standings <span class="sub">${esc(d.season)}</span></h2>
          <div class="tablewrap"><table>
            <thead><tr><th class="n">#</th><th>Team</th><th class="n" title="Played">P</th><th class="n" title="Won">W</th><th class="n" title="Lost">L</th><th class="n" title="Games won">Games</th><th class="n">Pts</th></tr></thead>
            <tbody>${rows}</tbody></table></div>
          <div class="legend"><i></i>Play-off places${po ? ' · ' + esc(po) : ''}</div>
          <div class="note">${esc(d.scoring)}.</div>
        </div>
        <div>
          <div class="card">
            <h2>Up next <span class="sub">${next.length ? 'Week ' + x.upcomingWeek : ''}</span></h2>
            ${next.length ? next.map(fixtureHTML.bind(null, d, x, false)).join('') : '<div class="muted">No fixtures left — see you at the play-offs.</div>'}
          </div>
          <div class="card">
            <h2>Latest results <span class="sub">${last.length ? 'Week ' + lastWeek : ''}</span></h2>
            ${last.length ? last.map(fixtureHTML.bind(null, d, x, false)).join('') : '<div class="muted">No results yet.</div>'}
          </div>
        </div>
      </div>`;
  }

  // ---------- fixtures ----------
  let fixtureFilter = 'all';
  function renderFixtures(d, x) {
    const weeks = [...new Set(d.fixtures.map((f) => f.week))].sort((a, b) => a - b);
    const html = weeks.map((w) => {
      let fs = d.fixtures.filter((f) => f.week === w);
      if (fixtureFilter === 'results') fs = fs.filter((f) => f.played);
      if (fixtureFilter === 'upcoming') fs = fs.filter((f) => !f.played);
      if (!fs.length) return '';
      const dates = [...new Set(fs.map((f) => f.date))].map((dt) => fmtDate(dt)).join(' · ');
      return `<div class="week" id="week-${w}">
        <h3>Week ${w} <span class="muted" style="text-transform:none;letter-spacing:0">${esc(dates)}</span>${w === x.upcomingWeek ? '<span class="cur">this week</span>' : ''}</h3>
        ${fs.map(fixtureHTML.bind(null, d, x, true)).join('')}
      </div>`;
    }).join('');
    $('#tab-fixtures').innerHTML = `
      <div class="tools" role="group" aria-label="Filter">
        ${['all', 'results', 'upcoming'].map((k) => `<button type="button" data-filter="${k}" aria-pressed="${fixtureFilter === k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}
      </div>
      ${html || '<div class="muted">Nothing to show.</div>'}`;
    $('#tab-fixtures .tools').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-filter]');
      if (!b) return;
      fixtureFilter = b.dataset.filter;
      renderFixtures(d, x);
    });
  }

  function fixtureHTML(d, x, expandable, f) {
    const m = f.matchNumber != null ? x.matchIndex.get(`${f.week}:${f.matchNumber}`) : null;
    const hw = f.played && f.homePts > f.awayPts, aw = f.played && f.awayPts > f.homePts;
    const score = f.played
      ? `<span class="${hw ? 'w' : aw ? 'l' : ''}">${f.homePts}</span> – <span class="${aw ? 'w' : hw ? 'l' : ''}">${f.awayPts}</span><small>games ${f.homeGames}–${f.awayGames}</small>`
      : `<span class="tbd">v</span>`;
    const detail = m ? rubbersHTML(m, f) : '';
    const canOpen = expandable && !!detail;
    return `<div class="fixture" ${canOpen ? '' : 'data-static'}>
      <button class="row" type="button" ${canOpen ? '' : 'disabled style="cursor:default"'}>
        <span class="when"><b>${esc(fmtDate(f.date))}</b>Court ${f.court}</span>
        <span class="home ${hw ? 'w' : ''}">${esc(f.home)}</span>
        <span class="score ${f.played ? '' : 'tbd'}">${score}</span>
        <span class="away ${aw ? 'w' : ''}">${esc(f.away)}</span>
        <span class="chev">${canOpen ? '▾' : ''}</span>
      </button>
      ${canOpen ? `<div class="detail">${detail}</div>` : ''}
    </div>`;
  }

  function rubbersHTML(m, f) {
    // The week sheet may list the two teams the other way round from the fixture list
    const flip = !!f.swapped;
    const rows = m.rubbers.map((r) => {
      const hp = flip ? r.awayPlayer : r.homePlayer, ap = flip ? r.homePlayer : r.awayPlayer;
      const hs = flip ? r.awaySub : r.homeSub, as = flip ? r.homeSub : r.awaySub;
      const hg = flip ? r.awayGames : r.homeGames, ag = flip ? r.homeGames : r.awayGames;
      const played = hg + ag > 0;
      return `<div class="rubber">
        <span class="rk">${r.rank != null ? '#' + r.rank : ''}</span>
        <span class="hp ${played && hg > ag ? 'w' : ''}">${esc(hp || '—')}${hs ? '<span class="sub">sub</span>' : ''}</span>
        <span class="sc ${played ? '' : 'tbd'}">${played ? `${hg}–${ag}` : 'v'}</span>
        <span class="ap ${played && ag > hg ? 'w' : ''}">${as ? '<span class="sub">sub</span>' : ''}${esc(ap || '—')}</span>
      </div>`;
    }).join('');
    if (!rows) return '';
    return `${!m.played ? '<div class="note">Line-ups from the week sheet — subject to change.</div>' : ''}${rows}`;
  }

  // ---------- players ----------
  let playerQuery = '';
  function renderPlayers(d, x) {
    const brackets = [...new Set(d.performance.map((p) => p.bracket))].sort((a, b) => a - b);
    const q = playerQuery.trim().toLowerCase();
    const cards = brackets.map((b) => {
      let ps = d.performance.filter((p) => p.bracket === b);
      if (q) ps = ps.filter((p) => p.player.toLowerCase().includes(q));
      if (!ps.length) return '';
      const rows = ps.map((p) => {
        const team = x.teamOf.get(x.keyOf(p.player)) || 'Sub';
        const diff = p.gamesFor - p.gamesAgainst;
        return `<tr>
          <td class="n muted">${p.rank}</td><td class="team">${esc(p.player)}</td><td class="muted">${esc(team)}</td>
          <td class="n">${p.played}</td><td class="n">${p.rubbers}</td>
          <td class="n">${p.gamesFor}–${p.gamesAgainst}</td><td class="n ${diff > 0 ? 'w' : diff < 0 ? 'l' : ''}">${diff > 0 ? '+' : ''}${diff}</td>
          <td class="n">${p.played ? (p.avgRubbers == null ? '' : fmtAvg(p.avgRubbers)) : ''}</td>
          <td class="n pts">${p.played ? (p.avgGames == null ? '' : fmtAvg(p.avgGames)) : ''}</td></tr>`;
      }).join('');
      return `<div class="card">
        <h2>Bracket ${b} <span class="sub">${b === 1 ? 'top string of each team' : 'string ' + b}</span></h2>
        <div class="tablewrap"><table>
          <thead><tr><th class="n">#</th><th>Player</th><th>Team</th><th class="n" title="Matches played">P</th><th class="n" title="Rubbers won">Won</th><th class="n">Games</th><th class="n">+/−</th><th class="n" title="Rubbers won per match">Avg W</th><th class="n" title="Net games average per match">Avg G</th></tr></thead>
          <tbody>${rows}</tbody></table></div>
      </div>`;
    }).join('');
    $('#tab-players').innerHTML = `
      <div class="tools"><input type="search" id="pq" placeholder="Find a player…" value="${esc(playerQuery)}" style="border:1px solid var(--line);background:var(--card);border-radius:8px;padding:6px 10px;font:inherit;font-size:13px;min-width:200px"></div>
      ${cards || '<div class="muted">No players match.</div>'}
      <div class="note">Ranking within each bracket follows the organiser's sheet: rubbers won, then net games per match. Substitutes are ranked in the bracket they cover.</div>`;
    const inp = $('#pq');
    inp.addEventListener('input', () => { playerQuery = inp.value; const pos = inp.selectionStart; renderPlayers(d, x); const n = $('#pq'); n.focus(); n.setSelectionRange(pos, pos); });
  }
  const fmtAvg = (v) => (Math.round(v * 100) / 100).toString();

  // ---------- teams ----------
  function renderTeams(d, x) {
    const cards = d.teams.map((t) => {
      const r = x.rec.get(t.name) || { p: 0, w: 0, l: 0 };
      const s = d.standings.find((z) => z.team === t.name);
      const players = t.players.map((p) => {
        const pr = x.player.get(x.keyOf(p));
        return `<li><span>${esc(p)}</span><span class="rec">${pr ? `${pr.w}–${pr.l}` : ''}</span></li>`;
      }).join('');
      return `<div class="teamcard">
        <h3>${esc(t.name)} <span>${s ? `#${s.place} · ${s.teamPts} pts` : ''}${r.p ? ` · ${r.w}W ${r.l}L` : ''}</span></h3>
        ${players ? `<ol>${players}</ol>` : '<div class="empty">No players listed</div>'}
      </div>`;
    }).join('');
    const subs = [...d.substitutes].sort((a, b) => (a.rank || 9) - (b.rank || 9) || a.name.localeCompare(b.name)).map((s) => {
      const pr = x.player.get(x.keyOf(s.name));
      return `<div><span>${esc(s.name)}${pr ? ` <span class="rec muted" style="font-size:12px">${pr.w}–${pr.l}</span>` : ''}</span><span class="rk">bracket ${s.rank ?? '–'}</span></div>`;
    }).join('');
    $('#tab-teams').innerHTML = `
      <div class="teamgrid">${cards}</div>
      <div class="card" style="margin-top:16px"><h2>Substitutes <span class="sub">${d.substitutes.length} players · rank = bracket they can cover</span></h2><div class="subs">${subs}</div></div>
      <div class="note">Record next to a name = rubbers won–lost this season.</div>`;
  }

  // ---------- shell ----------
  function renderAll() {
    if (!data) {
      $('#tab-standings').innerHTML = '<div class="card">No league data yet — publish a workbook with <code>node tools/publish.js</code>, or drop an .xlsx on this page to preview.</div>';
      return;
    }
    const x = derive(data);
    $('#season').textContent = data.season || '';
    const played = data.fixtures.filter((f) => f.played).length;
    const gen = data.generatedAt ? new Date(data.generatedAt) : null;
    $('#meta').innerHTML = `<b>${played}</b> of <b>${data.fixtures.length}</b> matches played<br>${gen ? 'Updated ' + fmtDate(gen.toISOString().slice(0, 10)) + ' ' + gen.toTimeString().slice(0, 5) : ''}`;
    $('#foot').textContent = `${data.league} · ${data.season}${data.source ? ' · from ' + data.source : ''}`;
    renderStandings(data, x);
    renderFixtures(data, x);
    renderRankings(data, x);
    renderPlayers(data, x);
    renderTeams(data, x);
  }

  document.addEventListener('click', (e) => {
    const row = e.target.closest('.fixture:not([data-static]) > .row');
    if (row) { row.parentElement.toggleAttribute('open'); return; }
    const tab = e.target.closest('#tabs [data-tab]');
    if (tab) selectTab(tab.dataset.tab);
  });
  function selectTab(name) {
    document.querySelectorAll('#tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === name));
    document.querySelectorAll('section[role=tabpanel]').forEach((s) => { s.hidden = s.id !== 'tab-' + name; });
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  }
  if (/^#(standings|fixtures|rankings|players|teams)$/.test(location.hash)) selectTab(location.hash.slice(1));

  // ---------- preview a workbook (drag & drop or file picker) ----------
  const SHEETJS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  function loadSheetJS() {
    return window.XLSX ? Promise.resolve(window.XLSX) : new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = SHEETJS; s.onload = () => res(window.XLSX); s.onerror = rej; document.head.appendChild(s);
    });
  }
  async function previewFile(file) {
    if (!file || !/\.xls[xm]$/i.test(file.name)) { alert('Please choose the league workbook (.xlsx).'); return; }
    try {
      const XLSX = await loadSheetJS();
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      data = window.LeagueParser.parseWorkbook(XLSX, wb, { source: file.name });
      preview = true;
      $('#preview-name').textContent = file.name;
      $('#preview-banner').hidden = false;
      renderAll();
    } catch (err) {
      console.error(err);
      alert('Could not read that workbook: ' + err.message);
    }
  }
  $('#file').addEventListener('change', (e) => previewFile(e.target.files[0]));
  $('#preview-clear').addEventListener('click', () => { data = window.LEAGUE_DATA || null; preview = false; $('#preview-banner').hidden = true; renderAll(); });
  let dragDepth = 0;
  document.addEventListener('dragenter', (e) => { if ([...e.dataTransfer.types].includes('Files')) { dragDepth++; document.body.classList.add('dragging'); } });
  document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); previewFile(e.dataTransfer.files[0]); });

  renderAll();
})();
