import { describe, expect, it } from "vitest";
import { ImportError, parsePdfText, tokensFromItems } from "../src/import/parsePdf";

// Text as it comes out of a two-court PDF, after tokensFromItems.
const twoCourts: string[][] = [
  [
    "SAT 20 SEP · CLUB ONE",
    "Padel Rotation",
    "8 players · 2 courts · 2 rounds · 15 min each",
    "08:00 – 08:30 · Everyone plays every round · the pairings rotate",
    "ROUND1",
    "08:00 – 08:15",
    "COURT1",
    "Ann & Ben",
    "VS",
    "Cara & Dan",
    "COURT2",
    "Eve & Finn",
    "VS",
    "Gus & Bartholomew-Maximilian",
    "Padel Rotation · 30 min · 2 courts",
    "1/3",
  ],
  [
    "PADEL ROTATION · CONTINUED",
    "ROUND 2",
    "08:15 – 08:30",
    "COURT 1",
    "Ann & Eve",
    "VS",
    "Ben & Gus",
    "COURT 2",
    "Cara & Finn",
    "VS",
    "Dan & Bartholomew-Ma…",
    "Padel Rotation · 30 min · 2 courts",
    "2/3",
  ],
  [
    "AT A GLANCE",
    "WHOISONCOURT",
    "R1",
    "R2",
    "PLAYS",
    "Ann", "1", "1", "2",
    "Ben", "1", "1", "2",
    "Cara", "1", "2", "2",
    "Dan", "1", "2", "2",
    "Eve", "2", "1", "2",
    "Finn", "2", "2", "2",
    "Gus", "2", "1", "2",
    "Bartholomew-Maximilian", "2", "2", "2",
    "Team 1",
    "Team 2",
    "number = court",
    "generated 20 Sep 2026 · seed 1",
    "Padel Rotation · 30 min · 2 courts",
    "3/3",
  ],
];

// A one-court PDF with resting players and no start time.
const oneCourt: string[][] = [
  [
    "THE CAGE",
    "Sunday Smash",
    "5 players · 2 rounds · 20 min each",
    "4 of 2 ...",
    "ROUND 1",
    "0–20 min",
    "Ann & Ben",
    "VS",
    "Cara & Dan",
    "RESTING",
    "Eve",
    "ROUND 2",
    "20–40 min",
    "Eve & Ann",
    "VS",
    "Ben & Cara",
    "RESTING",
    "Dan",
    "Sunday Smash · 40 min · 1 court",
    "1/2",
  ],
  [
    "AT A GLANCE",
    "WHO IS ON COURT",
    "R1",
    "R2",
    "PLAYS",
    "Ann", "2",
    "Ben", "2",
    "Cara", "2",
    "Dan", "1",
    "Eve", "1",
    "Team 1",
    "Team 2",
    "Resting",
    "Sunday Smash · 40 min · 1 court",
    "2/2",
  ],
];

describe("parsePdfText", () => {
  it("reads a two-court PDF with clock times", () => {
    const { session, rounds } = parsePdfText(twoCourts);
    expect(session).toEqual({
      players: ["Ann", "Ben", "Cara", "Dan", "Eve", "Finn", "Gus", "Bartholomew-Maximilian"],
      minutes: 30,
      nRounds: 2,
      courts: 2,
      start: "08:00",
      title: "Padel Rotation",
      dateText: "Sat 20 Sep",
      location: "Club One",
    });
    expect(rounds[0]).toEqual({
      number: 1,
      matches: [
        { court: 1, teamA: [0, 1], teamB: [2, 3] },
        { court: 2, teamA: [4, 5], teamB: [6, 7] },
      ],
      resting: [],
      startMin: 0,
      endMin: 15,
    });
    // a name cut short with "…" on the card resolves to the full roster name
    expect(rounds[1].matches[1].teamB).toEqual([3, 7]);
    expect(rounds[1].startMin).toBe(15);
  });

  it("reads a one-court PDF with resting players and relative times", () => {
    const { session, rounds } = parsePdfText(oneCourt);
    expect(session.courts).toBe(1);
    expect(session.start).toBeNull();
    expect(session.title).toBe("Sunday Smash");
    expect(session.location).toBe("The Cage");
    expect(session.dateText).toBe("");
    expect(rounds.map((r) => r.resting)).toEqual([[4], [3]]);
    expect(rounds[1]).toMatchObject({ startMin: 20, endMin: 40 });
  });

  it("rejects a PDF that isn't a rotation", () => {
    expect(() => parsePdfText([["Invoice", "Total", "R 450.00"]])).toThrow(ImportError);
  });

  it("rejects a round that doesn't add up", () => {
    const broken = structuredClone(twoCourts);
    broken[0][13] = "Ann & Gus"; // Ann twice in round 1
    expect(() => parsePdfText(broken)).toThrow(/Round 1/);
  });
});

describe("tokensFromItems", () => {
  it("joins letter-spaced pieces on one line and leaves normal text alone", () => {
    const items = [
      { str: "M O N", y: 586 },
      { str: "1 9", y: 586 },
      { str: "O C T", y: 586 },
      { str: "·", y: 586 },
      { str: "C L U B", y: 586 },
      { str: "Padel Rotation", y: 560 },
      { str: "R O U N D 1", y: 480 },
      { str: "17:00 – 17:15", y: 480 },
      { str: "Ann & Ben", y: 460 },
      { str: "V S", y: 449 },
      { str: "", y: 440 },
    ];
    expect(tokensFromItems(items)).toEqual([
      "MON 19 OCT · CLUB",
      "Padel Rotation",
      "ROUND1",
      "17:00 – 17:15",
      "Ann & Ben",
      "VS",
    ]);
  });
});
