/**
 * Pull the text out of a PDF, one array of strings per page, in drawing order.
 *
 * pdf.js is large, so it is only loaded when someone actually picks a file.
 * The legacy build runs on older phone browsers too.
 */

import { tokensFromItems, type TextItem } from "./parsePdf";

export type OnProgress = (step: { done: number; label: string }) => void;

export async function readPdfText(data: ArrayBuffer, onProgress: OnProgress = () => {}): Promise<string[][]> {
  onProgress({ done: 0.1, label: "Loading the PDF reader…" });
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  onProgress({ done: 0.3, label: "Opening the PDF…" });
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const pages: string[][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    onProgress({ done: 0.35 + 0.55 * ((n - 1) / doc.numPages), label: `Reading page ${n} of ${doc.numPages}…` });
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items: TextItem[] = [];
    for (const item of content.items) {
      if ("str" in item) items.push({ str: item.str, y: item.transform[5] });
    }
    pages.push(tokensFromItems(items));
  }
  await doc.destroy();
  onProgress({ done: 0.95, label: "Rebuilding the schedule…" });
  return pages;
}
