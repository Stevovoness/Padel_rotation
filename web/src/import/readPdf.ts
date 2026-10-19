/**
 * Pull the text out of a PDF, one array of strings per page, in drawing order.
 *
 * pdf.js is large, so it is only loaded when someone actually picks a file.
 * The legacy build runs on older phone browsers too.
 */

import { tokensFromItems, type TextItem } from "./parsePdf";

export async function readPdfText(data: ArrayBuffer): Promise<string[][]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const pages: string[][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items: TextItem[] = [];
    for (const item of content.items) {
      if ("str" in item) items.push({ str: item.str, y: item.transform[5] });
    }
    pages.push(tokensFromItems(items));
  }
  await doc.destroy();
  return pages;
}
