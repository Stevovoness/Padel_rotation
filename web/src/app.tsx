import { useEffect, useRef, useState } from "preact/hooks";
import { hasScores, newTracker, type Round, type Session, type Tracker } from "./model";
import { clearCurrent, loadCurrent, loadHistory, saveCurrent, saveHistory, type History } from "./store";
import { collect, remember, wantedPlayers, type FormState } from "./form/validate";
import { makeRotation, sharePdf } from "./generate";
import { Sync, type SyncStatus } from "./sync/engine";
import { Home } from "./ui/Home";
import { initialForm } from "./ui/Form";
import { TrackerView } from "./ui/TrackerView";

type Screen = "home" | "tracker";

/** The session code in a shared link (?s=abc123), if this page was opened from one. */
function linkedSession(): string | null {
  const id = new URLSearchParams(location.search).get("s");
  return id && /^[a-z0-9]{10}$/.test(id) ? id : null;
}

function forgetLink(): void {
  history.replaceState(null, "", location.pathname);
}

export function App() {
  const [tracker, setTracker] = useState<Tracker | null>(() => loadCurrent());
  const [screen, setScreen] = useState<Screen>(() => (loadCurrent() ? "tracker" : "home"));
  const [history, setHistory] = useState<History>(() => loadHistory());
  const [form, setForm] = useState<FormState>(() => initialForm(loadHistory()));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState<SyncStatus>("off");

  // the sync engine reads and writes the latest tracker, not a render's copy
  const current = useRef<Tracker | null>(tracker);
  const put = (next: Tracker | null) => {
    current.current = next;
    setTracker(next);
    if (next) saveCurrent(next);
  };
  const sync = useRef<Sync | null>(null);
  if (!sync.current) {
    sync.current = new Sync({ get: () => current.current, set: put, onStatus: setStatus });
  }
  const engine = sync.current;

  /** Change screen and start at the top of it. */
  const go = (next: Screen) => {
    setScreen(next);
    window.scrollTo(0, 0);
  };

  /** A local edit: save it here, and send it to everyone else. */
  const update = (next: Tracker) => {
    const prev = current.current;
    put(prev ? engine.local(prev, next) : next);
  };

  /** Start following a new session on this phone. */
  const begin = (next: Tracker) => {
    put(next);
    setNotice("");
    go("tracker");
    void engine.share();
    engine.watch();
  };

  const confirmReplace = () => {
    const t = current.current;
    // a shared session's scores are safe on the server; a private one's aren't
    return (
      !t ||
      !hasScores(t) ||
      !!t.shared ||
      confirm("Start a new session? The scores you've entered for the current one will be lost.")
    );
  };

  // on first load: open a shared link, or carry on with the session we had
  useEffect(() => {
    const id = linkedSession();
    if (!id || !engine.enabled) {
      if (id) forgetLink();
      engine.watch();
      void engine.share(); // sessions from before sharing existed get shared too
      return;
    }
    if (current.current?.shared?.id === id) {
      forgetLink();
      engine.watch();
      go("tracker");
      return;
    }
    engine
      .join(id)
      .then((joined) => {
        forgetLink();
        if (!joined) {
          alert("That scoring link has expired or doesn't exist.");
          engine.watch();
          return;
        }
        if (!confirmReplace()) {
          engine.watch();
          return;
        }
        put(joined);
        setNotice("");
        go("tracker");
        engine.watch();
      })
      .catch(() => {
        alert("Couldn't open the shared scoreboard. Check your connection and open the link again.");
        engine.watch();
      });
  }, []);

  /** Swap in a schedule read from a PDF. */
  const imported = (made: { session: Session; rounds: Round[] }): boolean => {
    if (!confirmReplace()) return false;
    begin(newTracker(made.session, made.rounds));
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
      begin(newTracker(made.session, made.rounds, made.seed));
      setNotice(`${made.file.name}  ·  ${made.pages} pages  ·  seed ${made.seed}`);
    } catch (exc) {
      alert(`Could not build the PDF: ${(exc as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const discard = () => {
    const t = current.current;
    if (t && hasScores(t) && !t.shared && !confirm("Delete this session and its scores?")) return;
    clearCurrent();
    put(null);
    setNotice("");
    engine.watch();
    go("home");
  };

  if (screen === "tracker" && tracker) {
    return (
      <TrackerView
        tracker={tracker}
        notice={notice}
        status={status}
        link={engine.shareLink(tracker)}
        onChange={update}
        onHome={() => go("home")}
      />
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
