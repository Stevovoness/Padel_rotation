import { useState } from "preact/hooks";
import { hasScores, newTracker, type Tracker } from "./model";
import { clearCurrent, loadCurrent, saveCurrent } from "./store";
import { Home } from "./ui/Home";
import { TrackerView } from "./ui/TrackerView";

type Screen = "home" | "tracker";

export function App() {
  const [tracker, setTracker] = useState<Tracker | null>(() => loadCurrent());
  const [screen, setScreen] = useState<Screen>(() => (loadCurrent() ? "tracker" : "home"));

  const update = (next: Tracker) => {
    setTracker(next);
    saveCurrent(next);
  };

  /** Swap in a new schedule, checking first if that would throw away scores. */
  const start = (made: Pick<Tracker, "session" | "rounds">): boolean => {
    if (
      tracker &&
      hasScores(tracker) &&
      !confirm("Start a new session? The scores you've entered for the current one will be lost.")
    ) {
      return false;
    }
    const fresh = newTracker(made.session, made.rounds);
    update(fresh);
    setScreen("tracker");
    return true;
  };

  const discard = () => {
    if (tracker && hasScores(tracker) && !confirm("Delete this session and its scores?")) return;
    clearCurrent();
    setTracker(null);
    setScreen("home");
  };

  if (screen === "tracker" && tracker) {
    return <TrackerView tracker={tracker} onChange={update} onHome={() => setScreen("home")} />;
  }
  return (
    <Home
      current={tracker}
      onImported={start}
      onContinue={() => setScreen("tracker")}
      onDiscard={discard}
    />
  );
}
