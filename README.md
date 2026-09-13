# Seoul Club Squash League — site

Public standings / fixtures / results / player rankings for the Seoul Club Squash
League, generated from the organiser's Excel workbook. No framework, no build step,
no backend: a static page on GitHub Pages.

## How to publish a new week

1. Save the league workbook (e.g. `2026 Fall League.xlsx`) after entering results.
2. In this folder:

   ```
   node tools/publish.js "C:\Users\h00ns\Downloads\2026 Fall League.xlsx" --push
   ```

   This rewrites `data/league.js` and pushes it; GitHub Pages updates within a
   couple of minutes. Without `--push` it only writes the file so you can check it
   locally first (`node tools/serve.js` → http://127.0.0.1:8790/).

The workbook itself is git-ignored and never copied into the repo. The parser never
reads the **Player Contact Info** tab, so no contact details reach the site.

To check a workbook without publishing, open the site and drop the `.xlsx` on the
page (or use "Preview a workbook" in the footer) — it is parsed in the browser.

## Files

| Path | What |
|---|---|
| `index.html`, `css/style.css`, `js/app.js` | The site (Standings · Fixtures & Results · Players · Teams) |
| `js/parse.js` | Workbook → JSON parser, shared by Node and the browser |
| `tools/publish.js` | Reads the .xlsx, writes `data/league.js`, optionally commits + pushes |
| `tools/serve.js` | Local preview server |
| `data/league.js` | Generated data (`window.LEAGUE_DATA = {...}`) — the only thing that changes week to week |

## Workbook layout the parser expects

- **LEAGUE Standings** — `Place / Team / Games Won / Team Pts` table (found by the
  cell `Place` in column D); the fixture list starting at the row whose column B
  reads `Week` (week no. in B, date in C, court 1 = `Team E v G` with games H/J and
  points K/M, court 2 = `Team O v Q` with games R/T and points U/W); a row starting
  `PLAY-OFFS` ends the list (date + round names are picked up).
- **Teams** — roster grid whose header row reads `1 2 3 …` (players below each
  number until a blank), plus a `Substitutes / Rank` list.
- **PLAYER PERFORMANCE** — from the `Bracket | Player | Played | Rubbers | Games+ |
  Games- | …` header down to `ENTER EACH INDIVIDUALS RESULTS…`.
- **WK<n> Result** — every `MATCH n` block: two rows below it `Player | Team A | v |
  Team B | Score`, then four rubber rows (rank, home player, v, away player, home
  games, -, away games). A match with all-zero scores is "not played yet" and its
  names are shown as line-ups.

Adding a column or moving a block inside these rules is fine; renaming tabs or
headers means updating `js/parse.js`.
