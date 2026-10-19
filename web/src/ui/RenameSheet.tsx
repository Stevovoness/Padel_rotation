import { useState } from "preact/hooks";
import type { Tracker } from "../model";
import { fixName, namesInUse, personAt, substitute } from "../scoring/people";

export interface RenameTarget {
  slot: number;
  round: number; // the round whose card was tapped
}

interface Props {
  tracker: Tracker;
  target: RenameTarget;
  onClose: () => void;
  onSave: (next: Tracker) => void;
}

type Mode = "fix" | "sub";

export function RenameSheet({ tracker, target, onClose, onSave }: Props) {
  const person = personAt(tracker.people, target.slot, target.round);
  const [mode, setMode] = useState<Mode>("fix");
  const [name, setName] = useState(mode === "fix" ? person.name : "");
  const [from, setFrom] = useState(target.round);
  const [error, setError] = useState("");

  const choose = (next: Mode) => {
    setMode(next);
    setName(next === "fix" ? person.name : "");
    setError("");
  };

  const save = (e: Event) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) {
      setError("Type a name first.");
      return;
    }
    const taken = namesInUse(tracker.people);
    if (mode === "fix") taken.delete(person.name.trim().toLowerCase());
    if (taken.has(clean.toLowerCase())) {
      setError(`There's already a ${clean} - everyone needs a different name.`);
      return;
    }
    onSave(
      mode === "fix"
        ? fixName(tracker, target.slot, person.segment, clean)
        : substitute(tracker, target.slot, from, clean),
    );
  };

  const rounds = tracker.rounds.map((r) => r.number);

  return (
    <div class="sheet-backdrop" onClick={onClose}>
      <form class="sheet" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h2 class="sheet-title">{person.name}</h2>
        <div class="segmented">
          <button type="button" class={mode === "fix" ? "on" : ""} onClick={() => choose("fix")}>
            Fix the name
          </button>
          <button type="button" class={mode === "sub" ? "on" : ""} onClick={() => choose("sub")}>
            Substitute
          </button>
        </div>

        {mode === "fix" ? (
          <p class="muted small">Same person, different spelling. Changes it everywhere, scores stay.</p>
        ) : (
          <p class="muted small">
            Someone new takes {person.name}'s place from the round you pick. They get their own line
            on the leaderboard; {person.name} keeps the points from before.
          </p>
        )}

        <label class="field">
          <span>{mode === "fix" ? "Name" : "Substitute's name"}</span>
          <input
            value={name}
            autoFocus
            autoCapitalize="words"
            onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
          />
        </label>

        {mode === "sub" && (
          <label class="field">
            <span>From round</span>
            <select value={from} onChange={(e) => setFrom(Number((e.currentTarget as HTMLSelectElement).value))}>
              {rounds.map((n) => (
                <option value={n} key={n}>
                  Round {n}
                </option>
              ))}
            </select>
          </label>
        )}

        {error && <p class="warn">⚠ {error}</p>}

        <div class="row-buttons">
          <button type="button" class="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" class="btn primary">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
