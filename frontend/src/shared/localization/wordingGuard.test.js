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

// The Spanish "not saved" claim that an uncertain-save message must never make, anywhere in a
// sentence (including at its end: "no se guardó.").
const ES_NOT_SAVED = /no se guardó nada|no se guardó\b/i;

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
  ["received paycheck", term("received paychecks?")],
  ["expectation", term("expectations?")],
  ["projection", term("projections?")],
  ["profile", term("profiles?")],
  ["Log in / Log In", term("log in")],
  ["logging in", term("logging in")],
  ["Sign out", term("logout")],
  ["Register (whole label)", wholeLabel("register")],
  ["needs review", term("needs review")],
  ["To review", term("review required")],
  ["Review again", term("reconsider")],
  ["Link a deposit", term("record received")],
  ["Add a transaction", term("capture")],
  ["Upcoming paychecks", term("coming up")],
  ["Reports", term("insights?")],
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
  ["Crear cuenta", term("registrarse")],
  ["Regístrate", term("regístrate")],
  ["factura", term("facturas?")],
  ["requiere revisión", term("requieren? revisión")],
  ["Volver a revisar", term("reconsider\\w*")],
  ["Actividad (whole label)", wholeLabel("actividad")],
  ["Reportes", term("análisis")],
  ["contabilización", term("contabilizaci(?:ón|ones)")],
  ["usted", term("usted(?:es)?")],
  ["pago(s) esperado", term("pagos? esperad\\w*")],
  ["pago de nómina recibido", term("pagos? (?:de nómina )?recibid[oa]s?")],
  ["pagos recurrentes", term("pagos? recurrentes?")],
];

// Area terms: enforced in every namespace (full coverage as of the last PR of the #229 series).
const AREA_NAMESPACES = Object.keys(resources.en);

const AREA_BANNED_EN = [
  ["candidate", term("candidates?")],
  ["proposal", term("proposals?")],
  ["anchor", term("anchors?")],
  ["cadence", term("cadences?")],
  ["eligible", term("eligible")],
  ["evidence", term("evidence")],
  ["(s)", /\(s\)/],
  ["...", /\.\.\./],
  ["Retry", term("retry")],
  ["MTD", term("mtd")],
];

const AREA_BANNED_ES = [
  ["ancla", term("anclas?")],
  ["elegible", term("elegibles?")],
  ["evidencia", term("evidencias?")],
  ["(s)", /\(s\)/],
  ["...", /\.\.\./],
  ["informe", term("informes?")],
  ["Período", term("período")],
];

const inAreaNamespaces = (catalog) => Object.fromEntries(
  Object.entries(catalog).filter(([key]) => AREA_NAMESPACES.includes(key.split(":")[0])),
);

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

  it("covers all 12 namespaces with the area terms", () => {
    expect([...AREA_NAMESPACES].sort()).toEqual([
      "activity", "analytics", "auth", "budgets", "commitments", "common",
      "home", "importPreview", "investing", "navigation", "paychecks", "settings",
    ]);
  });

  it("keeps the area banned terms out of every namespace (en)", () => {
    expect(violations(inAreaNamespaces(en), "en", AREA_BANNED_EN)).toEqual([]);
  });

  it("keeps the area banned terms out of every namespace (es)", () => {
    expect(violations(inAreaNamespaces(es), "es", AREA_BANNED_ES)).toEqual([]);
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
  // The fixed set of 13 keys whose Spanish value is legitimately identical to English:
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
    "paychecks:facts.linkedCount",
    "paychecks:format.scheduleMonthly",
    "paychecks:format.window",
    "settings:language.options.en",
    "settings:language.options.es",
  ];

  it("translates every Spanish string except the fixed 13-key allowlist", () => {
    const identical = Object.keys(en).filter((key) => es[key] === en[key]);
    expect(identical.sort()).toEqual([...IDENTICAL_ALLOWED].sort());
  });
});

describe("wording guard: Quincenal", () => {
  it("names every Spanish semimonthly cadence Quincenal", () => {
    const keys = Object.keys(es).filter((key) => /[.:]cadences?\.semimonthly$/.test(key));
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
    { key: "importPreview:row.qualification", en: [/not counted as income or as a paycheck/i], es: [/no se cuenta como ingreso ni como pago de nómina/i] },
    { key: "analytics:summary.about.coverage", en: [/isn[’']t an account balance/i, /\bsavings\b/i, /available to spend/i], es: [/no es un saldo de la cuenta/i, /ahorros/i, /disponible para gastar/i] },
    { key: "home:comingUp.qualifier", en: [/expected only/i, /not included in your totals/i], es: [/solo esperados?/i, /no se suman a tus totales/i] },
    { key: "commitments:page.subtitle", en: [/expected only/i, /not included in your totals/i], es: [/solo esperados?/i, /no se suman a tus totales/i] },
    { key: "paychecks:page.intro", en: [/expected only/i, /not included in your totals/i], es: [/solo esperado/i, /no se suma a tus totales/i] },
    { key: "paychecks:receipt.intro", en: [/expected amount and dates/i, /don[’']t change/i], es: [/esperados no cambian/i, /monto y las fechas/i] },
    { key: "paychecks:form.hints.semimonthly", en: [/two pay days a month/i, /at least 7 days apart/i], es: [/dos días al mes en que te pagan/i, /al menos 7 días/i] },
    { key: "investing:status.body", en: [/isn[’']t available yet/i, /isn[’']t connected to any investment account/i], es: [/aún no está disponible/i, /no está conectado a ninguna cuenta de inversión/i] },
    { key: "paychecks:manual.intro", en: [/confirmed by your employer/i], es: [/lo confirma tu empleador/i] },
    { key: "importPreview:row.possibleDuplicate", en: [/before selecting/i], es: [/antes de seleccionar/i] },
  ];

  for (const anchor of anchors) {
    it(`keeps the meaning anchors of ${anchor.key}`, () => {
      for (const pattern of anchor.en) expect(en[anchor.key]).toMatch(pattern);
      for (const pattern of anchor.es) expect(es[anchor.key]).toMatch(pattern);
    });
  }

  it("never claims nothing was imported when the import outcome is unknown", () => {
    const key = "importPreview:confirmation.confirmation_failed";
    expect(en[key]).toMatch(/couldn[’']t confirm/i);
    expect(en[key]).toMatch(/nothing is shown as imported/i);
    expect(en[key]).not.toMatch(/nothing was (?:imported|saved)/i);
    expect(es[key]).toMatch(/no pudimos confirmar/i);
    expect(es[key]).toMatch(/no se muestra nada como importado/i);
    expect(es[key]).not.toMatch(/no se (?:import|guard)ó nada/i);
  });

  it("never opens an uncertain-save refresh notice in Activity or Budgets as if the change took effect", () => {
    const keys = [
      "activity:cashIn.feedback.unknownChecked",
      "activity:cashIn.feedback.refreshed",
      "activity:spending.feedback.refreshed",
      "budgets:feedback.refreshed",
    ];
    for (const key of keys) {
      expect(es[key], key).not.toMatch(/^[^.]*\bactualizad[oa]s?\b/i);
      expect(es[key], key).toMatch(/^Se volvi(?:ó|eron) a cargar /);
    }
  });

  it("never opens an uncertain-save paychecks notice as if the change took effect", () => {
    for (const key of ["paychecks:feedback.uncertainCreateLoaded", "paychecks:feedback.uncertainReceiptLoaded"]) {
      expect(en[key]).not.toMatch(/^\s*(?:paychecks\s+)?updated/i);
      expect(es[key]).not.toMatch(/^\s*(?:n[óo]mina\s+)?actualizad[oa]/i);
      expect(en[key]).toMatch(/^Paychecks reloaded\./);
      expect(es[key]).toMatch(/^Se volvió a cargar Nómina\./);
    }
  });

  it("keeps the uncertain-save and unconfirmed messages from claiming that nothing was saved", () => {
    const keys = Object.keys(en).filter((key) => /uncertain|unknown|unconfirmed|acknowledged/i.test(key));
    expect(keys.length).toBeGreaterThan(3);
    for (const key of keys) {
      expect(en[key], key).not.toMatch(/nothing was saved|wasn[’']t saved|was not saved/i);
      expect(es[key], key).not.toMatch(ES_NOT_SAVED);
    }
  });

  it("catches an injected 'no se guardó' claim, including at the end of a sentence", () => {
    expect("Revisa tu lista. Tu cambio no se guardó.").toMatch(ES_NOT_SAVED);
    expect("Tu cambio no se guardó. Inténtalo de nuevo.").toMatch(ES_NOT_SAVED);
    expect("No se guardó nada.").toMatch(ES_NOT_SAVED);
    expect("Revisa si se guardó tu cambio antes de intentarlo de nuevo.").not.toMatch(ES_NOT_SAVED);
  });

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
  // the accessible name.
  const pairs = [
    ["commitments:changes.accept", "commitments:changes.acceptLabel.amount"],
    ["commitments:changes.accept", "commitments:changes.acceptLabel.timing"],
    ["commitments:changes.keepCurrent", "commitments:changes.keepCurrentLabel.amount"],
    ["commitments:changes.keepCurrent", "commitments:changes.keepCurrentLabel.timing"],
    ["commitments:changes.keepActive", "commitments:changes.keepCurrentLabel.missing"],
    ["commitments:changes.reconsider", "commitments:changes.reconsiderLabel.amount"],
    ["commitments:changes.reconsider", "commitments:changes.reconsiderLabel.timing"],
    ["commitments:changes.reconsider", "commitments:changes.reconsiderLabel.missing"],
    ["commitments:candidates.reconsider", "commitments:candidates.reconsiderLabel"],
    ["commitments:candidates.dismiss", "commitments:candidates.dismissLabel"],
    ["commitments:candidates.reviewAndConfirm", "commitments:candidates.reviewAndConfirmLabel"],
    ["commitments:changes.markEnded", "commitments:changes.markEndedLabel"],
    ["commitments:changes.confirmMarkEnded", "commitments:changes.confirmMarkEndedLabel"],
    ["commitments:changes.cancelMarkEnded", "commitments:changes.cancelMarkEndedLabel"],
    ["commitments:changes.details", "commitments:changes.detailsLabel.amount"],
    ["commitments:changes.details", "commitments:changes.detailsLabel.timing"],
    ["commitments:changes.details", "commitments:changes.detailsLabel.missing"],
    ["commitments:saved.details", "commitments:saved.detailsLabel"],
    ["commitments:saved.edit", "commitments:saved.editLabel"],
    ["commitments:saved.pause", "commitments:saved.pauseLabel"],
    ["commitments:saved.end", "commitments:saved.endLabel"],
    ["commitments:saved.reactivate", "commitments:saved.reactivateLabel"],
    ["paychecks:actions.reconsider", "paychecks:actions.reconsiderLabel"],
    ["paychecks:actions.dismiss", "paychecks:actions.dismissLabel"],
    ["paychecks:actions.recordReceived", "paychecks:actions.recordReceivedLabel"],
    ["paychecks:actions.reviewConfirm", "paychecks:actions.reviewConfirmLabel"],
    ["paychecks:actions.pause", "paychecks:actions.pauseLabel"],
    ["paychecks:actions.end", "paychecks:actions.endLabel"],
    ["paychecks:actions.edit", "paychecks:actions.editLabel"],
    ["paychecks:actions.reactivate", "paychecks:actions.reactivateLabel"],
    ["paychecks:card.details", "paychecks:card.detailsLabel"],
    ["paychecks:evidence.removeTrigger", "paychecks:evidence.removeLabel"],
    ["budgets:card.edit", "budgets:card.editLabel"],
    ["budgets:card.delete", "budgets:card.deleteLabel"],
    ["importPreview:row.depositLabel", "importPreview:row.depositAria"],
    ["activity:timeline.actions.edit", "activity:timeline.actions.editExpense"],
    ["activity:timeline.actions.edit", "activity:timeline.actions.editCashIn"],
    ["activity:timeline.actions.delete", "activity:timeline.actions.deleteExpense"],
    ["activity:timeline.actions.delete", "activity:timeline.actions.deleteCashIn"],
    ["importPreview:row.selectLabel", "importPreview:row.selectAria"],
    ["importPreview:row.notSelectableLabel", "importPreview:row.notSelectableAria"],
    ["importPreview:row.sourceDetails.summary", "importPreview:row.sourceDetails.aria"],
    ["importPreview:row.fields.description", "importPreview:row.fields.descriptionAria"],
    ["importPreview:row.fields.category", "importPreview:row.fields.categoryAria"],
    ["importPreview:row.fields.customCategory", "importPreview:row.fields.customCategoryAria"],
    ["importPreview:row.fields.saveRow", "importPreview:row.fields.saveRowAria"],
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
