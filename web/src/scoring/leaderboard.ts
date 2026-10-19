/**
 * Americano standings.
 *
 * Every player banks the points their team scored in each match.
 *   Everyone has played the same number of games:
 *     total points, then matches won, then point difference.
 *   Game counts differ (odd numbers, or a substitute):
 *     average points per game, then win rate, then average difference per game.
 * A draw counts as half a win. A match counts once both scores are in.
 */

import { scoreKey, type Tracker } from "../model";
import { everyone, personAt, type Person } from "./people";

export interface Row {
  person: Person;
  games: number;
  pointsFor: number;
  pointsAgainst: number;
  wins: number; // draws count 0.5
  rank: number;
}

export interface ScoredMatch {
  round: number;
  court: number;
  teamA: Person[];
  teamB: Person[];
  a: number;
  b: number;
}

export interface Standings {
  rows: Row[]; // ranked; people with no games last
  averaged: boolean; // true when ranked per game because game counts differ
  matches: ScoredMatch[];
}

export const diff = (r: Row) => r.pointsFor - r.pointsAgainst;
const per = (value: number, r: Row) => (r.games ? value / r.games : 0);

export function scoredMatches(tracker: Tracker): ScoredMatch[] {
  const out: ScoredMatch[] = [];
  for (const round of tracker.rounds) {
    for (const match of round.matches) {
      const score = tracker.scores[scoreKey(round.number, match.court)];
      if (!score || score[0] === null || score[1] === null) continue;
      const who = (slot: number) => personAt(tracker.people, slot, round.number);
      out.push({
        round: round.number,
        court: match.court,
        teamA: match.teamA.map(who),
        teamB: match.teamB.map(who),
        a: score[0],
        b: score[1],
      });
    }
  }
  return out;
}

export function standings(tracker: Tracker): Standings {
  const matches = scoredMatches(tracker);
  const rows = new Map<string, Row>(
    everyone(tracker.people).map((p) => [
      p.id,
      { person: p, games: 0, pointsFor: 0, pointsAgainst: 0, wins: 0, rank: 0 },
    ]),
  );

  for (const m of matches) {
    const credit = (team: Person[], mine: number, theirs: number) => {
      for (const p of team) {
        const row = rows.get(p.id)!;
        row.games += 1;
        row.pointsFor += mine;
        row.pointsAgainst += theirs;
        row.wins += mine > theirs ? 1 : mine === theirs ? 0.5 : 0;
      }
    };
    credit(m.teamA, m.a, m.b);
    credit(m.teamB, m.b, m.a);
  }

  // someone substituted out before they scored has nothing to show
  const all = [...rows.values()].filter(
    (r) => r.games > 0 || r.person.segment === tracker.people[r.person.slot].length - 1,
  );
  const playing = all.filter((r) => r.games > 0);
  const averaged = new Set(playing.map((r) => r.games)).size > 1;

  const keys = (r: Row): number[] =>
    averaged
      ? [per(r.pointsFor, r), per(r.wins, r), per(diff(r), r)]
      : [r.pointsFor, r.wins, diff(r)];

  const compare = (x: Row, y: Row) => {
    if ((x.games > 0) !== (y.games > 0)) return x.games > 0 ? -1 : 1;
    const kx = keys(x);
    const ky = keys(y);
    for (let i = 0; i < kx.length; i++) {
      if (Math.abs(kx[i] - ky[i]) > 1e-9) return ky[i] - kx[i];
    }
    return 0;
  };

  const ranked = [...all].sort(
    (x, y) => compare(x, y) || x.person.name.localeCompare(y.person.name),
  );
  ranked.forEach((row, i) => {
    const prev = ranked[i - 1];
    row.rank = prev && compare(prev, row) === 0 ? prev.rank : i + 1;
  });

  return { rows: ranked, averaged, matches };
}

/** The most one-sided match so far. */
export function biggestWin(matches: ScoredMatch[]): ScoredMatch | null {
  let best: ScoredMatch | null = null;
  for (const m of matches) {
    if (m.a === m.b) continue;
    if (!best || Math.abs(m.a - m.b) > Math.abs(best.a - best.b)) best = m;
  }
  return best;
}

export interface Partnership {
  pair: [Person, Person];
  games: number;
  diffPerGame: number;
}

/** The pair with the best average point difference when on the same side. */
export function bestPartnership(matches: ScoredMatch[]): Partnership | null {
  const pairs = new Map<string, { pair: [Person, Person]; games: number; diff: number }>();
  const add = (team: Person[], d: number) => {
    if (team.length !== 2) return;
    const [x, y] = [...team].sort((p, q) => p.id.localeCompare(q.id));
    const key = `${x.id}|${y.id}`;
    const entry = pairs.get(key) ?? { pair: [x, y] as [Person, Person], games: 0, diff: 0 };
    entry.games += 1;
    entry.diff += d;
    pairs.set(key, entry);
  };
  for (const m of matches) {
    add(m.teamA, m.a - m.b);
    add(m.teamB, m.b - m.a);
  }
  let best: Partnership | null = null;
  for (const e of pairs.values()) {
    const candidate = { pair: e.pair, games: e.games, diffPerGame: e.diff / e.games };
    if (
      !best ||
      candidate.diffPerGame > best.diffPerGame ||
      (candidate.diffPerGame === best.diffPerGame && candidate.games > best.games)
    ) {
      best = candidate;
    }
  }
  return best && best.diffPerGame > 0 ? best : null;
}
