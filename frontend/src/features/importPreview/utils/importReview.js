import { formatCents, parseExactMoney } from "../../expenses/utils/exactMoney";

// Pure helpers behind the statement review summary, filters, bulk selection, confirm totals
// and the saved-rows list. Selection predicates match the panel and hook: an expense counts
// when it is eligible and selected for import; a deposit counts when it is inflow-eligible
// and selected for inflow. Money stays in exact BigInt cents.

export const REVIEW_FILTERS = ["all", "attention", "duplicates", "deposits", "selected"];

export function isExpenseSelected(row) {
  return Boolean(row.isEligible && row.selectedForImport);
}

export function isDepositSelected(row) {
  return Boolean(row.isInflowEligible && row.selectedForInflow);
}

export function isRowSelected(row) {
  return isExpenseSelected(row) || isDepositSelected(row);
}

export function isPossibleDuplicateRow(row) {
  return Boolean(row.isPossibleDuplicate || row.isPossibleInflowDuplicate);
}

// A fully content-less invalid row (no date, amount or description) has nothing to review or
// edit; the panel lists it in a collapsed note instead of the table. It is still counted by
// summarize and the "attention" filter so nothing looks silently dropped.
export function isUnreadableRow(row) {
  return row.classification === "invalid"
    && !row.isEligible
    && !row.isInflowEligible
    && !row.postedDate
    && (row.amount === null || row.amount === undefined || row.amount === "")
    && !String(row.sourceDescription ?? "").trim();
}

function needsReviewOrInvalid(row) {
  return row.classification === "needs_review" || row.classification === "invalid";
}

export function summarize(rows) {
  return {
    total: rows.length,
    expensesSelected: rows.filter(isExpenseSelected).length,
    depositsSelected: rows.filter(isDepositSelected).length,
    possibleDuplicates: rows.filter(isPossibleDuplicateRow).length,
    needsReview: rows.filter(needsReviewOrInvalid).length,
    cannotBeSelected: rows.filter((row) => !row.isEligible && !row.isInflowEligible).length,
  };
}

export function rowMatchesFilter(row, filter, confirmationCodes = []) {
  switch (filter) {
    case "attention":
      return needsReviewOrInvalid(row) || (row.errors ?? []).length > 0 || confirmationCodes.length > 0;
    case "duplicates":
      return isPossibleDuplicateRow(row);
    case "deposits":
      return row.classification === "non_expense" && row.direction === "credit";
    case "selected":
      return isRowSelected(row);
    default:
      return true;
  }
}

export function filterCounts(rows, codesFor = () => []) {
  return Object.fromEntries(REVIEW_FILTERS.map((filter) => [
    filter,
    rows.filter((row) => rowMatchesFilter(row, filter, codesFor(row.rowId))).length,
  ]));
}

// Same rule as the server's default selection: eligible expense candidates with no duplicate
// signal. Deposits, duplicates, needs_review and invalid rows are never bulk-selected.
export function bulkSelectableExpenses(rows) {
  return rows.filter((row) => row.isEligible
    && !row.isPossibleDuplicate
    && !row.isPossibleInflowDuplicate
    && (row.duplicateExpenseIds ?? []).length === 0
    && row.classification === "expense_candidate"
    && !row.selectedForImport);
}

export function bulkClearTargets(rows) {
  return rows.filter(isRowSelected);
}

function sumCents(rows) {
  let total = 0n;
  for (const row of rows) {
    const parsed = parseExactMoney(row.amount);
    if (!parsed) return null;
    total += parsed.cents;
  }
  return total;
}

// `expenseCents` / `depositCents` are null when any selected amount is not an exact amount.
export function selectedTotals(rows) {
  const expenses = rows.filter(isExpenseSelected);
  const deposits = rows.filter(isDepositSelected);
  return {
    expenseCount: expenses.length,
    expenseCents: sumCents(expenses),
    depositCount: deposits.length,
    depositCents: sumCents(deposits),
  };
}

export function totalsFromSavedRows(savedRows) {
  return {
    expenseCents: sumCents(savedRows.expenses),
    depositCents: sumCents(savedRows.deposits),
  };
}

// Snapshot of the rows a confirm is about to save, taken from the preview captured at the
// start of confirm. Expense text comes from the server row (never an unsaved draft: confirm is
// blocked while drafts are dirty); a deposit uses its trimmed source description.
export function snapshotSavedRows(preview) {
  const rows = preview?.rows ?? [];
  return {
    expenses: rows.filter(isExpenseSelected).map((row) => ({
      rowId: row.rowId,
      description: row.editableExpenseDescription ?? "",
      category: row.category ?? "",
      postedDate: row.postedDate ?? null,
      amount: row.amount,
    })),
    deposits: rows.filter(isDepositSelected).map((row) => ({
      rowId: row.rowId,
      description: (row.sourceDescription ?? "").trim(),
      postedDate: row.postedDate ?? null,
      amount: row.amount,
    })),
  };
}

export function savedRowsMatchConfirmation(savedRows, confirmation) {
  return Boolean(savedRows)
    && savedRows.expenses.length === confirmation.importedExpenseCount
    && savedRows.deposits.length === confirmation.importedInflowCount;
}

// Exact total text; `null` cents means an amount could not be read exactly.
export function formatTotal(t, cents, locale) {
  return cents === null ? t("bar.totalUnavailable") : formatCents(cents, locale);
}
