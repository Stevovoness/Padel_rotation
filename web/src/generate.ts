/**
 * Build a rotation and its PDF, and hand the PDF to the phone's share sheet
 * (WhatsApp) - or download it where sharing files isn't possible.
 */

import type { Round, Session } from "./model";
import { renderPdf } from "./pdf/render";
import { generateAsync, nextFrame, summarise, type Step } from "./sched/schedule";
import { slugify } from "./form/validate";

export type { Step };

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

const SCHEDULING = 0.9; // the rest of the bar is drawing the PDF

/** Schedule and draw, reporting progress as it goes. */
export async function makeRotation(
  session: Session,
  seed: number | null,
  onProgress: (step: Step) => void,
): Promise<Made> {
  const made = await generateAsync(session, seed, (step) =>
    onProgress({ done: step.done * SCHEDULING, label: step.label }),
  );
  onProgress({ done: SCHEDULING, label: "Drawing the PDF…" });
  await nextFrame();
  const { file, pages } = pdfFile(session, made.rounds, made.seed);
  onProgress({ done: 1, label: "Done" });
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

/**
 * "shared", "cancelled", "downloaded", or "blocked" when the phone could
 * share but refused because too long passed since the tap - the person then
 * taps Share PDF themselves.
 */
export async function sharePdf(file: File): Promise<"shared" | "cancelled" | "downloaded" | "blocked"> {
  const data = { files: [file], title: file.name };
  if (navigator.canShare?.(data)) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (exc) {
      const name = (exc as DOMException).name;
      if (name === "AbortError") return "cancelled";
      if (name === "NotAllowedError") return "blocked";
    }
  }
  download(file);
  return "downloaded";
}
