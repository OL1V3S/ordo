# UI component kit

Shared, presentational components in `frontend/src/shared/ui`, styled by
`frontend/src/styles/ui-kit.css` (tokens only; see [design-tokens.md](design-tokens.md)).
Components contain no user-facing strings: every label, hint and message arrives
through props from the feature's i18n catalogs (`uiKitStrings.test.js` scans the
sources). Each kit element carries an additive `ui-*` class; a `className` prop
appends feature classes. Buttons inherit the 44px touch target
(`--size-touch-target`). Files are imported directly (no barrel).

Hidden content: kit panels set `[hidden] { display: none !important }`, so a
`display: grid` rule can never un-hide them outside `.activity-page`.

## Components

- **Disclosure** (`Disclosure.jsx`): `DisclosureButton`, `DisclosurePanel`,
  `useForcedOpen` (own file), and a composed `Disclosure`. A real `<button>` with
  `aria-expanded`/`aria-controls`; never `<details>/<summary>`. Children must be
  inline text (no headings). While `forced` (a task, error, gate or recovery needs
  the content) the button stays focusable, is announced disabled via
  `aria-disabled`, exposes the reason through `aria-describedby` (default hint id
  `${controls}-hint`, override with `hintId`) and click is a no-op. `useForcedOpen`
  latches open once forced. Focus never moves on toggle.
- **FilterBar**: search field, disclosure toggle + panel (periods group, feature
  `fields`), removable chips, and one polite status container. Removing a chip
  focuses the next chip, else the previous, else search; Clear calls `onClear`
  then focuses search. Feature code owns chip/status content and strings.
- **StatusStrip**: one always-mounted `aria-live` container (polite by default,
  `assertive` option) with no role, rendering nothing when idle. Use one container
  per region and never nest a `role` inside it. `StatusMessage` stays the component
  for `role=alert`/`status` notices. Optional `limit` (messages shown, caller orders
  by priority) and one `action` button.
- **SectionHeader**: heading (`level`, `id`, `headingRef`, `focusable` for
  `tabIndex=-1`) plus at most one `action` node, inside a wrapper div.
- **ListRow**: `li` with `label`, `title`, `meta`, `amount` (tabular numerals) and
  optional `actions` (omitted when falsy). Mobile stacking uses the legacy 400px
  breakpoint to stay pixel-identical; normalize with the breakpoint pass.
- **EmptyState**: `inline` (muted paragraph) or `block` (`.empty-state` with
  optional title and action). No role.
- **TaskArea** + `useFocusReturn`: labelled region (`label` or `labelledBy`),
  hidden when closed; focus moves to `initialFocusRef` (or the container) when it
  opens. `useFocusReturn` remembers the opener and restores it, falling back to a
  ref when the opener is gone or disabled.

## Adoption status

Used by Activity (and the Transactions Records toggles): `DisclosureButton`,
`FilterBar`, `StatusStrip` (live notice and filter status), `SectionHeader`
(timeline heading), `ListRow`, inline `EmptyState`.

Built but not yet adopted, verified by unit tests only: `TaskArea`,
`useFocusReturn`, the composed `Disclosure`, `StatusStrip` `action`/`limit`/
`assertive`, and block `EmptyState`. Planned for the single task area slice.
The Activity timeline error/refresh notices keep `StatusMessage` roles.
