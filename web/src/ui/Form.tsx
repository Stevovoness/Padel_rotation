import { MAX_COURTS, MAX_PLAYERS } from "../model";
import type { History } from "../store";
import { collect, summaryLine, todayIso, wantedPlayers, type FormState } from "../form/validate";
import type { Step } from "../generate";
import { Autocomplete } from "./Autocomplete";
import { Progress } from "./Progress";

// padel.py DEFAULT_PLAYERS: the roster the Windows app starts with
const DEFAULT_PLAYERS = ["Reuben", "John", "Robyn", "Stephen", "Marco", "Tiaan", "Simone"];

export function initialForm(history: History): FormState {
  const last = history.last as Record<string, unknown>;
  const str = (k: string, fallback: string) => (typeof last[k] === "string" ? (last[k] as string) : fallback);
  const num = (k: string, fallback: number) => String(typeof last[k] === "number" ? last[k] : fallback);
  const remembered = Array.isArray(last.players)
    ? (last.players as unknown[]).filter((n): n is string => typeof n === "string")
    : [];
  const roster = remembered.length ? remembered : DEFAULT_PLAYERS;
  return {
    location: str("location", ""),
    dateIso: str("date_iso", todayIso()),
    title: str("title", "Padel Rotation"),
    start: str("start", "08:00"),
    minutes: num("minutes", 90),
    courts: num("courts", 1),
    nPlayers: String(roster.length),
    autoRounds: true,
    rounds: "6",
    seed: "",
    names: [...roster],
  };
}

interface Props {
  history: History;
  form: FormState;
  onForm: (next: FormState) => void;
  progress: Step | null;
  onGenerate: () => void;
}

/** Numeric field: shows the phone's number pad. */
function NumberField(props: {
  label: string;
  value: string;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <label class="field">
      <span>{props.label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        disabled={props.disabled}
        onInput={(e) => props.onChange((e.currentTarget as HTMLInputElement).value)}
      />
    </label>
  );
}

export function Form({ history, form, onForm, progress, onGenerate }: Props) {
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => onForm({ ...form, [key]: value });

  // name boxes follow the Players count, keeping whatever is already typed
  const wanted = wantedPlayers(form);
  const count = wanted ?? form.names.length;
  const names = Array.from({ length: count }, (_, i) => form.names[i] ?? "");

  const setPlayers = (text: string) => {
    const next = { ...form, nPlayers: text };
    const n = wantedPlayers(next);
    if (n !== null && n > form.names.length) {
      next.names = [...form.names, ...Array(n - form.names.length).fill("")];
    }
    onForm(next);
  };

  const setName = (i: number, value: string) => {
    const next = [...names];
    next[i] = value;
    // keep any names beyond the current count, so lowering then raising Players loses nothing
    onForm({ ...form, names: [...next, ...form.names.slice(count)] });
  };

  const result = collect({ ...form, names });
  const error = "error" in result ? result.error : "";

  return (
    <>
      <section class="panel">
        <h2 class="panel-title">Where and when</h2>
        <label class="field">
          <span>Location</span>
          <Autocomplete value={form.location} pool={history.locations} onChange={(v) => set("location", v)} label="Location" />
        </label>
        <div class="grid2">
          <label class="field">
            <span>Date</span>
            <input type="date" value={form.dateIso} onInput={(e) => set("dateIso", (e.currentTarget as HTMLInputElement).value)} />
          </label>
          <label class="field">
            <span>Start</span>
            <input type="time" step={300} value={form.start} onInput={(e) => set("start", (e.currentTarget as HTMLInputElement).value)} />
          </label>
        </div>
        <label class="field">
          <span>Heading</span>
          <input value={form.title} onInput={(e) => set("title", (e.currentTarget as HTMLInputElement).value)} />
        </label>
        <div class="grid2">
          <NumberField label="Minutes" value={form.minutes} min={15} max={300} step={15} onChange={(v) => set("minutes", v)} />
          <NumberField label="Courts" value={form.courts} min={1} max={MAX_COURTS} onChange={(v) => set("courts", v)} />
          <NumberField label="Players" value={form.nPlayers} min={4} max={MAX_PLAYERS} onChange={setPlayers} />
          <label class="field">
            <span>Seed</span>
            <input inputMode="numeric" placeholder="new" value={form.seed} onInput={(e) => set("seed", (e.currentTarget as HTMLInputElement).value)} />
          </label>
        </div>
        <div class="rounds-row">
          <span class="rounds-label">Rounds</span>
          <label class="check">
            <input type="checkbox" checked={form.autoRounds} onChange={(e) => set("autoRounds", (e.currentTarget as HTMLInputElement).checked)} />
            auto
          </label>
          <input
            class="rounds-input"
            type="number"
            inputMode="numeric"
            min={1}
            max={40}
            aria-label="Rounds"
            value={form.autoRounds && "session" in result ? String(result.session.nRounds) : form.rounds}
            disabled={form.autoRounds}
            onInput={(e) => set("rounds", (e.currentTarget as HTMLInputElement).value)}
          />
        </div>
      </section>

      <section class="panel">
        <h2 class="panel-title">Players</h2>
        <ol class="names">
          {names.map((name, i) => (
            <li key={i}>
              <span class="num">{i + 1}</span>
              <Autocomplete value={name} pool={history.players} onChange={(v) => setName(i, v)} label={`Player ${i + 1}`} />
            </li>
          ))}
        </ol>
      </section>

      {"session" in result && <p class="muted summary">{summaryLine(result.session)}</p>}
      {error && <p class="warn">⚠  {error}</p>}

      <footer class="dock">
        {progress ? (
          <Progress done={progress.done} label={progress.label} />
        ) : (
          <button class="btn primary wide" disabled={!!error} onClick={onGenerate}>
            Generate PDF
          </button>
        )}
      </footer>
    </>
  );
}
