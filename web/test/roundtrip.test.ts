// A PDF this app makes reads back, through the importer, as the same schedule.
import { describe, expect, it } from "vitest";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { parsePdfText, tokensFromItems } from "../src/import/parsePdf";
import type { Session } from "../src/model";
import { renderPdf } from "../src/pdf/render";
import { chooseRounds, generate } from "../src/sched/schedule";

async function textOf(bytes: ArrayBuffer): Promise<string[][]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const pages: string[][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    const items = content.items.flatMap((i) => ("str" in i ? [{ str: i.str, y: i.transform[5] }] : []));
    pages.push(tokensFromItems(items));
  }
  return pages;
}

const cases: Omit<Session, "nRounds">[] = [
  { players: ["Ann", "Ben", "Cara", "Dan", "Eve", "Finn", "Gus", "Hana", "Ivo"], minutes: 90, courts: 2, start: "17:00", title: "Padel Rotation", dateText: "Mon 19 Oct", location: "Club One" },
  { players: ["Ann", "Ben", "Cara", "Dan", "Bartholomew-Maximilian Vandermerwe"], minutes: 60, courts: 1, start: null, title: "Sunday Smash", dateText: "", location: "" },
  { players: Array.from({ length: 24 }, (_, i) => `Player ${i + 1}`), minutes: 120, courts: 4, start: "07:30", title: "Club Night", dateText: "Sat 05 Sep", location: "" },
];

describe("round trip", () => {
  for (const base of cases) {
    it(`reads back ${base.players.length} players on ${base.courts} court(s)`, async () => {
      const session: Session = { ...base, nRounds: chooseRounds(base.minutes, base.players.length, base.courts) };
      const { rounds, stats, seed } = generate(session, 31);
      const { bytes } = renderPdf(session, rounds, stats, seed);
      const back = parsePdfText(await textOf(bytes));
      expect(back.rounds).toEqual(rounds);
      expect(back.session).toEqual({ ...session, dateText: base.dateText, location: base.location });
    });
  }
});
