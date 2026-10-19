import { describe, expect, it } from "vitest";
import type { Session } from "../src/model";
import { chooseRounds, generate, playerCost, pyRound } from "../src/sched/schedule";
import fixture from "./chooseRounds.fixture.json";

function session(players: number, courts: number, minutes = 90): Session {
  return {
    players: Array.from({ length: players }, (_, i) => `P${i}`),
    minutes,
    nRounds: chooseRounds(minutes, players, courts),
    courts,
    start: "08:00",
    title: "Padel Rotation",
    dateText: "",
    location: "",
  };
}

describe("chooseRounds", () => {
  it("picks the same round count as padel.py for every court/player/minutes combination", () => {
    // fixture exported from padel.choose_rounds
    for (const [courts, players, ...expected] of fixture.rows) {
      const got = fixture.minutes.map((m) => chooseRounds(m, players, courts));
      expect([courts, players, ...got]).toEqual([courts, players, ...expected]);
    }
  });
});

describe("pyRound", () => {
  it("rounds halves to even, like Python", () => {
    expect([0.5, 1.5, 2.5, 22.5, 2.4, 2.6].map(pyRound)).toEqual([0, 2, 2, 22, 2, 3]);
  });
});

describe("playerCost", () => {
  it("punishes long runs on or off court", () => {
    expect(playerCost([1, 0, 1, 0])).toBeLessThan(playerCost([1, 1, 1, 0]));
    expect(playerCost([1, 1, 1, 1])).toBeGreaterThan(100);
  });
});

describe("generate", () => {
  const configs: [number, number, number][] = [
    [4, 1, 60], [5, 1, 90], [7, 1, 90], [8, 2, 90], [9, 2, 90], [10, 2, 120],
    [13, 3, 90], [16, 4, 120], [21, 3, 120], [32, 8, 150],
  ];

  for (const [players, courts, minutes] of configs) {
    it(`builds a valid rotation for ${players} players on ${courts} court(s)`, () => {
      for (const seed of [1, 7, 4242, 999_999]) {
        const s = session(players, courts, minutes);
        const { rounds, stats } = generate(s, seed);
        expect(rounds).toHaveLength(s.nRounds);

        for (const rd of rounds) {
          expect(rd.matches).toHaveLength(courts);
          const playing = rd.matches.flatMap((m) => [...m.teamA, ...m.teamB]);
          expect(new Set(playing).size).toBe(4 * courts); // nobody twice in a round
          expect(new Set([...playing, ...rd.resting]).size).toBe(players); // everyone accounted for
          for (const m of rd.matches) {
            expect(Math.min(...m.teamA)).toBeLessThan(Math.min(...m.teamB)); // team A holds the lowest index
          }
        }

        // court time as equal as the numbers allow
        expect(Math.max(...stats.games) - Math.min(...stats.games)).toBeLessThanOrEqual(1);
        expect(stats.games.reduce((a, b) => a + b, 0)).toBe(s.nRounds * 4 * courts);
        expect(rounds.at(-1)!.endMin).toBe(minutes);
      }
    });
  }

  it("rebuilds the same rotation from the same seed", () => {
    const s = session(9, 2);
    expect(generate(s, 123).rounds).toEqual(generate(s, 123).rounds);
    expect(generate(s, 123).rounds).not.toEqual(generate(s, 124).rounds);
  });

  it("keeps rests short when there are plenty of people sitting out", () => {
    for (const seed of [1, 2, 3]) {
      const { stats } = generate(session(7, 1), seed);
      expect(stats.maxStreak).toBeLessThanOrEqual(2);
      expect(stats.maxRestStreak).toBeLessThanOrEqual(2);
    }
  });
});
