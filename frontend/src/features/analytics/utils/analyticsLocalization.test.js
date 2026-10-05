import { describe, expect, it } from "vitest";
import i18n, { resources } from "../../../shared/localization/i18n";
import { cashDateLabel, cashMonthLabel, cashMonthTickParts, periodNotes } from "./cashFlowPresentation";
import { formatMonthLabel } from "./monthlySpendingInsights";

const tEs = i18n.getFixedT("es", "analytics");
const months = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));

function flatten(value, prefix = "") {
  return Object.entries(value).flatMap(([key, child]) => typeof child === "string"
    ? [[`${prefix}${key}`, child]]
    : flatten(child, `${prefix}${key}.`));
}
const placeholders = (text) => [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((match) => match[1]).sort();

describe("analytics month and date labels", () => {
  it.each(months)("keeps the English label for month %s identical to the original wording", (month) => {
    const long = new Intl.DateTimeFormat("en-US", { month: "long" }).format(new Date(2026, Number(month) - 1, 1));
    expect(cashMonthLabel(`2026-${month}`)).toBe(`${long} 2026`);
    expect(cashMonthLabel(`2026-${month}`, { short: true })).toBe(`${long.slice(0, 3)} 2026`);
    expect(cashMonthTickParts(`2026-${month}`)).toEqual([long.slice(0, 3), "2026"]);
    expect(cashDateLabel(`2026-${month}-07`)).toBe(`${long} 7, 2026`);
    expect(formatMonthLabel(`2026-${month}`)).toBe(`${long} 2026`);
  });

  it("builds Spanish labels from the catalog month names and the existing date components", () => {
    expect(months.map((month) => cashMonthLabel(`2026-${month}`, { t: tEs }))).toEqual([
      "enero de 2026", "febrero de 2026", "marzo de 2026", "abril de 2026", "mayo de 2026", "junio de 2026",
      "julio de 2026", "agosto de 2026", "septiembre de 2026", "octubre de 2026", "noviembre de 2026", "diciembre de 2026",
    ]);
    expect(months.map((month) => cashMonthTickParts(`2026-${month}`, { t: tEs })[0]))
      .toEqual(["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]);
    expect(cashMonthTickParts("2026-08", { t: tEs })).toEqual(["ago", "2026"]);
    expect(cashDateLabel("2024-02-29", { t: tEs })).toBe("29 de febrero de 2024");
    expect(cashDateLabel("2026-08-04", { t: tEs })).toBe("4 de agosto de 2026");
    expect(cashMonthLabel("0001-01", { t: tEs })).toBe("enero de 0001");
    expect(cashDateLabel("0001-01-01", { t: tEs })).toBe("1 de enero de 0001");
    expect(cashMonthLabel("9999-12", { t: tEs })).toBe("diciembre de 9999");
    expect(formatMonthLabel("2026-07", tEs)).toBe("julio de 2026");
    expect(formatMonthLabel("not-a-month", tEs)).toBe("not-a-month");
  });

  it("treats only a function as the translator so months.map(formatMonthLabel) keeps the English label", () => {
    const labels = months.map((month) => `2026-${month}`).map(formatMonthLabel);
    expect(labels).toEqual(months.map((month) => formatMonthLabel(`2026-${month}`)));
    expect(labels[0]).toBe("January 2026");
    expect(formatMonthLabel("2026-07", 1)).toBe("July 2026");
  });

  it("localizes period notes while keeping a recorded zero distinct from the empty marker", () => {
    expect(periodNotes({ month: "2026-08", to: "2026-08-14", cashInMinor: "0", spentMinor: "0" }, "2026-08-14", { t: tEs }))
      .toBe("Hasta el 14 de agosto de 2026 · No hay entradas de dinero registradas · No hay gastos registrados");
    expect(periodNotes({ month: "2026-07", cashInMinor: "100", spentMinor: "100" }, "2026-08-14", { t: tEs })).toBe("—");
    expect(periodNotes({ month: "2026-08", to: "2026-08-14", cashInMinor: "0", spentMinor: "0" }, "2026-08-14"))
      .toBe("Through August 14, 2026 · No cash in recorded · No spending recorded");
  });
});

describe("analytics catalog parity", () => {
  const english = flatten(resources.en.analytics);
  const spanish = new Map(flatten(resources.es.analytics));

  it("keeps the same keys, count variants, and interpolation placeholders in both languages", () => {
    expect(english.length).toBeGreaterThan(100);
    expect([...spanish.keys()].sort()).toEqual(english.map(([key]) => key).sort());
    for (const [key, text] of english) {
      expect(placeholders(spanish.get(key)), key).toEqual(placeholders(text));
    }
    expect(english.filter(([key]) => key.endsWith("_one")).map(([key]) => key))
      .toEqual(english.filter(([key]) => key.endsWith("_other")).map(([key]) => key.replace("_other", "_one")));
  });

  it("defines all twelve full and short month names in both languages", () => {
    for (const language of ["en", "es"]) {
      for (const form of ["long", "short"]) {
        expect(Object.keys(resources[language].analytics.months[form]).sort()).toEqual(months);
      }
    }
  });
});
