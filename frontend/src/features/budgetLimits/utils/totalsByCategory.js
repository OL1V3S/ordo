import { formatLocalCalendarDate } from "../../expenses/utils/calendarDate";
import { decimalFromCents, parseExpenseAmount } from "../../expenses/utils/exactMoney";

export function computeMonthlyTotalsByCategory(expenses, limitMonthYear) {
  const [yr, mon] = String(limitMonthYear).split("-").map(Number);

  const now = new Date();
  const today = formatLocalCalendarDate(now);

  const isCurrentMonth = yr === now.getFullYear() && mon === now.getMonth() + 1;

  const selectedMonthIsFuture =
    yr > now.getFullYear() || (yr === now.getFullYear() && mon > now.getMonth() + 1);

  if (selectedMonthIsFuture) return {};

  const totals = {};
  for (const exp of expenses ?? []) {
    if (!exp.date.startsWith(`${limitMonthYear}-`)) continue;
    if (isCurrentMonth && exp.date > today) continue;

    const cat = exp.category || "Uncategorized";

    if (totals[cat] === null) continue;
    const amount = parseExpenseAmount(exp.amount);
    if (!amount) {
      totals[cat] = null;
      continue;
    }
    const current = totals[cat] == null ? 0n : parseExpenseAmount(totals[cat]).cents;
    totals[cat] = decimalFromCents(current + amount.cents);
  }

  return totals;
}
