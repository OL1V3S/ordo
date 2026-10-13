import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "../constants/categories";
import { displayText } from "../../utils/text";
import i18n from "./i18n";
import { categoryLabel } from "./categoryLabel";

const KNOWN = {
  en: { food: "Food", transport: "Transport", bills: "Bills", entertainment: "Entertainment", other: "Other", uncategorized: "Uncategorized" },
  es: { food: "Comida", transport: "Transporte", bills: "Servicios", entertainment: "Entretenimiento", other: "Otra", uncategorized: "Sin categoría" },
};

afterEach(async () => { await i18n.changeLanguage("en"); });

describe("categoryLabel", () => {
  for (const language of ["en", "es"]) {
    it(`shows the ${language} label for every stored catalog key`, async () => {
      await i18n.changeLanguage(language);
      for (const [key, label] of Object.entries(KNOWN[language])) {
        expect(categoryLabel(i18n.t, key)).toBe(label);
      }
    });
  }

  it("covers every default category plus other and the app-generated uncategorized", () => {
    expect(Object.keys(KNOWN.en).sort()).toEqual([...DEFAULT_CATEGORIES.map((c) => c.toLowerCase()), "other", "uncategorized"].sort());
    expect(Object.keys(KNOWN.es).sort()).toEqual(Object.keys(KNOWN.en).sort());
  });

  it("labels the app-generated uncategorized value in either casing without changing the stored value", async () => {
    for (const language of ["en", "es"]) {
      await i18n.changeLanguage(language);
      expect(categoryLabel(i18n.t, "uncategorized", displayText)).toBe(KNOWN[language].uncategorized);
      expect(categoryLabel(i18n.t, "Uncategorized", displayText)).toBe(KNOWN[language].uncategorized);
    }
  });

  it("matches a known key regardless of case and surrounding spaces", async () => {
    await i18n.changeLanguage("es");
    expect(categoryLabel(i18n.t, " Food ")).toBe("Comida");
    expect(categoryLabel(i18n.t, "BILLS")).toBe("Servicios");
  });

  it("returns a custom or unknown category exactly as the call site rendered it before", async () => {
    for (const language of ["en", "es"]) {
      await i18n.changeLanguage(language);
      expect(categoryLabel(i18n.t, "home repair")).toBe("home repair");
      expect(categoryLabel(i18n.t, "home repair", displayText)).toBe("Home Repair");
      expect(categoryLabel(i18n.t, "Salud")).toBe("Salud");
      expect(categoryLabel(i18n.t, "food.extra")).toBe("food.extra");
      expect(categoryLabel(i18n.t, "a:b", displayText)).toBe("A:b");
    }
  });

  it("passes a missing category through the fallback", () => {
    expect(categoryLabel(i18n.t, null)).toBeNull();
    expect(categoryLabel(i18n.t, undefined, displayText)).toBe("");
    expect(categoryLabel(i18n.t, "", displayText)).toBe("");
  });
});
