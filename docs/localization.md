# Localization

Ordo's browser frontend supports English and broadly neutral U.S./Latin
American Spanish as an incremental product capability. The authenticated shell,
primary navigation, Plan and More hubs, and Settings are the first localized
surfaces. Feature pages and public account-access pages remain English until a
separately scoped adoption issue moves their complete copy into catalogs.

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

Language option names are autonyms: `English` and `Español` in both catalogs.
