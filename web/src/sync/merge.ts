/**
 * The pure half of shared scoring: what a local edit sends, and how edits from
 * other phones fold into this one. Every score and roster slot carries the time
 * it was last changed, and the most recent change wins - here and on the server.
 */

import {
  newTracker,
  peopleStamp,
  scoreKey,
  scoreStamp,
  type Round,
  type Score,
  type Segment,
  type Session,
  type Tracker,
} from "../model";

export interface ScoreOp {
  kind: "score";
  seq: number;
  id: string;
  round: number;
  court: number;
  a: number | null;
  b: number | null;
  at: string;
}

export interface PeopleOp {
  kind: "people";
  seq: number;
  id: string;
  slot: number;
  segments: Segment[];
  at: string;
}

export interface CreateOp {
  kind: "create";
  seq: number;
  id: string;
  fingerprint: string;
  schedule: Schedule;
}

export type Op = ScoreOp | PeopleOp | CreateOp;

/** An op before the queue numbers it. */
export type Unsent = Omit<ScoreOp, "seq"> | Omit<PeopleOp, "seq"> | Omit<CreateOp, "seq">;

/** What the server keeps about a session's schedule. */
export interface Schedule {
  session: Session;
  rounds: Round[];
  seed?: number;
  fingerprint: string;
}

/** What get_session returns. */
export interface Snapshot {
  id: string;
  schedule: Schedule;
  scores: { round: number; court: number; a: number | null; b: number | null; at: string }[];
  people: { slot: number; segments: Segment[]; at: string }[];
}

export function opKey(op: Op): string {
  if (op.kind === "score") return scoreStamp(op.round, op.court);
  if (op.kind === "people") return peopleStamp(op.slot);
  return "create";
}

// --------------------------------------------------------------------------
// fingerprints: the same PDF on two phones gives the same scoreboard
// --------------------------------------------------------------------------

/** The parts of a schedule that survive a trip through the PDF, normalised. */
export function fingerprintSource(session: Session, rounds: Round[]): string {
  const low = (s: string) => s.trim().toLowerCase();
  return JSON.stringify([
    session.players,
    session.minutes,
    session.courts,
    session.start,
    low(session.title),
    low(session.dateText),
    low(session.location),
    rounds.map((r) => r.matches.map((m) => [m.court, m.teamA, m.teamB])),
  ]);
}

export async function fingerprint(session: Session, rounds: Round[]): Promise<string> {
  const bytes = new TextEncoder().encode(fingerprintSource(session, rounds));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...hash].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A session code for links: 10 characters, about 50 bits of randomness. */
export function newSessionId(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o, 1/l/i to misread
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

// --------------------------------------------------------------------------
// local edits -> ops
// --------------------------------------------------------------------------

const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);

/**
 * Compare the tracker before and after an edit. Returns the tracker with the
 * changed items stamped, and the ops (without seq) that tell everyone else.
 */
export function diffLocal(
  prev: Tracker,
  next: Tracker,
  at: string,
): { tracker: Tracker; ops: (Omit<ScoreOp, "seq"> | Omit<PeopleOp, "seq">)[] } {
  const id = next.shared?.id;
  if (!id || prev.shared?.id !== id) return { tracker: next, ops: [] };

  const ops: (Omit<ScoreOp, "seq"> | Omit<PeopleOp, "seq">)[] = [];
  const stamps = { ...(next.stamps ?? {}) };

  for (const round of next.rounds) {
    for (const match of round.matches) {
      const key = scoreKey(round.number, match.court);
      const before = prev.scores[key] ?? [null, null];
      const after = next.scores[key] ?? [null, null];
      if (!same(before, after)) {
        ops.push({ kind: "score", id, round: round.number, court: match.court, a: after[0], b: after[1], at });
        stamps[scoreStamp(round.number, match.court)] = at;
      }
    }
  }
  next.people.forEach((segments, slot) => {
    if (!same(prev.people[slot], segments)) {
      ops.push({ kind: "people", id, slot, segments, at });
      stamps[peopleStamp(slot)] = at;
    }
  });

  return { tracker: ops.length ? { ...next, stamps } : next, ops };
}

// --------------------------------------------------------------------------
// remote edits -> tracker
// --------------------------------------------------------------------------

/** Is the incoming change newer than what this phone has? */
function newer(tracker: Tracker, stamp: string, at: string): boolean {
  const mine = tracker.stamps?.[stamp];
  return !mine || Date.parse(at) >= Date.parse(mine);
}

export function applyScore(
  tracker: Tracker,
  s: { round: number; court: number; a: number | null; b: number | null; at: string },
  pending: Set<string>,
): Tracker {
  const stamp = scoreStamp(s.round, s.court);
  if (pending.has(stamp) || !newer(tracker, stamp, s.at)) return tracker;
  const key = scoreKey(s.round, s.court);
  const score: Score = [s.a, s.b];
  if (same(tracker.scores[key] ?? [null, null], score) && Date.parse(tracker.stamps?.[stamp] ?? "") === Date.parse(s.at)) return tracker;
  return {
    ...tracker,
    scores: { ...tracker.scores, [key]: score },
    stamps: { ...(tracker.stamps ?? {}), [stamp]: s.at },
  };
}

export function applyPeople(
  tracker: Tracker,
  p: { slot: number; segments: Segment[]; at: string },
  pending: Set<string>,
): Tracker {
  const stamp = peopleStamp(p.slot);
  if (p.slot < 0 || p.slot >= tracker.people.length) return tracker;
  if (pending.has(stamp) || !newer(tracker, stamp, p.at)) return tracker;
  if (same(tracker.people[p.slot], p.segments) && Date.parse(tracker.stamps?.[stamp] ?? "") === Date.parse(p.at)) return tracker;
  const people = tracker.people.map((segs, i) => (i === p.slot ? p.segments : segs));
  return { ...tracker, people, stamps: { ...(tracker.stamps ?? {}), [stamp]: p.at } };
}

/** Fold a whole server snapshot in, leaving alone anything still waiting to send. */
export function mergeSnapshot(tracker: Tracker, snap: Snapshot, pending: Set<string>): Tracker {
  let t = tracker;
  for (const s of snap.scores) t = applyScore(t, s, pending);
  for (const p of snap.people) t = applyPeople(t, p, pending);
  return t;
}

/** A tracker for a session opened from a link. */
export function trackerFromSnapshot(snap: Snapshot): Tracker {
  const { session, rounds, seed, fingerprint: fp } = snap.schedule;
  const fresh: Tracker = { ...newTracker(session, rounds, seed), shared: { id: snap.id, fingerprint: fp } };
  return mergeSnapshot(fresh, snap, new Set());
}
