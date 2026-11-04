import { describe, expect, it } from "vitest";
import { classify, domainAllowed, domainOf, MAX_REQUEST_BYTES, newId, playgroundService, type Item } from "./playground";

const file = (name: string, type = "", content = "x") => new File([content], name, { type });

describe("classify", () => {
  it("recognises what the playground can check", () => {
    expect(classify(file("a.PNG"))).toBe("image");
    expect(classify(file("a.jpeg"))).toBe("image");
    expect(classify(file("deck.pdf"))).toBe("pdf");
    expect(classify(file("sow.docx"))).toBe("pdf"); // converted to PDF when sent
    expect(classify(file("sheet.xlsx"))).toBe("pdf");
    expect(classify(file("slides.pptx"))).toBe("pdf");
    expect(classify(file("notes.md"))).toBe("text");
    expect(classify(file("data.csv"))).toBe("text");
  });
  it("refuses everything else", () => {
    expect(classify(file("run.exe"))).toBeNull();
    expect(classify(file("archive.zip"))).toBeNull();
    expect(classify(file("old.doc"))).toBeNull();
  });
});

describe("domains", () => {
  it("extracts the host and matches exact and wildcard entries only", () => {
    expect(domainOf("https://Stg.Example.com/a?b=1")).toBe("stg.example.com");
    expect(domainOf("nonsense")).toBe("");
    expect(domainAllowed("stg.example.com", ["stg.example.com"])).toBe(true);
    expect(domainAllowed("a.stg.example.com", ["*.stg.example.com"])).toBe(true);
    expect(domainAllowed("evilstg.example.com", ["*.stg.example.com"])).toBe(false);
    expect(domainAllowed("example.com", [])).toBe(false);
  });
});

describe("prepare", () => {
  it("sends the page's own item ids so findings can be pinned on the right card", async () => {
    const items: Item[] = [
      { id: "p1", kind: "text", name: "brief.txt", file: file("brief.txt", "text/plain", "Hello"), bytes: 5 },
      { id: "p2", kind: "url", name: "stg.example.com", url: "https://stg.example.com/", device: "mobile" },
    ];
    const body = await playgroundService.prepare(items);
    expect(body.files).toEqual([{ id: "p1", name: "brief.txt", kind: "text", text: "Hello" }]);
    expect(body.urls).toEqual([{ id: "p2", url: "https://stg.example.com/", device: "mobile" }]);
  });

  it("refuses a request that is too big to send, with a readable message", async () => {
    const big = "x".repeat(MAX_REQUEST_BYTES + 10);
    const items: Item[] = [{ id: newId(), kind: "text", name: "huge.txt", file: file("huge.txt", "text/plain", big), bytes: big.length }];
    await expect(playgroundService.prepare(items)).rejects.toThrow(/40 MB limit/);
  });
});
