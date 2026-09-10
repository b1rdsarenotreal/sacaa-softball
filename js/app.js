import { generateSchedule } from './engine/schedule.js';
import { computeLeagueAverages, simulateGame } from './engine/sim.js';
import { generateRosters, buildGameRoster, pickStarterForGame } from './engine/roster.js';
import { computeStandings, standingsByConference, overallStandings } from './engine/standings.js';
import { computeRankings, top25 } from './engine/rankings.js';
import { runConferenceTournament, selectField, runRegionals, runWorldSeries, roundLabel } from './engine/postseason.js';

const STORAGE_KEY = 'sacaa-season-v1';

let TEAMS = [];
let TEAMS_BY_NAME = {};
let LEAGUE = null;
let state = null;

async function loadTeams() {
  const res = await fetch('js/data/teams.json');
  TEAMS = await res.json();
  TEAMS_BY_NAME = Object.fromEntries(TEAMS.map((t) => [t.name, t]));
  LEAGUE = computeLeagueAverages(TEAMS);
}

function freshState(seed) {
  const schedule = generateSchedule(TEAMS, seed);
  return {
    seed,
    totalWeeks: schedule.totalWeeks,
    currentWeek: 1,
    games: schedule.games,
    rosters: generateRosters(TEAMS, seed + 500000),
    regularSeasonComplete: false,
    postseason: null,
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function newSeason() {
  state = freshState(Date.now() % 1000000);
  saveState();
  renderAll();
  setMessage('New season generated: 56 teams, 13-week schedule.');
}

function gameRosterFor(teamName, gameOfSeries) {
  const roster = state.rosters[teamName];
  const team = TEAMS_BY_NAME[teamName];
  const starter = pickStarterForGame(roster, gameOfSeries - 1);
  return buildGameRoster(teamName, roster, team, starter);
}

// Regular-season box scores are NOT persisted (they'd bloat localStorage --
// ~1,200 games x ~24 player lines each). Since the sim is fully seeded and
// deterministic, we just re-run the exact same game on demand whenever a box
// score is actually needed (e.g. opening the box score modal, or building a
// team's season stat totals). Re-simulating one game takes well under a
// millisecond, so this is effectively free.
function regenerateGameResult(game) {
  const homeGR = gameRosterFor(game.home, game.gameOfSeries);
  const awayGR = gameRosterFor(game.away, game.gameOfSeries);
  return simulateGame(awayGR, homeGR, LEAGUE, game.id * 7919 + state.seed);
}

function simWeek() {
  if (state.regularSeasonComplete) return;
  const week = state.currentWeek;
  const weekGames = state.games.filter((g) => g.week === week && !g.played);
  weekGames.forEach((g) => {
    const homeGR = gameRosterFor(g.home, g.gameOfSeries);
    const awayGR = gameRosterFor(g.away, g.gameOfSeries);
    const r = simulateGame(awayGR, homeGR, LEAGUE, g.id * 7919 + state.seed);
    g.played = true;
    g.result = { homeScore: r.homeScore, awayScore: r.awayScore, innings: r.innings, awayLine: r.awayLine, homeLine: r.homeLine };
  });
  if (week >= state.totalWeeks) {
    state.regularSeasonComplete = true;
  } else {
    state.currentWeek = week + 1;
  }
  saveState();
  renderAll();
  setMessage(`Week ${week} simulated (${weekGames.length} games).`);
}

function simToEnd() {
  let guard = 0;
  while (!state.regularSeasonComplete && guard < 20) {
    simWeekQuiet();
    guard += 1;
  }
  saveState();
  renderAll();
  setMessage('Regular season complete.');
}

function simWeekQuiet() {
  const week = state.currentWeek;
  const weekGames = state.games.filter((g) => g.week === week && !g.played);
  weekGames.forEach((g) => {
    const homeGR = gameRosterFor(g.home, g.gameOfSeries);
    const awayGR = gameRosterFor(g.away, g.gameOfSeries);
    const r = simulateGame(awayGR, homeGR, LEAGUE, g.id * 7919 + state.seed);
    g.played = true;
    g.result = { homeScore: r.homeScore, awayScore: r.awayScore, innings: r.innings, awayLine: r.awayLine, homeLine: r.homeLine };
  });
  if (week >= state.totalWeeks) state.regularSeasonComplete = true;
  else state.currentWeek = week + 1;
}

function simPostseason() {
  if (!state.regularSeasonComplete) return;
  const standings = computeStandings(TEAMS, state.games);
  const byConf = standingsByConference(standings);
  const rankings = computeRankings(TEAMS, state.games);

  const conferenceTournaments = Object.entries(byConf).map(([conf, rows], i) =>
    runConferenceTournament(rows, TEAMS_BY_NAME, state.rosters, LEAGUE, state.seed + i * 17 + 3)
  );

  const field = selectField(conferenceTournaments, rankings, 16);
  const regionals = runRegionals(field, TEAMS_BY_NAME, state.rosters, LEAGUE, state.seed + 101);
  const winners = regionals.map((m) => m.winner);
  const worldSeries = runWorldSeries(winners, LEAGUE, state.seed + 202);

  state.postseason = { conferenceTournaments, field, regionals, worldSeries };
  saveState();
  renderAll();
  setMessage(`National Champion: ${worldSeries.champion.name}!`);
}

function outsToIp(outs) {
  return `${Math.floor(outs / 3)}.${outs % 3}`;
}

// Aggregates a team's individual player stats across every game played so
// far, by re-simulating each game (see regenerateGameResult) and summing box
// scores. Cheap: even a full 45-game season re-simulates in a few ms.
function computeSeasonStatsForTeam(teamName) {
  const battingTotals = {};
  const pitchingTotals = {};
  state.games
    .filter((g) => g.played && (g.home === teamName || g.away === teamName))
    .forEach((g) => {
      const result = regenerateGameResult(g);
      const side = g.home === teamName ? 'home' : 'away';
      result.boxscore[side].batting.forEach((b) => {
        if (!battingTotals[b.playerId]) {
          battingTotals[b.playerId] = {
            name: b.name, position: b.position, battingOrder: b.battingOrder,
            ab: 0, h: 0, r: 0, rbi: 0, bb: 0, k: 0, doubles: 0, triples: 0, hr: 0,
          };
        }
        const t = battingTotals[b.playerId];
        t.ab += b.ab; t.h += b.h; t.r += b.r; t.rbi += b.rbi; t.bb += b.bb; t.k += b.k;
        t.doubles += b.doubles; t.triples += b.triples; t.hr += b.hr;
      });
      result.boxscore[side].pitching.forEach((p) => {
        if (!pitchingTotals[p.playerId]) {
          pitchingTotals[p.playerId] = { name: p.name, role: p.role, outs: 0, h: 0, r: 0, er: 0, bb: 0, k: 0, w: 0, l: 0, sv: 0 };
        }
        const t = pitchingTotals[p.playerId];
        t.outs += p.outs; t.h += p.h; t.r += p.r; t.er += p.er; t.bb += p.bb; t.k += p.k;
        if (p.decision === 'W') t.w += 1;
        if (p.decision === 'L') t.l += 1;
        if (p.decision === 'SV') t.sv += 1;
      });
    });

  const batting = Object.values(battingTotals).sort((a, b) => a.battingOrder - b.battingOrder);
  const pitching = Object.values(pitchingTotals).sort((a, b) => b.outs - a.outs);
  return { batting, pitching };
}

function setMessage(msg) {
  document.getElementById('simMessage').textContent = msg;
}

/* ---------------- Rendering ---------------- */

function renderAll() {
  renderStatus();
  renderControls();
  renderSchedule();
  renderStandings();
  renderRankings();
  renderPostseason();
  renderTeams();
}

function renderStatus() {
  const el = document.getElementById('weekIndicator');
  if (state.postseason) el.textContent = 'Postseason complete';
  else if (state.regularSeasonComplete) el.textContent = 'Regular season complete';
  else el.textContent = `${state.currentWeek} of ${state.totalWeeks}`;
}

function renderControls() {
  document.getElementById('btnSimWeek').disabled = state.regularSeasonComplete;
  document.getElementById('btnSimToEnd').disabled = state.regularSeasonComplete;
  document.getElementById('btnSimPostseason').disabled = !state.regularSeasonComplete || !!state.postseason;
}

function teamRecordThrough(games, teamName, uptoWeek) {
  let w = 0, l = 0;
  games.forEach((g) => {
    if (!g.played || g.week > uptoWeek) return;
    if (g.home !== teamName && g.away !== teamName) return;
    const isHome = g.home === teamName;
    const won = isHome ? g.result.homeScore > g.result.awayScore : g.result.awayScore > g.result.homeScore;
    if (won) w += 1; else l += 1;
  });
  return `${w}-${l}`;
}

function renderSchedule() {
  const select = document.getElementById('weekSelect');
  if (select.options.length !== state.totalWeeks) {
    select.innerHTML = '';
    for (let w = 1; w <= state.totalWeeks; w++) {
      const opt = document.createElement('option');
      opt.value = w;
      opt.textContent = `Week ${w}`;
      select.appendChild(opt);
    }
  }
  const selectedWeek = Number(select.value) || Math.min(state.currentWeek, state.totalWeeks);
  select.value = selectedWeek;

  const list = document.getElementById('scheduleList');
  list.innerHTML = '';
  const weekGames = state.games
    .filter((g) => g.week === selectedWeek)
    .sort((a, b) => a.home.localeCompare(b.home) || a.gameOfSeries - b.gameOfSeries);

  if (weekGames.length === 0) {
    list.innerHTML = '<p class="view-note">No games scheduled.</p>';
    return;
  }

  weekGames.forEach((g) => {
    const row = document.createElement('div');
    row.className = 'game-row' + (g.played ? ' played' : '') + (g.conferenceGame ? ' conference-game' : '');
    if (g.played) {
      row.classList.add('game-row-clickable');
      row.dataset.boxscoreGame = g.id;
    }

    const awayWon = g.played && g.result.awayScore > g.result.homeScore;
    const homeWon = g.played && g.result.homeScore > g.result.awayScore;

    const awayDiv = document.createElement('div');
    awayDiv.className = 'game-team' + (awayWon ? ' winner' : '');
    awayDiv.innerHTML = `${teamLink(g.away)}<span class="game-score">${g.played ? g.result.awayScore : ''}</span>`;

    const vs = document.createElement('div');
    vs.className = 'game-vs';
    vs.textContent = `G${g.gameOfSeries} · wk ${g.week}`;

    const homeDiv = document.createElement('div');
    homeDiv.className = 'game-team' + (homeWon ? ' winner' : '');
    homeDiv.innerHTML = `${teamLink(g.home)}<span class="game-score">${g.played ? g.result.homeScore : ''}</span>`;

    const tag = document.createElement('div');
    tag.className = 'game-tag';
    tag.textContent = g.played ? (g.conferenceGame ? 'final · conf' : 'final') : (g.conferenceGame ? 'conf' : 'non-conf');

    row.append(awayDiv, vs, homeDiv, tag);
    list.appendChild(row);
  });

  const playing = new Set();
  weekGames.forEach((g) => { playing.add(g.home); playing.add(g.away); });
  const byeTeams = TEAMS.map((t) => t.name).filter((n) => !playing.has(n)).sort();
  if (byeTeams.length > 0) {
    const byeNote = document.createElement('p');
    byeNote.className = 'view-note bye-note';
    byeNote.textContent = `On bye this week: ${byeTeams.join(', ')}`;
    list.appendChild(byeNote);
  }
}

function renderStandings() {
  const grid = document.getElementById('standingsGrid');
  grid.innerHTML = '';
  const standings = computeStandings(TEAMS, state.games);
  const byConf = standingsByConference(standings);

  Object.entries(byConf)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([conf, rows]) => {
      const card = document.createElement('div');
      card.className = 'standings-card';
      const h3 = document.createElement('h3');
      h3.textContent = conf;
      card.appendChild(h3);

      const table = document.createElement('table');
      table.className = 'standings-table';
      table.innerHTML = `<thead><tr><th>Team</th><th>Conf</th><th>Overall</th><th>RD</th></tr></thead>`;
      const tbody = document.createElement('tbody');
      rows.forEach((r) => {
        const tr = document.createElement('tr');
        const rd = r.runDiff > 0 ? `+${r.runDiff}` : `${r.runDiff}`;
        tr.innerHTML = `<td>${teamLink(r.name)}</td><td>${r.confWins}-${r.confLosses}</td><td>${r.wins}-${r.losses}</td><td>${rd}</td>`;
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      card.appendChild(table);
      grid.appendChild(card);
    });
}

function renderRankings() {
  const list = document.getElementById('rankingsList');
  list.innerHTML = '';
  const rankings = computeRankings(TEAMS, state.games);
  const played = state.games.some((g) => g.played);
  if (!played) {
    list.innerHTML = '<p class="view-note">Simulate a week to generate the first poll.</p>';
    return;
  }
  top25(rankings).forEach((r) => {
    const li = document.createElement('li');
    li.className = 'rank-row';
    li.innerHTML = `
      <span class="rank-num">${r.rank}</span>
      <span class="rank-team">${teamLink(r.name)}<span class="rank-conf">${r.conference}</span></span>
      <span class="rank-record">${r.record}</span>
      <span class="rank-rpi">${r.rpi.toFixed(3)}</span>
    `;
    list.appendChild(li);
  });
}

// Renders one match row for any bracket shape: byes, best-of-N series
// (winsA/winsB present), or single games (homeScore/awayScore present).
// `prefix` optionally labels the row (used for Grand Final Game 1/2).
function renderMatchRow(m, container, prefix) {
  const row = document.createElement('div');
  row.className = 'bracket-match';

  if (!m.a || !m.b) {
    const solo = m.a || m.b;
    row.innerHTML = `<span>${solo ? `${teamLink(solo.name)} advances (bye)` : 'TBD'}</span><span class="bracket-vs"></span><span></span>`;
    container.appendChild(row);
    return;
  }

  const aWin = m.winner?.name === m.a.name;
  let scoreText = 'vs';
  if (m.winsA !== undefined) scoreText = `${m.winsA}–${m.winsB}`;
  else if (m.homeScore !== undefined) {
    // score must read left-to-right as "a's score–b's score" to match the
    // a (left) / b (right) column layout, regardless of who was actually home.
    const isAHome = m.homeTeam?.name === m.a.name;
    scoreText = isAHome ? `${m.homeScore}–${m.awayScore}` : `${m.awayScore}–${m.homeScore}`;
  }

  row.innerHTML = `
    <span class="${aWin ? 'winner' : ''}">${prefix ? `<span class="rank-conf">${prefix}</span> ` : ''}${teamLink(m.a.name)}</span>
    <span class="bracket-vs">${scoreText}</span>
    <span class="${!aWin ? 'winner' : ''}">${teamLink(m.b.name)}</span>
  `;
  container.appendChild(row);
}

function renderPostseason() {
  const container = document.getElementById('postseasonContent');
  container.innerHTML = '';

  if (!state.regularSeasonComplete) {
    container.innerHTML = '<p class="view-note">Finish the regular season to unlock conference tournaments and the NCAA bracket.</p>';
    return;
  }
  if (!state.postseason) {
    container.innerHTML = '<p class="view-note">Regular season complete. Click "Sim Postseason" to run conference tournaments through the World Series.</p>';
    return;
  }

  const { conferenceTournaments, field, regionals, worldSeries } = state.postseason;

  const banner = document.createElement('div');
  banner.className = 'champion-banner';
  banner.textContent = `National Champion: ${worldSeries.champion.name}`;
  container.appendChild(banner);

  // Conference tournaments -- full bracket, not just the champion
  const confSection = document.createElement('div');
  confSection.className = 'bracket-section';
  confSection.innerHTML = '<h3>Conference Tournaments</h3>';
  conferenceTournaments.forEach((ct) => {
    const confWrap = document.createElement('div');
    confWrap.className = 'conf-tourney-block';
    confWrap.innerHTML = `<div class="conf-champ-line"><strong>${ct.conference}</strong> champion: <span class="winner">${teamLink(ct.champion.name)}</span></div>`;
    ct.rounds.forEach((round, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'bracket-round';
      const label = document.createElement('div');
      label.className = 'bracket-round-label';
      label.textContent = roundLabel(i, ct.rounds.length);
      wrap.appendChild(label);
      round.forEach((m) => renderMatchRow(m, wrap));
      confWrap.appendChild(wrap);
    });
    confSection.appendChild(confWrap);
  });
  container.appendChild(confSection);

  // NCAA field
  const fieldSection = document.createElement('div');
  fieldSection.className = 'bracket-section';
  fieldSection.innerHTML = '<h3>NCAA Field (Seeded 1–16)</h3>';
  const table = document.createElement('table');
  table.className = 'standings-table';
  table.style.width = '100%';
  table.innerHTML = '<thead><tr><th>Seed</th><th>Team</th><th>Berth</th><th>RPI</th></tr></thead>';
  const tbody = document.createElement('tbody');
  field.forEach((f) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${f.seed}</td><td>${teamLink(f.name)}</td><td>${f.berth}</td><td>${f.rpi.toFixed(3)}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  fieldSection.appendChild(table);
  container.appendChild(fieldSection);

  // Regionals
  const regSection = document.createElement('div');
  regSection.className = 'bracket-section';
  regSection.innerHTML = '<h3>Regionals (Best-of-3)</h3>';
  regionals.forEach((m) => renderMatchRow(m, regSection));
  container.appendChild(regSection);

  // World Series -- true double elimination: winners' bracket, losers'
  // bracket, then the grand final (with an "if necessary" decider game).
  const wsSection = document.createElement('div');
  wsSection.className = 'bracket-section';
  wsSection.innerHTML = '<h3>World Series <span class="view-note">(double elimination)</span></h3>';

  const wbWrap = document.createElement('div');
  wbWrap.innerHTML = '<div class="bracket-round-label"><strong>Winners\' Bracket</strong></div>';
  const wbLabels = ['Round 1', 'Semifinal', 'Winners\' Final'];
  worldSeries.winnersBracket.forEach((round, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'bracket-round';
    const label = document.createElement('div');
    label.className = 'bracket-round-label';
    label.textContent = wbLabels[i] || `Round ${i + 1}`;
    wrap.appendChild(label);
    round.forEach((m) => renderMatchRow(m, wrap));
    wbWrap.appendChild(wrap);
  });
  wsSection.appendChild(wbWrap);

  const lbWrap = document.createElement('div');
  lbWrap.innerHTML = '<div class="bracket-round-label"><strong>Losers\' Bracket</strong></div>';
  const lbLabels = ['Round 1', 'Round 2', 'Round 3', 'Losers\' Final'];
  worldSeries.losersBracket.forEach((round, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'bracket-round';
    const label = document.createElement('div');
    label.className = 'bracket-round-label';
    label.textContent = lbLabels[i] || `Round ${i + 1}`;
    wrap.appendChild(label);
    round.forEach((m) => renderMatchRow(m, wrap));
    lbWrap.appendChild(wrap);
  });
  wsSection.appendChild(lbWrap);

  const gfWrap = document.createElement('div');
  gfWrap.className = 'bracket-round';
  gfWrap.innerHTML = '<div class="bracket-round-label"><strong>Grand Final</strong> (winners\' bracket champion must lose twice)</div>';
  renderMatchRow(worldSeries.grandFinal.game1, gfWrap, 'Game 1');
  if (worldSeries.grandFinal.game2) {
    renderMatchRow(worldSeries.grandFinal.game2, gfWrap, 'Game 2 (if necessary)');
  }
  wsSection.appendChild(gfWrap);
  container.appendChild(wsSection);
}

function renderTeams() {
  const grid = document.getElementById('teamsGrid');
  if (grid.childElementCount > 0) return; // static, only needs to render once
  grid.innerHTML = '';
  TEAMS.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((t) => {
    const card = document.createElement('div');
    card.className = 'team-card';
    card.innerHTML = `
      <h4>${teamLink(t.name)}</h4>
      <p>${t.conference} · ${t.coach}</p>
      <div class="stat-line">AVG ${t.batting.avg.toFixed(3)} · OBP ${t.batting.obp.toFixed(3)} · SLG ${t.batting.slg.toFixed(3)}</div>
      <div class="stat-line">ERA ${t.pitching.era.toFixed(2)} · WHIP ${t.pitching.whip.toFixed(2)}</div>
    `;
    grid.appendChild(card);
  });
}

function teamLink(name) {
  return `<span class="team-link" data-team="${name}">${name}</span>`;
}

function openTeamModal(name) {
  const team = TEAMS_BY_NAME[name];
  if (!team) return;

  const standings = computeStandings(TEAMS, state.games);
  const row = standings.find((r) => r.name === name) || {
    wins: 0, losses: 0, confWins: 0, confLosses: 0, runDiff: 0,
  };

  const games = state.games
    .filter((g) => g.home === name || g.away === name)
    .sort((a, b) => a.week - b.week || a.gameOfSeries - b.gameOfSeries);

  const gameRows = games.map((g) => {
    const isHome = g.home === name;
    const opponent = isHome ? g.away : g.home;
    const atVs = isHome ? 'vs' : '@';
    if (!g.played) {
      return `
        <div class="tp-game-row">
          <span class="tp-wk">wk ${g.week}</span>
          <span>${atVs} ${teamLink(opponent)}</span>
          <span class="tp-score">—</span>
          <span class="tp-tag">${g.conferenceGame ? 'conf' : 'non-conf'}</span>
        </div>`;
    }
    const ownScore = isHome ? g.result.homeScore : g.result.awayScore;
    const oppScore = isHome ? g.result.awayScore : g.result.homeScore;
    const won = ownScore > oppScore;
    return `
      <div class="tp-game-row tp-game-row-clickable" data-boxscore-game="${g.id}">
        <span class="tp-wk">wk ${g.week}</span>
        <span>${atVs} ${teamLink(opponent)}</span>
        <span class="tp-score"><span class="${won ? 'tp-result-w' : 'tp-result-l'}">${won ? 'W' : 'L'}</span> ${ownScore}-${oppScore}</span>
        <span class="tp-tag">${g.conferenceGame ? 'conf' : 'non-conf'}</span>
      </div>`;
  }).join('');

  const rd = row.runDiff > 0 ? `+${row.runDiff}` : `${row.runDiff}`;
  const seasonStats = computeSeasonStatsForTeam(name);

  const battingRows = seasonStats.batting.map((b) => `
    <tr>
      <td>${b.battingOrder}. ${b.name}</td><td>${b.position}</td>
      <td>${b.ab}</td><td>${b.h}</td><td>${b.r}</td><td>${b.rbi}</td><td>${b.bb}</td><td>${b.k}</td>
      <td>${b.hr}</td><td>${b.ab > 0 ? (b.h / b.ab).toFixed(3).replace(/^0/, '') : '.000'}</td>
    </tr>`).join('');

  const pitchingRows = seasonStats.pitching.map((p) => {
    const ip = outsToIp(p.outs);
    const era = p.outs > 0 ? ((p.er * 21) / p.outs).toFixed(2) : '0.00';
    const whip = p.outs > 0 ? ((p.bb + p.h) / (p.outs / 3)).toFixed(2) : '0.00';
    return `
    <tr>
      <td>${p.role} ${p.name}</td><td>${p.w}-${p.l}${p.sv ? `, ${p.sv}sv` : ''}</td>
      <td>${ip}</td><td>${p.h}</td><td>${p.er}</td><td>${p.bb}</td><td>${p.k}</td><td>${era}</td><td>${whip}</td>
    </tr>`;
  }).join('');

  document.getElementById('modalContent').innerHTML = `
    <div class="tp-header">
      <h2>${team.name}</h2>
      <p class="tp-sub">${team.conference} · Head Coach ${team.coach}</p>
    </div>
    <div class="tp-records">
      <div class="tp-record-box"><span class="num">${row.wins}-${row.losses}</span><span class="label">overall</span></div>
      <div class="tp-record-box"><span class="num">${row.confWins}-${row.confLosses}</span><span class="label">conference</span></div>
      <div class="tp-record-box"><span class="num">${rd}</span><span class="label">run diff</span></div>
    </div>
    <div class="tp-stats">
      AVG ${team.batting.avg.toFixed(3)} · OBP ${team.batting.obp.toFixed(3)} · SLG ${team.batting.slg.toFixed(3)}
      &nbsp;|&nbsp; ERA ${team.pitching.era.toFixed(2)} · WHIP ${team.pitching.whip.toFixed(2)}
    </div>

    ${games.some((g) => g.played) ? `
    <div class="tp-schedule-title">Roster — Season Stats</div>
    <div class="tp-roster-tables">
      <table class="standings-table tp-mini-table">
        <thead><tr><th>Batter</th><th>Pos</th><th>AB</th><th>H</th><th>R</th><th>RBI</th><th>BB</th><th>K</th><th>HR</th><th>AVG</th></tr></thead>
        <tbody>${battingRows}</tbody>
      </table>
      <table class="standings-table tp-mini-table">
        <thead><tr><th>Pitcher</th><th>W-L</th><th>IP</th><th>H</th><th>ER</th><th>BB</th><th>K</th><th>ERA</th><th>WHIP</th></tr></thead>
        <tbody>${pitchingRows}</tbody>
      </table>
    </div>
    ` : ''}

    <div class="tp-schedule-title">Schedule (${games.length} games)</div>
    <div class="tp-game-list">${gameRows || '<p class="view-note">No games scheduled.</p>'}</div>
  `;

  document.getElementById('teamModalOverlay').classList.add('open');
}

function openBoxScoreModal(gameId) {
  const game = state.games.find((g) => g.id === Number(gameId));
  if (!game || !game.played) return;
  const result = regenerateGameResult(game);
  const { boxscore } = result;

  function battingTable(side, teamName) {
    const rows = boxscore[side].batting.map((b) => `
      <tr>
        <td>${b.battingOrder}. ${b.name}</td><td>${b.position}</td>
        <td>${b.ab}</td><td>${b.h}</td><td>${b.r}</td><td>${b.rbi}</td><td>${b.bb}</td><td>${b.k}</td>
      </tr>`).join('');
    return `
      <div class="bs-team-title">${teamLink(teamName)}</div>
      <table class="standings-table tp-mini-table">
        <thead><tr><th>Batter</th><th>Pos</th><th>AB</th><th>H</th><th>R</th><th>RBI</th><th>BB</th><th>K</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  function pitchingTable(side) {
    const rows = boxscore[side].pitching.map((p) => `
      <tr>
        <td>${p.role} ${p.name}</td><td>${p.ip}</td><td>${p.h}</td><td>${p.r}</td><td>${p.er}</td><td>${p.bb}</td><td>${p.k}</td>
        <td>${p.decision}</td>
      </tr>`).join('');
    return `
      <table class="standings-table tp-mini-table">
        <thead><tr><th>Pitcher</th><th>IP</th><th>H</th><th>R</th><th>ER</th><th>BB</th><th>K</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  const lineHeader = result.awayLine.map((_, i) => `<th>${i + 1}</th>`).join('') + '<th>R</th>';
  const awayLineRow = result.awayLine.map((r) => `<td>${r === null ? '' : r}</td>`).join('') + `<td><strong>${result.awayScore}</strong></td>`;
  const homeLineRow = result.homeLine.map((r) => `<td>${r === null ? '' : r}</td>`).join('') + `<td><strong>${result.homeScore}</strong></td>`;

  document.getElementById('modalContent').innerHTML = `
    <div class="tp-header">
      <h2>${game.away} @ ${game.home}</h2>
      <p class="tp-sub">Week ${game.week} · Game ${game.gameOfSeries} of ${game.seriesLength ?? 3} · ${game.conferenceGame ? 'Conference' : 'Non-conference'}</p>
    </div>
    <table class="standings-table tp-mini-table bs-linescore">
      <thead><tr><th></th>${lineHeader}</tr></thead>
      <tbody>
        <tr><td>${teamLink(game.away)}</td>${awayLineRow}</tr>
        <tr><td>${teamLink(game.home)}</td>${homeLineRow}</tr>
      </tbody>
    </table>
    <p class="view-note">Errors: ${game.away} ${boxscore.away.errors} · ${game.home} ${boxscore.home.errors}</p>

    <div class="tp-schedule-title">Batting</div>
    <div class="tp-roster-tables">
      ${battingTable('away', game.away)}
      ${battingTable('home', game.home)}
    </div>

    <div class="tp-schedule-title">Pitching</div>
    <div class="tp-roster-tables">
      ${pitchingTable('away')}
      ${pitchingTable('home')}
    </div>
  `;

  document.getElementById('teamModalOverlay').classList.add('open');
}

function closeTeamModal() {
  document.getElementById('teamModalOverlay').classList.remove('open');
}

function wireTeamModal() {
  document.addEventListener('click', (e) => {
    const link = e.target.closest('.team-link');
    if (link) { openTeamModal(link.dataset.team); return; }
    const boxLink = e.target.closest('[data-boxscore-game]');
    if (boxLink) { openBoxScoreModal(boxLink.dataset.boxscoreGame); return; }
    if (e.target.id === 'teamModalOverlay') closeTeamModal();
  });
  document.getElementById('modalClose').addEventListener('click', closeTeamModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeTeamModal();
  });
}

/* ---------------- Wiring ---------------- */

function wireTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`view-${tab.dataset.tab}`).classList.add('active');
    });
  });
}

function wireControls() {
  document.getElementById('btnSimWeek').addEventListener('click', simWeek);
  document.getElementById('btnSimToEnd').addEventListener('click', simToEnd);
  document.getElementById('btnSimPostseason').addEventListener('click', simPostseason);
  document.getElementById('btnReset').addEventListener('click', () => {
    if (confirm('Start a brand new season? This clears all current results.')) newSeason();
  });
  document.getElementById('weekSelect').addEventListener('change', renderSchedule);
  document.getElementById('weekPrev').addEventListener('click', () => {
    const sel = document.getElementById('weekSelect');
    sel.value = Math.max(1, Number(sel.value) - 1);
    renderSchedule();
  });
  document.getElementById('weekNext').addEventListener('click', () => {
    const sel = document.getElementById('weekSelect');
    sel.value = Math.min(state.totalWeeks, Number(sel.value) + 1);
    renderSchedule();
  });
}

async function init() {
  await loadTeams();
  state = loadState() || freshState(Date.now() % 1000000);
  saveState();
  wireTabs();
  wireControls();
  wireTeamModal();
  renderAll();
}

init();
