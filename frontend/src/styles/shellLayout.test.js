import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const layout = readFileSync(resolve("src/styles/layout.css"), "utf8");

describe("app shell layout contract", () => {
  it("declares scroll padding for the pagebar and the compact bottom bar", () => {
    expect(layout).toMatch(/html \{ scroll-padding-top: calc\(var\(--shell-pagebar-height\)/);
    expect(layout).toMatch(/html:has\(\.app-shell\) \{ scroll-padding-bottom: calc\(var\(--mobile-nav-clearance\)/);
  });

  it("lays out four bottom-bar columns and uses only the 600/900 shell breakpoints", () => {
    expect(layout).toMatch(/\.app-nav__list \{[^}]*repeat\(4, minmax\(0, 1fr\)\)/);
    expect(layout).toContain("@media (min-width: 600px)");
    expect(layout).toContain("@media (min-width: 900px)");
  });

  it("does not make the sidebar scroll itself, so the account popover is not clipped", () => {
    const sidebarRules = layout.split("\n").filter((line) => line.trim().startsWith(".app-sidebar {"));
    expect(sidebarRules.length).toBeGreaterThan(0);
    for (const rule of sidebarRules) expect(rule).not.toMatch(/overflow/);
  });

  it("pads the scrolling nav by the focus ring extent so the ring is not clipped", () => {
    const ring = "calc\\(var\\(--focus-ring-width\\) \\+ var\\(--focus-ring-offset\\)\\)";
    const rule = layout.match(/\.app-nav \{ overflow-y: auto;[^}]*\}/)?.[0] ?? "";
    expect(rule).toMatch(new RegExp(`padding: ${ring}`));
    expect(rule).toMatch(new RegExp(`margin: calc\\(-1 \\* \\(var\\(--focus-ring-width\\) \\+ var\\(--focus-ring-offset\\)\\)\\)`));
  });
});
