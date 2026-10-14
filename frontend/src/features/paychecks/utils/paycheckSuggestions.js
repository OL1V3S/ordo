import { isCalendarDate, isUnsafeNumericAmount, parseAmount } from "./paycheckForm";

// `paycheck-match-v1`: advisory, deterministic matching of unlinked deposits to open receipt
// slots of active pay schedules. It never links anything; the user must accept explicitly and
// the backend re-checks ownership, schedule state, slot and deposit availability on accept.
export const MATCH_VERSION = "paycheck-match-v1";

const safeCents = (value) => (isUnsafeNumericAmount(value) ? null : parseAmount(value)?.cents ?? null);

export function suggestionKey(profileId, slotAnchor, inflowId) {
  return `${profileId}|${slotAnchor}|${inflowId}`;
}

function amountFits(amount, cents) {
  if (amount?.mode === "fixed") {
    const expected = safeCents(amount.fixedAmount);
    return expected !== null && cents === expected;
  }
  if (amount?.mode === "range") {
    const minimum = safeCents(amount.minimumAmount);
    const maximum = safeCents(amount.maximumAmount);
    return minimum !== null && maximum !== null && cents >= minimum && cents <= maximum;
  }
  return false;
}

// Returns suggestions ordered by deposit date (newest first), then id (highest first). Ambiguity
// is resolved here, before any dismissal filtering, so dismissing one match never promotes another.
export function computeSuggestions({ inflows, paychecks } = {}) {
  if (!Array.isArray(inflows) || !Array.isArray(paychecks)) return [];

  const linked = new Set();
  for (const profile of paychecks)
    for (const row of profile?.evidence ?? []) linked.add(String(row.accountInflowId));

  const candidates = [];
  for (const inflow of inflows) {
    if (inflow == null || inflow.id == null || linked.has(String(inflow.id))) continue;
    if (typeof inflow.date !== "string" || !isCalendarDate(inflow.date)) continue;
    const cents = safeCents(inflow.amount);
    if (cents === null) continue;
    candidates.push({ inflow, cents });
  }

  const triples = [];
  for (const profile of paychecks) {
    if (profile?.lifecycle !== "active" || !Array.isArray(profile.receiptSlots)) continue;
    for (const slot of profile.receiptSlots) {
      if (!slot?.anchor) continue;
      for (const { inflow, cents } of candidates) {
        if (inflow.date < slot.earliestExpectedDate || inflow.date > slot.latestExpectedDate) continue;
        if (!amountFits(profile.amount, cents)) continue;
        triples.push({ inflow, profile, slot, key: suggestionKey(profile.id, slot.anchor, inflow.id) });
      }
    }
  }

  const count = (map, id) => map.set(id, (map.get(id) ?? 0) + 1);
  const perInflow = new Map();
  const perSlot = new Map();
  for (const triple of triples) {
    count(perInflow, String(triple.inflow.id));
    count(perSlot, `${triple.profile.id}|${triple.slot.anchor}`);
  }

  return triples
    .filter((triple) => perInflow.get(String(triple.inflow.id)) === 1
      && perSlot.get(`${triple.profile.id}|${triple.slot.anchor}`) === 1)
    .sort((a, b) => (a.inflow.date === b.inflow.date ? 0 : a.inflow.date < b.inflow.date ? 1 : -1)
      || Number(b.inflow.id) - Number(a.inflow.id))
    .map((triple) => ({ ...triple, amountMode: triple.profile.amount.mode }));
}
