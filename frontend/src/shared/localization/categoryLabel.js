import { DEFAULT_CATEGORIES } from "../constants/categories";

// The stored category keys the catalogs carry a label for (activity:categories.*).
const CATALOG_KEYS = new Set([...DEFAULT_CATEGORIES.map((category) => category.toLowerCase()), "other"]);

const unchanged = (value) => value;

// Display only: stored values, payloads, grouping and comparison keys keep the stored key.
// Known catalog keys show the localized label; a custom or unknown category is passed through
// `fallback` exactly as the call site rendered it before (as stored, or displayText).
export function categoryLabel(t, category, fallback = unchanged) {
  if (typeof category !== "string") return fallback(category);
  const key = category.trim().toLowerCase();
  return CATALOG_KEYS.has(key) ? t(`activity:categories.${key}`) : fallback(category);
}
