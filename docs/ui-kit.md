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

Used by Activity: `TaskArea` (the single "Current task" area, with `autoFocus={false}` because each task owns its focus; the prop defaults to true), `DisclosureButton`,
`FilterBar`, `StatusStrip` (live notice and filter status), `SectionHeader`
(timeline heading), `ListRow`, inline `EmptyState`.

Built but not yet adopted, verified by unit tests only:
`useFocusReturn`, the composed `Disclosure`, `StatusStrip` `action`/`limit`/
`assertive`, and block `EmptyState`. The Activity row "..." menu is a feature component (`RowActionsMenu`), a non-modal disclosure popover in the `AccountMenu` pattern.
The Activity timeline error/refresh notices keep `StatusMessage` roles.

## App shell and navigation

The shell (`frontend/src/app/AppShell.jsx`) renders one "Primary navigation"
landmark; CSS alone switches the layout (no JavaScript layout switch):

- Compact (< 600px): fixed bottom bar, four equal columns, 56px targets.
- Medium (600-899px): sticky labelled rail (`--shell-rail-width`); the Account
  trigger stays in the page bar.
- Expanded (>= 900px): sidebar (`--shell-sidebar-width`) with Plan's children
  indented, the Account trigger pinned at the bottom, and the page title in the
  page bar. The sidebar does not scroll itself (the nav list does), so the
  Account popover is never clipped.

Links are plain `Link`s with explicit `aria-current`: `page` on the exact
route, and `location` on Plan while a child route is current. There is no
visually hidden "Current page" text.

`AccountMenu` (`app/AccountMenu.jsx`) is a non-modal disclosure popover: a
trigger with `aria-expanded` and `aria-controls`, a `role="group"` panel (no
ARIA menu role, no focus trap). Escape closes and focuses the trigger, an
outside pointerdown or focus leaving the wrapper closes it, and a same-path link
click returns focus to the trigger. The panel holds identity, Settings,
Investing, Theme, Language, and Logout.

`html` has `scroll-padding-top` for the sticky page bar and
`html:has(.app-shell)` has `scroll-padding-bottom` for the compact bottom bar
(`--shell-pagebar-height`, `--mobile-nav-clearance`). Route changes still focus
`<main>` and scroll to top.

### Plan switcher

`PlanLayout` (`app/PlanLayout.jsx`) is a pathless layout route inside the shell
that wraps `/plan`, `/budgets`, `/commitments` and `/paychecks`. It renders a
fragment (`PlanSwitcher` then `<Outlet />`), never a wrapper element, so the page
`.container` stays a direct child of `<main>` and `.app-content > .container`
keeps its zero margin and padding. `/plan` renders the Budgets page (with
`key="plan"` so `/plan` and `/budgets` each mount it fresh) with no redirect; the
page bar still says "Plan" while the h1 says "Budgets".

`PlanSwitcher` is a `nav` landmark ("Planning tools") of links, not ARIA tabs,
because each item is a route to its own address. The current link gets
`aria-current="page"` (Budgets on `/plan`) and a bordered raised segment, so state
is not colour alone. Targets are 44px, styles are tokens only
(`styles/plan-switcher.css`), gaps leave room for the focus ring, and there are no
icons, and compact widths use `--text-xs` with no inline padding so Spanish labels fit
at 320px without breaking mid-word. It is route-aware and owns i18n, so it is
not a `shared/ui` kit component. Labels reuse `destinations.*.label`
(Commitments is not renamed). The compact "back to Plan" link was removed.

To add a destination, extend `PRIMARY_DESTINATIONS` in `app/navigation.js` (keep
four to five items so the bottom bar fits at 320px in Spanish) and add its
labels to both locales.
