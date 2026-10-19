import { describe, expect, it } from "vitest";
import { newTracker, scoreKey, type Round, type Session, type Tracker } from "../src/model";
import { bestPartnership, biggestWin, standings } from "../src/scoring/leaderboard";
import { resultsMessage } from "../src/scoring/message";
import { fixName, substitute } from "../src/scoring/people";

const session: Session = {
  players: ["Ann", "Ben", "Cara", "Dan", "Eve"],
  minutes: 60,
  nRounds: 3,
  courts: 1,
  start: "08:00",
  title: "Padel Rotation",
  dateText: "Sat 20 Sep",
  location: "Club One",
};

// one court, Eve rests in round 1 and plays rounds 2 and 3
const rounds: Round[] = [
  { number: 1, matches: [{ court: 1, teamA: [0, 1], teamB: [2, 3] }], resting: [4], startMin: 0, endMin: 20 },
  { number: 2, matches: [{ court: 1, teamA: [0, 4], teamB: [1, 2] }], resting: [3], startMin: 20, endMin: 40 },
  { number: 3, matches: [{ court: 1, teamA: [3, 4], teamB: [0, 2] }], resting: [1], startMin: 40, endMin: 60 },
];

function scored(scores: Record<number, [number | null, number | null]>): Tracker {
  const t = newTracker(session, rounds);
  for (const [round, score] of Object.entries(scores)) {
    t.scores[scoreKey(Number(round), 1)] = score;
  }
  return t;
}

const names = (t: Tracker) => standings(t).rows.map((r) => `${r.rank}:${r.person.name}`);

describe("standings", () => {
  it("ranks on total points when everyone has played the same number of games", () => {
    // only round 1 scored: Ann, Ben, Cara, Dan have one game each
    const t = scored({ 1: [14, 11] });
    const s = standings(t);
    expect(s.averaged).toBe(false);
    expect(names(t)).toEqual(["1:Ann", "1:Ben", "3:Cara", "3:Dan", "5:Eve"]);
    expect(s.rows[0]).toMatchObject({ games: 1, pointsFor: 14, pointsAgainst: 11, wins: 1 });
    expect(s.rows[4].games).toBe(0); // Eve, unplayed, listed last
  });

  it("breaks a points tie on wins, then point difference", () => {
    // equal games for all four players across rounds 1 and 2 isn't possible here,
    // so build a two-round tracker with a round-2 rematch
    const r: Round[] = [
      rounds[0],
      { number: 2, matches: [{ court: 1, teamA: [0, 2], teamB: [1, 3] }], resting: [4], startMin: 20, endMin: 40 },
    ];
    const t = newTracker({ ...session, players: session.players.slice(0, 4), nRounds: 2 }, r);
    t.scores[scoreKey(1, 1)] = [10, 12]; // Ann+Ben 10, Cara+Dan 12
    t.scores[scoreKey(2, 1)] = [12, 10]; // Ann+Cara 12, Ben+Dan 10
    // points: Ann 22, Ben 20, Cara 24, Dan 22 -> Cara, then Ann/Dan tied on 22
    // wins: Ann 1, Dan 1 -> tied; diff: Ann 0, Dan 0 -> shared rank
    expect(names(t)).toEqual(["1:Cara", "2:Ann", "2:Dan", "4:Ben"]);
  });

  it("averages per game when game counts differ, and a draw is half a win", () => {
    const t = scored({ 1: [12, 12], 2: [15, 9], 3: [8, 16] });
    const s = standings(t);
    expect(s.averaged).toBe(true);
    const by = Object.fromEntries(s.rows.map((r) => [r.person.name, r]));
    expect(by.Ann).toMatchObject({ games: 3, pointsFor: 12 + 15 + 16, wins: 0.5 + 1 + 1 });
    expect(by.Eve).toMatchObject({ games: 2, pointsFor: 15 + 8, wins: 1 });
    // Ann 43/3 = 14.3, Cara 12+9+16 = 37/3 = 12.3, Eve 23/2 = 11.5, Ben 21/2 = 10.5, Dan 20/2 = 10
    expect(names(t)).toEqual(["1:Ann", "2:Cara", "3:Eve", "4:Ben", "5:Dan"]);
  });

  it("ignores a match until both scores are in", () => {
    const t = scored({ 1: [14, null] });
    expect(standings(t).rows.every((r) => r.games === 0)).toBe(true);
  });
});

describe("people", () => {
  it("fixing a name keeps the same person and their points", () => {
    const t = fixName(scored({ 1: [14, 11] }), 0, 0, "Anne");
    const s = standings(t);
    expect(s.rows[0].person.name).toBe("Anne");
    expect(s.rows[0].pointsFor).toBe(14);
  });

  it("a substitute is a separate person from their round on", () => {
    let t = scored({ 1: [14, 11], 2: [15, 9], 3: [8, 16] });
    t = substitute(t, 0, 2, "Zed"); // Zed takes Ann's place from round 2
    const by = Object.fromEntries(standings(t).rows.map((r) => [r.person.name, r]));
    expect(by.Ann).toMatchObject({ games: 1, pointsFor: 14 });
    expect(by.Zed).toMatchObject({ games: 2, pointsFor: 15 + 16 });
  });

  it("a substitute from round 1 replaces the original entirely", () => {
    const t = substitute(scored({}), 0, 1, "Zed");
    const shown = standings(t).rows.map((r) => r.person.name);
    expect(shown).toContain("Zed");
    expect(shown).not.toContain("Ann");
  });
});

describe("highlights and message", () => {
  const t = scored({ 1: [14, 11], 2: [21, 3], 3: [8, 16] });

  it("finds the biggest win and the best partnership", () => {
    const { matches } = standings(t);
    expect(biggestWin(matches)).toMatchObject({ round: 2, a: 21, b: 3 });
    const duo = bestPartnership(matches)!;
    expect(duo.pair.map((p) => p.name).sort()).toEqual(["Ann", "Eve"]);
    expect(duo.diffPerGame).toBe(18);
  });

  it("writes a WhatsApp message with podium, table and both jokes", () => {
    const text = resultsMessage(t, () => 0);
    expect(text).toContain("*PADEL AMERICANO RESULTS*");
    expect(text).toContain("📍 Club One · Sat 20 Sep");
    expect(text).toMatch(/🥇 \*Ann\*/);
    expect(text).toContain("💥 *Biggest win:* Ann & Eve 21–3 Ben & Cara (round 2)");
    expect(text).toContain("All hail *Ann*");
    expect(text).toContain("Wooden spoon goes to *");
    expect(text).not.toMatch(/Round 1|R1/); // no round-by-round scores
  });

  it("says so when nothing is scored yet", () => {
    expect(resultsMessage(scored({}))).toContain("No scores yet");
  });
});
