/**
 * The phone-shaped rotation PDF, ported line for line from padel.py so it
 * looks the same: round cards first, then the at-a-glance grid and notes.
 * All coordinates are reportlab's (y up from the bottom of the page).
 */

import { clock, courtsText, slotLabel, type Round, type Session } from "../model";
import { pyRound, roundMinutes, slotsOf, type Stats } from "../sched/schedule";
import { Canvas } from "./canvas";
import type { FontName } from "./metrics";

const PAGE_W = 340.0;
const PAGE_H = 620.0;
const MARGIN = 20.0;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const FOOT_H = 30.0;

const BG = "#F1F5F2";
const CARD = "#FFFFFF";
const SHADOW = "#E0E7E2";
const BORDER = "#E2E9E4";
const INK = "#0D1F1B";
const MUTED = "#6C7F79";
const FAINT = "#9AA8A3";
const DEEP = "#0B3A33";
const DEEP_SOFT = "#C3D8D2";
const TEAM_A = "#0E8C6B";
const TEAM_B = "#E0663A";
const BALL = "#D8F24B";
const HAIRLINE = "#EDF2EE";
const EMPTY = "#EEF2EF";
const EMPTY_EDGE = "#E2E9E4";

const DASH = "–";
const DOT = "·";

const BOLD: FontName = "Helvetica-Bold";
const REG: FontName = "Helvetica";

// --------------------------------------------------------------------------
// helpers shared with padel.py's console output
// --------------------------------------------------------------------------

/** Python's f"{x:.0f}". */
function f0(x: number): string {
  return String(pyRound(x));
}

/** '15 min' when it divides cleanly, '~13 min' when it does not. */
export function roundLenText(session: Session): string {
  const mins = roundMinutes(session);
  if (Math.abs(mins - pyRound(mins)) < 0.05) return `${f0(mins)} min`;
  return `~${f0(mins)} min`;
}

/** 'Everyone plays 4 of 7' / '5 or 6 of 9 rounds each'. */
export function playSummary(session: Session, stats: Stats): string {
  const low = Math.min(...stats.games);
  const high = Math.max(...stats.games);
  if (low === high && high === session.nRounds) return "Everyone plays every round";
  if (low === high) return `Everyone plays ${low} of ${session.nRounds}`;
  return `${low} or ${high} of ${session.nRounds} rounds each`;
}

const chars = (s: string) => [...s];

// --------------------------------------------------------------------------
// text
// --------------------------------------------------------------------------

/** Shrink then clip so a name never runs past its box. */
function fit(c: Canvas, text: string, width: number, font: FontName, size: number, minSize = 7.0): [string, number] {
  while (size > minSize && c.stringWidth(text, font, size) > width) size -= 0.25;
  if (c.stringWidth(text, font, size) > width) {
    let cs = chars(text);
    while (cs.length && c.stringWidth(cs.join("") + "…", font, size) > width) cs = cs.slice(0, -1);
    text = cs.join("") + "…";
  }
  return [text, size];
}

/** drawString with optional letter spacing. */
function spaced(
  c: Canvas,
  text: string,
  x: number,
  y: number,
  font: FontName,
  size: number,
  color: string,
  space = 0.0,
  align: "left" | "right" | "center" = "left",
): void {
  const width = c.stringWidth(text, font, size) + space * chars(text).length;
  if (align === "right") x -= width;
  else if (align === "center") x -= width / 2;
  c.setFont(font, size);
  c.setFillColor(color);
  c.drawString(x, y, text, space);
}

function wrap(c: Canvas, parts: string[], width: number, font: FontName, size: number, sep: string): string[] {
  const lines: string[] = [];
  let line = "";
  for (const part of parts) {
    const trial = line ? `${line}${sep}${part}` : part;
    if (line && c.stringWidth(trial, font, size) > width) {
      lines.push(line);
      line = part;
    } else {
      line = trial;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// --------------------------------------------------------------------------
// page furniture
// --------------------------------------------------------------------------

/**
 * padel.py sets an alpha here, but reportlab's setStrokeColor straight after
 * resets the stroke alpha to 1, so the glyph has always printed fully opaque.
 * It is drawn opaque here to look the same.
 */
function courtGlyph(c: Canvas, x: number, y: number, w: number, h: number, color: string): void {
  c.saveState();
  c.setStrokeColor(color);
  c.setLineWidth(1.2);
  c.roundRect(x, y, w, h, 3, 1, 0);
  c.line(x + w / 2, y, x + w / 2, y + h);
  c.setLineWidth(0.7);
  c.line(x + w * 0.22, y + h * 0.16, x + w * 0.22, y + h * 0.84);
  c.line(x + w * 0.78, y + h * 0.16, x + w * 0.78, y + h * 0.84);
  c.line(x + w * 0.22, y + h / 2, x + w * 0.78, y + h / 2);
  c.restoreState();
}

function pageBg(c: Canvas, pageH = PAGE_H): void {
  c.setFillColor(BG);
  c.rect(0, 0, PAGE_W, pageH, 0, 1);
}

const HERO_H = 108.0;
const BANNER_H = 46.0;

function hero(c: Canvas, session: Session, stats: Stats, pageH = PAGE_H): number {
  const top = pageH - HERO_H;
  c.setFillColor(DEEP);
  c.rect(0, top, PAGE_W, HERO_H, 0, 1);
  courtGlyph(c, PAGE_W - 92, top + 22, 72, 46, BALL);

  const crumbs = [session.dateText, session.location].filter(Boolean);
  const eyebrow = crumbs.length
    ? crumbs.join(` ${DOT} `).toUpperCase()
    : `${courtsText(session.courts)} ${DOT} rotation`.toUpperCase();
  let [text, size] = fit(c, eyebrow, CONTENT_W - 78, BOLD, 7.4, 6.0);
  spaced(c, text, MARGIN, pageH - 34, BOLD, size, BALL, 1.5);

  const [title, titleSize] = fit(c, session.title, CONTENT_W - 78, BOLD, 22, 13);
  c.setFont(BOLD, titleSize);
  c.setFillColor("#FFFFFF");
  c.drawString(MARGIN, pageH - 60, title);

  const nPlayers = session.players.length;
  const courtsBit = session.courts > 1 ? `${courtsText(session.courts)} ${DOT} ` : "";
  const line1 =
    `${nPlayers} players ${DOT} ${courtsBit}${session.nRounds} rounds ${DOT} ` +
    `${roundLenText(session)} each`;
  const resting = nPlayers - slotsOf(session);
  let line2 = playSummary(session, stats);
  if (resting === 0) line2 += ` ${DOT} the pairings rotate`;
  else if (stats.maxStreak <= 3) line2 += ` ${DOT} max ${stats.maxStreak} in a row`;
  else line2 += ` ${DOT} ${resting} resting each round`;
  if (session.start) {
    line2 = `${clock(session.start, 0)} ${DASH} ${clock(session.start, session.minutes)}  ${DOT}  ` + line2;
  }

  for (const [offset, line] of [
    [78, line1],
    [92, line2],
  ] as const) {
    [text, size] = fit(c, line, CONTENT_W, REG, 8.6, 6.6);
    c.setFont(REG, size);
    c.setFillColor(DEEP_SOFT);
    c.drawString(MARGIN, pageH - offset, text);
  }
  return top - 16;
}

function banner(c: Canvas, text: string, pageH = PAGE_H): number {
  const top = pageH - BANNER_H;
  c.setFillColor(DEEP);
  c.rect(0, top, PAGE_W, BANNER_H, 0, 1);
  const [label, size] = fit(c, text.toUpperCase(), CONTENT_W, BOLD, 8.4, 6.5);
  spaced(c, label, MARGIN, top + 18, BOLD, size, BALL, 1.4);
  return top - 16;
}

function footer(c: Canvas, session: Session, page: number, total: number): void {
  const y = 18.0;
  c.setStrokeColor(BORDER);
  c.setLineWidth(0.8);
  c.line(MARGIN, y + 13, PAGE_W - MARGIN, y + 13);
  const left = `${session.title} ${DOT} ${session.minutes} min ${DOT} ${courtsText(session.courts)}`;
  spaced(c, left, MARGIN, y, REG, 7.4, FAINT);
  spaced(c, `${page}/${total}`, PAGE_W - MARGIN, y, BOLD, 7.4, FAINT, 0, "right");
}

// --------------------------------------------------------------------------
// one card per round
// --------------------------------------------------------------------------

const PAD = 11.0;
const PILL_H = 14.0;
const TEAM_LINE = 16.0;
const VS_LINE = 10.0;
const REST_LINE = 11.0;
const CARD_GAP = 9.0;

type Item =
  | { kind: "head"; off: number }
  | { kind: "rule"; off: number }
  | { kind: "court"; off: number; court: number }
  | { kind: "team"; off: number; team: number[]; color: string }
  | { kind: "vs"; off: number }
  | { kind: "divider"; off: number }
  | { kind: "rest"; off: number; lines: string[] };

function restLines(c: Canvas, session: Session, rd: Round): string[] {
  const names = rd.resting.map((p) => session.players[p]);
  if (!names.length) return [];
  const width = CONTENT_W - 2 * PAD - 44;
  return wrap(c, names, width, REG, 8.6, `  ${DOT}  `);
}

/**
 * Return [height, items] where each item carries its offset from the card top.
 * Drawing and measuring both walk this list, so pagination can never disagree
 * with what actually gets painted.
 */
function cardLayout(c: Canvas, session: Session, rd: Round): [number, Item[]] {
  const showCourt = session.courts > 1;
  const items: Item[] = [];
  let off = PAD;
  items.push({ kind: "head", off });
  off += PILL_H;

  rd.matches.forEach((match, i) => {
    if (i) {
      off += 7;
      items.push({ kind: "rule", off });
      off += 6;
    }
    if (showCourt) {
      off += 12;
      items.push({ kind: "court", off, court: match.court });
      off += 15;
    } else {
      off += 20;
    }
    items.push({ kind: "team", off, team: match.teamA, color: TEAM_A });
    items.push({ kind: "vs", off: off + VS_LINE + 1 });
    off += TEAM_LINE + VS_LINE;
    items.push({ kind: "team", off, team: match.teamB, color: TEAM_B });
  });

  const lines = restLines(c, session, rd);
  if (lines.length) {
    off += 13;
    items.push({ kind: "divider", off });
    off += 12;
    items.push({ kind: "rest", off, lines });
    off += REST_LINE * (lines.length - 1) + 9;
  } else {
    off += 11;
  }
  return [off, items];
}

function cardHeight(c: Canvas, session: Session, rd: Round): number {
  return cardLayout(c, session, rd)[0];
}

function drawCard(c: Canvas, session: Session, rd: Round, yTop: number): number {
  const [height, items] = cardLayout(c, session, rd);
  const x = MARGIN;
  const w = CONTENT_W;
  const bottom = yTop - height;

  c.setFillColor(SHADOW);
  c.roundRect(x, bottom - 1.6, w, height, 10, 0, 1);
  c.setFillColor(CARD);
  c.setStrokeColor(BORDER);
  c.setLineWidth(0.9);
  c.roundRect(x, bottom, w, height, 10, 1, 1);

  const textX = x + PAD + 9;
  const textW = w - 2 * PAD - 9;

  for (const item of items) {
    const y = yTop - item.off;

    if (item.kind === "head") {
      const label = `ROUND ${rd.number}`;
      const pillW = c.stringWidth(label, BOLD, 7.6) + 8 * 1.1 + 14;
      c.setFillColor(DEEP);
      c.roundRect(x + PAD, y - PILL_H, pillW, PILL_H, PILL_H / 2, 0, 1);
      spaced(c, label, x + PAD + 7, y - PILL_H + 4.4, BOLD, 7.6, BALL, 1.1);
      spaced(c, slotLabel(session, rd), x + w - PAD, y - PILL_H + 4.4, BOLD, 9.2, INK, 0, "right");
    } else if (item.kind === "rule" || item.kind === "divider") {
      c.setStrokeColor(HAIRLINE);
      c.setLineWidth(1);
      c.line(x + PAD, y, x + w - PAD, y);
    } else if (item.kind === "court") {
      spaced(c, `COURT ${item.court}`, x + PAD, y, BOLD, 7.0, MUTED, 1.1);
    } else if (item.kind === "team") {
      c.setFillColor(item.color);
      c.roundRect(x + PAD, y - 2.5, 3.6, 13.5, 1.8, 0, 1);
      const names = item.team.map((p) => session.players[p]).join("  &  ");
      const [text, size] = fit(c, names, textW, BOLD, 12.6, 8.0);
      c.setFont(BOLD, size);
      c.setFillColor(INK);
      c.drawString(textX, y, text);
    } else if (item.kind === "vs") {
      spaced(c, "VS", textX, y, BOLD, 6.6, FAINT, 1.0);
    } else if (item.kind === "rest") {
      spaced(c, "RESTING", x + PAD, y, BOLD, 6.8, FAINT, 0.9);
      c.setFont(REG, 8.6);
      c.setFillColor(MUTED);
      item.lines.forEach((line, i) => c.drawString(x + PAD + 44, y - i * REST_LINE, line));
    }
  }
  return bottom;
}

// --------------------------------------------------------------------------
// the at-a-glance grid
// --------------------------------------------------------------------------

const GRID_ROW_H = 20.0;
const GLANCE_HEAD_H = 16 + 6 + 15;
const LEGEND_H = 26.0;

function glanceHeader(c: Canvas, session: Session, y: number, gridX: number, colW: number): number {
  spaced(c, "WHO IS ON COURT", MARGIN, y, BOLD, 7.6, MUTED, 1.2);
  y -= 16;
  for (let i = 0; i < session.nRounds; i++) {
    const cx = gridX + colW * i + colW / 2;
    spaced(c, `R${i + 1}`, cx, y, BOLD, 7.2, FAINT, 0, "center");
  }
  spaced(c, "PLAYS", PAGE_W - MARGIN, y, BOLD, 7.2, FAINT, 0, "right");
  y -= 6;
  c.setStrokeColor(BORDER);
  c.setLineWidth(0.8);
  c.line(MARGIN, y, PAGE_W - MARGIN, y);
  return y - 15;
}

function sideOf(rd: Round, player: number): "a" | "b" | null {
  for (const m of rd.matches) {
    if (m.teamA.includes(player)) return "a";
    if (m.teamB.includes(player)) return "b";
  }
  return null;
}

function courtOf(rd: Round, player: number): number | null {
  for (const m of rd.matches) {
    if (m.teamA.includes(player) || m.teamB.includes(player)) return m.court;
  }
  return null;
}

function glanceRows(
  c: Canvas,
  session: Session,
  rounds: Round[],
  stats: Stats,
  players: number[],
  y: number,
  gridX: number,
  colW: number,
  cellW: number,
): number {
  const cellH = 14.0;
  const showCourt = session.courts > 1 && cellW >= 11.0;

  players.forEach((p, row) => {
    if (row % 2 === 0) {
      c.setFillColor(CARD);
      c.roundRect(MARGIN - 4, y - 5.5, CONTENT_W + 8, GRID_ROW_H - 2, 5, 0, 1);
    }
    const [text, size] = fit(c, session.players[p], 88.0, BOLD, 9.4, 6.5);
    c.setFont(BOLD, size);
    c.setFillColor(INK);
    c.drawString(MARGIN, y, text);

    for (const rd of rounds) {
      const cx = gridX + colW * (rd.number - 1) + colW / 2;
      const boxX = cx - cellW / 2;
      const boxY = y - 3.2;
      const side = sideOf(rd, p);
      if (side === null) {
        c.setFillColor(EMPTY);
        c.setStrokeColor(EMPTY_EDGE);
        c.setLineWidth(0.8);
        c.roundRect(boxX, boxY, cellW, cellH, 4, 1, 1);
      } else {
        c.setFillColor(side === "a" ? TEAM_A : TEAM_B);
        c.roundRect(boxX, boxY, cellW, cellH, 4, 0, 1);
        if (showCourt) spaced(c, String(courtOf(rd, p)), cx, y, BOLD, 7.0, "#FFFFFF", 0, "center");
      }
    }

    spaced(c, String(stats.games[p]), PAGE_W - MARGIN, y, BOLD, 9.4, MUTED, 0, "right");
    y -= GRID_ROW_H;
  });
  return y;
}

function glanceLegend(c: Canvas, session: Session, rounds: Round[], y: number): number {
  y -= 4;
  const legend: [string, string, boolean][] = [
    ["Team 1", TEAM_A, false],
    ["Team 2", TEAM_B, false],
  ];
  if (rounds.some((rd) => rd.resting.length)) legend.push(["Resting", EMPTY, true]);
  let lx = MARGIN;
  for (const [text, color, empty] of legend) {
    c.setFillColor(color);
    if (empty) {
      c.setStrokeColor("#DCE4DF");
      c.setLineWidth(0.8);
      c.roundRect(lx, y - 1, 12, 9, 3, 1, 1);
    } else {
      c.roundRect(lx, y - 1, 12, 9, 3, 0, 1);
    }
    spaced(c, text, lx + 16, y, REG, 7.6, MUTED);
    lx += 16 + c.stringWidth(text, REG, 7.6) + 14;
  }
  if (session.courts > 1) spaced(c, "number = court", lx, y, REG, 7.6, FAINT);
  return y - 22;
}

function glanceMetrics(session: Session): [number, number, number] {
  const nameW = 92.0;
  const gamesW = 32.0;
  const gridX = MARGIN + nameW;
  const colW = (CONTENT_W - nameW - gamesW) / session.nRounds;
  const cellW = Math.max(6.0, Math.min(colW - 3, 22.0));
  return [gridX, colW, cellW];
}

// --------------------------------------------------------------------------
// notes
// --------------------------------------------------------------------------

function noteBullets(session: Session, stats: Stats): string[] {
  const low = Math.min(...stats.games);
  const high = Math.max(...stats.games);
  const spread = Math.min(...stats.distinctPartners);
  const mins = roundMinutes(session);
  const n = session.players.length;

  let fair: string;
  if (low === high && high === session.nRounds) {
    fair =
      `With ${n} players on ${courtsText(session.courts)} nobody sits out ` +
      `${DOT} every round re-draws the pairings.`;
  } else if (low === high) {
    fair = `Everyone plays ${low} of ${session.nRounds} rounds ${DOT} ` + `${f0(low * mins)} minutes on court each.`;
  } else {
    fair =
      `Court time is as even as ${n} players on ` +
      `${courtsText(session.courts)} allow: ${low} or ${high} rounds each.`;
  }

  const bullets = [fair];
  if (stats.maxRestStreak) {
    if (stats.maxStreak <= 3) {
      bullets.push(
        `Nobody plays more than ${stats.maxStreak} rounds in a row, ` +
          `or sits out more than ${stats.maxRestStreak}.`,
      );
    } else {
      const resting = n - slotsOf(session);
      const who = resting === 1 ? "1 player sits" : `${resting} players sit`;
      bullets.push(
        `Only ${who} out at a time, so runs on court are long by necessity ` +
          `${DOT} the rests are spread as evenly as they go.`,
      );
    }
  }
  bullets.push(`Partners are mixed up: at least ${spread} different team-mates each.`);
  let swap = `Swap at the end of every round ${DOT} ${roundLenText(session)}`;
  swap += session.courts > 1 ? ", check the card for your court." : ", winners stay on their side.";
  bullets.push(swap);
  return bullets;
}

function noteLines(c: Canvas, bullets: string[]): string[][] {
  return bullets.map((text) => wrap(c, text.split(" "), CONTENT_W - 44, REG, 8.6, " "));
}

function notesHeight(c: Canvas, bullets: string[]): number {
  return 20 + noteLines(c, bullets).reduce((h, lines) => h + 22 + 10.5 * (lines.length - 1), 0);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** strftime("%d %b %Y") */
function generatedDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function notes(c: Canvas, bullets: string[], seed: number, y: number, now: Date): void {
  const boxH = notesHeight(c, bullets);
  c.setFillColor(CARD);
  c.setStrokeColor(BORDER);
  c.setLineWidth(0.9);
  c.roundRect(MARGIN, y - boxH, CONTENT_W, boxH, 10, 1, 1);

  let ty = y - 20;
  for (const lines of noteLines(c, bullets)) {
    c.setFillColor(BALL);
    c.circle(MARGIN + 15, ty + 3, 3.2, 0, 1);
    c.setFillColor(DEEP);
    c.circle(MARGIN + 15, ty + 3, 1.3, 0, 1);
    c.setFont(REG, 8.6);
    c.setFillColor(MUTED);
    lines.forEach((line, i) => c.drawString(MARGIN + 26, ty - i * 10.5, line));
    ty -= 22 + 10.5 * (lines.length - 1);
  }

  spaced(c, `generated ${generatedDate(now)} ${DOT} seed ${seed}`, MARGIN, y - boxH - 14, REG, 6.8, FAINT);
}

// --------------------------------------------------------------------------
// pagination and render
// --------------------------------------------------------------------------

function paginateCards(c: Canvas, session: Session, rounds: Round[]): [Round, number][][] {
  const pages: [Round, number][][] = [];
  let current: [Round, number][] = [];
  let y = PAGE_H - HERO_H - 16;
  for (const rd of rounds) {
    const height = cardHeight(c, session, rd);
    if (current.length && y - height < FOOT_H + 12) {
      pages.push(current);
      current = [];
      y = PAGE_H - BANNER_H - 16;
    }
    current.push([rd, height]);
    y -= height + CARD_GAP;
  }
  if (current.length) pages.push(current);
  return pages;
}

function cardPageHeight(cards: [Round, number][], first: boolean): number {
  const chrome = (first ? HERO_H : BANNER_H) + 16;
  const content = cards.reduce((s, [, h]) => s + h, 0) + CARD_GAP * (cards.length - 1);
  return Math.max(260.0, Math.min(PAGE_H, chrome + content + 12 + FOOT_H));
}

/** Chunk the player rows so a big group still gets a tidy summary. */
function paginateGlance(session: Session, notesH: number): number[][] {
  const usable = PAGE_H - BANNER_H - 16 - FOOT_H - 12 - GLANCE_HEAD_H;
  const perPage = Math.max(1, Math.floor(usable / GRID_ROW_H));
  const lastPage = Math.max(1, Math.floor((usable - LEGEND_H - notesH - 20) / GRID_ROW_H));

  const n = session.players.length;
  const all = Array.from({ length: n }, (_, i) => i);
  if (n <= lastPage) return [all];

  let pages = 2;
  while ((pages - 1) * perPage + lastPage < n) pages += 1;

  // fill the pages evenly rather than leaving one name stranded at the end
  const tail = Math.min(lastPage, Math.max(1, Math.floor(n / pages)));
  const chunks: number[][] = [];
  let start = 0;
  let left = n - tail;
  for (let i = 0; i < pages - 1; i++) {
    const size = Math.ceil(left / (pages - 1 - i));
    chunks.push(all.slice(start, start + size));
    start += size;
    left -= size;
  }
  chunks.push(all.slice(start));
  return chunks;
}

/** Draw the whole PDF. Returns the jsPDF document and its page count. */
export function renderPdf(
  session: Session,
  rounds: Round[],
  stats: Stats,
  seed: number,
  now: Date = new Date(),
): { bytes: ArrayBuffer; pages: number } {
  const c = new Canvas(PAGE_W);
  c.doc.setProperties({
    title: session.title,
    author: "padel.py",
    subject: `${session.players.length} players, ${courtsText(session.courts)}, ${session.minutes} minutes`,
  });

  const cardPages = paginateCards(c, session, rounds);
  const bullets = noteBullets(session, stats);
  const notesH = notesHeight(c, bullets);
  const [gridX, colW, cellW] = glanceMetrics(session);
  const chunks = paginateGlance(session, notesH);
  const total = cardPages.length + chunks.length;

  let page = 0;
  cardPages.forEach((cards, index) => {
    page += 1;
    const height = cardPageHeight(cards, index === 0);
    c.beginPage(height);
    pageBg(c, height);
    let y = index === 0 ? hero(c, session, stats, height) : banner(c, `${session.title} ${DOT} continued`, height);
    for (const [rd] of cards) y = drawCard(c, session, rd, y) - CARD_GAP;
    footer(c, session, page, total);
  });

  // the summary pages are trimmed to their own content, so they never end in
  // half a page of empty paper on someone's phone
  chunks.forEach((players, index) => {
    page += 1;
    const last = index === chunks.length - 1;
    let needed = BANNER_H + 20 + GLANCE_HEAD_H + GRID_ROW_H * players.length + 12 + FOOT_H;
    if (last) needed += LEGEND_H + notesH + 20;
    const height = Math.max(260.0, Math.min(PAGE_H, needed));
    c.beginPage(height);

    pageBg(c, height);
    const heading = index === 0 ? "At a glance" : `At a glance ${DOT} continued`;
    let y = banner(c, heading, height) - 4;
    y = glanceHeader(c, session, y, gridX, colW);
    y = glanceRows(c, session, rounds, stats, players, y, gridX, colW, cellW);
    if (last) {
      y = glanceLegend(c, session, rounds, y);
      notes(c, bullets, seed, y, now);
    }
    footer(c, session, page, total);
  });

  return { bytes: c.doc.output("arraybuffer"), pages: page };
}
