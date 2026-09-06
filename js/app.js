import { generateSchedule } from './engine/schedule.js';
import { computeLeagueAverages, simulateGame } from './engine/sim.js';
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

function simWeek() {
  if (state.regularSeasonComplete) return;
  const week = state.currentWeek;
  const weekGames = state.games.filter((g) => g.week === week && !g.played);
  weekGames.forEach((g) => {
    const home = TEAMS_BY_NAME[g.home];
    const away = TEAMS_BY_NAME[g.away];
    const r = simulateGame(away, home, LEAGUE, g.id * 7919 + state.seed);
    g.played = true;
    g.result = { homeScore: r.homeScore, awayScore: r.awayScore, innings: r.innings };
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
    const home = TEAMS_BY_NAME[g.home];
    const away = TEAMS_BY_NAME[g.away];
    const r = simulateGame(away, home, LEAGUE, g.id * 7919 + state.seed);
    g.played = true;
    g.result = { homeScore: r.homeScore, awayScore: r.awayScore, innings: r.innings };
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
    runConferenceTournament(rows, TEAMS_BY_NAME, LEAGUE, state.seed + i * 17 + 3)
  );

  const field = selectField(conferenceTournaments, rankings, 16);
  const regionals = runRegionals(field, TEAMS_BY_NAME, LEAGUE, state.seed + 101);
  const winners = regionals.map((m) => m.winner);
  const worldSeries = runWorldSeries(winners, LEAGUE, state.seed + 202);

  state.postseason = { conferenceTournaments, field, regionals, worldSeries };
  saveState();
  renderAll();
  setMessage(`National Champion: ${worldSeries.champion.name}!`);
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

    const awayWon = g.played && g.result.awayScore > g.result.homeScore;
    const homeWon = g.played && g.result.homeScore > g.result.awayScore;

    const awayDiv = document.createElement('div');
    awayDiv.className = 'game-team' + (awayWon ? ' winner' : '');
    awayDiv.innerHTML = `<span>${g.away}</span><span class="game-score">${g.played ? g.result.awayScore : ''}</span>`;

    const vs = document.createElement('div');
    vs.className = 'game-vs';
    vs.textContent = `G${g.gameOfSeries} · wk ${g.week}`;

    const homeDiv = document.createElement('div');
    homeDiv.className = 'game-team' + (homeWon ? ' winner' : '');
    homeDiv.innerHTML = `<span>${g.home}</span><span class="game-score">${g.played ? g.result.homeScore : ''}</span>`;

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
        tr.innerHTML = `<td>${r.name}</td><td>${r.confWins}-${r.confLosses}</td><td>${r.wins}-${r.losses}</td><td>${rd}</td>`;
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
      <span class="rank-team">${r.name}<span class="rank-conf">${r.conference}</span></span>
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
    row.innerHTML = `<span>${solo ? `${solo.name} advances (bye)` : 'TBD'}</span><span class="bracket-vs"></span><span></span>`;
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
    <span class="${aWin ? 'winner' : ''}">${prefix ? `<span class="rank-conf">${prefix}</span> ` : ''}${m.a.name}</span>
    <span class="bracket-vs">${scoreText}</span>
    <span class="${!aWin ? 'winner' : ''}">${m.b.name}</span>
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
    confWrap.innerHTML = `<div class="conf-champ-line"><strong>${ct.conference}</strong> champion: <span class="winner">${ct.champion.name}</span></div>`;
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
    tr.innerHTML = `<td>${f.seed}</td><td>${f.name}</td><td>${f.berth}</td><td>${f.rpi.toFixed(3)}</td>`;
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
      <h4>${t.name}</h4>
      <p>${t.conference} · ${t.coach}</p>
      <div class="stat-line">AVG ${t.batting.avg.toFixed(3)} · OBP ${t.batting.obp.toFixed(3)} · SLG ${t.batting.slg.toFixed(3)}</div>
      <div class="stat-line">ERA ${t.pitching.era.toFixed(2)} · WHIP ${t.pitching.whip.toFixed(2)}</div>
    `;
    grid.appendChild(card);
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
  renderAll();
}

init();
