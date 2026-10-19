/**
 * Build a rotation and its PDF, and hand the PDF to the phone's share sheet
 * (WhatsApp) - or download it where sharing files isn't possible.
 */

import type { Round, Session } from "./model";
import { renderPdf } from "./pdf/render";
import { generate, summarise } from "./sched/schedule";
import { slugify } from "./form/validate";

export interface Made {
  session: Session;
  rounds: Round[];
  seed: number;
  file: File;
  pages: number;
}

export function pdfFile(session: Session, rounds: Round[], seed: number): { file: File; pages: number } {
  const stats = summarise(rounds, session.players.length);
  const { bytes, pages } = renderPdf(session, rounds, stats, seed);
  const name = `padel-${slugify(session.location || session.title)}.pdf`;
  return { file: new File([bytes], name, { type: "application/pdf" }), pages };
}

/** Everything here is synchronous, so the share sheet still counts as the tap's doing. */
export function makeRotation(session: Session, seed: number | null): Made {
  const made = generate(session, seed);
  const { file, pages } = pdfFile(session, made.rounds, made.seed);
  return { session, rounds: made.rounds, seed: made.seed, file, pages };
}

function download(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** "shared", "cancelled" or "downloaded". */
export async function sharePdf(file: File): Promise<"shared" | "cancelled" | "downloaded"> {
  const data = { files: [file], title: file.name };
  if (navigator.canShare?.(data)) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (exc) {
      if ((exc as DOMException).name === "AbortError") return "cancelled";
      // NotAllowedError and friends: fall back to a download
    }
  }
  download(file);
  return "downloaded";
}
