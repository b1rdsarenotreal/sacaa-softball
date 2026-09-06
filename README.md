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
    sim.js             single-game simulator (stat-driven, inning-by-inning)
    schedule.js        13-week schedule generator (conference round-robin + interconference)
    standings.js        conference / overall win-loss records
    rankings.js         RPI-style Top 25 poll
    postseason.js       conference tournaments -> NCAA field -> regionals -> World Series
```

## How the simulation works

- **Team strength** comes straight from each team's real batting (AVG/OBP/SLG/ISO)
  and pitching (ERA/WHIP/K rate) lines pulled from your stat sheet — there's no
  hidden "overall rating," so if you edit `teams.json` the sim responds directly.
- **Each plate appearance** gets an outcome probability from the batter's OBP,
  adjusted up or down by the opposing pitcher's ERA/WHIP relative to the league
  average, then split into walk/single/double/triple/homer using the batter's
  ISO. Runners advance with simple, tunable base-running rules (including sac
  flies). It's tuned so league-average scoring lands close to your source
  data's ~4.5 runs/team/game.
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
  and `fielding.pct`.
- **Season length / games per series**: `TOTAL_WEEKS` and `GAMES_PER_SERIES`
  at the top of `js/engine/schedule.js`.
- **NCAA field size**: pass a different number into `selectField(...)` in
  `js/app.js` (currently 16).
- **Simulation "feel"** (higher/lower scoring, more/fewer upsets): the clamp
  ranges and multipliers in `js/engine/sim.js` (`simulatePA`) are the knobs —
  each has a comment explaining what it controls.

## Notes on the source data

Your `2030_SACAA_Softball.xlsx` file contains a full pre-simulated season
(game log, weekly rankings, brackets) — per your instructions this app does
**not** use that data directly. Only team names, conferences, coaches, and
season stat lines were pulled in, from `SACAA_Softball.xlsx` and
`SACAA_Softball_Stats.xlsx`. A handful of name mismatches between the two
source files were reconciled by hand (e.g. "CSUSB" → Cal State San
Bernardino, "CUI" → Concordia, "Hawaii Hilo" → Hawai'i-Hilo).
