// postseason.js
// Conference tournaments (single-elim, fully rendered bracket) -> NCAA field
// selection (7 auto bids + at-large by RPI) -> Regional round (best-of-3) ->
// World Series (true 8-team double-elimination bracket).

import { simulateGame, simulateSeries } from './sim.js';

function nextPowerOf2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

// Seed `n` entries (already ordered best-first) into a standard bracket with
// byes for the top seeds when n isn't a power of 2.
function seedBracket(orderedTeams) {
  const size = nextPowerOf2(orderedTeams.length);
  const slots = new Array(size).fill(null);
  const seedOrder16 = [1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11];
  const seedOrder8 = [1, 8, 4, 5, 2, 7, 3, 6];
  const seedOrder4 = [1, 4, 2, 3];
  const order = size === 16 ? seedOrder16 : size === 8 ? seedOrder8 : size === 4 ? seedOrder4 : [1];
  order.forEach((seedNum, slotIdx) => {
    slots[slotIdx] = orderedTeams[seedNum - 1] || null;
  });
  return slots;
}

// Human round names, counting back from the final round.
export function roundLabel(idx, total) {
  const fromEnd = total - idx;
  if (fromEnd === 1) return 'Championship';
  if (fromEnd === 2) return 'Semifinals';
  if (fromEnd === 3) return 'Quarterfinals';
  return `Round ${idx + 1}`;
}

function runSingleElim(slots, playGame) {
  const rounds = [];
  let current = slots;
  while (current.length > 1) {
    const nextRound = [];
    const roundMatches = [];
    for (let i = 0; i < current.length; i += 2) {
      const a = current[i];
      const b = current[i + 1];
      if (a && !b) { nextRound.push(a); roundMatches.push({ a, b: null, winner: a }); continue; }
      if (b && !a) { nextRound.push(b); roundMatches.push({ a: null, b, winner: b }); continue; }
      if (!a && !b) { nextRound.push(null); roundMatches.push({ a: null, b: null, winner: null }); continue; }
      const result = playGame(a, b);
      nextRound.push(result.winner);
      roundMatches.push({ a, b, ...result });
    }
    rounds.push(roundMatches);
    current = nextRound;
  }
  return { rounds, champion: current[0] };
}

// Full single-elimination conference tournament, top 8 seeds by conf record.
export function runConferenceTournament(conferenceStandingRows, teamsByName, league, seed = 1) {
  const seeds = conferenceStandingRows.slice(0, 8).map((r) => teamsByName[r.name]);
  const slots = seedBracket(seeds);
  let g = 0;
  const { rounds, champion } = runSingleElim(slots, (a, b) => {
    // higher seed (earlier in `seeds`) hosts
    const aSeed = seeds.indexOf(a);
    const bSeed = seeds.indexOf(b);
    const home = aSeed <= bSeed ? a : b;
    const away = home === a ? b : a;
    const result = simulateGame(away, home, league, seed * 1000 + g++);
    const winner = result.winner === 'home' ? home : away;
    return { homeScore: result.homeScore, awayScore: result.awayScore, winner, homeTeam: home, awayTeam: away };
  });
  return { conference: conferenceStandingRows[0]?.conference, rounds, champion };
}

// Select the 16-team NCAA field: conference champs get auto bids, remaining
// spots filled by RPI rank, then the full 16 reseeded 1-16 by RPI.
export function selectField(conferenceChampions, rankings, fieldSize = 16) {
  const autoBidNames = new Set(conferenceChampions.map((c) => c.champion?.name).filter(Boolean));
  const autoBids = rankings.filter((r) => autoBidNames.has(r.name));
  const atLargePool = rankings.filter((r) => !autoBidNames.has(r.name));
  const atLargeCount = Math.max(0, fieldSize - autoBids.length);
  const atLarge = atLargePool.slice(0, atLargeCount);

  const field = [...autoBids, ...atLarge].sort((a, b) => (a.rpi < b.rpi ? 1 : -1));
  field.forEach((row, i) => { row.seed = i + 1; row.berth = autoBidNames.has(row.name) ? 'Automatic' : 'At-large'; });
  return field;
}

// Regional round: best-of-3 series, standard bracket seeding. Winners carry
// their original NCAA seed forward (as a shallow-copied object) so the World
// Series can reseed off it.
export function runRegionals(fieldRows, teamsByName, league, seed = 1) {
  const ordered = fieldRows
    .slice()
    .sort((a, b) => a.seed - b.seed)
    .map((r) => ({ ...teamsByName[r.name], seed: r.seed }));
  const slots = seedBracket(ordered);
  const matchups = [];
  for (let i = 0; i < slots.length; i += 2) {
    const a = slots[i];
    const b = slots[i + 1];
    if (!a || !b) { matchups.push({ a: a || b, b: null, winner: a || b, games: [] }); continue; }
    const seriesResult = simulateSeries(a, b, league, 2, seed * 2000 + i);
    const winner = seriesResult.winner === 'A' ? a : b;
    matchups.push({ a, b, winner, games: seriesResult.games, winsA: seriesResult.winsA, winsB: seriesResult.winsB });
  }
  return matchups;
}

// True 8-team double-elimination World Series. `entrants` must be 8 team-like
// objects each carrying a `.seed` (lower = better) from the regional round.
export function runWorldSeries(entrants, league, seed = 1) {
  const ordered = entrants.slice().sort((a, b) => a.seed - b.seed);
  const wb1Slots = seedBracket(ordered); // pairs: (1v8)(4v5)(2v7)(3v6) by seed

  let g = 0;
  function playSingle(a, b) {
    const home = a.seed <= b.seed ? a : b; // better seed hosts
    const away = home === a ? b : a;
    const result = simulateGame(away, home, league, seed * 5000 + g++);
    const winner = result.winner === 'home' ? home : away;
    const loser = winner === home ? away : home;
    return { a, b, homeTeam: home, awayTeam: away, homeScore: result.homeScore, awayScore: result.awayScore, winner, loser };
  }

  // Winners bracket
  const wb1 = [];
  for (let i = 0; i < wb1Slots.length; i += 2) wb1.push(playSingle(wb1Slots[i], wb1Slots[i + 1]));
  const wb1Winners = wb1.map((m) => m.winner);
  const wb1Losers = wb1.map((m) => m.loser);

  const wb2 = [];
  for (let i = 0; i < wb1Winners.length; i += 2) wb2.push(playSingle(wb1Winners[i], wb1Winners[i + 1]));
  const wb2Winners = wb2.map((m) => m.winner);
  const wb2Losers = wb2.map((m) => m.loser);

  const wb3 = [playSingle(wb2Winners[0], wb2Winners[1])];
  const wbChampion = wb3[0].winner; // still has zero losses
  const wb3Loser = wb3[0].loser; // exactly one loss, drops to losers' bracket

  // Losers bracket
  const lb1 = [];
  for (let i = 0; i < wb1Losers.length; i += 2) lb1.push(playSingle(wb1Losers[i], wb1Losers[i + 1]));
  const lb1Winners = lb1.map((m) => m.winner);

  const lb2 = [];
  for (let i = 0; i < lb1Winners.length; i++) lb2.push(playSingle(lb1Winners[i], wb2Losers[i]));
  const lb2Winners = lb2.map((m) => m.winner);

  const lb3 = [playSingle(lb2Winners[0], lb2Winners[1])];
  const lb3Winner = lb3[0].winner;

  const lb4 = [playSingle(lb3Winner, wb3Loser)];
  const lbChampion = lb4[0].winner; // now carrying one loss

  // Grand Final -- the unbeaten winners'-bracket champion must lose twice.
  const gf1 = playSingle(wbChampion, lbChampion);
  let champion;
  let gf2 = null;
  if (gf1.winner === wbChampion) {
    champion = wbChampion;
  } else {
    gf2 = playSingle(wbChampion, lbChampion);
    champion = gf2.winner;
  }

  return {
    winnersBracket: [wb1, wb2, wb3],
    losersBracket: [lb1, lb2, lb3, lb4],
    grandFinal: { game1: gf1, game2: gf2 },
    champion,
  };
}
