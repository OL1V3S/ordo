// Nearest listed "YYYY-MM" strings strictly below/above `value` (lexical order is chronological).
export function neighbourMonths(months, value) {
  let earlier;
  let later;
  if (!value) return { earlier, later };
  for (const month of months) {
    if (month < value && (earlier === undefined || month > earlier)) earlier = month;
    if (month > value && (later === undefined || month < later)) later = month;
  }
  return { earlier, later };
}
