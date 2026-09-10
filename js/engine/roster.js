// roster.js
// Generates a 25-man roster per team: ~16-18 position players and ~7-9
// pitchers (fluid, always summing to 25), plus 0-2 "two-way" pitchers who
// also hit and can crack the starting lineup. Every player is built from
// RATINGS (20-80 scouting scale, mean 50) rather than raw stat lines --
// Contact/Power/Eye for hitters, Stuff/Control/Movement for pitchers -- and
// the sim engine (sim.js) turns those ratings directly into plate-appearance
// outcomes. Ratings are anchored to each team's real batting/pitching
// quality (from teams.json) so team strength is preserved, with individual
// variance layered on top.

const FIRST_NAMES = [
  'Maddie', 'Sophia', 'Ava', 'Riley', 'Emma', 'Olivia', 'Mia', 'Grace',
  'Harper', 'Ella', 'Chloe', 'Layla', 'Zoe', 'Lily', 'Addison', 'Aubrey',
  'Kayla', 'Jasmine', 'Peyton', 'Morgan', 'Taylor', 'Reagan', 'Jordyn',
  'Kennedy', 'Brooklyn', 'Alexis', 'Mackenzie', 'Sydney', 'Hailey', 'Paige',
  'Savannah', 'Bailey', 'Gabby', 'Nataly', 'Camila', 'Valentina', 'Jocelyn',
  'Makena', 'Kiana', 'Leilani', 'Skyler', 'Presley', 'Delaney', 'Josie',
  'Marley', 'Finley', 'Quinn', 'Rowan', 'Elena', 'Isabela',
];

const LAST_NAMES = [
  'Nguyen', 'Garcia', 'Martinez', 'Johnson', 'Kim', 'Smith', 'Brown',
  'Rodriguez', 'Lopez', 'Hernandez', 'Young', 'Torres', 'Flores', 'Reyes',
  'Alvarez', 'Castillo', 'Ortiz', 'Ramirez', 'Chavez', 'Delgado', 'Vasquez',
  'Silva', 'Cabrera', 'Navarro', 'Salazar', 'Mendoza', 'Park', 'Choi',
  'Tanaka', 'Watanabe', 'Fonoti', 'Tuilagi', 'Mahelona', 'Pak', 'Ford',
  'Collins', 'Bennett', 'Foster', 'Coleman', 'Hayes', 'Sullivan', 'Ramos',
  'Cruz', 'Bishop', 'Mercer', 'Whitfield', 'Callahan', 'Donovan', 'Harmon',
  'Ellison',
];

const POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DP'];
const BENCH_POSITIONS = ['C', 'IF', 'IF', 'OF', 'OF', 'UTIL'];
const CLASSES = ['FR', 'SO', 'JR', 'SR'];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

// Roughly bell-shaped noise centered on 0, spread about ±1.
function noise(rng) { return ((rng() + rng() + rng()) / 3 - 0.5) * 2; }

function randomName(rng, used) {
  let name;
  let guard = 0;
  do {
    const first = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)];
    const last = LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)];
    name = `${first} ${last}`;
    guard += 1;
  } while (used.has(name) && guard < 30);
  used.add(name);
  return name;
}

function randomClass(rng) {
  return CLASSES[Math.floor(rng() * CLASSES.length)];
}

let playerCounter = 0;
function nextId(teamName) {
  playerCounter += 1;
  return `${teamName.replace(/\s+/g, '')}-${playerCounter}`;
}

// --- Team talent baselines (20-80 scale, mean 50) -------------------------
// Anchored to each team's real stat line so overall team strength survives
// the switch to individual ratings, via a z-score against the league.

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function stdev(arr) {
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((x) => (x - m) ** 2))) || 1;
}

export function computeTeamTalents(teams) {
  const wobas = teams.map((t) => t.batting.woba);
  const wobaMean = mean(wobas);
  const wobaSd = stdev(wobas);

  const eras = teams.map((t) => t.pitching.era);
  const whips = teams.map((t) => t.pitching.whip);
  const eraMean = mean(eras); const eraSd = stdev(eras);
  const whipMean = mean(whips); const whipSd = stdev(whips);

  const talents = {};
  teams.forEach((t) => {
    const battingZ = (t.batting.woba - wobaMean) / wobaSd;
    const eraZ = (t.pitching.era - eraMean) / eraSd; // lower era = better = negative z is good
    const whipZ = (t.pitching.whip - whipMean) / whipSd;
    const pitchingZ = -(eraZ + whipZ) / 2;
    talents[t.name] = {
      batting: clamp(50 + battingZ * 10, 22, 78),
      pitching: clamp(50 + pitchingZ * 10, 22, 78),
    };
  });
  return talents;
}

function genHitterRatings(battingTalent, rng) {
  return {
    contact: Math.round(clamp(battingTalent + noise(rng) * 14, 20, 80)),
    power: Math.round(clamp(battingTalent + noise(rng) * 16, 20, 80)),
    eye: Math.round(clamp(battingTalent + noise(rng) * 14, 20, 80)),
  };
}

const PITCHER_ROLE_SHIFT = { SP1: 7, SP2: 2, SP3: -3, RP: 0 };

function genPitcherRatings(pitchingTalent, rng, role) {
  const shift = PITCHER_ROLE_SHIFT[role] ?? 0;
  const base = pitchingTalent + shift + noise(rng) * 6;
  return {
    stuff: Math.round(clamp(base + noise(rng) * 12, 20, 80)),
    control: Math.round(clamp(base + noise(rng) * 12, 20, 80)),
    movement: Math.round(clamp(base + noise(rng) * 12, 20, 80)),
  };
}

function buildPitchingStaff(team, talents, rng, usedNames) {
  const pitcherCount = 7 + Math.floor(rng() * 3); // 7, 8, or 9
  const roles = [];
  for (let i = 0; i < pitcherCount; i++) {
    if (i === 0) roles.push('SP1');
    else if (i === 1) roles.push('SP2');
    else if (i === 2) roles.push('SP3');
    else roles.push('RP');
  }
  const pitchers = roles.map((role) => ({
    id: nextId(team.name),
    name: randomName(rng, usedNames),
    class: randomClass(rng),
    role,
    twoWay: false,
    ratings: genPitcherRatings(talents.pitching, rng, role),
  }));

  // 0-2 pitchers are also hitters (two-way players).
  let twoWayBudget = 2;
  pitchers.forEach((p) => {
    if (twoWayBudget > 0 && rng() < 0.3) {
      p.twoWay = true;
      p.hitterRatings = genHitterRatings(talents.batting, rng);
      twoWayBudget -= 1;
    }
  });

  return { pitchers, hitterCount: 25 - pitcherCount };
}

function buildRosterPlayers(team, talents, hitterCount, pitchers, rng, usedNames) {
  const pureHitters = [];
  for (let i = 0; i < hitterCount; i++) {
    pureHitters.push({
      id: nextId(team.name),
      name: randomName(rng, usedNames),
      class: randomClass(rng),
      twoWay: false,
      ratings: genHitterRatings(talents.batting, rng),
    });
  }

  // Candidate pool for the 9-player starting lineup: pure hitters plus any
  // two-way pitchers, ranked by a simple overall hit-tool composite.
  const twoWayCandidates = pitchers.filter((p) => p.twoWay).map((p) => ({
    id: p.id, name: p.name, class: p.class, twoWay: true, pitcherRef: p, ratings: p.hitterRatings,
  }));
  const pool = [...pureHitters, ...twoWayCandidates];
  const composite = (p) => p.ratings.contact * 0.4 + p.ratings.power * 0.35 + p.ratings.eye * 0.25;
  const ranked = [...pool].sort((a, b) => composite(b) - composite(a));
  const starters = ranked.slice(0, 9);
  const benchPool = ranked.slice(9);

  // Build the batting order: best eye/contact leads off, best power in the
  // heart of the order, the rest fill out the bottom.
  const byEye = [...starters].sort((a, b) => (b.ratings.eye + b.ratings.contact) - (a.ratings.eye + a.ratings.contact));
  const leadoff = byEye.slice(0, 2);
  const remaining1 = starters.filter((p) => !leadoff.includes(p));
  const byPower = [...remaining1].sort((a, b) => b.ratings.power - a.ratings.power);
  const heart = byPower.slice(0, 3);
  const remaining2 = remaining1.filter((p) => !heart.includes(p));
  const rest = [...remaining2].sort((a, b) => b.ratings.contact - a.ratings.contact);

  const lineupOrder = [...leadoff, ...heart, ...rest];
  const lineup = lineupOrder.map((p, i) => ({
    id: p.id,
    name: p.name,
    class: p.class,
    twoWay: p.twoWay,
    pitcherRole: p.twoWay ? p.pitcherRef.role : null,
    battingOrder: i + 1,
    position: POSITIONS[i],
    ratings: p.ratings,
  }));

  const bench = benchPool.map((p, i) => ({
    id: p.id,
    name: p.name,
    class: p.class,
    twoWay: p.twoWay,
    position: BENCH_POSITIONS[i % BENCH_POSITIONS.length],
    ratings: p.ratings,
  }));

  return { lineup, bench };
}

export function generateRosters(teams, seed = 1) {
  const rng = mulberry32(seed);
  const talents = computeTeamTalents(teams);
  const rosters = {};
  teams.forEach((team) => {
    const usedNames = new Set();
    const teamTalents = talents[team.name];
    const { pitchers, hitterCount } = buildPitchingStaff(team, teamTalents, rng, usedNames);
    const { lineup, bench } = buildRosterPlayers(team, teamTalents, hitterCount, pitchers, rng, usedNames);
    rosters[team.name] = { team: team.name, lineup, bench, pitchers };
  });
  return rosters;
}

// Rotation: cycle through the starters (SP1/SP2/SP3) by game index.
export function pickStarterForGame(roster, gameIndex) {
  const starters = roster.pitchers.filter((p) => p.role.startsWith('SP'));
  return starters[gameIndex % starters.length];
}

// Package a roster + team (for fielding pct) + chosen starter into the shape
// sim.js's simulateGame expects. Bullpen is ordered so real relievers (RP)
// get the call before another starter would.
export function buildGameRoster(teamName, roster, team, startingPitcher) {
  const bullpen = roster.pitchers
    .filter((p) => p !== startingPitcher)
    .sort((a, b) => (a.role === 'RP' ? 0 : 1) - (b.role === 'RP' ? 0 : 1));
  return {
    name: teamName,
    lineup: roster.lineup,
    bench: roster.bench,
    startingPitcher,
    bullpen,
    fieldingPct: team.fielding.pct,
  };
}
