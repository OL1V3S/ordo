import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The frontend verification lane runs from frontend/; Vitest stubs CSS imports.
const tokensCss = readFileSync(resolve("src/styles/tokens.css"), "utf8");
const themesCss = readFileSync(resolve("src/styles/themes.css"), "utf8");

const INVALID = Symbol("guaranteed-invalid");

function blockBody(css, marker) {
  const markerIndex = css.indexOf(marker);
  expect(markerIndex, `missing selector ${marker}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", markerIndex);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

// Raw (untrimmed) declarations so the exact `--if-dark: ;` text can be asserted.
function rawDeclarations(body) {
  const declarations = {};
  for (const match of body.matchAll(/(--[\w-]+|color-scheme):([^;]*);/g)) {
    declarations[match[1]] = match[2];
  }
  return declarations;
}

function splitTopLevelComma(text) {
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    else if (text[index] === ")") depth -= 1;
    else if (text[index] === "," && depth === 0) return [text.slice(0, index), text.slice(index + 1)];
  }
  return [text, undefined];
}

function resolveValue(value, env) {
  let result = value;
  for (;;) {
    const start = result.indexOf("var(");
    if (start < 0) break;
    let depth = 0;
    let end = start + 3;
    for (; end < result.length; end += 1) {
      if (result[end] === "(") depth += 1;
      if (result[end] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const [name, fallback] = splitTopLevelComma(result.slice(start + 4, end));
    const own = env[name.trim()];
    let replacement;
    if (own !== undefined && own.trim() !== "initial") replacement = resolveValue(own, env);
    else if (own === undefined && fallback !== undefined) replacement = resolveValue(fallback, env);
    else if (own !== undefined && fallback !== undefined) replacement = resolveValue(fallback, env);
    else replacement = INVALID;
    expect(replacement, `unresolvable var(${name.trim()}) in ${value}`).not.toBe(INVALID);
    result = result.slice(0, start) + replacement + result.slice(end + 1);
  }
  return result;
}

const sharedDeclarations = {
  ...rawDeclarations(blockBody(tokensCss, ":root {")),
  ...rawDeclarations(blockBody(themesCss, "\n:root {")),
};

const modeBlocks = {
  light: rawDeclarations(blockBody(themesCss, ":root,")),
  dark: rawDeclarations(blockBody(themesCss, ':root[data-theme="dark"]')),
  systemDark: rawDeclarations(blockBody(themesCss, ":root:not([data-theme])")),
};

function resolveTheme(mode) {
  const env = { ...sharedDeclarations, "--if-light": modeBlocks[mode]["--if-light"], "--if-dark": modeBlocks[mode]["--if-dark"] };
  const resolved = {};
  for (const [name, value] of Object.entries(sharedDeclarations)) {
    resolved[name] = resolveValue(value, env).replace(/\s+/g, " ").trim().toLowerCase();
  }
  return resolved;
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
  const light = resolveTheme("light");
  const dark = resolveTheme("dark");
  const systemDark = resolveTheme("systemDark");

  it("keeps the approved source palette in explicit light and dark modes", () => {
    expect(light).toMatchObject(expectedLight);
    expect(dark).toMatchObject(expectedDark);
  });

  it("keeps the mode switch as exact toggle text with no token values", () => {
    expect(themesCss).toContain("--if-dark: ;");
    expect(themesCss).toContain("--if-light: ;");
    expect(modeBlocks.light).toEqual({ "color-scheme": " light", "--if-light": " initial", "--if-dark": " " });
    expect(modeBlocks.dark).toEqual({ "color-scheme": " dark", "--if-light": " ", "--if-dark": " initial" });
    expect(modeBlocks.systemDark).toEqual(modeBlocks.dark);
  });

  it("gives system dark mode the same complete palette as explicit dark mode", () => {
    expect(systemDark).toEqual(dark);
    const semanticTokens = Object.keys(sharedDeclarations).filter((name) => /^--(color-|chart-)/.test(name) && !name.includes("hover") || name === "--color-accent-hover");
    for (const token of semanticTokens.filter((name) => name !== "--color-danger-hover")) {
      expect(light[token], token).toMatch(/^#[\da-f]{6}$/);
      expect(dark[token], token).toMatch(/^#[\da-f]{6}$/);
    }
    expect(light["--card-shadow"]).toBe("none");
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
    ["light text on canvas", light, "--color-text", "--color-canvas"],
    ["light text on surface", light, "--color-text", "--color-surface"],
    ["light text on sunken", light, "--color-text", "--color-surface-sunken"],
    ["light text on raised", light, "--color-text", "--color-surface-raised"],
    ["light muted on canvas", light, "--color-text-muted", "--color-canvas"],
    ["light muted on surface", light, "--color-text-muted", "--color-surface"],
    ["light muted on sunken", light, "--color-text-muted", "--color-surface-sunken"],
    ["light muted on raised", light, "--color-text-muted", "--color-surface-raised"],
    ["light amount-in on surface", light, "--color-amount-in", "--color-surface"],
    ["light amount-in on canvas", light, "--color-amount-in", "--color-canvas"],
    ["light accent on surface", light, "--color-accent", "--color-surface"],
    ["light accent on canvas", light, "--color-accent", "--color-canvas"],
    ["dark text on canvas", dark, "--color-text", "--color-canvas"],
    ["dark text on surface", dark, "--color-text", "--color-surface"],
    ["dark text on sunken", dark, "--color-text", "--color-surface-sunken"],
    ["dark text on raised", dark, "--color-text", "--color-surface-raised"],
    ["dark muted on canvas", dark, "--color-text-muted", "--color-canvas"],
    ["dark muted on surface", dark, "--color-text-muted", "--color-surface"],
    ["dark muted on sunken", dark, "--color-text-muted", "--color-surface-sunken"],
    ["dark muted on raised", dark, "--color-text-muted", "--color-surface-raised"],
    ["dark amount-in on surface", dark, "--color-amount-in", "--color-surface"],
    ["dark amount-in on canvas", dark, "--color-amount-in", "--color-canvas"],
    ["dark accent on surface", dark, "--color-accent", "--color-surface"],
    ["dark accent on canvas", dark, "--color-accent", "--color-canvas"],
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
    ["light border-strong on surface", light, "--color-border-strong", "--color-surface"],
    ["dark border-strong on surface", dark, "--color-border-strong", "--color-surface"],
    ["light focus on canvas", light, "--color-focus", "--color-canvas"],
    ["dark focus on canvas", dark, "--color-focus", "--color-canvas"],
    ["light focus on sunken", light, "--color-focus", "--color-surface-sunken"],
    ["dark focus on sunken", dark, "--color-focus", "--color-surface-sunken"],
    ["light focus on raised", light, "--color-focus", "--color-surface-raised"],
    ["dark focus on raised", dark, "--color-focus", "--color-surface-raised"],
  ])("meets non-text contrast for %s", (_name, theme, foreground, background) => {
    expect(contrast(theme[foreground], theme[background])).toBeGreaterThanOrEqual(3);
  });

  it.each([
    ["--color-bg", "--color-canvas"],
    ["--color-bg-accent", "--color-accent-subtle"],
    ["--color-surface-subtle", "--color-surface-sunken"],
    ["--color-divider", "--color-border-subtle"],
    ["--color-control-border", "--color-border-strong"],
    ["--color-placeholder", "--color-text-placeholder"],
    ["--color-primary", "--color-accent"],
    ["--color-primary-hover", "--color-accent-hover"],
    ["--color-on-primary", "--color-on-accent"],
    ["--shadow-md", "--shadow-overlay"],
  ])("resolves legacy alias %s equal to %s in both modes", (legacy, current) => {
    expect(light[legacy]).toBe(light[current]);
    expect(dark[legacy]).toBe(dark[current]);
  });
});
