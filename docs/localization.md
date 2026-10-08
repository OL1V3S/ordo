# Localization

Ordo's browser frontend supports English and broadly neutral U.S./Latin
American Spanish as an incremental product capability. The authenticated shell,
primary navigation, Plan and More hubs, and Settings were the first localized
surfaces, and the Home, Activity, statement import, Budgets, Insights, Commitments,
and Paychecks pages have since followed. The public account-access pages
(sign-in, registration, email confirmation, and password recovery) are localized
through the `auth` namespace. The unavailable Investing placeholder page remains
English until a separately scoped adoption issue moves its complete copy into catalogs.
The Activity page is localized through the `activity` namespace: the timeline, the
Records disclosures, the page header and actions, the spending area (expense form,
filters, list, and row editing), and the cash-in area (form, list, and delete
confirmation), including their feedback and error messages. The statement import
preview is localized through the `importPreview` namespace: the import panel, its
rows, and the safe upload, confirmation, and row-warning messages that the hook
maps from stable backend codes, so the import preview no longer stays English on
the Spanish Activity page. The Paychecks page is localized through the `paychecks` namespace: the page, the
paycheck form and its validation messages, the linked-deposit evidence, the
record-received panel, and the safe error and notice messages that the hook maps
from stable backend codes. The shared cash-in form that records a paycheck receipt
follows the selected language there, including its validation messages. The Budgets
page is localized through the `budgets` namespace: the page header, the budget month
and category-budget form, validation and feedback messages, the loading, error, and
empty states, the budget status labels, progress text, accessible names, and the
delete confirmation. The Analytics (Insights) page is localized through the
`analytics` namespace: the page, the cash-flow summary and its disclosure, the
category ranking, the trend chart (dataset labels, tooltips, axis ticks, kicker, and
the accessible chart-data table), the spending, budget-status, comparison, and
largest-expense sections, and the load-failure messages that the cash-flow hook
returns. The Commitments page is localized through the `commitments` namespace: the
page, the commitment form, the change review (pending and reviewed changes with their
decisions), the supporting-expense evidence, and the safe error and notice messages
that the hook maps from stable backend codes.

The account-access pages are localized through the `auth` namespace: the sign-in,
registration, check-email, email-confirmation, forgot-password, and reset-password
views, their labels, placeholders, password-toggle accessible names, requirement lists,
and every status or error message. `authMessages.js` maps failures to catalog keys and
the components translate them at render, so an on-screen message follows a language
change. The shared language selector (`LanguageControl`) appears on these pages so a
language can be chosen before sign-in.

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
- Auth messages are keyed by meaning (`errors.*`, `resend.*`, `forgotPassword.*`,
  `resetPassword.*`) and never by raw server text; unmapped responses (network errors,
  validation objects, proxy bodies, unknown 401 bodies) show a fixed localized message.
  Registration Identity errors map from the stable `code` through a fixed whitelist
  (`Object.hasOwn`, never a key built from the server value); unknown codes add one
  fallback line. Password-length numbers in those messages are fixed to the project's
  default Identity options. Resend and forgot-password results are chosen by HTTP
  status, not by the response message.
  **Documented exception:** the login endpoint returns its two 401 results as plain
  text with no code, so `authMessages.js` matches the exact whole strings
  `Invalid email or password` and `Please confirm your email before logging in.` (see
  `AuthController.cs` login action). This is the only place a raw server sentence is
  matched; any other 401 body shows the localized `errors.login.failed`. If the backend
  rewording changes those strings, users see that fallback until the literals are
  updated; a stable backend error code is the preferred future replacement.
- Auth password toggles use complete per-field labels (`passwordToggle.*`), not a
  lower-cased field label. `AuthShell` moves focus on a view change (`focusKey`), not
  when the language changes the title.
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
  until formatters adopt the direction below. Row counts are count-aware messages;
  English keeps `N rows` (including `1 rows`) as before localization, and Spanish
  uses `1 fila` and `N filas`.
- Activity spending and cash-in lists keep their existing `$` amounts and
  `MM/DD/YYYY` dates in both languages until formatters adopt the direction below.
- Paychecks messages are keyed by stable code (`feedback.errors.*`,
  `feedback.notices.*`, `form.errors.*`, `receipt.cashInErrors.*`) and never by raw
  server text; a code without an entry shows the generic `request_failed` message.
  The paychecks hook keeps catalog keys in its state and resolves them when it
  returns them, so a displayed message follows a language change. Paycheck form
  validation returns stable `*_invalid` codes that the form maps to messages.
  `formatPaychecks.js` helpers take an optional `t` and default to the English
  catalog for callers that are not localized yet.
- The Paychecks receipt panel maps the shared cash-in validation failures to
  `receipt.cashInErrors.*` by field. `inflows/utils/inflowForm.js` keeps its English
  validation text, which is never displayed: the Paychecks receipt panel and the
  Activity cash-in form each map the results to their own catalog messages.
- Spanish keeps a paycheck expectation distinct from money actually recorded.
  Expectation, projection, and expected-window copy uses `previsión` and
  `previsto`; copy about money actually received uses `pago recibido` and
  `entrada de dinero`. Do not describe a recorded deposit as `previsto` or an
  expectation as recibido or registrado.
- Paychecks keeps `Mon D, YYYY` dates (English month abbreviations) and `$` amounts
  in both languages until formatters adopt the direction below. Day counts
  (`formatWindow`) are count-aware messages; English `linked deposit(s)` and
  `day(s) before/after` wording is kept as written, with matching Spanish `(s)`
  forms.
- Budgets messages are keyed by outcome (`feedback.*`, `card.status.*`, `states.*`)
  and never by raw server text; the Budgets page shows no backend-provided message.
  The panel keeps a feedback catalog key in its state and resolves it when rendering,
  so a displayed message follows a language change. A write whose refresh failed has
  its own complete message instead of concatenated fragments.
- Spanish keeps a budget limit distinct from recorded spending. Limit copy uses
  `límite` and `monto límite`; copy about money actually recorded uses `gasto`,
  `gastos registrados`, and `usado`. Do not describe a limit as spent or recorded
  spending as a limit.
- Budget cards show the stored category value as stored (for example `Food`, a custom
  `Home Repair`) in both languages, inside a localized phrase such as
  `Presupuesto de Food`. Only the category option labels in the add form are
  localized; the stored value (`food`) and the request payload do not change.
  Budgets keeps the `$` amounts, the `YYYY-MM` month text, and the
  browser-formatted next-reset date in both languages until formatters adopt the
  direction below.

- Analytics messages are keyed by meaning (`summary.*`, `chart.*`, `budget.*`,
  `comparison.*`, `cashFlow.errors.*`) and never by raw server text; the page shows no
  backend-provided message. `useCashFlow` keeps a catalog key in its state and resolves
  it when returning `error`, so a displayed message follows a language change. The
  budget status values (`over budget`, `near limit`, `on track`, `unavailable`) stay
  the internal values used for sorting and styling; the page maps them to catalog
  labels. The chart's `USD` axis code, `$` amounts, and percentages stay as formatted
  in both languages.
- Month names follow the language (owner decision on #180). The `analytics` catalog
  holds the full and short month names (`months.long.01`-`12`, `months.short.01`-`12`)
  and a per-language label template (`labels.month`, `labels.date`). `cashMonthLabel`,
  `cashDateLabel`, `cashMonthTickParts`, and `periodNotes` in
  `cashFlowPresentation.js` apply those names to the existing `YYYY-MM` and
  `YYYY-MM-DD` components and take an optional `{ t }` that defaults to the English
  catalog, so English output is byte-identical (`August 2026`, `August 14, 2026`,
  `Aug`). `formatMonthLabel` takes an optional translator and otherwise keeps its
  original English formatting. No `Date` object, timezone conversion, or `Intl` locale
  formatter is used for the translated labels, and no month or date is computed
  differently. Spanish month names are lowercase in running text and labels
  (`agosto de 2026`, `14 de agosto de 2026`, ticks `ago`); the chart's `MTD` marker
  is `Acum.` in Spanish.
- Spanish keeps recorded cash and spending distinct from expectations: copy about
  recorded cash uses `entradas de dinero registradas`, `gastos registrados`, and
  `gastado`; paycheck expectations and projections are named `previsiones de nómina`
  and `proyecciones` (budgets, expectations, and projections add nothing to the
  recorded figures).
  Spanish also keeps an unavailable exact figure (`no está disponible`, `No
  disponible`) distinct from a recorded zero (`No hay gastos registrados`,
  `No hay entradas de dinero registradas`); never describe an unavailable figure as
  zero or a recorded zero as unavailable.
- Analytics keeps `$` amounts, percentages, the `YYYY-MM` option values, the numeric
  `MM/DD/YYYY` expense dates in Largest expenses, and stored category values as
  stored (for example `Food`) in both languages until formatters adopt the direction
  below. The category ranking order and the budget and comparison calculations are
  unchanged.
- Commitments messages are keyed by meaning (`page.*`, `saved.*`, `candidates.*`,
  `history.*`, `form.*`, `changes.*`, `feedback.errors.*`, `feedback.notices.*`) and
  never by raw server text. `useCommitments` keeps a catalog key in its state and
  resolves it when returning `loadError`, `actionError`, and `notice`, so a displayed
  message follows a language change; a code without an entry shows the generic
  `request_failed` message. `getCommitmentErrorMessage` takes an optional `t` and
  defaults to the English catalog. Cadence, lifecycle, weekday, and evidence-rule values
  map to catalog labels while the stored value stays the canonical value in payloads; a
  value without a label shows a readable fallback derived from the code.
- Commitments count-dependent text uses complete count-aware messages instead of
  concatenated fragments: `N change(s) to review` and `N possible commitment(s)` on the
  page, `N linked expense(s)`, supporting-expense phrases per change dimension (amount,
  timing), and missed-date phrases per cadence (weekly, monthly, yearly, with a generic
  fallback). Timing sentences take complete before/after day-count messages. English
  output is unchanged, including its existing wording for a count of one (for example
  `N linked expense(s)`, `1 days before`, `Based on 1 expenses`); Spanish uses correct
  singular and plural forms.
- Spanish keeps an expected commitment distinct from expenses actually recorded.
  Expectation copy uses `previsión`/`previsto`; evidence copy uses `gastos registrados`
  and `gastos vinculados`. Decision wording names its effect: `Descartar` and
  `Reconsiderar` act on a possible commitment, `Aceptar cambio` updates the saved
  expectation, `Mantener previsión actual`/`Mantener activo` leave it unchanged, and
  `Marcar como finalizado` changes the commitment status after a confirmation.
- Commitments keeps `$` amounts and the browser-language date display (`formatDate`
  uses `toLocaleDateString(undefined, ...)`, so dates follow the browser language, not
  the app language) in both languages until formatters adopt the direction below. Only
  the `Unknown date` fallback label is localized. Element ids that Home's attention
  links target (`changes-review-heading`, `candidate-heading`, and the others) and all
  focus behavior are unchanged.

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
| Possible paycheck | Posible pago de nómina | Detected candidate; not a confirmed paycheck |
| Record received | Registrar pago recibido | Links actual cash in; does not change the expectation |
| Schedule | Calendario | Paycheck schedule |
| Anchor | Ancla | Schedule anchor day or month end |

Language option names are autonyms: `English` and `Español` in both catalogs.
