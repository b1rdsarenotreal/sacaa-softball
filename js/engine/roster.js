// roster.js
// Generates individual players (9-batter lineup + a small pitching staff) for
// every team, derived from that team's aggregate stat line so a team's
// overall quality is preserved while individual players vary around it.
// Also assigns class year (FR/SO/JR/SR), which the recruiting/dynasty system
// will use to age players out and bring new ones in.

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

function genBatterStats(team, rng) {
  const talent = (rng() + rng() + rng()) / 3; // ~centered .5, roughly bell-shaped
  const hitMult = 0.78 + talent * 0.55; // .78 - 1.33
  const avg = clamp(team.batting.avg * hitMult * (0.92 + rng() * 0.16), 0.14, 0.55);

  const eyeTalent = rng();
  const walkGap = (team.batting.obp - team.batting.avg) * (0.5 + eyeTalent * 1.3);
  const obp = clamp(avg + walkGap, avg, 0.62);

  const powerTalent = rng();
  const powerGap = (team.batting.slg - team.batting.avg) * (0.5 + powerTalent * 1.3);
  const slg = clamp(avg + powerGap, avg, 0.95);

  return { avg, obp, slg, iso: slg - avg };
}

// role multiplier: aces get a discount (lower = better) on ERA/WHIP, later
// arms get progressively worse.
const PITCHER_ROLE_BASE = { SP1: 0.72, SP2: 0.9, SP3: 1.08, RP: 1.0 };

function genPitcherStats(team, rng, role) {
  const talent = (rng() + rng() + rng()) / 3;
  const base = PITCHER_ROLE_BASE[role] ?? 1.0;
  const mult = clamp(base + (talent - 0.5) * 0.5, 0.55, 1.6);

  const era = clamp(team.pitching.era * mult * (0.92 + rng() * 0.16), 0.9, 9.5);
  const whip = clamp(team.pitching.whip * mult * (0.92 + rng() * 0.16), 0.75, 2.6);
  const kPer7 = clamp((team.pitching.k_per7 / mult) * (0.92 + rng() * 0.16), 1, 14);
  const kbb = clamp((team.pitching.k_bb / mult) * (0.92 + rng() * 0.16), 0.3, 8);

  return { era, whip, k_per7: kPer7, k_bb: kbb };
}

function buildLineup(team, rng, usedNames) {
  const raw = [];
  for (let i = 0; i < 9; i++) {
    raw.push({
      id: nextId(team.name),
      name: randomName(rng, usedNames),
      class: randomClass(rng),
      batting: genBatterStats(team, rng),
    });
  }
  // Construct a plausible order: best OBP hitters lead off, best SLG in the
  // 3-4-5 slots, everyone else fills out the bottom of the order.
  const byObp = [...raw].sort((a, b) => b.batting.obp - a.batting.obp);
  const leadoff = byObp.slice(0, 2);
  const remaining1 = raw.filter((p) => !leadoff.includes(p));
  const bySlg = [...remaining1].sort((a, b) => b.batting.slg - a.batting.slg);
  const heart = bySlg.slice(0, 3);
  const remaining2 = remaining1.filter((p) => !heart.includes(p));
  const rest = [...remaining2].sort((a, b) => b.batting.avg - a.batting.avg);

  const ordered = [...leadoff, ...heart, ...rest];
  ordered.forEach((p, i) => {
    p.battingOrder = i + 1;
    p.position = POSITIONS[i];
  });
  return ordered;
}

function buildStaff(team, rng, usedNames) {
  const roles = ['SP1', 'SP2', 'SP3', 'RP'];
  return roles.map((role) => ({
    id: nextId(team.name),
    name: randomName(rng, usedNames),
    class: randomClass(rng),
    role,
    pitching: genPitcherStats(team, rng, role),
  }));
}

export function generateRosters(teams, seed = 1) {
  const rng = mulberry32(seed);
  const rosters = {};
  teams.forEach((team) => {
    const usedNames = new Set();
    rosters[team.name] = {
      team: team.name,
      lineup: buildLineup(team, rng, usedNames),
      pitchers: buildStaff(team, rng, usedNames),
    };
  });
  return rosters;
}

// Rotation: cycle through the starters (SP1/SP2/SP3) by game index. `gameIndex`
// is 0-based (game 1 of a series -> index 0, etc).
export function pickStarterForGame(roster, gameIndex) {
  const starters = roster.pitchers.filter((p) => p.role.startsWith('SP'));
  return starters[gameIndex % starters.length];
}

// Package a roster + team (for fielding pct) + chosen starter into the shape
// sim.js's simulateGame expects.
export function buildGameRoster(teamName, roster, team, startingPitcher) {
  return {
    name: teamName,
    lineup: roster.lineup,
    startingPitcher,
    bullpen: roster.pitchers.filter((p) => p !== startingPitcher),
    fieldingPct: team.fielding.pct,
  };
}
