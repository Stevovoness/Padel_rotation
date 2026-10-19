import { useRef, useState } from "preact/hooks";
import { courtsText, type Round, type Session, type Tracker } from "../model";
import { ImportError, parsePdfText } from "../import/parsePdf";
import { readPdfText } from "../import/readPdf";
import { Header } from "./Header";

interface Props {
  current: Tracker | null;
  onImported: (made: { session: Session; rounds: Round[] }) => boolean;
  onContinue: () => void;
  onDiscard: () => void;
}

export function Home({ current, onImported, onContinue, onDiscard }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
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
      setBusy(false);
      if (input.current) input.current.value = ""; // picking the same file again still fires
    }
  };

  const s = current?.session;

  return (
    <div class="page">
      <Header title="Padel Rotation" subtitle="Equal court time, staggered rests, one PDF for the group chat" />
      <main class="body">
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
          <button class="btn primary wide" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? "Reading the PDF…" : "Choose PDF"}
          </button>
          {error && <p class="warn">⚠ {error}</p>}
        </section>

        <section class="panel soon">
          <h2 class="panel-title">Make a new rotation</h2>
          <p class="muted">Building rotations and PDFs right here is coming next.</p>
        </section>
      </main>
    </div>
  );
}
