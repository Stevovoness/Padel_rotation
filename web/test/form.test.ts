import { describe, expect, it } from "vitest";
import {
  collect,
  dateText,
  remember,
  slugify,
  suggestions,
  summaryLine,
  type FormState,
} from "../src/form/validate";

const base: FormState = {
  location: "Club One",
  dateIso: "2026-10-19",
  title: "Padel Rotation",
  start: "17:00",
  minutes: "90",
  courts: "2",
  nPlayers: "8",
  autoRounds: true,
  rounds: "6",
  seed: "",
  names: ["Ann", "Ben", "Cara", "Dan", "Eve", "Finn", "Gus", "Hana"],
};

const error = (patch: Partial<FormState>) => {
  const r = collect({ ...base, ...patch });
  return "error" in r ? r.error : null;
};

describe("collect", () => {
  it("builds a session from a good form", () => {
    const r = collect(base);
    expect("session" in r && r.session).toEqual({
      players: base.names,
      minutes: 90,
      nRounds: 6,
      courts: 2,
      start: "17:00",
      title: "Padel Rotation",
      dateText: "Mon 19 Oct",
      location: "Club One",
    });
  });

  it("gives the Windows app's messages", () => {
    expect(error({ courts: "9" })).toBe("Courts must be a number from 1 to 8.");
    expect(error({ nPlayers: "3" })).toBe("Players must be a number from 4 to 32.");
    expect(error({ minutes: "10" })).toBe("Minutes must be a number from 15 to 300.");
    expect(error({ names: ["Ann", "Ben", "ann", "Dan", "Eve", "Finn", "Gus", "Hana"] })).toBe(
      "Duplicate name 'ann' - everyone needs a unique name.",
    );
    expect(error({ names: ["Ann", "", "Cara", "Dan", "Eve", "Finn", "Gus", ""] })).toBe(
      "Enter all 8 player names - 2 names still empty.",
    );
    expect(error({ nPlayers: "7", names: base.names.slice(0, 7) })).toBe(
      "2 courts need at least 8 players, got 7 - add 1 more.",
    );
    expect(error({ autoRounds: false, rounds: "0" })).toBe("Rounds must be a number from 1 to 40, or tick auto.");
    expect(error({ seed: "abc" })).toBe("Seed must be a whole number, or leave it blank for a new rotation.");
  });

  it("allows no start time and no date", () => {
    const r = collect({ ...base, start: "", dateIso: "" });
    expect("session" in r && [r.session.start, r.session.dateText]).toEqual([null, ""]);
  });

  it("uses a typed seed and manual rounds", () => {
    const r = collect({ ...base, seed: " 42 ", autoRounds: false, rounds: "5" });
    expect("session" in r && [r.seed, r.session.nRounds]).toEqual([42, 5]);
  });
});

describe("summaryLine", () => {
  it("matches the Windows app's line", () => {
    const r = collect(base);
    expect("session" in r && summaryLine(r.session)).toBe(
      "8 players  ·  2 courts  ·  6 rounds × 15 min  ·  everyone plays 6  ·  nobody rests",
    );
    const seven = collect({
      ...base,
      courts: "1",
      nPlayers: "7",
      names: base.names.slice(0, 7),
    });
    expect("session" in seven && summaryLine(seven.session)).toBe(
      "7 players  ·  1 court  ·  7 rounds × 12.9 min  ·  everyone plays 4  ·  3 resting each round",
    );
  });
});

describe("helpers", () => {
  it("formats the date as on the PDF", () => {
    expect(dateText("2026-09-05")).toBe("Sat 05 Sep");
    expect(dateText("")).toBe("");
  });

  it("remembers most recent first, without duplicates", () => {
    expect(remember(["Ann", "Ben"], ["ben", " Cara ", ""])).toEqual(["ben", "Cara", "Ann"]);
  });

  it("suggests prefix matches before others", () => {
    const pool = ["Marco", "Tiaan", "Mariska", "Amar", "Mar"];
    expect(suggestions(pool, "mar")).toEqual(["Marco", "Mariska", "Amar"]);
    expect(suggestions(pool, "")).toEqual([]);
  });

  it("slugifies file names", () => {
    expect(slugify("Thrashers, Menlyn")).toBe("thrashers-menlyn");
    expect(slugify("!!!")).toBe("rotation");
  });
});
