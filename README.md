# SACAA Softball — West Coast Fastpitch Simulator

A fully client-side softball league simulator for a fictional West Coast D1/D2
world: 56 teams, 7 conferences, a 13-week regular season, conference
tournaments, and an NCAA-style bracket through a national championship.
Nothing leaves the browser — no server, no backend, just static files.

## What's in here

```
index.html          the app shell
css/style.css        all styling
js/
  app.js              UI wiring, game state, localStorage persistence
  data/teams.json      56 teams: conference, coach, batting/pitching/fielding stats
  engine/
    roster.js          generates individual players (9-batter lineup + pitching staff) per team
    sim.js             single-game simulator: real batter-vs-pitcher plate appearances, box scores
    schedule.js        13-week schedule generator (conference round-robin + interconference)
    standings.js        conference / overall win-loss records
    rankings.js         RPI-style Top 25 poll
    postseason.js       conference tournaments -> NCAA field -> regionals -> World Series
```

## How the simulation works

- **Individual rosters**: every team has 9 named batters (with a constructed
  batting order and defensive positions) and a 4-man pitching staff (three
  starters + a reliever), each with their own AVG/OBP/SLG or ERA/WHIP/K-rate.
  Players are generated as plausible variations around their team's real
  stat line from `teams.json` — so a team's overall quality is preserved, but
  no two players on a roster are identical. Class years (FR/SO/JR/SR) are
  already assigned, ready for a future recruiting/graduation system.
- **Every plate appearance** is a real batter vs the actual pitcher in the
  game (starters rotate through the rotation by game number; a bullpen arm
  takes over if a pitcher allows 6+ runs). Fielding errors are modeled off
  each team's fielding percentage, runs are correctly split into earned vs.
  unearned, and pitchers get real W/L/SV decisions.
- **Full box scores** (AB/H/R/RBI/BB/K/2B/3B/HR per batter, IP/H/R/ER/BB/K
  per pitcher) are generated for every game. Regular-season box scores
  aren't saved to disk — the sim is fully seeded and deterministic, so a
  game's exact box score is regenerated on demand (in well under a
  millisecond) whenever you open it, keeping the saved file small. Click any
  played game to see its box score, and click a team name to see its full
  roster with season stats aggregated across every game it's played.
- **Schedule**: weeks 1–4 are entirely non-conference (4-game series). Weeks
  5–13 run each conference's round-robin (3-game series, via the standard
  "circle method"). Any team without a conference game in a given week —
  because its conference has an odd number of teams and someone's on the bye
  rotation, or because a smaller conference finishes its round-robin early —
  either picks up a 4-game non-conference series that week or takes a bye
  outright; which one is decided per-matchup, so it's fluid rather than a
  fixed pattern. The Schedule tab lists anyone on bye for the selected week.
- **Rankings**: a Top 25 using the same shape formula NCAA softball used for
  years — 25% your own win%, 50% your opponents' win%, 25% your opponents'
  opponents' win%.
- **Postseason**: each conference runs a full seeded single-elimination
  tournament (every round is simulated and shown, not just the champion); the
  7 champions get automatic bids, the strongest remaining teams by RPI fill
  out a 16-team field, which is reseeded 1–16. Regionals are best-of-3. The
  8 regional winners then play a true double-elimination World Series —
  winners' bracket, losers' bracket, and a Grand Final where the
  winners'-bracket team (still undefeated) has to be beaten twice, including
  an "if necessary" Game 2 when it happens.

Everything is seeded with a PRNG, so a given season's results are
reproducible if you note the seed, but "New Season" always draws a fresh one.

## Running it locally

Any static file server works, e.g.:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

You can't just double-click `index.html` — the browser needs to fetch
`teams.json` over HTTP, and `file://` pages block that request.

## Deploying to GitHub Pages

1. Create a new GitHub repo and push this whole folder to it.
2. In the repo, go to **Settings → Pages**.
3. Under "Build and deployment," set **Source** to "Deploy from a branch,"
   pick your default branch (e.g. `main`) and the `/ (root)` folder.
4. Save — GitHub will give you a URL like
   `https://yourname.github.io/your-repo/` within a minute or two.

No build step, no dependencies to install — it's just static files.

## Tweaking things

- **Team stats / conferences / coaches**: edit `js/data/teams.json` directly.
  Every team needs `batting.avg/obp/slg/iso`, `pitching.era/whip/k_per7/k_bb`,
  and `fielding.pct`. Individual players are regenerated from these values
  every time you start a new season.
- **Player generation** (name pools, how much individual players vary from
  their team's average, batting-order construction): `js/engine/roster.js`.
- **Season length / games per series**: `TOTAL_WEEKS` and the series-length
  constants at the top of `js/engine/schedule.js`.
- **NCAA field size**: pass a different number into `selectField(...)` in
  `js/app.js` (currently 16).
- **Simulation "feel"** (higher/lower scoring, more/fewer upsets, error
  rates, when the bullpen gets the call): the clamp ranges and multipliers in
  `js/engine/sim.js` (`simulatePA`, `RELIEF_RUN_THRESHOLD`) are the knobs —
  each has a comment explaining what it controls.

## Roadmap

Next up: recruiting and multi-year dynasty progression, building directly on
the roster/class-year system now in place — graduating seniors, generating
incoming recruiting classes, and carrying a program's identity across
multiple seasons instead of starting fresh every time.

## Notes on the source data

Your `2030_SACAA_Softball.xlsx` file contains a full pre-simulated season
(game log, weekly rankings, brackets) — per your instructions this app does
**not** use that data directly. Only team names, conferences, coaches, and
season stat lines were pulled in, from `SACAA_Softball.xlsx` and
`SACAA_Softball_Stats.xlsx`. A handful of name mismatches between the two
source files were reconciled by hand (e.g. "CSUSB" → Cal State San
Bernardino, "CUI" → Concordia, "Hawaii Hilo" → Hawai'i-Hilo).
