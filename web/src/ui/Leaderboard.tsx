import { useState } from "preact/hooks";
import type { Tracker } from "../model";
import { diff, standings } from "../scoring/leaderboard";
import { resultsMessage } from "../scoring/message";

function oneDp(n: number): string {
  return String(Math.round(n * 10) / 10);
}

function signed(n: number): string {
  const r = Math.round(n * 10) / 10;
  return r > 0 ? `+${r}` : r < 0 ? `−${Math.abs(r)}` : "0";
}

export function Leaderboard({ tracker }: { tracker: Tracker }) {
  const { rows, averaged } = standings(tracker);
  const [toast, setToast] = useState("");

  const flash = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(""), 2600);
  };

  const share = async () => {
    const text = resultsMessage(tracker);
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch (exc) {
        if ((exc as DOMException).name === "AbortError") return; // closed the share sheet
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      flash("Copied - paste it into WhatsApp");
    } catch {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
    }
  };

  const anyScores = rows.some((r) => r.games > 0);

  return (
    <>
      <main class="body board">
        {!anyScores && <p class="muted center">Enter some scores on the Schedule tab and the table fills in here.</p>}
        {anyScores && (
          <>
            <table class="table">
              <thead>
                <tr>
                  <th class="rank">#</th>
                  <th class="who">Player</th>
                  <th>{averaged ? "Pts/g" : "Pts"}</th>
                  <th>W</th>
                  <th>{averaged ? "±/g" : "±"}</th>
                  <th>G</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.person.id} class={r.games ? "" : "idle"}>
                    <td class="rank">{r.games ? r.rank : ""}</td>
                    <td class="who">{r.person.name}</td>
                    <td class="strong">
                      {averaged ? (r.games ? oneDp(r.pointsFor / r.games) : "–") : r.pointsFor}
                    </td>
                    <td>{oneDp(r.wins)}</td>
                    <td>{r.games ? signed(averaged ? diff(r) / r.games : diff(r)) : "–"}</td>
                    <td>{r.games}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p class="muted small">
              {averaged
                ? "Game counts differ, so it's ranked per game: points, then win rate, then difference."
                : "Ranked on points, then matches won, then point difference. A draw is half a win."}
            </p>
          </>
        )}
      </main>
      <footer class="dock">
        {toast && <div class="toast">{toast}</div>}
        <button class="btn primary wide" disabled={!anyScores} onClick={share}>
          Share results
        </button>
      </footer>
    </>
  );
}
