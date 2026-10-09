import { formatLocalCalendarDate } from "../../expenses/utils/calendarDate";
import { cashMonthLabel } from "./cashFlowPresentation";
import {
  compareCents, decimalFromCents,
  parseExpenseAmount, percentageFromRatio,
} from "../../expenses/utils/exactMoney";

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

function isValidCalendarDate(value) {
  const match = DATE_PATTERN.exec(String(value));
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= new Date(year, month, 0).getDate();
}

function compareCategoryNames(left, right) {
  return left.localeCompare(right, "en", { sensitivity: "base" });
}

function expenseEntriesForMonth(expenses, monthYear, now) {
  if (!MONTH_PATTERN.test(monthYear)) return [];
  const currentMonth = formatLocalCalendarDate(now).slice(0, 7);
  if (monthYear > currentMonth) return [];
  const today = formatLocalCalendarDate(now);
  return (expenses ?? []).filter((expense) => {
    if (!isValidCalendarDate(expense.date) || !expense.date.startsWith(`${monthYear}-`)) return false;
    return monthYear !== currentMonth || expense.date <= today;
  }).map((expense) => ({ expense, amount: parseExpenseAmount(expense.amount) }));
}

function totalsInCents(entries) {
  const totals = new Map();
  for (const { expense, amount } of entries) {
    const category = expense.category || "uncategorized";
    if (totals.get(category) === null) continue;
    totals.set(category, amount ? (totals.get(category) ?? 0n) + amount.cents : null);
  }
  return totals;
}

function availableTotal(totals) {
  if (Array.from(totals.values()).some((amount) => amount === null)) return null;
  return Array.from(totals.values()).reduce((sum, amount) => sum + amount, 0n);
}

export function getPreviousMonth(monthYear) {
  const match = MONTH_PATTERN.exec(String(monthYear));
  if (!match) return "";
  const date = new Date(Number(match[1]), Number(match[2]) - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

// With a translator the label is built from the catalog month names; without one the
// original English formatting is unchanged.
export function formatMonthLabel(monthYear, t) {
  const match = MONTH_PATTERN.exec(String(monthYear));
  if (!match) return monthYear;
  if (typeof t === "function") return cashMonthLabel(monthYear, { t });
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" })
    .format(new Date(Number(match[1]), Number(match[2]) - 1, 1));
}

export function getAvailableMonths(expenses, now = new Date()) {
  const currentMonth = formatLocalCalendarDate(now).slice(0, 7);
  const months = new Set([currentMonth]);
  for (const expense of expenses ?? []) {
    if (!isValidCalendarDate(expense.date)) continue;
    const month = expense.date.slice(0, 7);
    if (month <= currentMonth) months.add(month);
  }
  return Array.from(months).sort((left, right) => right.localeCompare(left));
}

export function buildMonthlySpendingInsights(expenses, selectedMonth, now = new Date()) {
  const selectedEntries = expenseEntriesForMonth(expenses, selectedMonth, now);
  const previousMonth = getPreviousMonth(selectedMonth);
  const previousEntries = expenseEntriesForMonth(expenses, previousMonth, now);
  const selectedTotals = totalsInCents(selectedEntries);
  const previousTotals = totalsInCents(previousEntries);
  const selectedTotal = availableTotal(selectedTotals);
  const previousTotal = availableTotal(previousTotals);
  const available = selectedTotal !== null && previousTotal !== null;
  const difference = available ? selectedTotal - previousTotal : null;

  const categories = Array.from(selectedTotals, ([category, amountCents]) => ({ category, amountCents }))
    .filter(({ amountCents }) => amountCents !== null)
    .sort((left, right) => compareCents(right.amountCents, left.amountCents)
      || compareCategoryNames(left.category, right.category))
    .map(({ category, amountCents }) => ({
      category,
      amount: decimalFromCents(amountCents),
      percentage: selectedTotal !== null && selectedTotal > 0n
        ? percentageFromRatio(amountCents, selectedTotal) : null,
    }));

  const categoryChanges = Array.from(new Set([...selectedTotals.keys(), ...previousTotals.keys()]), (category) => {
    const selected = selectedTotals.has(category) ? selectedTotals.get(category) : 0n;
    const previous = previousTotals.has(category) ? previousTotals.get(category) : 0n;
    return { category, differenceCents: selected === null || previous === null ? null : selected - previous };
  });
  const increases = categoryChanges.filter(({ differenceCents }) => differenceCents > 0n)
    .sort((left, right) => compareCents(right.differenceCents, left.differenceCents)
      || compareCategoryNames(left.category, right.category)).slice(0, 3)
    .map(({ category, differenceCents }) => ({ category, difference: decimalFromCents(differenceCents) }));
  const decreases = categoryChanges.filter(({ differenceCents }) => differenceCents < 0n)
    .sort((left, right) => compareCents(left.differenceCents, right.differenceCents)
      || compareCategoryNames(left.category, right.category)).slice(0, 3)
    .map(({ category, differenceCents }) => ({ category, difference: decimalFromCents(differenceCents) }));

  const largestExpensesAvailable = selectedEntries.every(({ amount }) => amount !== null);
  const largestExpenses = largestExpensesAvailable
    ? [...selectedEntries]
      .sort((left, right) => compareCents(right.amount.cents, left.amount.cents)
        || right.expense.date.localeCompare(left.expense.date)
        || Number(left.expense.id ?? 0) - Number(right.expense.id ?? 0))
      .slice(0, 5).map(({ expense }) => expense)
    : [];

  return {
    available,
    previousMonth,
    total: selectedTotal === null ? null : decimalFromCents(selectedTotal),
    categories,
    totalsByCategory: Object.fromEntries(Array.from(selectedTotals, ([category, cents]) =>
      [category, cents === null ? null : decimalFromCents(cents)])),
    comparison: {
      previousTotal: previousTotal === null ? null : decimalFromCents(previousTotal),
      difference: difference === null ? null : decimalFromCents(difference),
      isIncrease: difference !== null && difference > 0n,
      percentage: difference !== null && previousTotal > 0n
        ? percentageFromRatio(difference, previousTotal) : null,
    },
    increases,
    decreases,
    largestExpensesAvailable,
    largestExpenses,
  };
}
