// sim.js
// Simulates a single 7-inning softball game between two teams using their
// season batting / pitching rate stats. Medium-depth model: per-plate-appearance
// outcome probabilities derived from team stats, with simple base-state advancement.

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

// Compute league-wide averages once, used to normalize matchup strength.
export function computeLeagueAverages(teams) {
  const n = teams.length;
  const sum = (fn) => teams.reduce((a, t) => a + fn(t), 0);
  return {
    obp: sum((t) => t.batting.obp) / n,
    avg: sum((t) => t.batting.avg) / n,
    era: sum((t) => t.pitching.era) / n,
    whip: sum((t) => t.pitching.whip) / n,
  };
}

// Simulate a single plate appearance. Returns one of:
// 'K' (out via strikeout-ish), 'OUT', 'BB', '1B', '2B', '3B', 'HR'
function simulatePA(batter, pitcher, league, rng) {
  // A low ERA/WHIP pitcher should SUPPRESS the batter's effective OBP, so the
  // ratio is pitcher-over-league (good pitcher => factor < 1). Exponent 0.6
  // dampens the swing so a single elite/poor stat can't dominate the matchup.
  const rawFactor = Math.sqrt((pitcher.pitching.era / league.era) * (pitcher.pitching.whip / league.whip));
  const pitchFactor = clamp(Math.pow(rawFactor, 0.6), 0.8, 1.25);

  const effObp = clamp(batter.batting.obp * pitchFactor, 0.19, 0.53);
  const walkShare = clamp((batter.batting.obp - batter.batting.avg) / batter.batting.obp, 0.08, 0.35);

  const pOnBase = effObp;
  const pWalk = pOnBase * walkShare;
  const pHit = pOnBase - pWalk;
  const pOut = 1 - pOnBase;

  const r = rng();
  if (r < pOut) {
    // distinguish strikeout vs ball-in-play out using pitcher K/7 (affects flavor text only)
    const kRate = clamp(pitcher.pitching.k_per7 / 7, 0.08, 0.55);
    return rng() < kRate ? 'K' : 'OUT';
  }
  if (r < pOut + pWalk) return 'BB';

  // It's a hit -- decide type using ISO as the extra-base driver.
  const iso = batter.batting.iso;
  const pHR = clamp(iso * 0.32, 0.015, 0.14);
  const pTriple = 0.025;
  const pDouble = clamp(iso * 0.55, 0.07, 0.32);
  const pSingle = clamp(1 - pHR - pTriple - pDouble, 0.35, 0.9);
  const total = pHR + pTriple + pDouble + pSingle;

  const hr = rng() * total;
  if (hr < pHR) return 'HR';
  if (hr < pHR + pTriple) return '3B';
  if (hr < pHR + pTriple + pDouble) return '2B';
  return '1B';
}

// Advance runners given an event. bases = [firstOccupied, secondOccupied, thirdOccupied]
// Returns { bases: newBases, runsScored }
function advanceRunners(bases, event, outsBefore, rng) {
  let [b1, b2, b3] = bases;
  let runs = 0;

  switch (event) {
    case 'BB': {
      // force runners only where needed
      if (b1 && b2 && b3) {
        runs += 1; // bases loaded walk forces in a run
        // everyone shifts up, b3 scores, b2->3, b1->2, batter->1
        b3 = true; b2 = true; b1 = true;
      } else if (b1 && b2) {
        b3 = true; b2 = true; b1 = true;
      } else if (b1) {
        b2 = true; b1 = true;
      } else {
        b1 = true;
      }
      break;
    }
    case '1B': {
      if (b3) { runs += 1; b3 = false; }
      if (b2) { if (rng() < 0.55) { runs += 1; } else { b3 = true; } b2 = false; }
      if (b1) { if (rng() < 0.35) { b3 = true; } else { b2 = true; } b1 = false; }
      b1 = true;
      break;
    }
    case '2B': {
      if (b3) { runs += 1; b3 = false; }
      if (b2) { runs += 1; b2 = false; }
      if (b1) { if (rng() < 0.5) { runs += 1; } else { b3 = true; } b1 = false; }
      b2 = true;
      break;
    }
    case '3B': {
      if (b3) { runs += 1; b3 = false; }
      if (b2) { runs += 1; b2 = false; }
      if (b1) { runs += 1; b1 = false; }
      b3 = true;
      break;
    }
    case 'HR': {
      if (b3) { runs += 1; b3 = false; }
      if (b2) { runs += 1; b2 = false; }
      if (b1) { runs += 1; b1 = false; }
      runs += 1; // batter scores
      break;
    }
    case 'OUT': {
      // sac fly chance: runner on 3rd scores on a fly out with <2 outs
      if (b3 && outsBefore < 2 && rng() < 0.35) {
        runs += 1; b3 = false;
      }
      break;
    }
    default:
      break;
  }
  return { bases: [b1, b2, b3], runs };
}

// Pick a batter deterministically-ish by cycling through a small virtual lineup.
// We don't model individual players, so we just re-use the team's aggregate rates
// for every batter -- this keeps the sim purely team-stat-driven as requested.
function simulateHalfInning(battingTeam, pitchingTeam, league, rng) {
  let outs = 0;
  let bases = [false, false, false];
  let runs = 0;
  const events = [];

  while (outs < 3) {
    const event = simulatePA(battingTeam, pitchingTeam, league, rng);
    if (event === 'K' || event === 'OUT') {
      const result = advanceRunners(bases, 'OUT', outs, rng);
      bases = result.bases;
      runs += result.runs;
      outs += 1;
    } else {
      const result = advanceRunners(bases, event, outs, rng);
      bases = result.bases;
      runs += result.runs;
    }
    events.push(event);
  }
  return { runs, events };
}

// Mulberry32 seeded PRNG so results can be reproduced/replayed if needed.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Simulate a full game. away/home are team objects from teams.json.
// Returns { awayScore, homeScore, awayLine, homeLine, innings, winner }
export function simulateGame(awayTeam, homeTeam, league, seed) {
  const rng = typeof seed === 'number' ? makeRng(seed) : Math.random;
  const awayLine = [];
  const homeLine = [];
  let awayScore = 0;
  let homeScore = 0;
  const REGULATION = 7;

  let inning = 1;
  while (true) {
    const topResult = simulateHalfInning(awayTeam, homeTeam, league, rng);
    awayScore += topResult.runs;
    awayLine.push(topResult.runs);

    // Home team doesn't bat in the bottom of the last inning if already ahead
    const isLastScheduled = inning >= REGULATION;
    if (isLastScheduled && homeScore > awayScore) {
      homeLine.push(null); // did not bat
      break;
    }

    const bottomResult = simulateHalfInning(homeTeam, awayTeam, league, rng);
    homeScore += bottomResult.runs;
    homeLine.push(bottomResult.runs);

    if (isLastScheduled && homeScore !== awayScore) break;
    inning += 1;
    if (inning > 25) break; // safety valve against pathological ties
  }

  return {
    awayScore,
    homeScore,
    awayLine,
    homeLine,
    innings: awayLine.length,
    winner: awayScore > homeScore ? 'away' : 'home',
  };
}

// Simulate a best-of-N series (used for postseason). Returns per-game results
// plus the overall series winner once one side reaches the majority.
export function simulateSeries(teamA, teamB, league, gamesNeeded, seed) {
  const games = [];
  let winsA = 0;
  let winsB = 0;
  let g = 0;
  while (winsA < gamesNeeded && winsB < gamesNeeded) {
    // alternate "home" team for atmosphere; higher seed (teamA) hosts games 1,2,(4)
    const aIsHome = g % 2 === 1 && !(g === 2);
    const result = aIsHome
      ? simulateGame(teamB, teamA, league, seed !== undefined ? seed + g : undefined)
      : simulateGame(teamA, teamB, league, seed !== undefined ? seed + g : undefined);
    const aWon = aIsHome ? result.winner === 'home' : result.winner === 'away';
    if (aWon) winsA += 1; else winsB += 1;
    games.push({ ...result, aIsHome });
    g += 1;
  }
  return { games, winner: winsA > winsB ? 'A' : 'B', winsA, winsB };
}
