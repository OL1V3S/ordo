import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The frontend verification lane runs from frontend/; Vitest stubs CSS imports.
const themesCss = readFileSync(resolve("src/styles/themes.css"), "utf8");

function declarationsAfter(marker) {
  const markerIndex = themesCss.indexOf(marker);
  expect(markerIndex, `missing theme selector ${marker}`).toBeGreaterThanOrEqual(0);
  const openingBrace = themesCss.indexOf("{", markerIndex);
  const closingBrace = themesCss.indexOf("}", openingBrace);
  const declarations = {};

  for (const match of themesCss.slice(openingBrace + 1, closingBrace).matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    declarations[match[1]] = match[2].trim().toLowerCase();
  }

  return declarations;
}

function luminance(hex) {
  const channels = hex.match(/[\da-f]{2}/gi).map((channel) => Number.parseInt(channel, 16) / 255);
  const [red, green, blue] = channels.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function contrast(first, second) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

const expectedLight = {
  "--color-bg": "#f5f5f1",
  "--color-primary": "#5458c9",
  "--color-text-muted": "#666873",
};

const expectedDark = {
  "--color-bg": "#0d1017",
  "--color-primary": "#8d91ff",
  "--color-text-muted": "#a1a4ad",
};

const requiredChartTokens = [
  "--chart-spent",
  "--chart-limit",
  "--chart-text",
  "--chart-grid",
  "--chart-border",
  "--chart-surface",
];

describe("theme palette", () => {
  const light = declarationsAfter(":root,");
  const dark = declarationsAfter(':root[data-theme="dark"]');
  const systemDark = declarationsAfter(":root:not([data-theme])");

  it("keeps the approved source palette in explicit light and dark modes", () => {
    expect(light).toMatchObject(expectedLight);
    expect(dark).toMatchObject(expectedDark);
  });

  it("gives system dark mode the same complete palette as explicit dark mode", () => {
    expect(systemDark).toEqual(dark);
    for (const token of requiredChartTokens) {
      expect(light[token]).toMatch(/^#[\da-f]{6}$/);
      expect(dark[token]).toMatch(/^#[\da-f]{6}$/);
    }
  });

  it.each([
    ["light body text", light, "--color-text", "--color-bg"],
    ["light muted text", light, "--color-text-muted", "--color-bg"],
    ["light muted text on accent", light, "--color-text-muted", "--color-bg-accent"],
    ["light placeholder", light, "--color-placeholder", "--color-surface-raised"],
    ["light disabled text", light, "--color-disabled-text", "--color-disabled-surface"],
    ["light primary button", light, "--color-on-primary", "--color-primary"],
    ["light danger button", light, "--color-on-danger", "--color-danger"],
    ["light danger status", light, "--color-danger", "--color-danger-soft"],
    ["light warning status", light, "--color-warning", "--color-warning-soft"],
    ["light success status", light, "--color-success", "--color-success-soft"],
    ["light info status", light, "--color-info", "--color-info-soft"],
    ["dark body text", dark, "--color-text", "--color-bg"],
    ["dark muted text", dark, "--color-text-muted", "--color-surface-raised"],
    ["dark placeholder", dark, "--color-placeholder", "--color-surface-raised"],
    ["dark disabled text", dark, "--color-disabled-text", "--color-disabled-surface"],
    ["dark primary button", dark, "--color-on-primary", "--color-primary"],
    ["dark danger button", dark, "--color-on-danger", "--color-danger"],
    ["dark danger status", dark, "--color-danger", "--color-danger-soft"],
    ["dark warning status", dark, "--color-warning", "--color-warning-soft"],
    ["dark success status", dark, "--color-success", "--color-success-soft"],
    ["dark info status", dark, "--color-info", "--color-info-soft"],
  ])("meets normal-text contrast for %s", (_name, theme, foreground, background) => {
    expect(contrast(theme[foreground], theme[background])).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["light control border", light, "--color-control-border", "--color-surface-raised"],
    ["light focus", light, "--color-focus", "--color-surface"],
    ["light warning border", light, "--color-warning", "--color-surface"],
    ["light warning border on tint", light, "--color-warning", "--color-warning-soft"],
    ["dark warning border", dark, "--color-warning", "--color-surface"],
    ["dark warning border on tint", dark, "--color-warning", "--color-warning-soft"],
    ["dark control border", dark, "--color-control-border", "--color-surface-raised"],
    ["dark focus", dark, "--color-focus", "--color-surface"],
  ])("meets non-text contrast for %s", (_name, theme, foreground, background) => {
    expect(contrast(theme[foreground], theme[background])).toBeGreaterThanOrEqual(3);
  });

});
