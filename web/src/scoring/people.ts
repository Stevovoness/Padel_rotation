/**
 * Who is actually playing in each roster slot.
 *
 * The schedule never changes once made, but the people can: a typo gets fixed
 * (the same person, new spelling) or someone is substituted from a round on
 * (a new person, who gets their own line on the leaderboard).
 */

import type { Segment, Tracker } from "../model";

/** A person is one segment of one slot. */
export interface Person {
  id: string;
  slot: number;
  segment: number;
  name: string;
}

function personOf(slot: number, segment: number, seg: Segment): Person {
  return { id: `${slot}:${segment}`, slot, segment, name: seg.name };
}

/** Whoever holds a slot in a given round. */
export function personAt(people: Segment[][], slot: number, round: number): Person {
  const segments = people[slot];
  let index = 0;
  segments.forEach((seg, i) => {
    if (seg.fromRound <= round) index = i;
  });
  return personOf(slot, index, segments[index]);
}

export function everyone(people: Segment[][]): Person[] {
  return people.flatMap((segments, slot) => segments.map((seg, i) => personOf(slot, i, seg)));
}

/** Same person, corrected name, everywhere they appear. */
export function fixName(tracker: Tracker, slot: number, segment: number, name: string): Tracker {
  const people = tracker.people.map((segments, s) =>
    s === slot ? segments.map((seg, i) => (i === segment ? { ...seg, name } : seg)) : segments,
  );
  return { ...tracker, people };
}

/** A new person takes the slot from `fromRound` on; anyone after that is replaced. */
export function substitute(tracker: Tracker, slot: number, fromRound: number, name: string): Tracker {
  const people = tracker.people.map((segments, s) => {
    if (s !== slot) return segments;
    const kept = segments.filter((seg) => seg.fromRound < fromRound);
    return [...kept, { name, fromRound }];
  });
  return { ...tracker, people };
}

/** Every name in use, lower-cased - to stop two people sharing a name. */
export function namesInUse(people: Segment[][]): Set<string> {
  return new Set(people.flat().map((seg) => seg.name.trim().toLowerCase()));
}
