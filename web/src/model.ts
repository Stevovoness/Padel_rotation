/**
 * The shapes everything else passes around. They mirror padel.py's Session,
 * Match and Round so the scheduler port and the PDF importer agree.
 */

export const COURT_SIZE = 4; // players on one padel court
export const MAX_PLAYERS = 32;
export const MAX_COURTS = 8;

export interface Session {
  players: string[];
  minutes: number;
  nRounds: number;
  courts: number;
  /** "HH:MM", or null when the PDF shows minutes from the start instead of clock times */
  start: string | null;
  title: string;
  dateText: string;
  location: string;
}

export interface Match {
  court: number; // 1-based, as printed on the PDF
  teamA: number[]; // indices into session.players
  teamB: number[];
}

export interface Round {
  number: number;
  matches: Match[];
  resting: number[];
  startMin: number;
  endMin: number;
}

/** Points for team A and team B; null until typed in. */
export type Score = [number | null, number | null];

/**
 * Who holds a roster slot from a given round on. A slot starts with one
 * segment; a substitution adds another, and each segment is its own person
 * on the leaderboard.
 */
export interface Segment {
  name: string;
  fromRound: number;
}

/** The one session the app keeps: the schedule plus whatever has been scored. */
export interface Tracker {
  version: 1;
  session: Session;
  rounds: Round[];
  /** keyed by scoreKey(round, court) */
  scores: Record<string, Score>;
  /** people[slot] - the segments for that roster slot, oldest first */
  people: Segment[][];
}

export function scoreKey(round: number, court: number): string {
  return `${round}-${court}`;
}

export function newTracker(session: Session, rounds: Round[]): Tracker {
  return {
    version: 1,
    session,
    rounds,
    scores: {},
    people: session.players.map((name) => [{ name, fromRound: 1 }]),
  };
}

export function hasScores(tracker: Tracker): boolean {
  return Object.values(tracker.scores).some(([a, b]) => a !== null || b !== null);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Like padel.clock: the start time plus some minutes, as HH:MM. */
export function clock(start: string, minute: number): string {
  const [h, m] = start.split(":").map(Number);
  const total = (((h * 60 + m + minute) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** Like padel.slot_label: "08:00 – 08:15", or "0–15 min" without a start time. */
export function slotLabel(session: Session, round: Round): string {
  if (session.start) {
    return `${clock(session.start, round.startMin)} – ${clock(session.start, round.endMin)}`;
  }
  return `${round.startMin}–${round.endMin} min`;
}

export function courtsText(courts: number): string {
  return courts === 1 ? "1 court" : `${courts} courts`;
}
