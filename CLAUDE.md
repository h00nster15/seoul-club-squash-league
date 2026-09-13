# Seoul Club Squash League — project context for Claude

## What this is

A public, read-only website for the **Seoul Club Squash League** (an amateur team
league: 8 teams × 5 players in brackets 1–5, ~14 weeks Tue/Wed on two courts,
play-offs in December). The organiser keeps the master data in an Excel workbook
(`2026 Fall League.xlsx`, kept in Downloads / not in git); this repo turns it into
a static site. Owner: 이상훈 (Sanghoon Lee), the same person as the sibling
`wellperion-squash` project — but this league is a separate organisation, so
nothing here should mention Wellperion / Glass Court.

Decisions (2026-09-13):
- **Excel stays the source of truth.** No editing in the app. Publishing =
  `node tools/publish.js <xlsx> --push` (see README). Drag-and-drop on the page
  only previews.
- **Zero dependencies at runtime**, no build step (same reasoning as
  wellperion-squash). Node + the `xlsx` npm package are only needed for
  `tools/publish.js`; the browser preview loads SheetJS from cdnjs on demand.
- **Public repo + GitHub Pages**, so: never commit the workbook; the parser skips
  the "Player Contact Info" tab; only names + scores are published (they are
  already shared among league players).
- Standings/points come from the workbook's own numbers (LEAGUE Standings tab),
  not recomputed — the organiser's formulas are authoritative. P/W/L per team and
  per-player rubber records are derived from fixtures/rubbers for display only.
  Known quirk: WK1 sheet says Team 6 = 6 pts while the standings tab says 7; the
  site shows 7.

## Layout

`index.html` + `css/style.css` + `js/app.js` (tabs: Standings · Fixtures & Results
· Rankings · Brackets · Teams), `js/parse.js` (workbook → JSON, UMD so Node and browser share
it), `tools/publish.js`, `tools/serve.js`, generated `data/league.js`. Workbook
layout rules are documented in README → "Workbook layout".

## Status

- 2026-09-13: built and verified locally against the Fall 2026 workbook (week 1
  results in; 42 fixtures, 8 teams, 23 subs, 58 ranked players).
- 2026-09-13: public repo https://github.com/h00nster15/seoul-club-squash-league,
  GitHub Pages from `main` / root → https://h00nster15.github.io/seoul-club-squash-league/
  (gh CLI installed and logged in as h00nster15 on this machine).
- 2026-09-13: **Rankings** tab (individual Elo-style rating across brackets, seeded
  by string, K 32/40/48 by margin, provisional < 3 rubbers) — see README. The
  organiser's per-bracket table is the **Brackets** tab.

## Ideas not started

- Player pages (click a name → all rubbers this season, rating history chart).
- Rankings: tune seeds/K after a few weeks; maybe show the seed-vs-now table.
- Head-to-head / form guide, "next match" for a player.
- Korean UI strings (league is English-speaking; not needed now).
- A team-captain result form (would need a backend/Apps Script → then Excel is no
  longer the master; discuss before doing).

## Accounts / conventions

- GitHub `h00nster15`; git author SangHoon Lee <h00nster15@gmail.com> (global).
- Commit small, push to `main`. Keep this file's Status current at session end.
