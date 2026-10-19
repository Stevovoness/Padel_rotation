/**
 * Everything the app saves goes through here, and nothing else touches
 * storage. Today that is localStorage on this one phone; swapping in a shared
 * database later means changing only this file.
 *
 * Storage can be missing or throw (private browsing, blocked site data), so
 * every access is guarded and the app carries on without it.
 */

import type { Tracker } from "./model";

const CURRENT_KEY = "padel.current.v1";
const HISTORY_KEY = "padel.history.v1";
const QUEUE_KEY = "padel.queue.v1";

export interface History {
  players: string[];
  locations: string[];
  last: Record<string, unknown>;
}

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // a full or blocked storage should never break the app
  }
}

export function loadCurrent(): Tracker | null {
  const data = read(CURRENT_KEY) as Tracker | null;
  if (!data || data.version !== 1 || !Array.isArray(data.rounds) || !data.session) {
    return null;
  }
  return data;
}

export function saveCurrent(tracker: Tracker): void {
  write(CURRENT_KEY, tracker);
}

export function clearCurrent(): void {
  try {
    localStorage.removeItem(CURRENT_KEY);
  } catch {
    // nothing to clear
  }
}

export function loadHistory(): History {
  const blank: History = { players: [], locations: [], last: {} };
  const data = read(HISTORY_KEY) as Partial<History> | null;
  if (!data || typeof data !== "object") return blank;
  const strings = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return {
    players: strings(data.players),
    locations: strings(data.locations),
    last: data.last && typeof data.last === "object" ? data.last : {},
  };
}

export function saveHistory(history: History): void {
  write(HISTORY_KEY, history);
}

/** Edits waiting to reach the shared scoreboard (kept across reloads, for bad signal). */
export function loadQueue<T>(): T[] {
  const data = read(QUEUE_KEY);
  return Array.isArray(data) ? (data as T[]) : [];
}

export function saveQueue<T>(queue: T[]): void {
  write(QUEUE_KEY, queue);
}
