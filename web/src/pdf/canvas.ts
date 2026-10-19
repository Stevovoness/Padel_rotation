/**
 * A thin reportlab-style canvas over jsPDF.
 *
 * padel.py draws with reportlab: y grows upwards from the bottom of the page,
 * fill colour is shared by shapes and text, and rounded rectangles and circles
 * use reportlab's own Bezier factors. This wrapper keeps all of that, so the PDF
 * code ports line for line and draws the same shapes in the same places.
 */

import { jsPDF } from "jspdf";
import { stringWidth, winAnsi, type FontName } from "./metrics";

const RR_FACTOR = 0.4472; // reportlab pathobject.roundRect

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** jsPDF's standard fonts take text as WinAnsi bytes; anything else becomes "?". */
function toWinAnsi(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = winAnsi(ch);
    out += String.fromCharCode(code ?? 0x3f);
  }
  return out;
}

export class Canvas {
  readonly doc: jsPDF;
  private pageH = 0;
  private started = false;
  private fill = "#000000";
  private font: FontName = "Helvetica";
  private size = 12;

  constructor(private pageW: number) {
    // the real first page is sized in beginPage(); jsPDF needs one up front
    this.doc = new jsPDF({ unit: "pt", format: [pageW, 620], orientation: "portrait", compress: true });
  }

  /** Start a page `height` points tall (reportlab: setPageSize before drawing). */
  beginPage(height: number): void {
    const orientation = this.pageW > height ? "landscape" : "portrait";
    if (this.started) {
      this.doc.addPage([this.pageW, height], orientation);
    } else {
      // replace the placeholder page with one of the right size
      this.doc.addPage([this.pageW, height], orientation);
      this.doc.deletePage(1);
      this.started = true;
    }
    this.pageH = height;
  }

  private y(y: number): number {
    return this.pageH - y;
  }

  setFillColor(hex: string): void {
    this.fill = hex;
    this.doc.setFillColor(...hexToRgb(hex));
    this.doc.setTextColor(...hexToRgb(hex));
  }

  setStrokeColor(hex: string): void {
    this.doc.setDrawColor(...hexToRgb(hex));
  }

  setLineWidth(width: number): void {
    this.doc.setLineWidth(width);
  }

  setFont(font: FontName, size: number): void {
    this.font = font;
    this.size = size;
    this.doc.setFont("helvetica", font === "Helvetica-Bold" ? "bold" : "normal");
    this.doc.setFontSize(size);
  }

  stringWidth(text: string, font: FontName, size: number): number {
    return stringWidth(text, font, size);
  }

  saveState(): void {
    this.doc.saveGraphicsState();
  }

  restoreState(): void {
    this.doc.restoreGraphicsState();
    // jsPDF tracks colours itself; put ours back for later calls
    this.setFillColor(this.fill);
  }

  private paint(stroke: boolean, fill: boolean): void {
    if (stroke && fill) this.doc.fillStroke();
    else if (fill) this.doc.fill();
    else if (stroke) this.doc.stroke();
  }

  rect(x: number, y: number, w: number, h: number, stroke = 1, fill = 0): void {
    const doc = this.doc;
    doc.moveTo(x, this.y(y));
    doc.lineTo(x + w, this.y(y));
    doc.lineTo(x + w, this.y(y + h));
    doc.lineTo(x, this.y(y + h));
    doc.close();
    this.paint(!!stroke, !!fill);
  }

  roundRect(x: number, y: number, w: number, h: number, radius: number, stroke = 1, fill = 0): void {
    const doc = this.doc;
    const xlo = Math.min(x, x + w);
    const xhi = Math.max(x, x + w);
    const ylo = Math.min(y, y + h);
    const yhi = Math.max(y, y + h);
    const t = RR_FACTOR * radius;
    const Y = (v: number) => this.y(v);
    doc.moveTo(xlo + radius, Y(ylo));
    doc.lineTo(xhi - radius, Y(ylo));
    doc.curveTo(xhi - t, Y(ylo), xhi, Y(ylo + t), xhi, Y(ylo + radius));
    doc.lineTo(xhi, Y(yhi - radius));
    doc.curveTo(xhi, Y(yhi - t), xhi - t, Y(yhi), xhi - radius, Y(yhi));
    doc.lineTo(xlo + radius, Y(yhi));
    doc.curveTo(xlo + t, Y(yhi), xlo, Y(yhi - t), xlo, Y(yhi - radius));
    doc.lineTo(xlo, Y(ylo + radius));
    doc.curveTo(xlo, Y(ylo + t), xlo + t, Y(ylo), xlo + radius, Y(ylo));
    doc.close();
    this.paint(!!stroke, !!fill);
  }

  /** Four 90° arcs, as reportlab's pdfgeom.bezierArc draws a circle. */
  circle(cx: number, cy: number, r: number, stroke = 1, fill = 0): void {
    const doc = this.doc;
    const half = Math.PI / 4;
    const kappa = Math.abs(((4 / 3) * (1 - Math.cos(half))) / Math.sin(half));
    const pt = (a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    doc.moveTo(pt(0)[0], this.y(pt(0)[1]));
    for (let i = 0; i < 4; i++) {
      const t0 = (i * Math.PI) / 2;
      const t1 = ((i + 1) * Math.PI) / 2;
      const c1x = cx + r * (Math.cos(t0) - kappa * Math.sin(t0));
      const c1y = cy + r * (Math.sin(t0) + kappa * Math.cos(t0));
      const c2x = cx + r * (Math.cos(t1) + kappa * Math.sin(t1));
      const c2y = cy + r * (Math.sin(t1) - kappa * Math.cos(t1));
      const [ex, ey] = pt(t1);
      doc.curveTo(c1x, this.y(c1y), c2x, this.y(c2y), ex, this.y(ey));
    }
    doc.close();
    this.paint(!!stroke, !!fill);
  }

  line(x1: number, y1: number, x2: number, y2: number): void {
    this.doc.line(x1, this.y(y1), x2, this.y(y2), "S");
  }

  drawString(x: number, y: number, text: string, charSpace = 0): void {
    this.doc.text(toWinAnsi(text), x, this.y(y), charSpace ? { charSpace } : undefined);
  }

  currentFont(): [FontName, number] {
    return [this.font, this.size];
  }
}
