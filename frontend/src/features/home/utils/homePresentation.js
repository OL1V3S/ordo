import { formatCalendarDate, formatMoneyCents } from "../../../shared/localization/format";
import { parseExactMoney } from "../../expenses/utils/exactMoney";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL_AMOUNT = /^(?:0|[1-9]\d*)\.\d{2}$/;
const PROFILE_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const EMPTY_PROFILE_ID = "00000000-0000-0000-0000-000000000000";
const CADENCES = new Set(["weekly", "biweekly", "semimonthly", "monthly"]);

function isDateOnly(value) {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || year > 9999 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

function isAvailability(value, itemsKey) {
  if (!value || typeof value !== "object" || !value.availability) return false;
  const { state, reasonCode } = value.availability;
  if (state === "available") return reasonCode === null && Array.isArray(value[itemsKey]);
  return state === "unavailable" && reasonCode === "source_unavailable" && value[itemsKey] === null;
}

function isActivityItem(value) {
  if (!value || typeof value !== "object"
      || !["expense", "account_inflow"].includes(value.kind)
      || !Number.isInteger(value.recordId) || value.recordId <= 0
      || !isDateOnly(value.date)
      || typeof value.amount !== "string" || !DECIMAL_AMOUNT.test(value.amount)
      || !parseExactMoney(value.amount)
      || typeof value.description !== "string"
      || !(value.category === null || typeof value.category === "string")) return false;

  if (value.kind === "expense") return value.paycheck === null;
  if (value.category !== null) return false;
  return value.paycheck === null || (typeof value.paycheck === "object"
    && typeof value.paycheck.profileId === "string"
    && ["confirmation_evidence", "recorded_receipt"].includes(value.paycheck.relation));
}

function addCalendarDays(date, days) {
  if (!isDateOnly(date)) return null;
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  const iso = result.toISOString();
  return /^\d{4}-/.test(iso) ? iso.slice(0, 10) : null;
}

function parseCanonicalAmount(value, allowZero = false) {
  if (typeof value !== "string" || !DECIMAL_AMOUNT.test(value)) return null;
  const parsed = parseExactMoney(value, { allowZero });
  return parsed?.value === value ? parsed : null;
}

function isUpcomingAmount(value) {
  if (!value || typeof value !== "object") return false;
  if (value.mode === "fixed") {
    return parseCanonicalAmount(value.fixedAmount) !== null
      && value.minimumAmount === null && value.maximumAmount === null;
  }
  if (value.mode === "range") {
    const minimum = parseCanonicalAmount(value.minimumAmount);
    const maximum = parseCanonicalAmount(value.maximumAmount);
    return value.fixedAmount === null && minimum !== null && maximum !== null
      && minimum.cents < maximum.cents;
  }
  return false;
}

function isUpcomingItem(value, horizon) {
  if (!value || typeof value !== "object"
      || value.kind !== "paycheck_projection"
      || typeof value.paycheckProfileId !== "string" || !PROFILE_ID.test(value.paycheckProfileId)
      || value.paycheckProfileId.toLowerCase() === EMPTY_PROFILE_ID
      || typeof value.displayName !== "string" || value.displayName.trim().length === 0
      || !CADENCES.has(value.cadence)
      || !isDateOnly(value.anchorDate)
      || !isDateOnly(value.earliestExpectedDate)
      || !isDateOnly(value.latestExpectedDate)
      || value.earliestExpectedDate > value.anchorDate
      || value.anchorDate > value.latestExpectedDate
      || value.latestExpectedDate < horizon.from
      || value.earliestExpectedDate > horizon.through
      || !isUpcomingAmount(value.amount)) return false;
  return true;
}

export function isHomeUpcomingSection(value, upcomingEvaluatedOn) {
  if (!value || typeof value !== "object"
      || !value.horizon || !isDateOnly(value.horizon.from) || !isDateOnly(value.horizon.through)
      || value.horizon.from !== upcomingEvaluatedOn
      || value.horizon.through !== addCalendarDays(upcomingEvaluatedOn, 13)
      || !isAvailability(value, "items")) return false;
  if (value.availability.state === "unavailable") return true;
  return value.items.length <= 2 && value.items.every((item) => isUpcomingItem(item, value.horizon));
}

const ATTENTION_DIMENSIONS = new Set(["amount", "timing", "missing"]);
const ATTENTION_STATES = new Set(["proposed_change", "not_seen_recently", "possibly_ended"]);
const ATTENTION_FAMILIES = ["commitment_change_review", "budget_attention"];
const BUDGET_ATTENTION_STATES = new Set(["at_limit", "over_limit", "zero_limit_spending"]);

function isHomeAttentionItem(value) {
  return Boolean(value && typeof value === "object"
    && value.kind === "commitment_change_review"
    && typeof value.commitmentId === "string" && PROFILE_ID.test(value.commitmentId)
    && value.commitmentId.toLowerCase() !== EMPTY_PROFILE_ID
    && typeof value.commitmentName === "string" && value.commitmentName.trim().length > 0
    && Array.isArray(value.reviews) && value.reviews.length > 0
    && value.reviews.every((review) => review && ATTENTION_DIMENSIONS.has(review.dimension)
      && ATTENTION_STATES.has(review.state)
      && ((review.dimension === "amount" || review.dimension === "timing")
        ? review.state === "proposed_change"
        : ["not_seen_recently", "possibly_ended"].includes(review.state))));
}

function isHomeBudgetAttentionItem(value) {
  if (!value || typeof value !== "object"
      || value.kind !== "budget_attention"
      || typeof value.category !== "string" || value.category.length === 0
      || !BUDGET_ATTENTION_STATES.has(value.state)) return false;

  const spent = parseCanonicalAmount(value.spentAmount);
  const limit = parseCanonicalAmount(value.limitAmount, true);
  if (!spent || !limit) return false;
  if (value.state === "zero_limit_spending") return limit.cents === 0n && spent.cents > 0n;
  if (limit.cents === 0n) return false;
  return value.state === "at_limit"
    ? spent.cents === limit.cents
    : spent.cents > limit.cents;
}

function isFamilyAvailability(value) {
  return Boolean(value && typeof value === "object"
    && ((value.state === "available" && value.reasonCode === null)
      || (value.state === "unavailable" && value.reasonCode === "source_unavailable")));
}

function hasExpectedKinds(kindsEvaluated, familyAvailability) {
  const expected = ATTENTION_FAMILIES.filter((family) => familyAvailability[family].state === "available");
  return kindsEvaluated.length === expected.length
    && kindsEvaluated.every((kind, index) => kind === expected[index]);
}

export function isHomeAttentionSection(value, evaluatedOn) {
  if (!value || typeof value !== "object" || value.evaluatedOn !== evaluatedOn
      || !Array.isArray(value.kindsEvaluated)
      || !isDateOnly(value.evaluatedOn)
      || !value.familyAvailability || typeof value.familyAvailability !== "object") return false;

  const familyAvailability = value.familyAvailability;
  if (Object.keys(familyAvailability).length !== ATTENTION_FAMILIES.length
      || !ATTENTION_FAMILIES.every((family) => isFamilyAvailability(familyAvailability[family]))) return false;

  const commitmentAvailable = familyAvailability.commitment_change_review.state === "available";
  const budgetAvailable = familyAvailability.budget_attention.state === "available";
  const anyAvailable = commitmentAvailable || budgetAvailable;
  if (!isFamilyAvailability(value.availability)
      || value.availability.state !== (anyAvailable ? "available" : "unavailable")
      || !hasExpectedKinds(value.kindsEvaluated, familyAvailability)
      || (commitmentAvailable ? !Array.isArray(value.items) : value.items !== null)
      || (budgetAvailable ? !Array.isArray(value.budgetItems) : value.budgetItems !== null)) return false;

  if (!anyAvailable) return value.items === null && value.budgetItems === null;

  if (commitmentAvailable && (!value.items.every(isHomeAttentionItem)
      || new Set(value.items.map((item) => item.commitmentId)).size !== value.items.length
      || !value.items.every((item, index, items) => index === 0
        || items[index - 1].commitmentId < item.commitmentId))) return false;

  if (!budgetAvailable) return true;
  if (value.budgetItems.length > 2 || !value.budgetItems.every(isHomeBudgetAttentionItem)
      || new Set(value.budgetItems.map((item) => item.category)).size !== value.budgetItems.length) return false;

  const rank = (item) => item.state === "over_limit"
    ? parseCanonicalAmount(item.spentAmount).cents - parseCanonicalAmount(item.limitAmount, true).cents
    : item.state === "zero_limit_spending" ? parseCanonicalAmount(item.spentAmount).cents : 0n;
  return value.budgetItems.every((item, index, items) => {
    if (index === 0) return true;
    const previous = items[index - 1];
    const previousActionable = previous.state !== "at_limit";
    const currentActionable = item.state !== "at_limit";
    if (previousActionable !== currentActionable) return previousActionable;
    if (previousActionable && rank(previous) !== rank(item)) return rank(previous) > rank(item);
    return previous.category <= item.category;
  });
}

export function isHomeResponse(value) {
  if (!value || typeof value !== "object"
      || typeof value.generatedAt !== "string" || Number.isNaN(Date.parse(value.generatedAt))
      || value.currencyCode !== "USD"
      || !value.evaluations || !isDateOnly(value.evaluations.activityThroughDate)
      || !isDateOnly(value.evaluations.upcomingEvaluatedOn)
      || !isAvailability(value.recentActivity, "items")) return false;

  return value.recentActivity.availability.state === "unavailable"
    || value.recentActivity.items.every(isActivityItem);
}

export function formatHomeDate(date, locale = "en") {
  if (!isDateOnly(date)) return null;
  return formatCalendarDate(date, locale, "short");
}

export function formatHomeProjectionAmount(value, locale = "en") {
  const parsed = parseCanonicalAmount(value);
  if (!parsed) return null;
  return formatMoneyCents(parsed.cents, locale);
}

export function formatHomeAmount(value, kind, locale = "en") {
  const parsed = typeof value === "string" && DECIMAL_AMOUNT.test(value)
    ? parseExactMoney(value)
    : null;
  if (!parsed || !["expense", "account_inflow"].includes(kind)) return null;

  return `${kind === "expense" ? "−" : "+"}${formatMoneyCents(parsed.cents, locale)}`;
}
