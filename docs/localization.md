# Localization

Ordo's browser frontend supports English and Mexican Spanish (es-MX), using tú,
as an incremental product capability. The authenticated shell,
primary navigation, Plan and More hubs, and Settings were the first localized
surfaces, and the Home, Transactions, statement import, Budgets, Reports, Recurring expenses,
and Paychecks pages have since followed. Namespace ids (`activity`, `analytics`,
`commitments`) and routes keep their original names; only the UI labels changed. The public account-access pages
(sign-in, registration, email confirmation, and password recovery) are localized
through the `auth` namespace. The unavailable Investing placeholder page is localized through the `investing`
namespace (all copy, unchanged in meaning; no data reads).
The Transactions page is localized through the `activity` namespace: the list, the
row actions menu, the page header and actions, the task area (expense form and edit panel, deposit form and delete
confirmation), and the read-only recovery tables, including their feedback and error messages. The statement import
preview is localized through the `importPreview` namespace: the import panel, its
rows, and the safe upload, confirmation, and row-warning messages that the hook
maps from stable backend codes, so the import preview no longer stays English on
the Spanish Transactions page. The Paychecks page is localized through the `paychecks` namespace: the page, the
paycheck form and its validation messages, the linked deposits, the
link-a-deposit panel, and the safe error and notice messages that the hook maps
from stable backend codes. The shared deposit form that adds a deposit for a paycheck
follows the selected language there, including its validation messages. The Budgets
page is localized through the `budgets` namespace: the page header, the budget month
and category-budget form, validation and feedback messages, the loading, error, and
empty states, the budget status labels, progress text, accessible names, and the
delete confirmation. The Analytics (Reports) page is localized through the
`analytics` namespace: the page, the cash-flow summary and its disclosure, the
category ranking, the trend chart (dataset labels, tooltips, axis ticks, kicker, and
the accessible chart-data table), the spending, budget-status, comparison, and
largest-expense sections, and the load-failure messages that the cash-flow hook
returns. The Recurring expenses page is localized through the `commitments` namespace: the
page, the recurring expense form, the change review (pending and reviewed changes with their
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
- Pure helpers that return display fallbacks (for example `formatInflowMoney`,
  `formatInflowDate`, `formatExactMoney`, `formatSignedMoney`, and
  `formatCommitments.formatMoney`) take the localized label from the caller (an optional
  `unavailableLabel` where the helper has one) and keep an English default
  (`Exact amount unavailable`, `Date unavailable`) for callers that are not localized yet. Validation text that is never
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
  Transactions refreshes and maps them to complete localized messages.
- The import preview keeps row data as the statement parser produced it (source
  descriptions, `YYYY-MM-DD` dates, `$` amounts, and the stored category value) and
  keeps the browser-formatted expiry and confirmation timestamps in both languages
  until formatters adopt the direction below. Row counts are count-aware messages;
  English keeps `N rows` (including `1 rows`) as before localization, and Spanish
  uses `1 fila` and `N filas`.
- Transactions spending and deposit tables keep their existing `$` amounts and
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
- Spanish keeps an expected paycheck distinct from money actually recorded.
  Expected-paycheck and expected-date copy uses `esperado` and
  `pago de nómina esperado`; copy about money actually received uses `depósito`
  and `depósito vinculado`. Do not describe a recorded deposit as `esperado` or an
  expected paycheck as recibido or registrado. Never use a bare `pago esperado`.
- Paychecks keeps `Mon D, YYYY` dates (English month abbreviations) and `$` amounts
  in both languages until formatters adopt the direction below. Day counts
  (`formatWindow`) are count-aware messages. Where the code passes no count, the label
  carries the number instead of a `(s)` form: `Days before: N`
  (Spanish `Días antes: N`).
- Budgets messages are keyed by outcome (`feedback.*`, `card.status.*`, `states.*`)
  and never by raw server text; the Budgets page shows no backend-provided message.
  The panel keeps a feedback catalog key in its state and resolves it when rendering,
  so a displayed message follows a language change. A write whose refresh failed has
  its own complete message instead of concatenated fragments.
- Spanish keeps a budget limit distinct from recorded spending. Limit copy uses
  `límite` and `límite mensual`; copy about money actually recorded uses `gasto`,
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
  (`agosto de 2026`, `14 de agosto de 2026`, ticks `ago`); the chart's month-to-date marker
  is `So far` in English and `A la fecha` in Spanish.
- Spanish keeps recorded deposits and spending distinct from expectations: copy about
  recorded deposits uses `depósitos registrados`, `gastos registrados`, and
  `gastado`; expected paychecks and saved pay schedules are named
  `pagos de nómina esperados` and `calendarios de nómina` (budgets, expected
  paychecks, and pay schedules add nothing to the recorded figures).
  Spanish also keeps an unavailable exact figure (`no está disponible`, `No
  disponible`, `Monto exacto no disponible`) distinct from a recorded zero (`No hay gastos
  registrados`, `No hay depósitos registrados`); never describe an unavailable figure as
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
  concatenated fragments: `N changes to review` and `N possible recurring expenses` on
  the page, `N linked expenses`, matching-expense phrases per change dimension (amount,
  dates), and missed-date phrases per cadence (weekly, monthly, yearly, with a generic
  fallback). Timing sentences take complete before/after day-count messages (for
  example `up to 1 day early or 2 days late`). Both languages use correct singular and
  plural forms (`1 linked expense`, `1 day before`, `Based on 1 expense`).
- Spanish keeps an expected recurring expense distinct from expenses actually recorded.
  Expected copy uses `esperado`/`lo guardado`; copy about the expenses behind a
  suggestion uses `gastos que coinciden` and `gastos vinculados`. Decision wording names
  its effect: `Descartar` and `Volver a revisar` act on a possible recurring expense,
  `Usar los datos nuevos` updates the saved details, `Mantener lo guardado`/`Mantener
  activo` leave it unchanged, and `Marcar como finalizado` changes the recurring expense
  status after a confirmation (`Sí, marcar como finalizado`).
- Commitments keeps `$` amounts and the browser-language date display (`formatDate`
  uses `toLocaleDateString(undefined, ...)`, so dates follow the browser language, not
  the app language) in both languages until formatters adopt the direction below. Only
  the `Date unavailable` fallback label is localized. Element ids that Home's attention
  links target (`changes-review-heading`, `candidate-heading`, and the others) and all
  focus behavior are unchanged.

## Formatting direction

Language and currency are separate concerns. Future presentation formatters use
`en-US` for English and `es-MX` for Spanish while retaining the
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

This glossary is the owner-approved terminology set from the plain-language wording
review (#229). Copy may be refined for natural Mexican Spanish when financial meaning,
identifiers, and scope remain unchanged. A deposit is **any money that came into the
account, including transfers, refunds, reimbursements, and paychecks; it is not
income**. Every surface that introduces deposits says so.

**Direction rule.** In Spanish, money going **out** is always `gasto` (`gasto`, `gasto
recurrente`). Money coming **in** is `depósito` or `pago de nómina`, and for the import
direction label only, `abono`. A bare `pago`/`pagos` (not followed by `de nómina`) is
never used for either direction. A bare `pago esperado` is banned; the only allowed
forms are `pago de nómina esperado` (in) and `gasto recurrente esperado` (out). The one
exception is the outflow phrase `pagos de deudas` in `analytics:summary.about.spending`.
In English, a paycheck is always `paycheck`, and a recurring outflow is always
`recurring expense`.

| Concept | English | Spanish (es-MX) | Usage note |
|---|---|---|---|
| Home | Home | Inicio | Primary destination |
| Transactions page | Transactions | Movimientos | Lists saved items only; route and namespace stay `activity` |
| Plan hub | Plan | Plan | Primary destination |
| Reports page | Reports | Reportes | Recorded-only figures; route and namespace stay `insights`/`analytics` |
| More / Settings | More / Settings | Más / Configuración | |
| Add from Home (section label) | Add a transaction | Agregar un movimiento | Replaces the developer word "Capture" |
| Saved item (generic noun) | transaction | movimiento | A saved transaction differs from an imported row |
| Expense | Expense | Gasto | Out direction |
| Saved inflow | Deposit | Depósito | Includes transfers and refunds; not income. `abono` is rejected as the noun (installment and card-payment direction risk) |
| Imported credit row status | Deposit | Depósito | Same name as the saved item; rows stay rows and saving stays explicit ("Deposit rows", "Deposits to save: N") |
| Import direction label | Money out / Money in | Cargo / Abono | `Abono` only next to `Cargo`, mirroring the statement columns |
| Income | only in negations ("isn't counted as income") | "no se cuenta como ingreso" | |
| Spent | Spent | Gastado | |
| Recorded | Recorded | registrado | Use only where it contrasts with expected |
| Deposit date | Deposit date | Fecha del depósito | Replaces "Posted date" / "Fecha de contabilización"; report semantics unchanged |
| Reports primary labels | Deposits / Spent / Deposits minus spending, under "Deposits and spending you recorded" | Depósitos / Gastado / Depósitos menos gastos, under "Depósitos y gastos que registraste" | Not a balance or safe-to-spend |
| Other deposits | Other deposits | Otros depósitos | Can include an unlinked paycheck |
| Confirmed paychecks | Confirmed paychecks | Pagos de nómina confirmados | Partition semantics unchanged |
| Budget | Budgets | Presupuestos | |
| Monthly limit | Monthly limit | Límite mensual | Limit is not spent |
| Zero limit | Zero limit (no spending) | Límite en cero (sin gastos) | Zero is intentional; absent means no budget |
| Month to date (chart tick) | So far | A la fecha | Replaces the abbreviations `MTD` / `Acum.`; meaning unchanged |
| Recurring expense | Recurring expense (page: Recurring expenses) | Gasto recurrente (page: Gastos recurrentes) | An **expected** pattern: "Expected only. Not included in your totals." Never `pago` |
| Possible recurring expense | Possible recurring expense | Posible gasto recurrente | A suggestion, not a fact |
| Expected | Expected | Esperado | Expected copy never says received or recorded |
| Saved paycheck profile | pay schedule | calendario de nómina | A saved schedule plus amount, not money; distinct from a linked deposit and an expected paycheck |
| Received paycheck | linked deposit | depósito vinculado | Not employer-verified |
| Expected paycheck | expected paycheck | pago de nómina esperado | Not received |
| Home upcoming section | Upcoming paychecks | Próximos pagos de nómina | Kept separate from the transactions list |
| Needs attention | Needs your attention (Home heading only) | Requiere tu atención | |
| A decision is waiting | To review | Por revisar | |
| Data cannot be read exactly | Exact amount unavailable; Date unavailable | Monto exacto no disponible; Fecha no disponible | Unavailable is not zero |
| Possible duplicate | Possible duplicate | Posible duplicado | Never preselected |
| Statement / import | Import statement | Importar estado de cuenta | |
| Row (import) | Row | Fila | An unsaved line is not a transaction |
| Paycheck | Paycheck | pago de nómina; navigation and page title: Nómina | Not an income claim |
| Possible paycheck | Possible paycheck | Posible pago de nómina | Confirming it saves a pay schedule |
| Link a deposit | Link a deposit (submit: Link this deposit) | Vincular un depósito (submit: Vincular este depósito) | Does not change the pay schedule |
| How often | How often | Frecuencia | Stored cadence values unchanged |
| Expected dates | Expected between {start} and {end} | Se espera entre el {start} y el {end} | Expected, not guaranteed |
| Semimonthly | Twice a month | Quincenal | Ordo's semimonthly is any two ordered days at least 7 days apart, not only the 15th and the last day; never used for biweekly (`Cada dos semanas`) |
| Pay date fields | Pay dates; Starting pay date; First / Second pay day; Day of the month you're paid; Monthly pay day | Fechas en que te pagan; Fecha inicial en que te pagan; Primer / Segundo día en que te pagan; Día del mes en que te pagan; Cuándo te pagan cada mes | Replace anchor and schedule wording; Spanish never uses a bare `pago` here |
| Why we suggested this | Why we suggested this | Por qué lo sugerimos | Replaces "Detection details" |
| Review again | Review again | Volver a revisar | Replaces "Reconsider" |
| Not seen / possibly ended | Not seen lately / May have ended | No ha aparecido últimamente / Puede que haya terminado | Not an automatic status change |
| Category `bills` | Bills | Servicios | Stored value `bills` unchanged |
| Refund / reimbursement | refund / reimbursement | devolución / reembolso | A refund does not reduce spending |
| Auth verbs | Sign in / Create account / Sign out | Iniciar sesión / Crear cuenta / Cerrar sesión | Server 401 literals untouched |
| Account / Appearance / Theme / Language | same | Cuenta / Apariencia / Tema / Idioma | |
| System / Light / Dark | same | Sistema / Claro / Oscuro | Theme options |
| Delete | Delete | Eliminar | Expense and deposit removal |
| Statement | Statement | Estado de cuenta | Bank statement import |
| Investing | Investing | Inversiones | Unavailable placeholder destination |
| Voice | you | tú | Never usted |

## Wording style guide

- **Voice:** plain, calm, second person, one idea per sentence. Most labels are 4 words
  or fewer; help text is 2 sentences or fewer. No internal words: candidate, proposal,
  profile, anchor, cadence, evidence, eligible, client, algorithm, fingerprint, marker,
  authoritative, capture.
- **Register:** Spanish uses tú imperatives (Ingresa, Elige, Agrega, Sube, Revisa), never
  usted. No device verbs (clic, toca); name the control instead.
- **Direction:** Spanish outflow nouns are `gasto`; inflow nouns are `depósito` or `pago
  de nómina`. A bare `pago` is never used for either.
- **Case and punctuation:** sentence case in both languages. Ellipsis is always `…`,
  never `...`. No "vs" in headings.
- **Buttons:** a verb plus an object that names the effect (Save expense, Import
  selected, Link this deposit, Use the new details). Never Submit, Process, or Confirm
  on its own. Confirmation buttons say "Yes, …".
- **Label in name:** when a control has an aria-label, it contains the visible text,
  unchanged and at the start, followed by the object: "{visible}: {object}" or
  "{visible} for/to {name}". The receipt panel submit (`receipt.link`, "Link this
  deposit") differs from the opening button's name ("Link a deposit to {name}"), and
  `paychecks:receipt.label` is a section name, not a control name.
- **Errors:** reassure first, then the next step. Say what did not happen and whether
  anything changed, but only when that is certain. Then give one action. Use "Try again"
  for a retry and "Refresh" for reloading. Never claim "nothing was saved" when the
  outcome is unknown; the existing uncertain-save rules stay.
- **Empty states:** "No X yet." plus the one way to add X, where one exists.
- **Expected-money pattern:** "Expected only. Not included in your totals." (Spanish:
  "Solo esperado. No se suma a tus totales."). Expected copy never says received or
  recorded, because Ordo cannot know whether a paycheck arrived unless it is linked.
  Recorded copy never says expected.
- **Deposit pattern:** wherever deposits are introduced, say "Includes transfers and
  refunds. Not counted as income." (Spanish: "Incluye transferencias y devoluciones. No
  se cuenta como ingreso.")
- **Duplicate pattern:** "Possible duplicate: this looks like one you already saved.
  Check before selecting it." Calm, never preselected, and no criteria promised beyond
  what the backend reports.
- **Plurals:** never "(s)". Use i18next `_one`/`_other`, or "Label: N" when the code
  passes no count.
- **Abbreviations:** spell them out (So far, number, MB). Keep PDF and "Amount ($)".
- **Auth:** Sign in, Sign out, Create account, Reset password.
- **One review rule:** "To review / Por revisar" means a decision is waiting for you.
  "Needs your attention" is the Home heading only. "Exact … unavailable" means data
  cannot be read exactly; that differs from "Spending unavailable" (no data) and from
  zero. "We couldn't load/check …" means a request failed. "Review" is never used for a
  data problem.

The `shared/localization/wordingGuard.test.js` guard enforces the banned-term lists,
the Spanish direction rules, the `Quincenal` rule, the semantic anchors for the
disclaimers, and the label-in-name rule mechanically.

Language option names are autonyms: `English` and `Español` in both catalogs.
