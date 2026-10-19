/**
 * Shared scoring over Supabase.
 *
 * Every edit lands on this phone first (the app never waits for the network),
 * then joins a queue that survives reloads and bad signal. The queue drains to
 * the database functions in supabase/shared-scoring.sql; each sent edit is
 * also broadcast on the session's realtime channel so the other phones update
 * at once. Whenever a phone (re)connects it pulls the whole session, which
 * covers anything it missed.
 */

import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import type { Tracker } from "../model";
import { loadQueue, saveQueue } from "../store";
import {
  applyPeople,
  applyScore,
  diffLocal,
  fingerprint,
  mergeSnapshot,
  newSessionId,
  opKey,
  trackerFromSnapshot,
  type Op,
  type Unsent,
  type Snapshot,
} from "./merge";

export type SyncStatus = "off" | "live" | "syncing" | "offline";

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

interface Host {
  get(): Tracker | null;
  set(tracker: Tracker): void;
  onStatus(status: SyncStatus): void;
}


/**
 * A Postgres or PostgREST error: retrying the same edit won't help. A missing
 * function (PGRST202 - the database isn't set up yet) is worth retrying.
 */
function permanent(error: { code?: string } | null): boolean {
  return !!error?.code && error.code !== "PGRST202" && /^([0-9A-Z]{5}|PGRST\d+)$/.test(error.code);
}

export class Sync {
  private client: SupabaseClient | null = URL && KEY ? createClient(URL, KEY) : null;
  private queue: Op[] = loadQueue<Op>();
  private seq = Math.max(0, ...this.queue.map((op) => op.seq));
  private channel: RealtimeChannel | null = null;
  private channelId: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private offline = false;

  constructor(private host: Host) {
    if (!this.client) return;
    window.addEventListener("online", () => {
      this.offline = false;
      this.flushSoon(0);
      void this.refresh();
    });
    window.addEventListener("offline", () => this.report(true));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        this.flushSoon(0);
        void this.refresh();
      }
    });
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  // ------------------------------------------------------------------------
  // what the app calls
  // ------------------------------------------------------------------------

  /**
   * Share the current session: give it a code, send it with anything already
   * scored, and follow it. If the same schedule is already shared (the same
   * PDF on another phone), the server hands back that one and we join it.
   */
  async share(): Promise<void> {
    const before = this.host.get();
    if (!this.client || !before || before.shared) return;
    const fp = await fingerprint(before.session, before.rounds);
    const latest = this.host.get(); // scores may have been typed meanwhile
    if (!latest || latest.shared || latest.session !== before.session) return;
    const shared: Tracker = { ...latest, shared: { id: newSessionId(), fingerprint: fp } };
    this.host.set(shared);
    this.resend(shared);
    this.watch();
  }

  /** Record a local edit; returns the tracker with that edit stamped. */
  local(prev: Tracker, next: Tracker): Tracker {
    if (!this.client) return next;
    const { tracker, ops } = diffLocal(prev, next, new Date().toISOString());
    for (const op of ops) this.enqueue(op);
    return tracker;
  }

  /** Open a session from its link. Null if there's no such session (wrong or expired link). */
  async join(id: string): Promise<Tracker | null> {
    if (!this.client) return null;
    const { data, error } = await this.client.rpc("get_session", { p_id: id });
    if (error) throw new Error(error.message);
    return data ? trackerFromSnapshot(data as Snapshot) : null;
  }

  /** Follow the current session: listen for other phones and catch up. */
  watch(): void {
    if (!this.client) return;
    const id = this.host.get()?.shared?.id ?? null;
    if (id !== this.channelId) {
      if (this.channel) void this.client.removeChannel(this.channel);
      this.channel = null;
      this.channelId = id;
      if (id) {
        this.channel = this.client
          .channel(`padel:${id}`, { config: { broadcast: { self: false } } })
          .on("broadcast", { event: "op" }, ({ payload }) => this.receive(payload as Op))
          .subscribe((status) => {
            if (status === "SUBSCRIBED") void this.refresh();
          });
      }
    }
    this.flushSoon(0);
    this.report();
  }

  shareLink(tracker: Tracker): string | null {
    return tracker.shared ? `${location.origin}/?s=${tracker.shared.id}` : null;
  }

  // ------------------------------------------------------------------------
  // the queue
  // ------------------------------------------------------------------------

  private enqueue(op: Unsent): void {
    const full = { ...op, seq: ++this.seq } as Op;
    const key = opKey(full);
    // a newer edit to the same score replaces one still waiting (typing "1" then "14")
    this.queue = this.queue.filter((q, i) => !(q.id === full.id && opKey(q) === key && !(i === 0 && this.flushing)));
    this.queue.push(full);
    saveQueue(this.queue);
    this.report();
    this.flushSoon(400);
  }

  private flushSoon(delay: number): void {
    if (!this.client) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), delay);
  }

  private async flush(): Promise<void> {
    if (!this.client || this.flushing) return;
    this.flushing = true;
    try {
      while (this.queue.length) {
        const op = this.queue[0];
        const { error, retry } = await this.send(op);
        if (retry) {
          this.report(true);
          this.flushSoon(5000);
          return;
        }
        if (error) console.warn("Dropped an edit the server refused", op, error);
        this.queue = this.queue.filter((q) => q.seq !== op.seq);
        saveQueue(this.queue);
        if (!error && op.kind !== "create") this.broadcast(op);
      }
      this.offline = false;
    } finally {
      this.flushing = false;
      this.report();
    }
  }

  private async send(op: Op): Promise<{ error: unknown; retry: boolean }> {
    const client = this.client!;
    try {
      let result;
      if (op.kind === "create") {
        result = await client.rpc("create_session", {
          p_id: op.id,
          p_fingerprint: op.fingerprint,
          p_schedule: op.schedule,
        });
        if (!result.error && typeof result.data === "string" && result.data !== op.id) {
          this.rebind(op.id, result.data);
        }
      } else if (op.kind === "score") {
        result = await client.rpc("set_score", {
          p_id: op.id,
          p_round: op.round,
          p_court: op.court,
          p_a: op.a,
          p_b: op.b,
          p_at: op.at,
        });
      } else {
        result = await client.rpc("set_people", {
          p_id: op.id,
          p_slot: op.slot,
          p_segments: op.segments,
          p_at: op.at,
        });
      }
      if (!result.error) return { error: null, retry: false };
      return { error: result.error, retry: !permanent(result.error) };
    } catch (exc) {
      return { error: exc, retry: true }; // the network, not the server
    }
  }

  /**
   * Someone else already shared this exact schedule (the same PDF): move to
   * their scoreboard, taking along anything entered here.
   */
  private rebind(from: string, to: string): void {
    this.queue = this.queue.map((op) => (op.id === from ? { ...op, id: to } : op));
    saveQueue(this.queue);
    const t = this.host.get();
    if (t?.shared?.id === from) {
      this.host.set({ ...t, shared: { ...t.shared, id: to } });
      this.watch();
    }
  }

  // ------------------------------------------------------------------------
  // other phones
  // ------------------------------------------------------------------------

  private pending(id: string): Set<string> {
    return new Set(this.queue.filter((op) => op.id === id).map(opKey));
  }

  private broadcast(op: Op): void {
    if (this.channel && this.channelId === op.id) {
      void this.channel.send({ type: "broadcast", event: "op", payload: op });
    }
  }

  private receive(op: Op): void {
    const t = this.host.get();
    if (!t?.shared || op.id !== t.shared.id) return;
    const pending = this.pending(op.id);
    const next =
      op.kind === "score" ? applyScore(t, op, pending) : op.kind === "people" ? applyPeople(t, op, pending) : t;
    if (next !== t) this.host.set(next);
  }

  /** Pull the whole session and fold it in. */
  private async refresh(): Promise<void> {
    const t = this.host.get();
    if (!this.client || !t?.shared) return;
    const id = t.shared.id;
    if (this.queue.some((op) => op.kind === "create" && op.id === id)) return; // not on the server yet
    try {
      const { data, error } = await this.client.rpc("get_session", { p_id: id });
      if (error) return;
      const now = this.host.get();
      if (now?.shared?.id !== id) return;
      if (!data) {
        this.resend(now); // gone from the server (expired): put it back
        return;
      }
      const merged = mergeSnapshot(now, data as Snapshot, this.pending(id));
      if (merged !== now) this.host.set(merged);
    } catch {
      this.report(true);
    }
  }

  /** Send a session and everything entered in it (first share, or after it expired). */
  private resend(t: Tracker): void {
    const id = t.shared!.id;
    const at = new Date().toISOString();
    const stampOf = (key: string) => t.stamps?.[key] ?? at;
    this.enqueue({ kind: "create", id, fingerprint: t.shared!.fingerprint, schedule: this.scheduleOf(t) });
    for (const [key, [a, b]] of Object.entries(t.scores)) {
      const [round, court] = key.split("-").map(Number);
      this.enqueue({ kind: "score", id, round, court, a, b, at: stampOf(`s:${key}`) });
    }
    // only roster slots that were actually changed - untouched names are in the schedule
    t.people.forEach((segments, slot) => {
      const original = [{ name: t.session.players[slot], fromRound: 1 }];
      if (JSON.stringify(segments) !== JSON.stringify(original)) {
        this.enqueue({ kind: "people", id, slot, segments, at: stampOf(`p:${slot}`) });
      }
    });
  }

  private scheduleOf(t: Tracker) {
    return {
      session: t.session,
      rounds: t.rounds,
      ...(t.seed !== undefined ? { seed: t.seed } : {}),
      fingerprint: t.shared!.fingerprint,
    };
  }

  // ------------------------------------------------------------------------
  // status
  // ------------------------------------------------------------------------

  private report(offline?: boolean): void {
    if (offline !== undefined) this.offline = offline;
    const t = this.host.get();
    let status: SyncStatus;
    if (!this.client || !t?.shared) status = "off";
    else if (this.offline || !navigator.onLine) status = "offline";
    else if (this.queue.length) status = "syncing";
    else status = "live";
    this.host.onStatus(status);
  }
}
