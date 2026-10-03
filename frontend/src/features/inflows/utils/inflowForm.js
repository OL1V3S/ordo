const MAX_CENTS = 999999999999999999n;
const UNSAFE_NUMERIC_AMOUNT = 2 ** 46;

function localToday(now = new Date()) {
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseAmount(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "number" && (!Number.isFinite(value) || isUnsafeAmount(value))) return null;
  const text = String(value).trim();
  if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(text)) return null;
  const [whole = "0", fraction = ""] = text.split(".");
  const canonicalWhole = (whole || "0").replace(/^0+(?=\d)/, "");
  if (canonicalWhole.length > 16) return null;
  const cents = BigInt(canonicalWhole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (cents <= 0n || cents > MAX_CENTS) return null;
  return {
    cents,
    value: `${canonicalWhole}${fraction ? `.${fraction}` : ""}`,
    fraction,
  };
}

function isCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || year > 9999 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

export function isUnsafeAmount(value) {
  return typeof value === "number"
    && (!Number.isFinite(value) || Math.abs(value) >= UNSAFE_NUMERIC_AMOUNT);
}

export function initialInflowDraft(record) {
  const editing = record != null;
  const amount = record?.amount;
  return {
    description: typeof record?.description === "string" ? record.description : "",
    amount: isUnsafeAmount(amount)
      ? ""
      : typeof amount === "string" || (typeof amount === "number" && Number.isFinite(amount))
        ? String(amount)
        : "",
    date: editing ? (typeof record?.date === "string" ? record.date : "") : localToday(),
  };
}

export function validateInflow(draft) {
  const errors = {};
  const description = typeof draft?.description === "string" ? draft.description.trim() : "";
  if (!description) errors.description = "Enter a description.";
  else if (description.length > 500) errors.description = "Use 500 characters or fewer.";

  const amount = parseAmount(draft?.amount);
  if (!amount) {
    errors.amount = "Enter a positive amount with at most two decimals, up to 9999999999999999.99.";
  }

  const date = typeof draft?.date === "string" ? draft.date : "";
  if (!isCalendarDate(date)) errors.date = "Enter a valid date.";

  if (Object.keys(errors).length > 0) return { errors, payload: null };
  return {
    errors,
    payload: { description, amount: amount.value, date },
  };
}

export function formatInflowMoney(value, reviewLabel = "Amount needs review") {
  if (isUnsafeAmount(value)) return reviewLabel;
  const parsed = parseAmount(value);
  if (!parsed) return reviewLabel;
  const [whole] = parsed.value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${grouped}.${parsed.fraction.padEnd(2, "0")}`;
}

export function formatInflowDate(value, unknownLabel = "Unknown date") {
  if (!isCalendarDate(value)) return unknownLabel;
  const [year, month, day] = value.split("-");
  return `${month}/${day}/${year}`;
}
