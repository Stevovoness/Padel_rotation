/**
 * Reading the form, with the same rules and messages as the Windows app
 * (padel_gui.py PadelApp._collect / _on_change, padel.py clean_names /
 * check_roster).
 */

import { COURT_SIZE, MAX_COURTS, MAX_PLAYERS, courtsText, type Session } from "../model";
import { chooseRounds, pyRound, roundMinutes, slotsOf } from "../sched/schedule";

export interface FormState {
  location: string;
  dateIso: string; // "2026-10-19" from the date picker, or ""
  title: string;
  start: string; // "HH:MM" from the time picker, or ""
  minutes: string;
  courts: string;
  nPlayers: string;
  autoRounds: boolean;
  rounds: string;
  seed: string;
  names: string[];
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-19" -> "Mon 19 Oct" (strftime "%a %d %b", as on the PDF). */
export function dateText(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${DAYS[d.getDay()]} ${m[3]} ${MONTHS[d.getMonth()]}`;
}

export function todayIso(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function toInt(text: string, low: number, high: number): number | null {
  const t = text.trim();
  if (!/^[-+]?\d+$/.test(t)) return null;
  const v = Number(t);
  return low <= v && v <= high ? v : null;
}

/** Python's repr() of a string, for the duplicate-name message. */
function pyRepr(s: string): string {
  return s.includes("'") && !s.includes('"') ? `"${s}"` : `'${s.replace(/'/g, "\\'")}'`;
}

/** Strip blanks, reject duplicates. Returns [names, error]. */
export function cleanNames(raw: string[]): [string[], string | null] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (let name of raw) {
    name = name.trim();
    if (!name) continue;
    if (seen.has(name.toLowerCase())) {
      return [names, `duplicate name ${pyRepr(name)} - everyone needs a unique name`];
    }
    seen.add(name.toLowerCase());
    names.push(name);
  }
  return [names, null];
}

/** The one rule that matters: enough players to fill every court. */
export function checkRoster(names: string[], courts: number): string | null {
  const need = COURT_SIZE * courts;
  if (names.length < need) {
    const short = need - names.length;
    const verb = courts === 1 ? "needs" : "need";
    return `${courtsText(courts)} ${verb} at least ${need} players, got ${names.length} - add ${short} more`;
  }
  if (names.length > MAX_PLAYERS) {
    return `that is ${names.length} players; this tops out at ${MAX_PLAYERS}`;
  }
  return null;
}

const sentence = (s: string) => s[0].toUpperCase() + s.slice(1) + ".";

/** The player count to show name boxes for, when the Players field reads cleanly. */
export function wantedPlayers(form: FormState): number | null {
  return toInt(form.nPlayers, 4, MAX_PLAYERS);
}

export type Collected = { session: Session; seed: number | null } | { error: string };

/** Read the form. Names must already be sized to the Players count. */
export function collect(form: FormState): Collected {
  const courts = toInt(form.courts, 1, MAX_COURTS);
  if (courts === null) return { error: `Courts must be a number from 1 to ${MAX_COURTS}.` };

  const wanted = toInt(form.nPlayers, 4, MAX_PLAYERS);
  if (wanted === null) return { error: `Players must be a number from 4 to ${MAX_PLAYERS}.` };

  const minutes = toInt(form.minutes, 15, 300);
  if (minutes === null) return { error: "Minutes must be a number from 15 to 300." };

  const raw = form.names.slice(0, wanted);
  const blanks = raw.filter((n) => !n.trim()).length + Math.max(0, wanted - raw.length);
  const [names, dupError] = cleanNames(raw);
  if (dupError) return { error: sentence(dupError) };
  if (blanks) {
    const word = blanks === 1 ? "name" : "names";
    return { error: `Enter all ${wanted} player names - ${blanks} ${word} still empty.` };
  }

  const rosterError = checkRoster(names, courts);
  if (rosterError) return { error: sentence(rosterError) };

  const start = /^\d{2}:\d{2}$/.test(form.start.trim()) ? form.start.trim() : null;

  let nRounds: number;
  if (form.autoRounds) {
    nRounds = chooseRounds(minutes, names.length, courts);
  } else {
    const r = toInt(form.rounds, 1, 40);
    if (r === null) return { error: "Rounds must be a number from 1 to 40, or tick auto." };
    nRounds = r;
  }

  let seed: number | null = null;
  const rawSeed = form.seed.trim();
  if (rawSeed) {
    if (!/^[-+]?\d+$/.test(rawSeed)) {
      return { error: "Seed must be a whole number, or leave it blank for a new rotation." };
    }
    seed = Number(rawSeed);
  }

  return {
    session: {
      players: names,
      minutes,
      nRounds,
      courts,
      start,
      title: form.title.trim() || "Padel Rotation",
      dateText: dateText(form.dateIso),
      location: form.location.trim(),
    },
    seed,
  };
}

/** The line under the roster: "8 players · 2 courts · 6 rounds × 15 min · everyone plays 6 · nobody rests". */
export function summaryLine(session: Session): string {
  const n = session.players.length;
  const slots = slotsOf(session);
  const total = session.nRounds * slots;
  const base = Math.floor(total / n);
  const extra = total % n;
  const fairness = extra === 0 ? `everyone plays ${base}` : `${extra} play ${base + 1}, the rest play ${base}`;
  const length = roundMinutes(session);
  const lengthText =
    Math.abs(length - pyRound(length)) < 0.05 ? String(pyRound(length)) : pyFixed1(length);
  const resting = n - slots;
  const restText = resting === 0 ? "nobody rests" : `${resting} resting each round`;
  return `${n} players  ·  ${courtsText(session.courts)}  ·  ${session.nRounds} rounds × ${lengthText} min  ·  ${fairness}  ·  ${restText}`;
}

/** Python's f"{x:.1f}" - exact ties go to the even digit. */
function pyFixed1(x: number): string {
  return (pyRound(x * 10) / 10).toFixed(1);
}

// --------------------------------------------------------------------------
// remembering names and places (padel_gui.py remember / _matches)
// --------------------------------------------------------------------------

export const MAX_HISTORY = 200;
export const MAX_SUGGESTIONS = 6;

/** Most recently used first, case-insensitive de-dupe, capped. */
export function remember(existing: string[], fresh: string[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const value of [...fresh.map((v) => v.trim()), ...existing]) {
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    merged.push(value);
  }
  return merged.slice(0, MAX_HISTORY);
}

/** Past values that start with the text first, then ones that contain it. */
export function suggestions(pool: string[], text: string): string[] {
  if (!text) return [];
  const low = text.toLowerCase();
  const rest = pool.filter((v) => v.toLowerCase() !== low); // nothing to suggest once it matches
  const starts = rest.filter((v) => v.toLowerCase().startsWith(low));
  const contains = rest.filter((v) => v.toLowerCase().includes(low) && !starts.includes(v));
  return [...starts, ...contains].slice(0, MAX_SUGGESTIONS);
}

export function slugify(text: string): string {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "rotation";
}
