import { describe, expect, it } from "vitest";
import { resources } from "./i18n";

// Wording guard for the approved plain-language glossary (#229, docs/localization.md).
// It reads the bundled catalogs for all 12 namespaces in both languages and enforces the
// core banned terms, the Spanish direction rules, the Quincenal rule, the semantic anchors
// of the money disclaimers, and the label-in-name rule. Expected strings in feature tests
// stay literal; this guard only checks vocabulary and meaning anchors.

function flatten(value, prefix = "", out = {}) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object") flatten(child, path, out);
    else out[path] = child;
  }
  return out;
}

function flatCatalog(language) {
  const out = {};
  for (const [namespace, catalog] of Object.entries(resources[language])) {
    for (const [key, text] of Object.entries(flatten(catalog))) out[`${namespace}:${key}`] = text;
  }
  return out;
}

const en = flatCatalog("en");
const es = flatCatalog("es");

// Placeholders and markup are not wording.
const visible = (text) => text.replace(/\{\{[^}]*\}\}/g, " ").replace(/<\/?\w+>/g, " ");

// Unicode-aware, case-insensitive word boundaries (so accented letters count as letters).
const term = (source) => new RegExp(`(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`, "iu");
const wholeLabel = (source) => new RegExp(`^(?:${source})$`, "iu");

const CORE_BANNED_EN = [
  ["commitment", term("commitments?")],
  ["cash in", term("cash[ -]in")],
  ["incoming deposit", term("incoming[ -]deposits?")],
  ["inflow", term("inflows?")],
  ["expectation", term("expectations?")],
  ["projection", term("projections?")],
  ["profile", term("profiles?")],
  ["Log in / Log In", term("log in")],
  ["logging in", term("logging in")],
  ["Logout", term("logout")],
  ["Register (whole label)", wholeLabel("register")],
  ["needs review", term("needs review")],
  ["Review required", term("review required")],
  ["Reconsider", term("reconsider")],
  ["Record received", term("record received")],
  ["Capture", term("capture")],
  ["Coming Up", term("coming up")],
  ["Insights", term("insights?")],
  ["Activity (whole label)", wholeLabel("activity")],
  ["posted date", term("posted date")],
];

const CORE_BANNED_ES = [
  ["compromiso", term("compromisos?")],
  ["previsión", term("previsi(?:ón|ones)")],
  ["previsto", term("previst[oa]s?")],
  ["proyección", term("proyecci(?:ón|ones)")],
  ["expectativa", term("expectativas?")],
  ["entrada de dinero", term("entradas? de dinero")],
  ["depósito entrante", term("dep[óo]sitos? entrantes?")],
  ["perfil", term("perfil(?:es)?")],
  ["Registrarse", term("registrarse")],
  ["Regístrate", term("regístrate")],
  ["factura", term("facturas?")],
  ["requiere revisión", term("requieren? revisión")],
  ["Reconsiderar", term("reconsider\\w*")],
  ["Actividad (whole label)", wholeLabel("actividad")],
  ["Análisis", term("análisis")],
  ["contabilización", term("contabilizaci(?:ón|ones)")],
  ["usted", term("usted(?:es)?")],
  ["pago(s) esperado", term("pagos? esperad\\w*")],
  ["pagos recurrentes", term("pagos? recurrentes?")],
];

// A bare "pago"/"pagos" (not followed by "de nómina") is never used for money in or out.
const BARE_PAGO = /(?<![\p{L}\p{N}_])pagos?(?![\p{L}\p{N}_])(?! de nómina)/iu;

// Every allowlist entry names the key, the rule it bypasses, and why.
const ALLOWLIST = [
  { key: "analytics:summary.about.spending", language: "es", rule: "bare pago", reason: 'the outflow phrase "pagos de deudas" (debt payments) is a spending outflow and keeps its established wording' },
];

function allowed(key, language, rule) {
  return ALLOWLIST.some((entry) => entry.key === key && entry.language === language && entry.rule === rule);
}

function violations(catalog, language, rules) {
  const found = [];
  for (const [key, text] of Object.entries(catalog)) {
    const plain = visible(text);
    for (const [name, pattern] of rules) {
      if (pattern.test(plain) && !allowed(key, language, name)) found.push(`${language} ${key} [${name}]: ${text}`);
    }
  }
  return found;
}

describe("wording guard: core terms", () => {
  it("has the same number of keys in both languages", () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  it("keeps the English core banned terms out of every namespace", () => {
    expect(violations(en, "en", CORE_BANNED_EN)).toEqual([]);
  });

  it("keeps the Spanish core banned terms out of every namespace", () => {
    expect(violations(es, "es", CORE_BANNED_ES)).toEqual([]);
  });

  it("never uses a bare pago in Spanish outside the allowlist", () => {
    const found = Object.entries(es)
      .filter(([key, text]) => BARE_PAGO.test(visible(text)) && !allowed(key, "es", "bare pago"))
      .map(([key, text]) => `${key}: ${text}`);
    expect(found).toEqual([]);
  });

  it("keeps every allowlist entry live with a reason", () => {
    for (const entry of ALLOWLIST) {
      expect(entry.reason.length).toBeGreaterThan(10);
      expect(BARE_PAGO.test(visible(es[entry.key]))).toBe(true);
    }
  });
});

describe("wording guard: no Spanish left in English", () => {
  // The fixed set of keys whose Spanish value is legitimately identical to English:
  // interpolation-only templates, a proper noun, a separator, and the language autonyms.
  const IDENTICAL_ALLOWED = [
    "analytics:chart.tooltipValue",
    "commitments:timing.compact.weekly",
    "home:attention.reasonSeparator",
    "home:comingUp.rangeValue",
    "home:comingUp.itemLabel",
    "importPreview:source.sunflower",
    "importPreview:filters.option",
    "navigation:destinations.plan.label",
    "paychecks:format.scheduleMonthly",
    "paychecks:format.window",
    "settings:language.options.en",
    "settings:language.options.es",
  ];

  it("translates every Spanish string except the fixed 12-key allowlist", () => {
    const identical = Object.keys(en).filter((key) => es[key] === en[key]);
    expect(identical.sort()).toEqual([...IDENTICAL_ALLOWED].sort());
  });
});

describe("wording guard: Quincenal", () => {
  it("names every Spanish semimonthly cadence Quincenal", () => {
    const keys = Object.keys(es).filter((key) => /\.semimonthly$/.test(key));
    expect(keys.length).toBeGreaterThanOrEqual(2);
    for (const key of keys) expect(es[key]).toBe("Quincenal");
  });

  it("never calls a biweekly cadence quincenal", () => {
    const keys = Object.keys(es).filter((key) => /\.biweekly$/.test(key));
    expect(keys.length).toBeGreaterThanOrEqual(2);
    for (const key of keys) expect(es[key]).not.toMatch(/quincen/i);
  });
});

describe("wording guard: semantic anchors", () => {
  const anchors = [
    { key: "activity:cashIn.intro", en: [/transfers/i, /refunds/i, /not counted as income/i], es: [/transferencias/i, /devoluciones/i, /no se cuenta como ingreso/i] },
    { key: "analytics:summary.about.composition", en: [/transfers/i, /refunds/i, /isn[’']t counted as income/i], es: [/transferencias/i, /devoluciones/i, /no se cuenta como ingreso/i] },
    { key: "importPreview:row.qualification", en: [/not counted as income/i, /paycheck/i], es: [/no se cuenta como ingreso/i, /pago de nómina/i] },
    { key: "analytics:summary.about.coverage", en: [/not an account balance/i, /\bsavings\b/i], es: [/no es un saldo de la cuenta/i, /ahorros/i] },
    { key: "home:comingUp.qualifier", en: [/expected only/i, /not included in your totals/i], es: [/solo esperados?/i, /no se suman a tus totales/i] },
    { key: "commitments:page.subtitle", en: [/expected only/i, /not included in your totals/i], es: [/solo esperados?/i, /no se suman a tus totales/i] },
    { key: "paychecks:page.intro", en: [/expected only/i, /not included in your totals/i], es: [/solo esperado/i, /no se suma a tus totales/i] },
    { key: "paychecks:receipt.intro", en: [/expected amount and dates/i, /don[’']t change/i], es: [/esperados no cambian/i, /monto y las fechas/i] },
    { key: "paychecks:manual.intro", en: [/confirmed by your employer/i], es: [/lo confirma tu empleador/i] },
    { key: "importPreview:row.possibleDuplicate", en: [/before selecting/i], es: [/antes de seleccionar/i] },
  ];

  for (const anchor of anchors) {
    it(`keeps the meaning anchors of ${anchor.key}`, () => {
      for (const pattern of anchor.en) expect(en[anchor.key]).toMatch(pattern);
      for (const pattern of anchor.es) expect(es[anchor.key]).toMatch(pattern);
    });
  }

  it("keeps unavailable data distinct from a zero limit in Budgets", () => {
    expect(en["budgets:card.status.zeroLimit"]).toMatch(/zero limit/i);
    expect(es["budgets:card.status.zeroLimit"]).toMatch(/cero/i);
    expect(en["budgets:card.status.limitNeedsReview"]).toMatch(/unavailable/i);
    expect(es["budgets:card.status.limitNeedsReview"]).toMatch(/no disponible/i);
    expect(en["budgets:card.status.zeroLimit"]).not.toBe(en["budgets:card.status.limitNeedsReview"]);
    expect(es["budgets:card.status.zeroLimit"]).not.toBe(es["budgets:card.status.limitNeedsReview"]);
  });

  it("states deposits are not income wherever deposits are introduced", () => {
    expect(en["activity:cashIn.intro"]).toMatch(/not counted as income/i);
    expect(es["activity:cashIn.intro"]).toMatch(/no se cuenta como ingreso/i);
  });
});

describe("wording guard: label in name", () => {
  // [visible text key, accessible name key]. The visible text must be the unchanged start of
  // the accessible name. The commitments accept / mark-ended pairs change with the
  // decision-verb pass of the series and are enabled by that change.
  const pairs = [
    ["commitments:changes.keepCurrent", "commitments:changes.keepCurrentLabel.amount"],
    ["commitments:changes.keepCurrent", "commitments:changes.keepCurrentLabel.timing"],
    ["commitments:changes.keepActive", "commitments:changes.keepCurrentLabel.missing"],
    ["commitments:changes.reconsider", "commitments:changes.reconsiderLabel.amount"],
    ["commitments:changes.reconsider", "commitments:changes.reconsiderLabel.timing"],
    ["commitments:changes.reconsider", "commitments:changes.reconsiderLabel.missing"],
    ["commitments:candidates.reconsider", "commitments:candidates.reconsiderLabel"],
    ["commitments:candidates.dismiss", "commitments:candidates.dismissLabel"],
    ["commitments:candidates.reviewAndConfirm", "commitments:candidates.reviewAndConfirmLabel"],
    ["paychecks:actions.reconsider", "paychecks:actions.reconsiderLabel"],
    ["paychecks:actions.dismiss", "paychecks:actions.dismissLabel"],
    ["paychecks:actions.recordReceived", "paychecks:actions.recordReceivedLabel"],
    ["paychecks:actions.reviewConfirm", "paychecks:actions.reviewConfirmLabel"],
    ["importPreview:row.depositLabel", "importPreview:row.depositAria"],
  ];

  for (const language of ["en", "es"]) {
    const catalog = language === "en" ? en : es;
    it(`starts each accessible name with its visible text (${language})`, () => {
      for (const [visibleKey, nameKey] of pairs) {
        expect(catalog[visibleKey], visibleKey).toBeTypeOf("string");
        expect(catalog[nameKey].startsWith(catalog[visibleKey]), `${nameKey}: "${catalog[nameKey]}" must start with "${catalog[visibleKey]}"`).toBe(true);
      }
    });
  }

  it("keeps the receipt submit and the opening button names different", () => {
    for (const catalog of [en, es]) {
      expect(catalog["paychecks:receipt.link"]).not.toBe(catalog["paychecks:actions.recordReceived"]);
      expect(catalog["paychecks:receipt.label"].startsWith(catalog["paychecks:actions.recordReceived"])).toBe(false);
    }
  });
});
