import { isCalendarDate, isUnsafeNumericAmount, parseAmount } from "../../paychecks/utils/paycheckForm";
import { computeSuggestions } from "../../paychecks/utils/paycheckSuggestions";

// Advisory paycheck matches for deposit rows in an unsaved statement review. It reuses the
// unchanged `paycheck-match-v1` matcher: each candidate review row becomes a pseudo-deposit
// (`import:<rowId>`) next to the already-saved deposits so ambiguity counts both. Nothing here
// links anything; linking happens only after the user saves, through the existing receipt write.

export const IMPORT_ID_PREFIX = "import:";

const safeCents = (value) => (isUnsafeNumericAmount(value) ? null : parseAmount(value)?.cents ?? null);

// Rows that may receive a suggestion: deposit rows with an exact date and amount and no
// duplicate signal. Selection state does not matter.
export function isSuggestionCandidateRow(row) {
  if (!row?.isInflowEligible || row.direction !== "credit") return false;
  if (row.isPossibleInflowDuplicate || (row.duplicateInflowIds ?? []).length > 0) return false;
  if (typeof row.postedDate !== "string" || !isCalendarDate(row.postedDate)) return false;
  return safeCents(row.amount) !== null;
}

export function importDepositCents(row) {
  return safeCents(row?.amount);
}

// Returns suggestions for review rows only, ordered by statement row ordinal.
export function importPaycheckSuggestions({ rows, paychecks, inflows } = {}) {
  if (!Array.isArray(rows) || !Array.isArray(paychecks) || !Array.isArray(inflows)) return [];
  const candidates = rows.filter(isSuggestionCandidateRow);
  if (candidates.length === 0) return [];
  const byPseudoId = new Map(candidates.map((row) => [`${IMPORT_ID_PREFIX}${row.rowId}`, row]));
  const pseudo = candidates.map((row) => ({
    id: `${IMPORT_ID_PREFIX}${row.rowId}`,
    date: row.postedDate,
    amount: row.amount,
  }));
  return computeSuggestions({ inflows: [...inflows, ...pseudo], paychecks })
    .filter((suggestion) => byPseudoId.has(String(suggestion.inflow.id)))
    .map((suggestion) => ({ ...suggestion, row: byPseudoId.get(String(suggestion.inflow.id)) }))
    .sort((a, b) => a.row.sourceRowOrdinal - b.row.sourceRowOrdinal);
}

// What the user chose, captured before saving. The saved deposit has no known id yet.
export function buildLinkIntent(row, suggestion) {
  return {
    rowId: row.rowId,
    date: row.postedDate,
    cents: importDepositCents(row),
    amount: row.amount,
    description: (row.sourceDescription ?? "").trim(),
    profileId: suggestion.profile.id,
    slotAnchor: suggestion.slot.anchor,
    name: suggestion.profile.displayName,
  };
}

// After saving, find the one deposit that this intent created and re-check that the matcher
// still offers exactly that deposit for the same pay schedule and slot. Anything uncertain
// returns `{ ok: false }`, so nothing is linked. `snapshotIds` are the deposit ids that existed
// before saving; `usedIds` are deposits already linked earlier in the same run.
export function resolveLinkTarget({ intent, snapshotIds, usedIds = new Set(), inflows, paychecks }) {
  if (!(snapshotIds instanceof Set) || !Array.isArray(inflows) || !Array.isArray(paychecks)) return { ok: false };
  const matches = inflows.filter((inflow) => inflow != null && inflow.id != null
    && !snapshotIds.has(String(inflow.id))
    && !usedIds.has(String(inflow.id))
    && inflow.date === intent.date
    && safeCents(inflow.amount) === intent.cents
    && String(inflow.description ?? "").trim() === intent.description);
  if (matches.length !== 1) return { ok: false };
  const target = matches[0];
  const offered = computeSuggestions({ inflows, paychecks })
    .filter((suggestion) => String(suggestion.inflow.id) === String(target.id));
  if (offered.length !== 1) return { ok: false };
  const [suggestion] = offered;
  if (suggestion.profile.id !== intent.profileId || suggestion.slot.anchor !== intent.slotAnchor) return { ok: false };
  return { ok: true, inflowId: target.id, profileId: intent.profileId, slotAnchor: intent.slotAnchor };
}
