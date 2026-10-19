import { useState } from "preact/hooks";
import { hasScores, newTracker, type Round, type Session, type Tracker } from "./model";
import { clearCurrent, loadCurrent, loadHistory, saveCurrent, saveHistory, type History } from "./store";
import { collect, remember, wantedPlayers, type FormState } from "./form/validate";
import { makeRotation, sharePdf } from "./generate";
import { Home } from "./ui/Home";
import { initialForm } from "./ui/Form";
import { TrackerView } from "./ui/TrackerView";

type Screen = "home" | "tracker";

export function App() {
  const [tracker, setTracker] = useState<Tracker | null>(() => loadCurrent());
  const [screen, setScreen] = useState<Screen>(() => (loadCurrent() ? "tracker" : "home"));
  const [history, setHistory] = useState<History>(() => loadHistory());
  const [form, setForm] = useState<FormState>(() => initialForm(loadHistory()));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const update = (next: Tracker) => {
    setTracker(next);
    saveCurrent(next);
  };

  const confirmReplace = () =>
    !tracker ||
    !hasScores(tracker) ||
    confirm("Start a new session? The scores you've entered for the current one will be lost.");

  /** Swap in a schedule read from a PDF. */
  const imported = (made: { session: Session; rounds: Round[] }): boolean => {
    if (!confirmReplace()) return false;
    update(newTracker(made.session, made.rounds));
    setNotice("");
    go("tracker");
    return true;
  };

  const rememberSession = (session: Session) => {
    const next: History = {
      players: remember(history.players, session.players),
      locations: session.location ? remember(history.locations, [session.location]) : history.locations,
      last: {
        players: session.players,
        location: session.location,
        date_iso: form.dateIso,
        title: session.title,
        courts: session.courts,
        minutes: session.minutes,
        start: form.start,
      },
    };
    setHistory(next);
    saveHistory(next);
  };

  const onGenerate = () => {
    if (busy) return;
    const n = wantedPlayers(form) ?? form.names.length;
    const result = collect({ ...form, names: form.names.slice(0, n) });
    if ("error" in result) return;
    if (!confirmReplace()) return;

    setBusy(true);
    try {
      // build and share in the same tap, so the phone allows the share sheet;
      // the sheet stays open as long as the person likes, so nothing waits on it
      const made = makeRotation(result.session, result.seed);
      void sharePdf(made.file);
      rememberSession(made.session);
      update(newTracker(made.session, made.rounds, made.seed));
      setNotice(`${made.file.name}  ·  ${made.pages} pages  ·  seed ${made.seed}`);
      go("tracker");
    } catch (exc) {
      alert(`Could not build the PDF: ${(exc as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  /** Change screen and start at the top of it. */
  const go = (next: Screen) => {
    setScreen(next);
    window.scrollTo(0, 0);
  };

  const discard = () => {
    if (tracker && hasScores(tracker) && !confirm("Delete this session and its scores?")) return;
    clearCurrent();
    setTracker(null);
    setNotice("");
    go("home");
  };

  if (screen === "tracker" && tracker) {
    return (
      <TrackerView tracker={tracker} notice={notice} onChange={update} onHome={() => go("home")} />
    );
  }
  return (
    <Home
      current={tracker}
      history={history}
      form={form}
      onForm={setForm}
      busy={busy}
      onGenerate={onGenerate}
      onImported={imported}
      onContinue={() => go("tracker")}
      onDiscard={discard}
    />
  );
}
