import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { needsConversion, toPdf } from "./toPdf";

const head = (f: File) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).slice(0, 5)); r.readAsText(f); });
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';

async function zipFile(name: string, entries: Record<string, string>) {
  const z = new JSZip();
  for (const [k, v] of Object.entries(entries)) z.file(k, v);
  return new File([await z.generateAsync({ type: "blob" })], name);
}

describe("toPdf", () => {
  it("leaves PDFs alone", async () => {
    const f = new File(["%PDF-1.4"], "a.pdf", { type: "application/pdf" });
    expect(needsConversion(f)).toBe(false);
    expect((await toPdf(f)).converted).toBe(false);
  });

  it("converts plain text to a PDF", async () => {
    const r = await toPdf(new File(["Users register with a mobile number.\nOTP is required."], "sow.txt", { type: "text/plain" }));
    expect(r.converted).toBe(true);
    expect(r.file.name).toBe("sow.pdf");
    expect(await head(r.file)).toBe("%PDF-");
  });

  it("converts PowerPoint text, one page per slide", async () => {
    const slide = (t: string) => `<p:sld ${NS} xmlns:p="x"><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:sld>`;
    const f = await zipFile("deck.pptx", { "ppt/slides/slide1.xml": slide("Welcome"), "ppt/slides/slide2.xml": slide("Rewards") });
    expect(await head((await toPdf(f)).file)).toBe("%PDF-");
  });

  it("converts Excel cells including shared strings", async () => {
    const f = await zipFile("rules.xlsx", {
      "xl/workbook.xml": `<workbook xmlns="x"><sheets><sheet name="Rules"/></sheets></workbook>`,
      "xl/sharedStrings.xml": `<sst xmlns="x"><si><t>Daily limit</t></si></sst>`,
      "xl/worksheets/sheet1.xml": `<worksheet xmlns="x"><sheetData><row><c t="s"><v>0</v></c><c><v>1</v></c></row></sheetData></worksheet>`,
    });
    expect((await toPdf(f)).converted).toBe(true);
  });

  it("explains what to do with formats it cannot convert", async () => {
    await expect(toPdf(new File(["x"], "old.doc"))).rejects.toThrow(/save as \.docx or PDF/);
    await expect(toPdf(new File(["x"], "a.zip"))).rejects.toThrow(/ZIP/);
  });

  it("refuses text it cannot write correctly instead of producing a garbled PDF", async () => {
    const hindi = "\u0928\u092e\u0938\u094d\u0924\u0947 \u0926\u0941\u0928\u093f\u092f\u093e \u092f\u0939 \u090f\u0915 \u092a\u0930\u0940\u0915\u094d\u0937\u0923 \u0939\u0948";
    await expect(toPdf(new File([hindi], "hindi.txt", { type: "text/plain" }))).rejects.toThrow(/characters/);
  });

  it("refuses empty files", async () => {
    await expect(toPdf(new File([""], "empty.txt", { type: "text/plain" }))).rejects.toThrow(/nothing to convert/);
  });
});
