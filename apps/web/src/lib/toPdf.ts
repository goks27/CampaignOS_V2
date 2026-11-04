/**
 * Converts uploaded files to PDF in the browser, so the AI worker (which reads PDFs) can analyse them.
 * Nothing is sent anywhere: conversion happens on the uploader's machine. Libraries load only when needed.
 *
 * Fidelity: Word, Excel and PowerPoint are converted from their TEXT (layout, images and styling are not kept).
 * That is what requirement extraction needs; the original file is stored next to the PDF.
 */

export type PdfResult = { file: File; converted: boolean; originalName: string };

const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
const PLAIN = /\.(txt|csv|md|markdown)$/i;

// FileReader works in every browser (and in the jsdom test environment, which lacks Blob.text/arrayBuffer).
const readBuffer = (f: Blob) => new Promise<ArrayBuffer>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as ArrayBuffer); r.onerror = () => rej(r.error); r.readAsArrayBuffer(f); });
const readText = (f: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsText(f); });

function ext(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}
const pdfName = (name: string) => name.replace(/\.[^.]+$/, "") + ".pdf";

export function needsConversion(file: File) {
  return !(file.type === "application/pdf" || ext(file.name) === "pdf");
}

export async function toPdf(file: File): Promise<PdfResult> {
  const e = ext(file.name);
  if (!needsConversion(file)) return { file, converted: false, originalName: file.name };

  let pdf: Blob;
  if (IMAGE.test(file.name)) pdf = await imageToPdf(file);
  else if (e === "docx") pdf = await pagesToPdf([await docxText(file)]);
  else if (e === "xlsx") pdf = await pagesToPdf(await xlsxPages(file));
  else if (e === "pptx") pdf = await pagesToPdf(await pptxPages(file));
  else if (PLAIN.test(file.name)) pdf = await pagesToPdf([await readText(file)]);
  else if (["doc", "xls", "ppt", "rtf"].includes(e)) {
    throw new Error(`Old .${e} files can't be converted here. Open it and save as .${e === "doc" || e === "rtf" ? "docx" : e + "x"} or PDF, then upload again.`);
  } else if (e === "zip") {
    throw new Error("ZIP files can't be converted. Upload the SOW itself (PDF, Word, Excel, PowerPoint, text or image).");
  } else throw new Error(`.${e || "this"} files can't be converted to PDF.`);

  return { file: new File([pdf], pdfName(file.name), { type: "application/pdf" }), converted: true, originalName: file.name };
}

// ---------------------------------------------------------------- text to PDF
// Standard PDF fonts only cover Western characters. Say so, rather than writing garbage into a SOW.
// (Unicode escapes keep this file safe from encoding problems.)
const REPLACE: [RegExp, string][] = [
  [/[\u2018\u2019]/g, "'"], [/[\u201c\u201d]/g, '"'], [/[\u2013\u2014]/g, "-"], [/\u2026/g, "..."],
  [/[\u2022\u00b7\u25aa\u25cf]/g, "-"], [/\u00a0/g, " "], [/\t/g, "    "],
];

function clean(text: string) {
  let t = text.replace(/\r\n?/g, "\n");
  for (const [re, to] of REPLACE) t = t.replace(re, to);
  return t;
}

async function pagesToPdf(sections: string[]): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48, lineH = 14;
  const width = doc.internal.pageSize.getWidth() - margin * 2;
  const bottom = doc.internal.pageSize.getHeight() - margin;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  let first = true, wrote = false;
  for (const raw of sections) {
    const text = clean(raw);
    // eslint-disable-next-line no-control-regex
    const bad = text.match(/[^\u0000-\u00ff]/g);
    if (bad && bad.length > 3) {
      throw new Error("This file contains characters (for example Hindi, Telugu or emoji) that can't be written into a converted PDF. Export it to PDF from Word/Excel/PowerPoint and upload that instead.");
    }
    if (!first) doc.addPage();
    first = false;
    let y = margin;
    for (const para of text.split("\n")) {
      const lines: string[] = para.trim() === "" ? [""] : doc.splitTextToSize(para, width);
      for (const line of lines) {
        if (y > bottom) { doc.addPage(); y = margin; }
        if (line) { doc.text(line, margin, y); wrote = true; }
        y += lineH;
      }
    }
  }
  if (!wrote) throw new Error("No readable text was found in this file, so there is nothing to convert.");
  return doc.output("blob");
}

async function imageToPdf(file: File): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width; canvas.height = bmp.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read the image.");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0);
  const url = canvas.toDataURL("image/jpeg", 0.9);
  const landscape = bmp.width > bmp.height;
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: landscape ? "landscape" : "portrait" });
  const pw = doc.internal.pageSize.getWidth(), ph = doc.internal.pageSize.getHeight();
  const scale = Math.min(pw / bmp.width, ph / bmp.height);
  doc.addImage(url, "JPEG", (pw - bmp.width * scale) / 2, (ph - bmp.height * scale) / 2, bmp.width * scale, bmp.height * scale);
  return doc.output("blob");
}

// ---------------------------------------------------------------- Word
async function docxText(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ arrayBuffer: await readBuffer(file) });
  return value;
}

// ---------------------------------------------------------------- Excel / PowerPoint (OOXML zip)
const parse = (s: string) => new DOMParser().parseFromString(s, "application/xml");
/** Elements by local name, whatever their namespace prefix (a:p, p:sp, ...). */
const els = (root: Document | Element, name: string): Element[] => Array.from(root.getElementsByTagNameNS("*", name));
const byNumber = (a: string, b: string) => parseInt(a.replace(/\D/g, ""), 10) - parseInt(b.replace(/\D/g, ""), 10);

async function xlsxPages(file: File): Promise<string[]> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await readBuffer(file));
  const shared: string[] = [];
  const ss = zip.file("xl/sharedStrings.xml");
  if (ss) els(parse(await ss.async("string")), "si").forEach((si) => shared.push(els(si, "t").map((t) => t.textContent ?? "").join("")));
  const names: string[] = [];
  const wb = zip.file("xl/workbook.xml");
  if (wb) els(parse(await wb.async("string")), "sheet").forEach((s) => names.push(s.getAttribute("name") ?? ""));
  const sheetFiles = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort(byNumber);
  const pages: string[] = [];
  for (const [i, f] of sheetFiles.entries()) {
    const rows: string[] = [];
    els(parse(await zip.file(f)!.async("string")), "row").forEach((row) => {
      const cells = els(row, "c").map((c) => {
        const v = els(c, "v")[0]?.textContent ?? els(c, "t")[0]?.textContent ?? "";
        return c.getAttribute("t") === "s" ? shared[Number(v)] ?? "" : v;
      });
      if (cells.some((x) => x !== "")) rows.push(cells.join(" | "));
    });
    if (rows.length) pages.push(`Sheet: ${names[i] || i + 1}\n\n${rows.join("\n")}`);
  }
  return pages;
}

async function pptxPages(file: File): Promise<string[]> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await readBuffer(file));
  const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(byNumber);
  const pages: string[] = [];
  for (const [i, f] of slides.entries()) {
    const paras: string[] = [];
    els(parse(await zip.file(f)!.async("string")), "p").forEach((p) => {
      const t = els(p, "t").map((x) => x.textContent ?? "").join("");
      if (t.trim()) paras.push(t);
    });
    if (paras.length) pages.push(`Slide ${i + 1}\n\n${paras.join("\n")}`);
  }
  return pages;
}
