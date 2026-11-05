import { describe, expect, it } from "vitest";
import { liveHeadline, placeLabel } from "./model";

describe("live view labels", () => {
  it("says where the browser is", () => {
    expect(placeLabel(null)).toBe("");
    expect(placeLabel({ device: "desktop", pageNo: 2, pageTotal: 10, url: "https://thedigitalapps.com/bector-food" })).toBe("Desktop · page 2 of 10 · /bector-food");
    expect(placeLabel({ device: "mobile", url: "https://x.test/" })).toBe("Phone · x.test");
    expect(placeLabel({ pageNo: 1 })).toBe("page 1");
  });
  it("starts the step with a capital", () => {
    expect(liveHeadline("checking page 3: /offers")).toBe("Checking page 3: /offers");
    expect(liveHeadline("")).toBe("Starting");
  });
});

describe("live view names the device being tested", () => {
  it("shows the device's own name", () => {
    expect(placeLabel({ device: "iPhone 15", pageNo: 3, pageTotal: 8, url: "https://x.test/offers" })).toBe("iPhone 15 · page 3 of 8 · /offers");
    expect(placeLabel({ device: "Pixel 7 (Android)", pageNo: 1 })).toBe("Pixel 7 (Android) · page 1");
  });
});
