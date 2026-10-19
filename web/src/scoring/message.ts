/**
 * The results message for the WhatsApp group: short, emoji-led, readable on a
 * phone. WhatsApp turns *x* into bold and _x_ into italics.
 */

import type { Tracker } from "../model";
import { LOSER_LINES, WINNER_LINES, pick } from "./jokes";
import { bestPartnership, biggestWin, diff, standings, type Row } from "./leaderboard";

const MEDALS = ["🥇", "🥈", "🥉"];

function signed(n: number): string {
  const r = Math.round(n * 10) / 10;
  return r > 0 ? `+${r}` : r < 0 ? `−${Math.abs(r)}` : "±0";
}

function oneDp(n: number): string {
  return String(Math.round(n * 10) / 10);
}

function winsText(w: number): string {
  return `${oneDp(w)}W`;
}

function scoreText(row: Row, averaged: boolean): string {
  return averaged
    ? `${oneDp(row.pointsFor / row.games)} pts/game`
    : `${row.pointsFor} pts`;
}

export function resultsMessage(tracker: Tracker, random: () => number = Math.random): string {
  const { rows, averaged, matches } = standings(tracker);
  const ranked = rows.filter((r) => r.games > 0);
  const { session } = tracker;
  const lines: string[] = [];

  lines.push("🎾 *PADEL AMERICANO RESULTS* 🎾");
  const where = [session.location, session.dateText].filter(Boolean).join(" · ");
  if (where) lines.push(`📍 ${where}`);

  if (!ranked.length) {
    lines.push("", "No scores yet - get out there! 🏃");
    return lines.join("\n");
  }

  lines.push("");
  ranked.slice(0, 3).forEach((row, i) => {
    const medal = MEDALS[Math.min(row.rank, 3) - 1] ?? MEDALS[i];
    lines.push(`${medal} *${row.person.name}* — ${scoreText(row, averaged)}`);
  });

  lines.push("", "📊 *The table*");
  for (const row of ranked) {
    const games = averaged ? ` (${row.games} games)` : "";
    lines.push(
      `${row.rank}. ${row.person.name} · ${scoreText(row, averaged)} · ${winsText(row.wins)} · ${signed(
        averaged ? diff(row) / row.games : diff(row),
      )}${games}`,
    );
  }
  if (averaged) {
    lines.push("_Not everyone played the same number of games, so it's ranked per game._");
  }

  const big = biggestWin(matches);
  const duo = bestPartnership(matches);
  if (big || duo) lines.push("");
  if (big) {
    const [winners, losers, w, l] =
      big.a > big.b ? [big.teamA, big.teamB, big.a, big.b] : [big.teamB, big.teamA, big.b, big.a];
    const names = (team: typeof winners) => team.map((p) => p.name).join(" & ");
    lines.push(`💥 *Biggest win:* ${names(winners)} ${w}–${l} ${names(losers)} (round ${big.round})`);
  }
  if (duo) {
    lines.push(
      `🤝 *Dream team:* ${duo.pair[0].name} & ${duo.pair[1].name} (${signed(duo.diffPerGame)} per game together)`,
    );
  }

  const winner = ranked[0];
  const loser = ranked[ranked.length - 1];
  lines.push("", pick(WINNER_LINES, random).replaceAll("{name}", winner.person.name));
  if (ranked.length > 1 && loser.rank !== winner.rank) {
    lines.push(pick(LOSER_LINES, random).replaceAll("{name}", loser.person.name));
  }

  return lines.join("\n");
}
