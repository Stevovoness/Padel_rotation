/**
 * Turn the text of a Padel Rotation PDF back into a schedule.
 *
 * Works on PDFs from the Python app (padel.py) and from this web app, which
 * draw the same strings in the same order:
 *
 *   page 1    eyebrow "MON 19 OCT · VENUE", title, two summary lines, cards
 *   page 2+   "TITLE · CONTINUED", cards
 *   a card    "ROUND n", "17:00 – 17:15" | "0–15 min",
 *             per match: ["COURT n"], "A  &  B", "VS", "C  &  D",
 *             then optionally "RESTING", "X  ·  Y  ·  Z" (may wrap)
 *   glance    "AT A GLANCE", ... "PLAYS", name, cells..., plays, name, ... "Team 1"
 *   footer    "Title · 90 min · 2 courts", "p/N" on every page
 *
 * Card names can be shortened with "…" when they are too wide, so the full
 * roster comes from the at-a-glance page and card names are matched to it.
 */

import { COURT_SIZE, type Match, type Round, type Session } from "../model";

export class ImportError extends Error {}

const NOT_OURS =
  "This doesn't look like a Padel Rotation PDF. Pick a PDF made by the Padel Rotation app.";

// letter-spaced labels can lose their word gap in extraction: "ROUND1"
const ROUND_RE = /^ROUND\s*(\d+)$/;
const COURT_RE = /^COURT\s*(\d+)$/;
const CLOCK_RE = /^(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})$/;
const RELATIVE_RE = /^(\d+)\s*[–-]\s*(\d+)\s*min$/;
const PAGE_RE = /^\d+\/\d+$/;
const FOOTER_RE = /^(.*)\s+·\s+(\d+)\s+min\s+·\s+(\d+)\s+courts?$/;
const ELLIPSIS = "…";

interface RawMatch {
  court: number;
  teamA: string[];
  teamB: string[];
}

interface RawRound {
  number: number;
  label: string;
  matches: RawMatch[];
}

/** One run of text as pdf.js reports it, with its baseline. */
export interface TextItem {
  str: string;
  y: number;
}

/** "R O U N D" - the way pdf.js reports text drawn with letter spacing. */
function isSpacedOut(s: string): boolean {
  return /^\S( \S)+$/.test(s);
}

/**
 * Rebuild the strings the PDF actually drew.
 *
 * Letter-spaced labels (the eyebrow, ROUND n, COURT n, VS, RESTING, banners)
 * come out of pdf.js one word at a time with a space between every letter:
 * "M O N", "1 9", "O C T", "·", ... Consecutive pieces on the same baseline
 * are joined and the letter gaps squeezed out: "MON 19 OCT · ...".
 */
export function tokensFromItems(items: TextItem[]): string[] {
  const tokens: string[] = [];
  let run: string[] = [];
  let runY = NaN;

  const flush = () => {
    if (run.length) tokens.push(run.join(" "));
    run = [];
  };

  const live = items.map((i) => ({ s: i.str.trim(), y: i.y })).filter((i) => i.s);
  live.forEach((item, k) => {
    const { s } = item;
    const spaced = isSpacedOut(s);
    const sameLine = Math.abs(item.y - runY) < 0.5;
    if (run.length && sameLine && (spaced || s.length === 1)) {
      run.push(spaced ? s.replace(/ /g, "") : s);
      return;
    }
    flush();
    // a lone character opens a run only when spaced-out text follows on its
    // line: the "1" of "1 COURT · ROTATION", not a grid cell next to a name
    const next = live[k + 1];
    const opensRun = s.length === 1 && next && Math.abs(next.y - item.y) < 0.5 && isSpacedOut(next.s);
    if (spaced || opensRun) {
      run = [s.replace(/ /g, "")];
      runY = item.y;
    } else {
      tokens.push(s);
    }
  });
  flush();
  return tokens;
}

function splitTeam(text: string): string[] {
  return text.split(/\s+&\s+/).map((s) => s.trim()).filter(Boolean);
}

function titleCase(text: string): string {
  return text.toLowerCase().replace(/(^|[\s,(/-])(\p{L})/gu, (_m, sep, ch) => sep + ch.toUpperCase());
}

/** Strip each page's footer, remembering the first one for the metadata. */
function splitFooters(pages: string[][]): { body: string[][]; footer: string | null } {
  let footer: string | null = null;
  const body = pages.map((tokens) => {
    const t = [...tokens];
    if (t.length && PAGE_RE.test(t[t.length - 1])) {
      t.pop();
      const candidate = t.pop() ?? "";
      if (footer === null && FOOTER_RE.test(candidate)) footer = candidate;
    }
    return t;
  });
  return { body, footer };
}

function readRoster(pages: string[][]): string[] {
  const names: string[] = [];
  for (const tokens of pages) {
    const head = tokens.indexOf("PLAYS");
    if (head < 0) continue;
    for (const token of tokens.slice(head + 1)) {
      if (token === "Team 1") break;
      if (/^\d+$/.test(token)) continue; // a court number in a cell, or the plays count
      names.push(token);
    }
  }
  return names;
}

function readRounds(tokens: string[]): RawRound[] {
  const rounds: RawRound[] = [];
  let current: RawRound | null = null;
  let court = 1;
  let pendingA: string[] | null = null;
  let inResting = false;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.replace(/\s/g, "").startsWith("ATAGLANCE")) break;

    const round = ROUND_RE.exec(token);
    if (round) {
      current = { number: Number(round[1]), label: tokens[i + 1] ?? "", matches: [] };
      rounds.push(current);
      court = 1;
      pendingA = null;
      inResting = false;
      i += 1; // the time label
      continue;
    }
    if (!current) continue; // the hero or a continued banner

    if (/·\s*CONTINUED$/.test(token)) continue;
    if (token === "RESTING") {
      inResting = true;
      continue;
    }
    if (inResting) continue; // resting names come from the roster instead

    const courtMatch = COURT_RE.exec(token);
    if (courtMatch) {
      court = Number(courtMatch[1]);
      continue;
    }
    if (token === "VS") continue;
    if (token.includes("&")) {
      const team = splitTeam(token);
      if (pendingA === null) {
        pendingA = team;
      } else {
        current.matches.push({ court, teamA: pendingA, teamB: team });
        pendingA = null;
      }
    }
  }
  return rounds;
}

/** Match a card name, possibly cut short with "…", to one roster entry. */
function resolve(name: string, roster: string[]): number {
  const exact = roster.findIndex((r) => r === name);
  if (exact >= 0) return exact;

  const stem = (s: string) => (s.endsWith(ELLIPSIS) ? s.slice(0, -1) : s).trim().toLowerCase();
  const target = stem(name);
  const hits = roster
    .map((r, i) => ({ r: stem(r), i }))
    .filter(({ r }) => r.startsWith(target) || target.startsWith(r));
  if (hits.length === 1) return hits[0].i;
  throw new ImportError(`Couldn't work out who "${name}" is on the schedule.`);
}

/**
 * The glance column is narrow, so a long name can be cut short there while a
 * round card still shows it whole. Use the whole one where there is one.
 */
function fillTruncated(roster: string[], rounds: RawRound[]): string[] {
  const whole = new Set(
    rounds.flatMap((r) => r.matches.flatMap((m) => [...m.teamA, ...m.teamB])).filter((n) => !n.endsWith(ELLIPSIS)),
  );
  return roster.map((name) => {
    if (!name.endsWith(ELLIPSIS)) return name;
    const stem = name.slice(0, -1).trim();
    const hits = [...whole].filter((n) => n.startsWith(stem));
    return hits.length === 1 ? hits[0] : name;
  });
}

function readEyebrow(eyebrow: string): { dateText: string; location: string } {
  if (/^\d+\s*COURTS?\s*·\s*ROTATION$/.test(eyebrow)) return { dateText: "", location: "" };
  const parts = eyebrow.split(/\s+·\s+/);
  if (parts.length >= 2) {
    return { dateText: titleCase(parts[0]), location: titleCase(parts.slice(1).join(" · ")) };
  }
  const looksLikeDate = /^(MON|TUE|WED|THU|FRI|SAT|SUN)\b|^\d/.test(eyebrow);
  return looksLikeDate
    ? { dateText: titleCase(eyebrow), location: "" }
    : { dateText: "", location: titleCase(eyebrow) };
}

function toMinutes(h: string, m: string): number {
  return Number(h) * 60 + Number(m);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function parsePdfText(pages: string[][]): { session: Session; rounds: Round[] } {
  const { body, footer } = splitFooters(pages.map((p) => p.map((s) => s.trim()).filter(Boolean)));
  if (!footer || !body.length) throw new ImportError(NOT_OURS);

  const [, title, minutesText] = FOOTER_RE.exec(footer)!;
  const minutes = Number(minutesText);

  const raw = readRounds(body.flat());
  const roster = fillTruncated(readRoster(body), raw);
  if (!roster.length || !raw.length) throw new ImportError(NOT_OURS);

  const courts = Math.max(...raw.flatMap((r) => r.matches.map((m) => m.court)));

  // times: clock labels give the start, relative labels give minutes directly
  const first = CLOCK_RE.exec(raw[0].label);
  const start = first ? `${pad(Number(first[1]))}:${first[2]}` : null;
  const startAbs = first ? toMinutes(first[1], first[2]) : 0;

  const rounds: Round[] = raw.map((r) => {
    let startMin: number;
    let endMin: number;
    const c = CLOCK_RE.exec(r.label);
    const rel = RELATIVE_RE.exec(r.label);
    if (c) {
      startMin = (toMinutes(c[1], c[2]) - startAbs + 1440) % 1440;
      endMin = (toMinutes(c[3], c[4]) - startAbs + 1440) % 1440 || 1440;
    } else if (rel) {
      startMin = Number(rel[1]);
      endMin = Number(rel[2]);
    } else {
      throw new ImportError(NOT_OURS);
    }

    const matches: Match[] = r.matches.map((m) => ({
      court: m.court,
      teamA: m.teamA.map((n) => resolve(n, roster)),
      teamB: m.teamB.map((n) => resolve(n, roster)),
    }));

    const playing = new Set(matches.flatMap((m) => [...m.teamA, ...m.teamB]));
    const seats = matches.reduce((n, m) => n + m.teamA.length + m.teamB.length, 0);
    if (matches.length !== courts || seats !== courts * COURT_SIZE || playing.size !== seats) {
      throw new ImportError(`Round ${r.number} on the PDF didn't read cleanly.`);
    }

    return {
      number: r.number,
      matches,
      resting: roster.map((_, i) => i).filter((i) => !playing.has(i)),
      startMin,
      endMin,
    };
  });

  rounds.forEach((r, i) => {
    if (r.number !== i + 1) throw new ImportError(NOT_OURS);
  });

  const eyebrow = body[0][0] ?? "";
  const { dateText, location } = readEyebrow(eyebrow);

  return {
    session: {
      players: roster,
      minutes,
      nRounds: rounds.length,
      courts,
      start,
      title,
      dateText,
      location,
    },
    rounds,
  };
}
