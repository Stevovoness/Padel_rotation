import { useRef, useState } from "preact/hooks";
import { courtsText, type Round, type Session, type Tracker } from "../model";
import type { History } from "../store";
import type { FormState } from "../form/validate";
import { ImportError, parsePdfText } from "../import/parsePdf";
import { readPdfText } from "../import/readPdf";
import { Form } from "./Form";
import { Header } from "./Header";

interface Props {
  current: Tracker | null;
  history: History;
  form: FormState;
  onForm: (next: FormState) => void;
  busy: boolean;
  onGenerate: () => void;
  onImported: (made: { session: Session; rounds: Round[] }) => boolean;
  onContinue: () => void;
  onDiscard: () => void;
}

export function Home({ current, history, form, onForm, busy, onGenerate, onImported, onContinue, onDiscard }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    setError("");
    try {
      const pages = await readPdfText(await file.arrayBuffer());
      onImported(parsePdfText(pages));
    } catch (exc) {
      setError(
        exc instanceof ImportError
          ? exc.message
          : "Couldn't open that file. Make sure it's the PDF the rotation was shared as.",
      );
    } finally {
      setReading(false);
      if (input.current) input.current.value = ""; // picking the same file again still fires
    }
  };

  const s = current?.session;

  return (
    <div class="page">
      <Header title="Padel Rotation Scheduler" subtitle="Equal court time, staggered rests, one PDF for the group chat" />
      <main class="body with-dock">
        {s && (
          <section class="panel">
            <h2 class="panel-title">Current session</h2>
            <p class="current-name">{s.title}</p>
            <p class="muted">
              {[s.dateText, s.location].filter(Boolean).join(" · ") || "No date or venue"}
              <br />
              {s.players.length} players · {courtsText(s.courts)} · {s.nRounds} rounds
            </p>
            <div class="row-buttons">
              <button class="btn primary" onClick={onContinue}>
                Continue scoring
              </button>
              <button class="btn ghost" onClick={onDiscard}>
                Delete
              </button>
            </div>
          </section>
        )}

        <Form history={history} form={form} onForm={onForm} busy={busy} onGenerate={onGenerate} />

        <section class="panel">
          <h2 class="panel-title">Score an existing PDF</h2>
          <p class="muted">
            Got a rotation PDF already, from WhatsApp or the Windows app? Save it to your phone, then
            pick it here to keep score.
          </p>
          <input
            ref={input}
            type="file"
            accept="application/pdf,.pdf"
            class="hidden-input"
            onChange={(e) => pickFile((e.currentTarget as HTMLInputElement).files?.[0])}
          />
          <button class="btn ghost wide" disabled={reading} onClick={() => input.current?.click()}>
            {reading ? "Reading the PDF…" : "Choose PDF"}
          </button>
          {error && <p class="warn">⚠ {error}</p>}
        </section>
      </main>
    </div>
  );
}
