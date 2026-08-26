import { formatLocalCalendarDate } from "../../expenses/utils/calendarDate";
import { usedPercentage } from "../../../utils/budgets";

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

function isValidCalendarDate(value) {
  const match = DATE_PATTERN.exec(String(value));
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(year, month, 0).getDate();
}

function toCents(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

function compareCategoryNames(left, right) {
  return left.localeCompare(right, "en", { sensitivity: "base" });
}

function expensesForMonth(expenses, monthYear, now) {
  if (!MONTH_PATTERN.test(monthYear)) return [];
  const currentMonth = formatLocalCalendarDate(now).slice(0, 7);
  if (monthYear > currentMonth) return [];

  const today = formatLocalCalendarDate(now);
  return (expenses ?? []).filter((expense) => {
    if (!isValidCalendarDate(expense.date) || !expense.date.startsWith(`${monthYear}-`)) return false;
    if (monthYear === currentMonth && expense.date > today) return false;
    return toCents(expense.amount) !== null;
  });
}

function totalsInCents(expenses) {
  const totals = new Map();
  for (const expense of expenses) {
    const category = expense.category || "uncategorized";
    totals.set(category, (totals.get(category) ?? 0) + toCents(expense.amount));
  }
  return totals;
}

function totalCents(totals) {
  return Array.from(totals.values()).reduce((sum, amount) => sum + amount, 0);
}

export function getPreviousMonth(monthYear) {
  const match = MONTH_PATTERN.exec(String(monthYear));
  if (!match) return "";
  const date = new Date(Number(match[1]), Number(match[2]) - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function formatMonthLabel(monthYear) {
  const match = MONTH_PATTERN.exec(String(monthYear));
  if (!match) return monthYear;
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
  const selectedExpenses = expensesForMonth(expenses, selectedMonth, now);
  const previousMonth = getPreviousMonth(selectedMonth);
  const previousExpenses = expensesForMonth(expenses, previousMonth, now);
  const selectedTotals = totalsInCents(selectedExpenses);
  const previousTotals = totalsInCents(previousExpenses);
  const selectedTotalCents = totalCents(selectedTotals);
  const previousTotalCents = totalCents(previousTotals);
  const differenceCents = selectedTotalCents - previousTotalCents;

  const categories = Array.from(selectedTotals, ([category, amountCents]) => ({
    category,
    amount: amountCents / 100,
    percentage: selectedTotalCents > 0 ? (amountCents / selectedTotalCents) * 100 : null,
  })).sort((left, right) => right.amount - left.amount || compareCategoryNames(left.category, right.category));

  const categoryChanges = Array.from(new Set([...selectedTotals.keys(), ...previousTotals.keys()]), (category) => ({
    category,
    difference: ((selectedTotals.get(category) ?? 0) - (previousTotals.get(category) ?? 0)) / 100,
  }));
  const increases = categoryChanges
    .filter(({ difference }) => difference > 0)
    .sort((left, right) => right.difference - left.difference || compareCategoryNames(left.category, right.category))
    .slice(0, 3);
  const decreases = categoryChanges
    .filter(({ difference }) => difference < 0)
    .sort((left, right) => left.difference - right.difference || compareCategoryNames(left.category, right.category))
    .slice(0, 3);

  const largestExpenses = [...selectedExpenses]
    .sort((left, right) => {
      const amountDifference = toCents(right.amount) - toCents(left.amount);
      if (amountDifference) return amountDifference;
      const dateDifference = right.date.localeCompare(left.date);
      if (dateDifference) return dateDifference;
      return Number(left.id ?? 0) - Number(right.id ?? 0);
    })
    .slice(0, 5);

  return {
    previousMonth,
    total: selectedTotalCents / 100,
    categories,
    totalsByCategory: Object.fromEntries(Array.from(selectedTotals, ([category, cents]) => [category, cents / 100])),
    comparison: {
      previousTotal: previousTotalCents / 100,
      difference: differenceCents / 100,
      percentage: previousTotalCents > 0 ? (differenceCents / previousTotalCents) * 100 : null,
    },
    increases,
    decreases,
    largestExpenses,
  };
}

export function buildBudgetStatuses(budgetLimits, totalsByCategory) {
  return (budgetLimits ?? []).map((limit) => {
    const spent = Number(totalsByCategory?.[limit.category] ?? 0);
    const limitAmount = Number(limit.limitAmount ?? 0);
    const difference = Math.round(Math.abs(limitAmount - spent) * 100) / 100;
    const isOver = spent > limitAmount;
    const percentage = limitAmount === 0 ? null : usedPercentage(spent, limitAmount);
    const status = isOver ? "over budget" : percentage >= 90 ? "near limit" : "on track";
    return {
      ...limit,
      spent,
      percentage: limitAmount === 0 && spent === 0 ? 0 : percentage,
      status,
      remaining: isOver ? null : difference,
      over: isOver ? difference : null,
    };
  }).sort((left, right) => {
    const priority = { "over budget": 0, "near limit": 1, "on track": 2 };
    return priority[left.status] - priority[right.status] || compareCategoryNames(left.category, right.category);
  });
}
