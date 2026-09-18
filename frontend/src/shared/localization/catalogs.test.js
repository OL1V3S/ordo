import { describe, expect, it } from "vitest";
import i18n, { resources } from "./i18n";

function catalogShape(value) {
  if (typeof value === "string") {
    expect(value.trim()).not.toBe("");
    return "string";
  }

  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, catalogShape(value[key])]),
  );
}

describe("localization catalogs", () => {
  it("keeps English and Spanish namespace keys in parity with non-empty strings", () => {
    expect(catalogShape(resources.es)).toEqual(catalogShape(resources.en));
  });

  it("uses English as the configured fallback", () => {
    expect(i18n.options.fallbackLng).toContain("en");
  });
});
