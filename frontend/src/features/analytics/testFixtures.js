const daysFor = (from, to, spent = {}) => {
  const last = Number(to.slice(8, 10));
  return Array.from({ length: last }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return { date: `${from.slice(0, 8)}${day}`, spentMinor: spent[index + 1] ?? "0" };
  });
};
const monthEnd = (month) => String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate());

export function cashFlowFixture(month = "2026-08", overrides = {}) {
  const bucket = {
    month, from: `${month}-01`, to: month === "2026-08" ? "2026-08-14" : `${month}-31`,
    cashInMinor: "15000", paycheckCashInMinor: "12000", otherCashInMinor: "3000", spentMinor: "10000", netMinor: "5000",
    inflowCount: 3, paycheckInflowCount: 2, otherInflowCount: 1, expenseCount: 2,
    paycheckProfileCount: 1, editedPaycheckInflowCount: 0,
    ...overrides,
  };
  if (overrides.netMinor === undefined) bucket.netMinor = (BigInt(bucket.cashInMinor) - BigInt(bucket.spentMinor)).toString();
  if (bucket.paycheckCashInMinor === "0") {
    bucket.paycheckInflowCount = 0;
    bucket.paycheckProfileCount = 0;
    bucket.editedPaycheckInflowCount = 0;
  }
  if (bucket.otherCashInMinor === "0") bucket.otherInflowCount = 0;
  bucket.inflowCount = bucket.paycheckInflowCount + bucket.otherInflowCount;
  if (bucket.spentMinor === "0") bucket.expenseCount = 0;
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1;
  const first = Math.max(12, index - 5);
  const months = Array.from({ length: index - first + 1 }, (_, offset) => {
    const value = first + offset;
    return `${String(Math.floor(value / 12)).padStart(4, "0")}-${String(value % 12 + 1).padStart(2, "0")}`;
  })
    .map((value) => value === month ? bucket : {
      ...bucket, month: value, from: `${value}-01`, to: `${value}-${monthEnd(value)}`,
      cashInMinor: "0", paycheckCashInMinor: "0", otherCashInMinor: "0", spentMinor: "0", netMinor: "0",
      inflowCount: 0, paycheckInflowCount: 0, otherInflowCount: 0, expenseCount: 0, paycheckProfileCount: 0,
      days: daysFor(`${value}-01`, `${value}-${monthEnd(value)}`), categories: [],
    });
  const categories = [{ category: "food", amountMinor: "9000" }, { category: "transport", amountMinor: "1000" }];
  // Spending on two days that sums exactly to the effective Spent, set after the spread above.
  const spent = BigInt(bucket.spentMinor);
  bucket.days = daysFor(bucket.from, bucket.to, spent === 0n ? {} : { 3: (spent / 10n).toString(), 10: (spent - spent / 10n).toString() });
  bucket.categories = categories;
  return {
    month, throughDate: "2026-08-14", from: bucket.from, to: bucket.to,
    availableMonths: ["2026-08", "2026-07"], selected: bucket, months,
    categories,
  };
}
