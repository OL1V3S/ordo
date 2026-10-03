# Localization

Ordo's browser frontend supports English and broadly neutral U.S./Latin
American Spanish as an incremental product capability. The authenticated shell,
primary navigation, Plan and More hubs, and Settings are the first localized
surfaces. Other feature pages and public account-access pages remain English
until a separately scoped adoption issue moves their complete copy into catalogs.
The Activity page is localized through the `activity` namespace: the timeline, the
section links, the page header and actions, the spending area (expense form,
filters, list, and row editing), and the cash-in area (form, list, and delete
confirmation), including their feedback and error messages. The statement import
preview is localized through the `importPreview` namespace: the import panel, its
rows, and the safe upload, confirmation, and row-warning messages that the hook
maps from stable backend codes, so the import preview no longer stays English on
the Spanish Activity page. The shared cash-in form is also used
to record a paycheck receipt on the Paychecks page; it follows the selected
language there while the rest of that page, including its validation messages,
stays English until Paychecks is adopted.

## Runtime boundary

`frontend/src/shared/localization/` owns the bundled i18next resources, language
preference, `html.lang` synchronization, and Settings language control. The
preference is one of `en` or `es`, is stored under `ordo-language`, and defaults
to English. It is a browser/device preference, not account data, and survives
logout or session invalidation. Language selection does not infer a region,
change currency, reload a route, or remount application state.

English is the fallback language. The English and Spanish JSON catalogs use
stable semantic keys and must retain identical key/value shapes. Catalogs are
bundled with the frontend; a future translation-management system may
import/export them, but the runtime must not depend on a translation service.

## Authoring rules

- Use catalog keys for localized product copy. Do not add inline language
  conditionals or use English sentences as keys.
- Translate complete phrases and sentences. Use interpolation for variables and
  i18next count variants for plurals; do not concatenate translated fragments.
- Keep routes, identifiers, API codes, payloads, stored values, and canonical
  financial meanings unchanged.
- Do not translate user-entered descriptions, names, custom categories, email
  addresses, or other user-created financial content.
- Known product values may map to localized labels while their canonical IDs
  stay stable.
- Map future localized failures from stable client/backend error codes. Do not
  parse or translate raw server sentences.
- Pure helpers that return display fallbacks (for example `formatInflowMoney` and
  `formatInflowDate`) take the localized label from the caller and keep an English
  default for callers that are not localized yet. Validation text that is never
  rendered (the cash-in capture hook maps `validateInflow` results to stable
  `*_invalid` codes) stays in the helper; the page maps those codes to catalog
  messages.
- Do not look up DOM nodes by visible English text. Where code must locate a
  control by its label, build the selector from the same catalog string.
- Category option labels are localized, but a stored category value (for example
  `food`) is shown as stored and text search matches the stored value.
  Localizing displayed values would change search semantics and needs a separate
  decision.
- Import preview messages are keyed by backend code (`errors.*`, `confirmation.*`,
  `row.errorCodes.*`, `row.confirmationCodes.*`) and never by raw server text. A code
  without a catalog entry shows a readable fallback (the code with underscores
  replaced by spaces, or the generic fallback error) instead of a blank message.
  The import hook resolves its message when an outcome is recorded; the panel passes
  stable list identifiers (`expenses`, `cashIn`), not English names, for failed
  Activity refreshes and maps them to complete localized messages.
- The import preview keeps row data as the statement parser produced it (source
  descriptions, `YYYY-MM-DD` dates, `$` amounts, and the stored category value) and
  keeps the browser-formatted expiry and confirmation timestamps in both languages
  until formatters adopt the direction below. Row counts are shown as `N rows` in
  English, as they were before localization.
- Activity spending and cash-in lists keep their existing `$` amounts and
  `MM/DD/YYYY` dates in both languages until formatters adopt the direction below.

## Formatting direction

Language and currency are separate concerns. Future presentation formatters use
`en-US` for English and `es-US` for Spanish while retaining the
application-defined USD currency and existing financial semantics.

- Calendar-only `YYYY-MM-DD` values must be formatted without local-timezone day
  shifts.
- Exact cent strings or integers must remain exact through calculations and
  display adaptation; do not convert large exact amounts through JavaScript
  `Number`.
- Percentage localization applies only after the existing calculation.
- Relative-time localization receives an already approved unit/value or calendar
  delta and must not redefine date logic.
- Plurals use complete count-aware messages.
- Financial input syntax, parsing, normalization, and API payloads do not vary by
  language without separate financial-invariant approval.

## Foundational glossary

This glossary is the initial reviewed terminology set. Copy may be refined for
natural neutral Spanish when financial meaning, identifiers, and scope remain
unchanged. Generic cash-in wording must not imply earned income.

| English | Spanish | Usage note |
|---|---|---|
| Home | Inicio | Primary destination |
| Activity | Actividad | Primary destination |
| Plan | Plan | Primary destination |
| Insights | Análisis | Neutral product language |
| More | Más | Primary destination |
| Settings | Configuración | |
| Cash in | Entradas de dinero | Includes transfers, refunds, and other non-income inflows |
| Expense | Gasto | |
| Paycheck | Pago de nómina | Neutral payroll label |
| Commitment | Compromiso | Expected or recurring expense product term |
| Expected | Previsto | |
| Recorded | Registrado | |
| Needs attention | Requiere atención | |
| Account | Cuenta | |
| Appearance | Apariencia | |
| Theme | Tema | |
| System / Light / Dark | Sistema / Claro / Oscuro | Theme options |
| Language | Idioma | |
| Logout | Cerrar sesión | |
| Delete | Eliminar | Expense and cash-in removal |
| Posted date | Fecha de contabilización | Cash-in date used by reports |
| Paycheck expectation | Previsión de nómina | Saved expected paycheck |
| Statement | Estado de cuenta | Bank statement import |
| Incoming deposit | Depósito entrante | Imported statement credit; not classified as income |
| Possible duplicate | Posible duplicado | Review before selecting or saving |

Language option names are autonyms: `English` and `Español` in both catalogs.
