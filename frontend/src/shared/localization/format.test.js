import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatCalendarDate,
  formatDateTime,
  formatMoneyCents,
  formatMoneyDecimal,
  formatMonthYear,
  formatPercentTenths,
  formatPercentWhole,
} from "./format";
import { FORMAT_TAGS } from "./locale";

// U+00A0 separates the currency code from the digits in Spanish money.
const NBSP = " ";

describe("FORMAT_TAGS", () => {
  it("names the regional Intl tags in one place", () => {
    expect(FORMAT_TAGS).toEqual({ en: "en-US", es: "es-MX" });
  });
});

describe("formatMoneyCents", () => {
  it.each([
    [0n, "$0.00", `USD${NBSP}0.00`],
    [5n, "$0.05", `USD${NBSP}0.05`],
    [-50n, "-$0.50", `-USD${NBSP}0.50`],
    [123456n, "$1,234.56", `USD${NBSP}1,234.56`],
    [-123456n, "-$1,234.56", `-USD${NBSP}1,234.56`],
    [999999999999999999n, "$9,999,999,999,999,999.99", `USD${NBSP}9,999,999,999,999,999.99`],
    [-999999999999999999n, "-$9,999,999,999,999,999.99", `-USD${NBSP}9,999,999,999,999,999.99`],
    [1234567890123456789012n, "$12,345,678,901,234,567,890.12", `USD${NBSP}12,345,678,901,234,567,890.12`],
  ])("formats %s exactly in English and Spanish", (cents, english, spanish) => {
    expect(formatMoneyCents(cents, "en")).toBe(english);
    expect(formatMoneyCents(cents, "es")).toBe(spanish);
  });

  it("accepts regional tags, defaults to English and omits the currency on request", () => {
    expect(formatMoneyCents(123456n, "en-US")).toBe("$1,234.56");
    expect(formatMoneyCents(123456n, "es-US")).toBe(`USD${NBSP}1,234.56`);
    expect(formatMoneyCents(123456n)).toBe("$1,234.56");
    expect(formatMoneyCents(123456n, "fr")).toBe("$1,234.56");
    expect(formatMoneyCents(123456n, "en", { currency: false })).toBe("1,234.56");
    expect(formatMoneyCents(123456n, "es", { currency: false })).toBe("1,234.56");
    expect(formatMoneyCents(-5n, "en", { currency: false })).toBe("-0.05");
  });

  it("returns null for anything that is not a bigint", () => {
    expect(formatMoneyCents(12, "en")).toBeNull();
    expect(formatMoneyCents("12", "es")).toBeNull();
    expect(formatMoneyCents(null)).toBeNull();
  });
});

describe("formatMoneyDecimal", () => {
  it.each([
    ["0", "$0.00", `USD${NBSP}0.00`],
    ["0.05", "$0.05", `USD${NBSP}0.05`],
    ["-0.50", "-$0.50", `-USD${NBSP}0.50`],
    ["-0.00", "$0.00", `USD${NBSP}0.00`],
    ["1234.5", "$1,234.50", `USD${NBSP}1,234.50`],
    ["1234.56", "$1,234.56", `USD${NBSP}1,234.56`],
    ["9999999999999999.99", "$9,999,999,999,999,999.99", `USD${NBSP}9,999,999,999,999,999.99`],
    ["9007199254740993.01", "$9,007,199,254,740,993.01", `USD${NBSP}9,007,199,254,740,993.01`],
    [1234.56, "$1,234.56", `USD${NBSP}1,234.56`],
  ])("formats %s exactly", (value, english, spanish) => {
    expect(formatMoneyDecimal(value, "en")).toBe(english);
    expect(formatMoneyDecimal(value, "es")).toBe(spanish);
  });

  it("agrees with formatMoneyCents for the same amount", () => {
    expect(formatMoneyDecimal("9007199254740993.01", "es")).toBe(formatMoneyCents(900719925474099301n, "es"));
    expect(formatMoneyDecimal("-12.30", "en")).toBe(formatMoneyCents(-1230n, "en"));
  });

  it("supports currency: false", () => {
    expect(formatMoneyDecimal("1234.5", "en", { currency: false })).toBe("1,234.50");
    expect(formatMoneyDecimal("-1234.5", "es", { currency: false })).toBe("-1,234.50");
  });

  it.each(["", " 1.00", "1.005", "1e5", ".5", "1.", "abc", "--1", null, undefined, true, {}, NaN])(
    "returns null for %s",
    (value) => {
      expect(formatMoneyDecimal(value, "en")).toBeNull();
    },
  );
});

describe("formatPercentTenths and formatPercentWhole", () => {
  it.each([
    [123n, "12.3%"],
    [-50n, "-5.0%"],
    [0n, "0.0%"],
    [5n, "0.5%"],
    [-5n, "-0.5%"],
    [12345n, "1,234.5%"],
    [999999999999999999999n, "99,999,999,999,999,999,999.9%"],
  ])("formats %s tenths as %s in both languages", (tenths, expected) => {
    expect(formatPercentTenths(tenths, "en")).toBe(expected);
    expect(formatPercentTenths(tenths, "es")).toBe(expected);
  });

  it("can leave the integer digits ungrouped", () => {
    expect(formatPercentTenths(12345n, "en", { grouping: false })).toBe("1234.5%");
    expect(formatPercentTenths(-12345n, "es", { grouping: false })).toBe("-1234.5%");
  });

  it("formats whole percents and rejects non-integers", () => {
    expect(formatPercentWhole(95, "en")).toBe("95%");
    expect(formatPercentWhole(125, "es")).toBe("125%");
    expect(formatPercentWhole(1234, "en")).toBe("1,234%");
    expect(formatPercentWhole(-3, "es")).toBe("-3%");
    expect(formatPercentWhole(0, "en")).toBe("0%");
    expect(formatPercentWhole(12345678901234567890n, "en")).toBe("12,345,678,901,234,567,890%");
    expect(formatPercentWhole(1.5, "en")).toBeNull();
    expect(formatPercentWhole(NaN, "en")).toBeNull();
    expect(formatPercentTenths(12, "en")).toBeNull();
  });
});

describe("formatCalendarDate", () => {
  it("formats the three styles in English and Spanish", () => {
    expect(formatCalendarDate("2026-03-04", "en", "short")).toBe("Mar 4, 2026");
    expect(formatCalendarDate("2026-03-04", "en", "long")).toBe("March 4, 2026");
    expect(formatCalendarDate("2026-03-04", "en", "numeric")).toBe("03/04/2026");
    expect(formatCalendarDate("2026-03-04", "es", "short")).toBe("4 mar 2026");
    expect(formatCalendarDate("2026-03-04", "es", "long")).toBe("4 de marzo de 2026");
    expect(formatCalendarDate("2026-03-04", "es", "numeric")).toBe("04/03/2026");
    expect(formatCalendarDate("2026-03-04")).toBe("Mar 4, 2026");
  });

  it("handles leap days, the first and last representable years", () => {
    expect(formatCalendarDate("2024-02-29", "en", "short")).toBe("Feb 29, 2024");
    expect(formatCalendarDate("2024-02-29", "es", "numeric")).toBe("29/02/2024");
    expect(formatCalendarDate("0001-01-01", "en", "short")).toBe("Jan 1, 0001");
    expect(formatCalendarDate("0001-01-01", "en", "numeric")).toBe("01/01/0001");
    expect(formatCalendarDate("0001-01-01", "es", "numeric")).toBe("01/01/0001");
    expect(formatCalendarDate("0099-12-31", "en", "long")).toBe("December 31, 0099");
    expect(formatCalendarDate("9999-12-31", "en", "short")).toBe("Dec 31, 9999");
    expect(formatCalendarDate("9999-12-31", "es", "long")).toBe("31 de diciembre de 9999");
  });

  it.each(["2026-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "0000-01-01", "2026-3-4", "2026-03-04T00:00:00Z", "", null, undefined, 20260304])(
    "returns null for %s",
    (value) => {
      expect(formatCalendarDate(value, "en", "short")).toBeNull();
    },
  );

  it("returns null for an unknown style", () => {
    expect(formatCalendarDate("2026-03-04", "en", "weekday")).toBeNull();
  });
});

describe("formatMonthYear", () => {
  it("formats a month and year in English and Spanish", () => {
    expect(formatMonthYear(2026, 3, "en")).toBe("March 2026");
    expect(formatMonthYear(2026, 3, "es")).toBe("marzo de 2026");
    expect(formatMonthYear(2026, 12)).toBe("December 2026");
  });

  it("keeps four-digit years and rejects invalid input", () => {
    expect(formatMonthYear(50, 1, "en")).toBe("January 0050");
    expect(formatMonthYear(2026, 13, "en")).toBeNull();
    expect(formatMonthYear(2026, 0, "en")).toBeNull();
    expect(formatMonthYear(0, 1, "en")).toBeNull();
    expect(formatMonthYear(2026.5, 1, "en")).toBeNull();
    expect(formatMonthYear("2026", 1, "en")).toBeNull();
  });
});

describe("formatDateTime", () => {
  it("formats an instant with an explicit timezone in English and Spanish", () => {
    const instant = "2026-03-04T15:05:06Z";
    expect(formatDateTime(instant, "en", { timeZone: "UTC" })).toMatch(/^3\/4\/2026, 3:05:06\sPM$/);
    expect(formatDateTime(new Date(instant), "es", { timeZone: "UTC" })).toMatch(/^4\/3\/2026, 3:05:06\sp\.m\.$/);
    expect(formatDateTime(Date.parse(instant), "en", { timeZone: "Pacific/Kiritimati" })).toMatch(/^3\/5\/2026, 5:05:06\sAM$/);
  });

  it("matches the browser default used before localization in English", () => {
    const instant = new Date("2026-03-04T15:05:06Z");
    expect(formatDateTime(instant, "en")).toBe(instant.toLocaleString("en-US"));
  });

  it("returns null for missing or invalid instants", () => {
    expect(formatDateTime(null, "en")).toBeNull();
    expect(formatDateTime(undefined, "en")).toBeNull();
    expect(formatDateTime("", "en")).toBeNull();
    expect(formatDateTime("not a date", "es")).toBeNull();
  });
});

describe("calendar dates do not shift with the machine timezone", () => {
  const originalTimeZone = process.env.TZ;
  afterEach(() => {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  });

  it.each(["America/Los_Angeles", "Pacific/Kiritimati", "Pacific/Pago_Pago"])(
    "keeps the same calendar day under TZ=%s",
    (timeZone) => {
      process.env.TZ = timeZone;
      for (const day of ["2026-03-08", "2026-11-01", "2026-01-01", "2026-12-31", "2024-02-29", "0001-01-01"]) {
        const [year, month, date] = day.split("-").map(Number);
        const english = formatCalendarDate(day, "en", "numeric");
        expect(english).toBe(`${String(month).padStart(2, "0")}/${String(date).padStart(2, "0")}/${String(year).padStart(4, "0")}`);
        expect(formatCalendarDate(day, "es", "numeric")).toBe(`${String(date).padStart(2, "0")}/${String(month).padStart(2, "0")}/${String(year).padStart(4, "0")}`);
      }
      expect(formatCalendarDate("2026-03-08", "en", "short")).toBe("Mar 8, 2026");
      expect(formatCalendarDate("2026-03-08", "es", "short")).toBe("8 mar 2026");
      expect(formatMonthYear(2026, 1, "en")).toBe("January 2026");
      expect(formatMonthYear(2026, 12, "es")).toBe("diciembre de 2026");
    },
  );
});
