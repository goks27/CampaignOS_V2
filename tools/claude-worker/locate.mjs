/** Finds the element a scenario step means: a CSS selector, or a label, placeholder, button or link text. Shared by staging scenarios and Live test. */
export async function locateTarget(page, target, kind) {
  if (/^[#.[]|^\w+\[|^\/\//.test(target) || target.startsWith("css=")) return page.locator(target.replace(/^css=/, "")).first();
  if (kind === "fill") for (const loc of [page.getByLabel(target), page.getByPlaceholder(target)]) if (await loc.count()) return loc.first();
  if (kind === "click") for (const loc of [page.getByRole("button", { name: target }), page.getByRole("link", { name: target })]) if (await loc.count()) return loc.first();
  if (kind === "check") { const loc = page.getByLabel(target); if (await loc.count()) return loc.first(); }
  return page.getByText(target, { exact: false }).first();
}
