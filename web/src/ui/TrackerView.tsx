import { Fragment } from "preact";
import { useState } from "preact/hooks";
import { courtsText, scoreKey, slotLabel, type Score, type Tracker } from "../model";
import { personAt } from "../scoring/people";
import { scoredMatches } from "../scoring/leaderboard";
import { pdfFile, sharePdf } from "../generate";
import type { SyncStatus } from "../sync/engine";
import { Header } from "./Header";
import { Leaderboard } from "./Leaderboard";
import { RenameSheet, type RenameTarget } from "./RenameSheet";

interface Props {
  tracker: Tracker;
  /** what was just generated, e.g. "padel-club.pdf · 4 pages · seed 123" */
  notice?: string;
  status: SyncStatus;
  /** the link that opens this scoreboard on another phone */
  link: string | null;
  onChange: (next: Tracker) => void;
  onHome: () => void;
}

const STATUS_TEXT: Record<SyncStatus, string> = {
  off: "",
  live: "Live · scores shared",
  syncing: "Saving…",
  offline: "Offline · will sync",
};

async function invite(link: string, title: string, flash: (text: string) => void): Promise<void> {
  const text = `🎾 Keep score with us for ${title}: tap to open the live scoreboard`;
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url: link });
      return;
    } catch (exc) {
      if ((exc as DOMException).name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(link);
    flash("Link copied - paste it into WhatsApp");
  } catch {
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${link}`)}`, "_blank");
  }
}

/** The PDF this app made for the session, with any corrected spellings. */
function shareAgain(tracker: Tracker): void {
  const players = tracker.people.map((segments) => segments[0].name);
  const { file } = pdfFile({ ...tracker.session, players }, tracker.rounds, tracker.seed!);
  void sharePdf(file);
}

type Tab = "schedule" | "board";

function readScore(text: string): number | null {
  const digits = text.replace(/\D/g, "").slice(0, 3);
  return digits === "" ? null : Number(digits);
}

export function TrackerView({ tracker, notice, status, link, onChange, onHome }: Props) {
  const [tab, setTab] = useState<Tab>("schedule");
  const [toast, setToast] = useState("");
  const flash = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(""), 2600);
  };
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);
  const { session, rounds } = tracker;

  const setScore = (round: number, court: number, side: 0 | 1, text: string) => {
    const key = scoreKey(round, court);
    const score: Score = [...(tracker.scores[key] ?? [null, null])] as Score;
    score[side] = readScore(text);
    onChange({ ...tracker, scores: { ...tracker.scores, [key]: score } });
  };

  const totalMatches = rounds.length * session.courts;
  const done = scoredMatches(tracker).length;
  const where = [session.dateText, session.location].filter(Boolean).join(" · ");

  return (
    <div class="page">
      <Header
        title={session.title}
        subtitle={where || `${session.players.length} players · ${courtsText(session.courts)}`}
        left={
          <button class="back" onClick={onHome} aria-label="Home">
            ‹
          </button>
        }
      />
      <nav class="tabs">
        <button class={tab === "schedule" ? "tab on" : "tab"} onClick={() => setTab("schedule")}>
          Schedule
        </button>
        <button class={tab === "board" ? "tab on" : "tab"} onClick={() => setTab("board")}>
          Leaderboard
        </button>
      </nav>
      {status !== "off" && link && (
        <div class={`live-bar ${status}`}>
          <span class="dot" />
          <span class="live-text">{STATUS_TEXT[status]}</span>
          <button class="btn ghost small-btn" onClick={() => void invite(link, session.title, flash)}>
            Invite
          </button>
        </div>
      )}
      {toast && <div class="toast top-toast">{toast}</div>}

      {tab === "schedule" ? (
        <main class="body cards">
          {tracker.seed !== undefined && (
            <div class="pdf-bar">
              <span class="muted small">{notice || `Seed ${tracker.seed}`}</span>
              <button class="btn ghost small-btn" onClick={() => shareAgain(tracker)}>
                Share PDF
              </button>
            </div>
          )}
          <p class="muted progress">
            {done} of {totalMatches} matches scored · tap a name to fix it or bring on a sub
          </p>
          {rounds.map((round) => (
            <article class="card" key={round.number}>
              <div class="card-head">
                <span class="pill">ROUND {round.number}</span>
                <span class="slot">{slotLabel(session, round)}</span>
              </div>
              {round.matches.map((match, i) => {
                const score = tracker.scores[scoreKey(round.number, match.court)] ?? [null, null];
                const team = (slots: number[], side: 0 | 1) => (
                  <div class="team">
                    <span class={side === 0 ? "bar a" : "bar b"} />
                    <span class="names">
                      {slots.map((slot, j) => {
                        const person = personAt(tracker.people, slot, round.number);
                        return (
                          <Fragment key={slot}>
                            {j > 0 && <span class="amp"> & </span>}
                            <button
                              class="name"
                              onClick={() => setRenaming({ slot, round: round.number })}
                            >
                              {person.name}
                            </button>
                          </Fragment>
                        );
                      })}
                    </span>
                    <input
                      class="score"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="–"
                      aria-label={`Round ${round.number} court ${match.court} team ${side + 1} points`}
                      value={score[side] ?? ""}
                      onInput={(e) =>
                        setScore(round.number, match.court, side, (e.currentTarget as HTMLInputElement).value)
                      }
                    />
                  </div>
                );
                return (
                  <div class="match" key={match.court}>
                    {i > 0 && <hr class="rule" />}
                    {session.courts > 1 && <div class="court">COURT {match.court}</div>}
                    {team(match.teamA, 0)}
                    <div class="vs">VS</div>
                    {team(match.teamB, 1)}
                  </div>
                );
              })}
              {round.resting.length > 0 && (
                <div class="resting">
                  <span class="resting-label">RESTING</span>
                  <span>
                    {round.resting
                      .map((slot) => personAt(tracker.people, slot, round.number).name)
                      .join("  ·  ")}
                  </span>
                </div>
              )}
            </article>
          ))}
        </main>
      ) : (
        <Leaderboard tracker={tracker} />
      )}

      {renaming && (
        <RenameSheet
          tracker={tracker}
          target={renaming}
          onClose={() => setRenaming(null)}
          onSave={(next) => {
            onChange(next);
            setRenaming(null);
          }}
        />
      )}
    </div>
  );
}
