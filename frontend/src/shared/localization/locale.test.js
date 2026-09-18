import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  applyDocumentLocale,
  getStoredLocale,
  normalizeLocale,
  persistLocale,
} from "./locale";

describe("locale preference", () => {
  it("defaults unsupported and missing values to English", () => {
    const storage = { getItem: vi.fn(() => null) };
    expect(getStoredLocale(storage)).toBe(DEFAULT_LOCALE);
    storage.getItem.mockReturnValue("fr");
    expect(getStoredLocale(storage)).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale("es-US")).toBe("es");
  });

  it("falls back safely when storage cannot be read", () => {
    const storage = { getItem: vi.fn(() => { throw new Error("unavailable"); }) };
    expect(getStoredLocale(storage)).toBe("en");
  });

  it("persists only supported values and tolerates write failures", () => {
    const storage = { setItem: vi.fn() };
    expect(persistLocale("es", storage)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(LOCALE_STORAGE_KEY, "es");
    expect(persistLocale("fr", storage)).toBe(false);

    storage.setItem.mockImplementation(() => { throw new Error("unavailable"); });
    expect(persistLocale("en", storage)).toBe(true);
  });

  it("sets a validated language on the document root", () => {
    const root = { lang: "" };
    applyDocumentLocale("es", root);
    expect(root.lang).toBe("es");
    applyDocumentLocale("unknown", root);
    expect(root.lang).toBe("en");
  });
});
