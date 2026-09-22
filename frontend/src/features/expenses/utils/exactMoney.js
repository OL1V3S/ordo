export const MAX_EXPENSE_CENTS = 999999999999999999n;
export const UNSAFE_NUMERIC_DOLLARS = 2 ** 46;

const UNSIGNED_DECIMAL = /^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/;

export function parseExactMoney(value, { allowZero = false, requireNumeric = false } = {}) {
  if (requireNumeric && typeof value !== "number") return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "number"
    && (!Number.isFinite(value) || value < 0 || value >= UNSAFE_NUMERIC_DOLLARS)) return null;

  const text = String(value).trim();
  if (!UNSIGNED_DECIMAL.test(text)) return null;
  const [whole = "0", fraction = ""] = text.split(".");
  const canonicalWhole = (whole || "0").replace(/^0+(?=\d)/, "");
  if (canonicalWhole.length > 16) return null;
  const cents = BigInt(canonicalWhole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if ((!allowZero && cents <= 0n) || cents < 0n || cents > MAX_EXPENSE_CENTS) return null;
  const fixed = `${canonicalWhole}.${fraction.padEnd(2, "0")}`;
  if (typeof value === "number" && Number(fixed) !== value) return null;
  return { cents, value: fixed };
}

export function parseExpenseAmount(value) {
  return parseExactMoney(value);
}

export function parseBudgetLimit(value) {
  return parseExactMoney(value, { allowZero: true, requireNumeric: true });
}

export function decimalFromCents(cents) {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const whole = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function formatCents(cents) {
  const decimal = decimalFromCents(cents);
  const negative = decimal.startsWith("-");
  const [whole, fraction] = (negative ? decimal.slice(1) : decimal).split(".");
  return `${negative ? "-" : ""}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

export function formatExactMoney(value, options) {
  const parsed = parseExactMoney(value, options);
  return parsed ? formatCents(parsed.cents) : "Amount needs review";
}

export function formatSignedMoney(value) {
  const text = String(value ?? "").trim();
  const match = /^(-)?(\d+)\.(\d{2})$/.exec(text);
  if (!match) return "Amount needs review";
  const cents = BigInt(match[2]) * 100n + BigInt(match[3]);
  return formatCents(match[1] ? -cents : cents);
}

export function compareCents(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function percentageFromRatio(numerator, denominator, precision = 1) {
  if (denominator === 0n) return null;
  const sign = numerator < 0n ? -1 : 1;
  const absolute = numerator < 0n ? -numerator : numerator;
  const scale = 10n ** BigInt(precision);
  const rounded = (absolute * 100n * scale + denominator / 2n) / denominator;
  return sign * Number(rounded) / Number(scale);
}
