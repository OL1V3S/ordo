import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Source guard: money, percent and date presentation goes through shared/localization/format.js
// so the app language and exact-amount handling cannot silently diverge again. Each
// allow-list entry is { file, rule, reason }; one entry covers every match of that rule in
// the file, and entries that no longer match fail the test.
const srcRoot = resolve("src");
const FORMAT_MODULE = "shared/localization/format.js";

const SOURCE_RULES = [
  { id: "toFixed", pattern: /\.toFixed\(/ },
  { id: "toLocale", pattern: /\.toLocale\w*\(/ },
  { id: "Intl", pattern: /\bIntl\./ },
  { id: "hand-grouping", pattern: /\(\\d\{3\}\)/ },
  { id: "dollar-literal", pattern: /\$\$\{|\$\d+\.\d|\\\$|["'`]\$["'`]/ },
];

const allowlist = [
  { file: "features/budgetLimits/components/BudgetLimitsPanel.jsx", rule: "toFixed", reason: "roundMoney normalizes the amount input before it is sent; it is input/payload logic, not display" },
  { file: "features/analytics/pages/AnalyticsPage.jsx", rule: "toFixed", reason: "the already-rounded ratio Number is split into exact tenths before formatPercentTenths renders it" },
];

// Catalog strings must not hard-code the currency symbol or a percent sign next to a
// placeholder; the formatters supply both.
const CATALOG_RULES = [
  { id: "dollar-sign", pattern: /\$/ },
  { id: "percent-after-placeholder", pattern: /\}\}%/ },
];

const catalogAllowlist = [
  { file: "shared/localization/locales/en/activity.json", rule: "dollar-sign", reason: 'the English column header "Amount ($)" names the unit and is unchanged' },
];

function listFiles(directory, extensions) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === "test" ? [] : listFiles(path, extensions);
    return extensions.some((extension) => name.endsWith(extension)) ? [path] : [];
  });
}

const relativePath = (path) => relative(srcRoot, path).split("\\").join("/");
const isTest = (path) => /\.test\.(js|jsx)$/.test(path);

function findings(files, rules) {
  const found = [];
  for (const path of files) {
    const text = readFileSync(path, "utf8");
    for (const rule of rules) {
      if (rule.pattern.test(text)) found.push({ file: relativePath(path), rule: rule.id });
    }
  }
  return found;
}

function unexplained(found, entries) {
  return found.filter((item) => !entries.some((entry) => entry.file === item.file && entry.rule === item.rule));
}

function unused(found, entries) {
  return entries.filter((entry) => !found.some((item) => item.file === entry.file && item.rule === entry.rule));
}

describe("localized formatting source guard", () => {
  const sourceFiles = listFiles(srcRoot, [".js", ".jsx"])
    .filter((path) => !isTest(path) && relativePath(path) !== FORMAT_MODULE);
  const sourceFindings = findings(sourceFiles, SOURCE_RULES);

  it("keeps number and date formatting inside shared/localization/format.js", () => {
    expect(unexplained(sourceFindings, allowlist)).toEqual([]);
  });

  it("has no stale source allow-list entries", () => {
    expect(unused(sourceFindings, allowlist)).toEqual([]);
  });

  it("names the regional Intl tags only in locale.js", () => {
    const tagged = sourceFiles
      .filter((path) => /\b(?:en-US|es-US|es-MX)\b/.test(readFileSync(path, "utf8")))
      .map(relativePath);
    expect(tagged).toEqual(["shared/localization/locale.js"]);
  });

  const catalogFiles = listFiles(join(srcRoot, "shared/localization/locales"), [".json"]);
  const catalogFindings = findings(catalogFiles, CATALOG_RULES);

  it("keeps currency symbols and percent signs out of catalog strings", () => {
    expect(unexplained(catalogFindings, catalogAllowlist)).toEqual([]);
  });

  it("has no stale catalog allow-list entries", () => {
    expect(unused(catalogFindings, catalogAllowlist)).toEqual([]);
  });
});
