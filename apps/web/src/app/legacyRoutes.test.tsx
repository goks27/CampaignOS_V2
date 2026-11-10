import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { legacyRoutes } from "./legacyRoutes";

function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}{l.search}{l.hash}</p>; }
const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><Routes>{legacyRoutes}<Route path="*" element={<Where />} /></Routes></MemoryRouter>);

describe("old addresses", () => {
  it.each([
    ["/campaigns", "/projects"],
    ["/tasks", "/inbox?type=tasks"],
    ["/reviews", "/inbox?type=findings"],
    ["/timeline", "/home#upcoming"],
    ["/reports", "/home#portfolio"],
    ["/team", "/settings?tab=team"],
    ["/live", "/live-test"],
  ])("%s lands on %s", (from, to) => {
    at(from);
    expect(screen.getByTestId("where").textContent).toBe(to);
  });

  it("keeps a task id or a campaign filter when it redirects", () => {
    at("/tasks?task=t9");
    expect(screen.getByTestId("where").textContent).toBe("/inbox?task=t9&type=tasks");
  });
  it("keeps the campaign filter on the old reviews address", () => {
    at("/reviews?campaign=c1&view=queue");
    expect(screen.getByTestId("where").textContent).toBe("/inbox?campaign=c1&view=queue&type=findings");
  });
});
