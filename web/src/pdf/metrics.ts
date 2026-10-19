/**
 * Text measurement that matches reportlab's canvas.stringWidth for the two
 * standard fonts the PDF uses, so names shrink, clip and wrap exactly as they
 * do in padel.py.
 */

import { HELVETICA, HELVETICA_BOLD } from "./widths";

export type FontName = "Helvetica" | "Helvetica-Bold";

// Unicode -> WinAnsi (cp1252) for the 0x80-0x9F block; everything else in
// Latin-1 maps to itself.
const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86,
  0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** The WinAnsi code for a character, or null when the font cannot show it. */
export function winAnsi(ch: string): number | null {
  const cp = ch.codePointAt(0)!;
  if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) return cp;
  return CP1252[cp] ?? null;
}

const FALLBACK = 556; // an average Helvetica glyph, for characters outside WinAnsi

export function stringWidth(text: string, font: FontName, size: number): number {
  const table = font === "Helvetica" ? HELVETICA : HELVETICA_BOLD;
  let units = 0;
  for (const ch of text) {
    const code = winAnsi(ch);
    units += code === null ? FALLBACK : table[code];
  }
  return (units * size) / 1000;
}
