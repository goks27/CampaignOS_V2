import { autoMap, mapRow, toDate, toStage } from "./mapping";

describe("Notion CSV mapping", () => {
  it("maps common Notion headers", () => {
    const m = autoMap(["Name", "Client", "Stage", "Launch date", "Journeys", "Staging URL"]);
    expect(m).toMatchObject({ name: "Name", client: "Client", stage: "Stage", target_launch_date: "Launch date", journeys: "Journeys", staging_url: "Staging URL" });
  });
  it("parses Notion and Indian date formats", () => {
    expect(toDate("November 3, 2026")).toBe("2026-11-03");
    expect(toDate("03/11/2026")).toBe("2026-11-03");
    expect(toDate("2026-11-03")).toBe("2026-11-03");
    expect(toDate("Nov 1, 2026 → Nov 30, 2026", "end")).toBe("2026-11-30");
    expect(toDate("not a date")).toBe("");
  });
  it("normalises stages", () => {
    expect(toStage("In Design")).toBe("design");
    expect(toStage("UAT")).toBe("client_uat");
    expect(toStage("QA")).toBe("internal_qa");
    expect(toStage("Brief & Planning")).toBe("brief_planning");
    expect(toStage("")).toBe("");
  });
  it("cleans Notion relation links and splits journeys", () => {
    const row = mapRow(
      { Name: "Gold Drop", Client: "BigCity (https://www.notion.so/abc123)", Journeys: "Consumer promotion, Telangana retailer contest", Staging: "staging.example.com" },
      { name: "Name", client: "Client", journeys: "Journeys", staging_url: "Staging" },
    );
    expect(row.client).toBe("BigCity");
    expect(row.journeys).toBe("Consumer promotion; Telangana retailer contest");
    expect(row.staging_url).toBe("https://staging.example.com/");
  });
});
