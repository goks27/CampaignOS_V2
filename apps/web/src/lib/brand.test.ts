import { describe, expect, it } from "vitest";
import { brandMime, guessBrandKind, isPicture } from "./brand";
import { validateFile } from "@/services/storage";

const f = (name: string, type = "", size = 10) => Object.assign(new Blob([new Uint8Array(size)], { type }), { name });

describe("brandMime", () => {
  it("trusts the extension for files browsers describe badly", () => {
    expect(brandMime(f("Logo.SVG"))).toBe("image/svg+xml");
    expect(brandMime(f("Inter.woff2", "application/octet-stream"))).toBe("font/woff2");
    expect(brandMime(f("brand.ai"))).toBe("application/vnd.adobe.illustrator");
  });
  it("refuses what is not a brand file", () => {
    expect(brandMime(f("run.exe", "application/x-msdownload"))).toBeNull();
    expect(brandMime(f("page.html", "text/html"))).toBeNull();
  });
});

describe("guessBrandKind", () => {
  it("labels the common files", () => {
    expect(guessBrandKind(f("BigCity-Logo.svg"))).toBe("logo");
    expect(guessBrandKind(f("favicon.ico"))).toBe("icon");
    expect(guessBrandKind(f("Brand Guidelines v3.pdf"))).toBe("brand_guide");
    expect(guessBrandKind(f("Inter-Bold.ttf"))).toBe("font");
    expect(guessBrandKind(f("hero.jpg", "image/jpeg"))).toBe("imagery");
    expect(guessBrandKind(f("pack.zip"))).toBe("other");
  });
});

describe("isPicture", () => {
  it("shows pictures only", () => {
    expect(isPicture("image/svg+xml")).toBe(true);
    expect(isPicture("font/ttf")).toBe(false);
    expect(isPicture(null)).toBe(false);
  });
});

describe("brand uploads are validated", () => {
  it("accepts a logo and a font with no browser type", () => {
    expect(validateFile("brand", f("logo.svg", "image/svg+xml"))).toBeNull();
    expect(validateFile("brand", f("Inter.ttf"))).toBeNull();
  });
  it("blocks scripts, pages and anything over 25 MB", () => {
    expect(validateFile("brand", f("x.js", "text/javascript"))).toMatch(/not allowed/);
    expect(validateFile("brand", f("x.html", "text/html"))).toMatch(/not allowed/);
    expect(validateFile("brand", f("big.png", "image/png", 26 * 1048576))).toMatch(/limit is 25 MB/);
  });
});
