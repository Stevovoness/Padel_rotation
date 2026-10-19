import { describe, expect, it } from "vitest";
import { newTracker, scoreKey, type Round, type Session, type Tracker } from "../src/model";
import {
  applyPeople,
  applyScore,
  diffLocal,
  fingerprint,
  mergeSnapshot,
  newSessionId,
  trackerFromSnapshot,
  type Snapshot,
} from "../src/sync/merge";

const session: Session = {
  players: ["Ann", "Ben", "Cara", "Dan"],
  minutes: 30,
  nRounds: 2,
  courts: 1,
  start: "08:00",
  title: "Padel Rotation",
  dateText: "Mon 19 Oct",
  location: "Laerskool Menlo Park",
};
const rounds: Round[] = [
  { number: 1, matches: [{ court: 1, teamA: [0, 1], teamB: [2, 3] }], resting: [], startMin: 0, endMin: 15 },
  { number: 2, matches: [{ court: 1, teamA: [0, 2], teamB: [1, 3] }], resting: [], startMin: 15, endMin: 30 },
];

const shared = (): Tracker => ({ ...newTracker(session, rounds), shared: { id: "abcdefgh23", fingerprint: "f" } });
const T1 = "2026-10-19T17:00:00.000Z";
const T2 = "2026-10-19T17:01:00.000Z";

describe("diffLocal", () => {
  it("turns a typed score into one op and stamps it", () => {
    const prev = shared();
    const next = { ...prev, scores: { [scoreKey(1, 1)]: [14, null] as [number, null] } };
    const { tracker, ops } = diffLocal(prev, next, T1);
    expect(ops).toEqual([{ kind: "score", id: "abcdefgh23", round: 1, court: 1, a: 14, b: null, at: T1 }]);
    expect(tracker.stamps).toEqual({ "s:1-1": T1 });
  });

  it("sends a renamed slot", () => {
    const prev = shared();
    const people = prev.people.map((s, i) => (i === 2 ? [{ name: "Carla", fromRound: 1 }] : s));
    const { ops } = diffLocal(prev, { ...prev, people }, T1);
    expect(ops).toEqual([
      { kind: "people", id: "abcdefgh23", slot: 2, segments: [{ name: "Carla", fromRound: 1 }], at: T1 },
    ]);
  });

  it("sends nothing for a session that isn't shared", () => {
    const prev = newTracker(session, rounds);
    const next = { ...prev, scores: { "1-1": [1, 2] as [number, number] } };
    expect(diffLocal(prev, next, T1).ops).toEqual([]);
  });
});

describe("applying other phones' edits", () => {
  it("takes a newer score and ignores an older one", () => {
    const mine = { ...shared(), scores: { "1-1": [10, 10] as [number, number] }, stamps: { "s:1-1": T1 } };
    const newer = applyScore(mine, { round: 1, court: 1, a: 14, b: 11, at: T2 }, new Set());
    expect(newer.scores["1-1"]).toEqual([14, 11]);
    const older = applyScore(
      { ...mine, stamps: { "s:1-1": T2 } },
      { round: 1, court: 1, a: 3, b: 3, at: T1 },
      new Set(),
    );
    expect(older.scores["1-1"]).toEqual([10, 10]);
  });

  it("never overwrites an edit still waiting to send", () => {
    const mine = { ...shared(), scores: { "1-1": [10, 10] as [number, number] } };
    const out = applyScore(mine, { round: 1, court: 1, a: 1, b: 1, at: T2 }, new Set(["s:1-1"]));
    expect(out).toBe(mine);
  });

  it("applies a substitution", () => {
    const out = applyPeople(
      shared(),
      { slot: 0, segments: [{ name: "Ann", fromRound: 1 }, { name: "Zed", fromRound: 2 }], at: T1 },
      new Set(),
    );
    expect(out.people[0].map((s) => s.name)).toEqual(["Ann", "Zed"]);
  });

  it("builds a tracker from a server snapshot", () => {
    const snap: Snapshot = {
      id: "abcdefgh23",
      schedule: { session, rounds, seed: 5, fingerprint: "f" },
      scores: [{ round: 2, court: 1, a: 21, b: 19, at: "2026-10-19T17:05:00+00:00" }],
      people: [],
    };
    const t = trackerFromSnapshot(snap);
    expect(t.shared).toEqual({ id: "abcdefgh23", fingerprint: "f" });
    expect(t.seed).toBe(5);
    expect(t.scores["2-1"]).toEqual([21, 19]);
    // merging the same snapshot again changes nothing
    expect(mergeSnapshot(t, snap, new Set())).toBe(t);
  });
});

describe("fingerprint", () => {
  it("is the same after a trip through the PDF (which upper-cases the venue)", async () => {
    const typed = await fingerprint({ ...session, location: "laerskool menlo park" }, rounds);
    const imported = await fingerprint(session, rounds);
    expect(typed).toBe(imported);
    expect(typed).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for a different schedule", async () => {
    const other = await fingerprint({ ...session, start: "09:00" }, rounds);
    expect(other).not.toBe(await fingerprint(session, rounds));
  });
});

describe("newSessionId", () => {
  it("makes 10-character link codes the database accepts", () => {
    for (let i = 0; i < 50; i++) expect(newSessionId()).toMatch(/^[a-z0-9]{10}$/);
  });
});
