/**
 * The scheduler, ported line for line from padel.py: pick a round count, give
 * everyone a quota of games, anneal who is on court when, then anneal who plays
 * on which court with whom.
 */

import { COURT_SIZE, type Match, type Round, type Session } from "../model";
import { Rng, newSeed, range } from "./rng";

const MAX_RUN = 2; // aim: never more than this many rounds on (or off) in a row

/** Python's round(): halves go to the even neighbour. */
export function pyRound(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export function slotsOf(session: Pick<Session, "courts">): number {
  return COURT_SIZE * session.courts;
}

export function roundMinutes(session: Pick<Session, "minutes" | "nRounds">): number {
  return session.minutes / session.nRounds;
}

// --------------------------------------------------------------------------
// how many rounds
// --------------------------------------------------------------------------

const BAND_LOW = 12.0;
const BAND_HIGH = 18.0; // a round length that feels right
const HARD_LOW = 6.0;
const HARD_HIGH = 25.0; // anything outside this is silly

/**
 * First preference is a count where everyone plays exactly the same number of
 * rounds *and* the rounds land in a comfortable 12-18 minute band. Failing
 * that, round length wins and one player may get a game more than another.
 */
export function chooseRounds(minutes: number, nPlayers: number, courts = 1, targetLen = 15.0): number {
  const slots = COURT_SIZE * courts;
  let bestRound: number | null = null;
  let bestScore: number[] | null = null;
  for (let r = 1; r <= 40; r++) {
    const length = minutes / r;
    if (!(HARD_LOW <= length && length <= HARD_HIGH)) continue;
    const fair = (r * slots) % nPlayers === 0;
    const inBand = BAND_LOW <= length && length <= BAND_HIGH;
    const whole = Math.abs(length - pyRound(length)) < 1e-9;
    const score = [
      fair && inBand ? 0 : 1,
      Math.abs(length - targetLen),
      whole ? 0 : 1,
      fair ? 0 : 1,
    ];
    if (bestScore === null || lessThan(score, bestScore)) {
      bestRound = r;
      bestScore = score;
    }
  }
  return bestRound || Math.max(1, pyRound(minutes / targetLen));
}

function lessThan(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

// --------------------------------------------------------------------------
// who is on court
// --------------------------------------------------------------------------

/** Games per player: as equal as the numbers allow. */
function quotas(nPlayers: number, nRounds: number, slots: number, rng: Rng): number[] {
  const total = nRounds * slots;
  const base = Math.floor(total / nPlayers);
  const extra = total % nPlayers;
  const q = new Array<number>(nPlayers).fill(base);
  for (const p of rng.sample(range(nPlayers), extra)) q[p] += 1;
  return q;
}

/** Fill each round with whoever is furthest behind on court time. */
function greedyAttendance(nPlayers: number, nRounds: number, slots: number, quota: number[], rng: Rng): Set<number>[] {
  const remaining = [...quota];
  const rounds: Set<number>[] = [];
  for (let i = 0; i < nRounds; i++) {
    const keyed = range(nPlayers).map((p) => ({ p, a: -remaining[p], b: rng.random() }));
    keyed.sort((x, y) => x.a - y.a || x.b - y.b);
    const picked = keyed.slice(0, slots).map((k) => k.p);
    for (const p of picked) remaining[p] -= 1;
    rounds.push(new Set(picked));
  }
  return rounds;
}

/** One player's rotation: long on/off runs cost a lot, bunching a little. */
export function playerCost(seq: number[]): number {
  const nRounds = seq.length;
  let cost = 0.0;

  let i = 0;
  while (i < nRounds) {
    let j = i;
    while (j + 1 < nRounds && seq[j + 1] === seq[i]) j += 1;
    const run = j - i + 1;
    if (run > MAX_RUN) cost += 60.0 * (run - MAX_RUN) ** 2;
    i = j + 1;
  }

  const played = range(nRounds).filter((r) => seq[r]);
  if (played.length) {
    const step = nRounds / played.length;
    played.forEach((r, k) => {
      const ideal = (k + 0.5) * step - 0.5; // evenly spread across the session
      cost += (r - ideal) ** 2;
    });
  }
  return cost;
}

const copySets = (sets: Set<number>[]) => sets.map((s) => new Set(s));

/**
 * Swap a player between two rounds; quotas and round sizes stay intact.
 * A swap only touches two players, so only their two costs are recomputed.
 */
function annealAttendance(
  att: Set<number>[],
  nPlayers: number,
  nRounds: number,
  rng: Rng,
  iters = 4000,
  patience = 700,
): [Set<number>[], number] {
  const cur = copySets(att);
  const seqs = range(nPlayers).map((p) => range(nRounds).map((r) => (cur[r].has(p) ? 1 : 0)));
  const costs = seqs.map(playerCost);
  let total = costs.reduce((a, b) => a + b, 0);
  let best = copySets(cur);
  let bestCost = total;
  if (nRounds < 2) return [best, bestCost];

  const hot = 2.5;
  const cold = 0.02;
  let stale = 0;
  for (let step = 0; step < iters; step++) {
    const temp = hot * (cold / hot) ** (step / Math.max(1, iters - 1));
    const [r1, r2] = rng.sample(range(nRounds), 2);
    const outs = [...cur[r1]].filter((p) => !cur[r2].has(p));
    const ins = [...cur[r2]].filter((p) => !cur[r1].has(p));
    if (!outs.length || !ins.length) continue;
    const p = rng.choice(outs);
    const q = rng.choice(ins);

    seqs[p][r1] = 0;
    seqs[p][r2] = 1;
    seqs[q][r1] = 1;
    seqs[q][r2] = 0;
    const newP = playerCost(seqs[p]);
    const newQ = playerCost(seqs[q]);
    const delta = newP + newQ - (costs[p] + costs[q]);

    if (delta <= 0 || rng.random() < Math.exp(-delta / temp)) {
      costs[p] = newP;
      costs[q] = newQ;
      total += delta;
      cur[r1].delete(p);
      cur[r1].add(q);
      cur[r2].delete(q);
      cur[r2].add(p);
      if (total < bestCost - 1e-9) {
        best = copySets(cur);
        bestCost = total;
        stale = 0;
        continue;
      }
    } else {
      seqs[p][r1] = 1;
      seqs[p][r2] = 0;
      seqs[q][r1] = 0;
      seqs[q][r2] = 1;
    }

    stale += 1;
    if (stale > patience && temp < 0.3) break;
  }
  return [best, bestCost];
}

// --------------------------------------------------------------------------
// which four share a court, and how they pair up
// --------------------------------------------------------------------------

const SPLITS = [
  [0, 1, 2, 3],
  [0, 2, 1, 3],
  [0, 3, 1, 2],
] as const;

const OPPONENT_W = 0.3;
// Court balance pulls its weight: at 1.0 nobody gets parked on court 1 all
// morning, and measured against 0.2 it costs at most one repeated partnership.
const COURT_W = 1.0;

function teamsOf(four: number[], choice: number): [number[], number[]] {
  const [i, j, k, l] = SPLITS[choice];
  return [
    [four[i], four[j]],
    [four[k], four[l]],
  ];
}

function pairKey(x: number, y: number): string {
  return x < y ? `${x},${y}` : `${y},${x}`;
}

/**
 * Seats players on courts and pairs them up, scoring repeat encounters.
 * Seats for round r are a flat list: [0:4] is court 1, [4:8] court 2, and so
 * on. Cost is the sum of squared meeting counts, so the search naturally
 * spreads partners, opponents and court usage around.
 */
class Arrangement {
  seats: number[][];
  splits: number[][];
  cost = 0.0;
  private partner = new Map<string, number>();
  private opponent = new Map<string, number>();
  private courtUse = new Map<string, number>();

  constructor(lineups: number[][], private courts: number, rng: Rng) {
    this.seats = lineups.map((lineup) => {
      const seats = [...lineup];
      rng.shuffle(seats);
      return seats;
    });
    this.splits = lineups.map(() => range(courts).map(() => rng.randrange(SPLITS.length)));
    for (let r = 0; r < lineups.length; r++) {
      for (let ci = 0; ci < courts; ci++) this.cost += this.contribute(r, ci, +1);
    }
  }

  /** Add or remove one meeting, returning the change in count-squared. */
  private static bump(counts: Map<string, number>, key: string, weight: number, sign: number): number {
    const now = counts.get(key) ?? 0;
    if (sign > 0) {
      counts.set(key, now + 1);
      return weight * (2 * now + 1);
    }
    counts.set(key, now - 1);
    return -weight * (2 * (now - 1) + 1);
  }

  teams(r: number, ci: number): [number[], number[]] {
    const four = this.seats[r].slice(ci * COURT_SIZE, (ci + 1) * COURT_SIZE);
    return teamsOf(four, this.splits[r][ci]);
  }

  private contribute(r: number, ci: number, sign: number, withCourt = true): number {
    const [a, b] = this.teams(r, ci);
    let delta = 0.0;
    delta += Arrangement.bump(this.partner, pairKey(a[0], a[1]), 1.0, sign);
    delta += Arrangement.bump(this.partner, pairKey(b[0], b[1]), 1.0, sign);
    for (const x of a) {
      for (const y of b) delta += Arrangement.bump(this.opponent, pairKey(x, y), OPPONENT_W, sign);
    }
    if (withCourt && this.courts > 1) {
      for (const p of [...a, ...b]) delta += Arrangement.bump(this.courtUse, `${p}@${ci}`, COURT_W, sign);
    }
    return delta;
  }

  /** Try one of the three ways to split a foursome into two teams. */
  repair(r: number, ci: number, choice: number): number {
    let delta = this.contribute(r, ci, -1, false);
    this.splits[r][ci] = choice;
    delta += this.contribute(r, ci, +1, false);
    this.cost += delta;
    return delta;
  }

  /** Move two players between courts in the same round. */
  swap(r: number, s1: number, s2: number): number {
    const c1 = Math.floor(s1 / COURT_SIZE);
    const c2 = Math.floor(s2 / COURT_SIZE);
    let delta = this.contribute(r, c1, -1) + this.contribute(r, c2, -1);
    [this.seats[r][s1], this.seats[r][s2]] = [this.seats[r][s2], this.seats[r][s1]];
    delta += this.contribute(r, c1, +1) + this.contribute(r, c2, +1);
    this.cost += delta;
    return delta;
  }

  snapshot(): [number[][], number[][]] {
    return [this.seats.map((s) => [...s]), this.splits.map((s) => [...s])];
  }
}

/** Anneal over court seating and team pairings together. */
function assignCourts(lineups: number[][], courts: number, rng: Rng, restarts = 5): [number[][], number[][]] {
  const nRounds = lineups.length;
  const seatsPerRound = COURT_SIZE * courts;
  const iters = Math.min(9000, Math.max(1500, 600 * nRounds * courts));

  let bestState: [number[][], number[][]] | null = null;
  let bestCost = Infinity;
  for (let restart = 0; restart < restarts; restart++) {
    const arr = new Arrangement(lineups, courts, rng);
    let localState = arr.snapshot();
    let localCost = arr.cost;

    const hot = 2.5;
    const cold = 0.02;
    for (let step = 0; step < iters; step++) {
      const temp = hot * (cold / hot) ** (step / Math.max(1, iters - 1));
      const r = rng.randrange(nRounds);
      let delta: number;
      let undo: () => void;

      if (courts > 1 && rng.random() < 0.6) {
        const [s1, s2] = rng.sample(range(seatsPerRound), 2);
        if (Math.floor(s1 / COURT_SIZE) === Math.floor(s2 / COURT_SIZE)) continue;
        delta = arr.swap(r, s1, s2);
        undo = () => arr.swap(r, s1, s2); // swapping back
      } else {
        const ci = rng.randrange(courts);
        const previous = arr.splits[r][ci];
        const choice = rng.randrange(SPLITS.length);
        if (choice === previous) continue;
        delta = arr.repair(r, ci, choice);
        undo = () => arr.repair(r, ci, previous);
      }

      if (delta <= 0 || rng.random() < Math.exp(-delta / temp)) {
        if (arr.cost < localCost - 1e-9) {
          localState = arr.snapshot();
          localCost = arr.cost;
        }
      } else {
        undo();
      }
    }

    if (localCost < bestCost) {
      bestState = localState;
      bestCost = localCost;
    }
  }
  return bestState!;
}

export function buildSchedule(session: Session, rng: Rng): Round[] {
  const n = session.players.length;
  const r = session.nRounds;
  const courts = session.courts;
  const slots = slotsOf(session);

  let bestAtt: Set<number>[] | null = null;
  let bestAttCost = Infinity;
  for (let attempt = 0; attempt < 8; attempt++) {
    const greedy = greedyAttendance(n, r, slots, quotas(n, r, slots, rng), rng);
    const [att, cost] = annealAttendance(greedy, n, r, rng);
    if (cost < bestAttCost) {
      bestAtt = att;
      bestAttCost = cost;
    }
    if (bestAttCost <= 0.0) break;
  }

  const lineups = bestAtt!.map((s) => [...s].sort((a, b) => a - b));
  const [seats, splits] = assignCourts(lineups, courts, rng);

  const rounds: Round[] = [];
  for (let i = 0; i < r; i++) {
    const matches: Match[] = [];
    for (let ci = 0; ci < courts; ci++) {
      const four = seats[i].slice(ci * COURT_SIZE, (ci + 1) * COURT_SIZE);
      let [teamA, teamB] = teamsOf(four, splits[i][ci]);
      if (Math.min(...teamB) < Math.min(...teamA)) [teamA, teamB] = [teamB, teamA];
      matches.push({ court: ci + 1, teamA, teamB });
    }
    const playing = new Set(lineups[i]);
    rounds.push({
      number: i + 1,
      matches,
      resting: range(n).filter((p) => !playing.has(p)),
      startMin: pyRound((i * session.minutes) / r),
      endMin: pyRound(((i + 1) * session.minutes) / r),
    });
  }
  return rounds;
}

// --------------------------------------------------------------------------
// summary numbers for the PDF
// --------------------------------------------------------------------------

export interface Stats {
  games: number[];
  roundsPlayed: number[][];
  maxStreak: number;
  maxRestStreak: number;
  partners: Map<string, number>;
  distinctPartners: number[];
}

export function summarise(rounds: Round[], nPlayers: number): Stats {
  const partners = range(nPlayers).map(() => new Set<number>());
  const pairCounts = new Map<string, number>();
  const onCourt = rounds.map((rd) => new Set(rd.matches.flatMap((m) => [...m.teamA, ...m.teamB])));
  const st: Stats = {
    games: [],
    roundsPlayed: [],
    maxStreak: 0,
    maxRestStreak: 0,
    partners: pairCounts,
    distinctPartners: [],
  };

  for (let p = 0; p < nPlayers; p++) {
    const played = rounds.filter((_, i) => onCourt[i].has(p)).map((rd) => rd.number);
    st.games[p] = played.length;
    st.roundsPlayed[p] = played;

    let on = 0;
    let off = 0;
    let bestOn = 0;
    let bestOff = 0;
    for (const players of onCourt) {
      if (players.has(p)) {
        on += 1;
        off = 0;
      } else {
        off += 1;
        on = 0;
      }
      bestOn = Math.max(bestOn, on);
      bestOff = Math.max(bestOff, off);
    }
    st.maxStreak = Math.max(st.maxStreak, bestOn);
    st.maxRestStreak = Math.max(st.maxRestStreak, bestOff);
  }

  for (const rd of rounds) {
    for (const match of rd.matches) {
      for (const team of [match.teamA, match.teamB]) {
        for (let i = 0; i < team.length; i++) {
          for (const y of team.slice(i + 1)) {
            const x = team[i];
            partners[x].add(y);
            partners[y].add(x);
            const key = pairKey(x, y);
            pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
          }
        }
      }
    }
  }

  st.distinctPartners = partners.map((s) => s.size);
  return st;
}

/** Schedule a session. Returns the rounds, their stats and the seed used. */
export function generate(session: Session, seed: number | null = null): { rounds: Round[]; stats: Stats; seed: number } {
  const used = seed ?? newSeed();
  const rounds = buildSchedule(session, new Rng(used));
  return { rounds, stats: summarise(rounds, session.players.length), seed: used };
}
