import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Literal lint: feature CSS must use design tokens (see docs/design-tokens.md).
// Allowlist entries are { file, property, value, reason }; one entry covers every repeat
// of the same normalized declaration in that file. Unused entries fail the test.
const srcRoot = resolve("src");
const skippedFiles = new Set(["styles/tokens.css", "styles/themes.css"]);
const allowedBreakpoints = new Set([600, 900, 599.98, 899.98]);
const legacyBreakpoints = new Set([1100, 1000, 820, 760, 720, 620, 520, 430, 400, 360]);
const importFrozen = "import frozen until the owner redesigns import";

const allowlist = [
  { file: "styles/globals.css", property: "margin", value: "-1px", reason: "sr-only visually-hidden pattern" },
  { file: "styles/components.css", property: "font-weight", value: "800", reason: importFrozen },
  { file: "styles/globals.css", property: "font-size", value: "clamp(var(--text-2xl), 1.45rem + 1.2vw, var(--text-3xl))", reason: "fluid h1 ramp; media queries cannot use tokens for the middle term" },
  { file: "styles/components.css", property: "background", value: "repeating-linear-gradient(135deg, transparent 0, transparent 3px, var(--chart-text) 3px, var(--chart-text) 4px), var(--chart-other)", reason: "hatch pattern is a non-color encoding for the Other segment" },
  { file: "styles/activity.css", property: "margin", value: "-1px", reason: "sr-only visually-hidden table header pattern" },
  { file: "styles/inflows.css", property: "margin", value: "-1px", reason: "sr-only visually-hidden table header pattern" },
  { file: "styles/components.css", property: "padding-block", value: ".625rem", reason: "summary block padding tuned for 44px target" },
  { file: "styles/components.css", property: "padding-block", value: ".45rem", reason: "theme/language select padding" },
  { file: "styles/components.css", property: "gap", value: "2px", reason: "mobile nav icon/label gap" },
  { file: "styles/components.css", property: "padding", value: "var(--space-1) 2px", reason: "mobile nav link padding" },
  { file: "styles/components.css", property: "padding-left", value: "1.25rem", reason: "list indent" },
  { file: "styles/components.css", property: "padding", value: ".35rem .5rem", reason: "import badge padding; import frozen until the owner redesigns import" },
  { file: "styles/components.css", property: "margin-top", value: ".2rem", reason: "import checkbox alignment; import frozen until the owner redesigns import" },
  { file: "styles/components.css", property: "padding-block", value: "calc((var(--size-touch-target) - 1.5em) / 2)", reason: "centers summary text in the touch target" },
  { file: "styles/components.css", property: "gap", value: ".15rem", reason: "tight evidence item gap" },
  { file: "styles/components.css", property: "padding", value: ".3rem .55rem", reason: "status badge padding" },
  { file: "styles/components.css", property: "padding", value: ".35rem .55rem", reason: "missing-item badge padding" },
  { file: "styles/layout.css", property: "padding", value: "clamp(1.5rem, 2.5vw, 2.5rem)", reason: "desktop content padding clamp; max has no token" },
  { file: "styles/secondary-pages.css", property: "padding", value: ".2rem .45rem", reason: "secondary link status badge padding" },
];

function listCss(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return listCss(path);
    return name.endsWith(".css") ? [path] : [];
  });
}

const normalize = (text) => text.replace(/\s+/g, " ").trim().toLowerCase();

function parseDeclarations(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const stack = [];
  const declarations = [];
  let buffer = "";
  for (const char of stripped) {
    if (char === "{") {
      stack.push(normalize(buffer));
      buffer = "";
    } else if (char === "}" || char === ";") {
      if (buffer.trim() && buffer.includes(":") && stack.length > 0) {
        const index = buffer.indexOf(":");
        declarations.push({
          property: normalize(buffer.slice(0, index)),
          value: normalize(buffer.slice(index + 1)),
          selector: stack[stack.length - 1],
          media: stack.filter((prelude) => prelude.startsWith("@media")),
        });
      }
      buffer = "";
      if (char === "}") stack.pop();
    } else {
      buffer += char;
    }
  }
  const media = [];
  for (const match of stripped.matchAll(/@media[^{]*/g)) media.push(match[0]);
  return { declarations, media };
}

const namedColors = "black|white|red|green|blue|yellow|orange|purple|pink|gray|grey|silver|navy|teal|maroon|olive|lime|aqua|fuchsia|brown|gold";
const namedColorRegex = new RegExp(`(?<![\\w-])(${namedColors})(?![\\w-])`);
const colorProperty = /^(color|background|background-color|border|border-[a-z-]*|outline|outline-color|box-shadow|fill|stroke|text-decoration|text-decoration-color|caret-color|accent-color)$/;
const nonzeroLength = /(?<![\w.])(-?\d*\.?\d+)(rem|px|em)\b/g;

function violationsFor({ property, value, selector }) {
  const found = [];
  if (/#[\da-f]{3,8}\b/.test(value) && property !== "content") found.push("hex color");
  if (/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/.test(value)) found.push("color function");
  if (colorProperty.test(property) && namedColorRegex.test(value)) found.push("named color");
  if (property === "font" && value !== "inherit") found.push("font shorthand");
  if (property === "font-weight" && !/^(var\(--weight-[a-z]+\)|inherit)$/.test(value)) found.push("font-weight literal");
  if (property === "font-size") {
    const rest = value.replace(/var\([^)]*\)/g, "").replace(/(clamp|calc|min|max)\(/g, "(");
    if (value !== "inherit" && !/^var\(--text-[\w-]+\)$/.test(value) && !/^[\s(),+*/\-\d.]*(vw)?[\s(),+*/\-\d.vw]*$/.test(rest)) found.push("font-size literal");
    else if (!/^var\(--text-[\w-]+\)$/.test(value) && value !== "inherit" && /(rem|px|em)\b/.test(rest)) found.push("font-size literal");
  }
  if (/^border(-[a-z]+)*-radius$/.test(property)) {
    const rest = value.replace(/var\(--(?:radius-[\w-]+|[\w-]+-radius)\)/g, "").replace(/\b0\b|50%|inherit/g, "").trim();
    if (rest) found.push("radius literal");
  }
  if (property === "box-shadow" && value !== "none" && !/^var\(--[\w-]+\)$/.test(value) && !/^inset [-\w.\s]+ var\(--[\w-]+\)$/.test(value)) found.push("box-shadow literal");
  if (/^(padding|margin)(-[a-z]+)*$|^(gap|row-gap|column-gap)$/.test(property)) {
    for (const match of value.matchAll(nonzeroLength)) {
      if (Number(match[1]) !== 0) { found.push("spacing literal"); break; }
    }
  }
  if (/gradient\(/.test(value)) found.push("gradient");
  if (/translatey\(-/.test(value) && /:hover/.test(selector)) found.push("hover lift");
  return found;
}

const files = listCss(srcRoot).map((path) => ({ path, name: relative(srcRoot, path).split("\\").join("/") }))
  .filter(({ name }) => !skippedFiles.has(name));

describe("token literal lint", () => {
  const used = new Set();
  const problems = [];
  const breakpointProblems = [];

  for (const { path, name } of files) {
    const { declarations, media } = parseDeclarations(readFileSync(path, "utf8"));
    for (const declaration of declarations) {
      for (const kind of violationsFor(declaration)) {
        const index = allowlist.findIndex((entry) => entry.file === name && entry.property === declaration.property && normalize(entry.value) === declaration.value);
        if (index >= 0) used.add(index);
        else problems.push(`${name}: ${kind}: ${declaration.property}: ${declaration.value}  [${declaration.selector.slice(0, 60)}]`);
      }
    }
    for (const query of media) {
      for (const match of query.matchAll(/(?:max|min)-width:\s*([\d.]+)px/g)) {
        const width = Number(match[1]);
        if (!allowedBreakpoints.has(width) && !legacyBreakpoints.has(width)) breakpointProblems.push(`${name}: ${query.trim()}`);
      }
    }
  }

  it("scans the style sources", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it("has no unapproved literals", () => {
    expect(problems).toEqual([]);
  });

  it("uses only known breakpoints", () => {
    expect(breakpointProblems).toEqual([]);
  });

  it("has no stale allowlist entries", () => {
    const unused = allowlist.filter((_entry, index) => !used.has(index)).map((entry) => `${entry.file} ${entry.property}: ${entry.value}`);
    expect(unused).toEqual([]);
  });

  it("keeps surfaces flat and buttons from lifting", () => {
    const tokens = readFileSync(resolve("src/styles/tokens.css"), "utf8");
    expect(tokens).toMatch(/--card-shadow:\s*none;/);
    const components = readFileSync(resolve("src/styles/components.css"), "utf8");
    expect(components).toMatch(/\.card \{[^}]*box-shadow: var\(--card-shadow\)/);
    expect(components).not.toMatch(/button:hover \{[^}]*transform/);
  });
});
