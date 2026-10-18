# Design tokens

Ordo's styling lives in `frontend/src/styles`. Feature CSS uses tokens, never raw
colors, radii, weights, or (mostly) spacing. `tokenLiterals.test.js` enforces this.
Shared components built on these tokens are documented in [ui-kit.md](ui-kit.md).

## Tiers and files

1. **Primitives** (`tokens.css`): raw palette (`--ivory-100`, `--midnight-950`,
   `--periwinkle-600`, ...), scales (`--text-*`, `--weight-*`, `--space-*`,
   `--radius-*`, motion) and the shadow ink bases.
2. **Semantic colors** (`themes.css`): `--color-canvas`, `-surface`, `-surface-raised`,
   `-surface-sunken`, `-accent-subtle`, `-border-subtle`, `-border`, `-border-strong`,
   `-text`, `-text-muted`, `-text-placeholder`, `-accent`, `-accent-hover`, `-on-accent`,
   `-amount-in`, `-amount-out` (defined and contrast-tested, not yet applied), status
   colors (`danger`, `warning`, `success`, `info`, each with `-soft`), `--chart-*`,
   `--shadow-overlay`.
3. **Component tokens** (`tokens.css`, `themes.css`): `--card-*`, `--control-*`,
   `--focus-ring-*`, `--size-touch-target`, `--table-cell-*`, ...

New and migrated CSS uses the semantic names. Legacy aliases keep unmigrated rules
working: `--color-bg` (canvas), `-bg-accent` (accent-subtle), `-surface-subtle`
(surface-sunken), `-divider` (border-subtle), `-control-border` (border-strong),
`-placeholder` (text-placeholder), `-primary`, `-primary-hover`, `-on-primary`
(accent family), `--shadow-md` (equals `--shadow-overlay`).

## Mode switch (do not break)

Each semantic color is written once and holds both values:
`--color-canvas: var(--if-light, var(--ivory-100)) var(--if-dark, var(--midnight-950));`

Mode blocks (`:root`, `:root[data-theme="dark"]`, and the `prefers-color-scheme: dark`
block for `:root:not([data-theme])`) contain only `color-scheme`, `--if-light` and
`--if-dark`. The inactive one is the **empty value `--if-dark: ;`**. Do not remove the
space or the declaration, and do not let a formatter turn it into `--if-dark:;`: some
engines then drop it and every color silently breaks. `themes.test.js` asserts the
exact text and the built CSS must still contain `--if-dark: ;`. Chart hooks read
computed values with surrounding whitespace and `.trim()` them.

## Scales

- Radius: xs 4px, sm 6px, md 8px, lg 12px, pill. Cards use `--card-radius`.
- Type: xs .75, sm .875, base 1, lg 1.2, xl 1.44, 2xl 1.75, 3xl 2.125rem, display fluid.
- Weight: regular 400, medium 500, semibold 600, bold 700 (nothing heavier).
- Spacing: `--space-1` .25rem through `--space-8` 4rem.
- Breakpoints (constants, media queries cannot read properties): compact < 600px,
  medium 600-899px, expanded >= 900px. Older off-policy queries are frozen as legacy
  in the lint and get normalized per page in later slices.

## Surfaces, shadows, motion

Cards are flat: opaque `--color-surface`, 1px `--color-border`, `--card-shadow: none`.
Only overlays (menus) use `--shadow-overlay`. Buttons do not lift on hover; transitions
cover background, border and color only. Reduced motion is respected globally.

## CSS architecture and load order

`src/index.css` imports the global sheets in this order: `tokens.css`, `themes.css`,
`globals.css`, `layout.css`, `components.css` (shared primitives, shell navigation,
buttons, the shared 520px tail rule), `ui-kit.css`, `paychecks.css`. Page-owned
sheets are imported by the component that owns them, so they load after every global
sheet, in import order (children before the importing page):

- `analytics.css` by `AnalyticsPage.jsx`, `commitments.css` by `CommitmentsPage.jsx`
- `import-preview.css`, `activity.css`, `inflows.css` by `TransactionsPage.jsx` (in that
  order); `inflows.css` also by `PaychecksPage.jsx`
- `budgets.css` by `BudgetsPage.jsx`, `home-capture.css` by `OverviewPage.jsx`,
  `secondary-pages.css` by Settings, Investing and More, `plan-switcher.css` by `PlanLayout.jsx`

Rule of thumb: moving a rule into a page-owned sheet moves it later in the cascade.
Before moving or splitting a sheet, check equal-specificity rules on the same element
and property (for example `.budget-row--warning` stays in `components.css` because it
ties with `.ui-list-row` in `ui-kit.css`). Keep feature selectors scoped under the
feature's own root class, and delete a selector when its class has no consumer in
`src` (dynamic `prefix-${x}` class names count as consumers). The no-literals
allowlist is keyed by the file that contains the declaration.

## No-literals rule and allowlist

`src/styles/tokenLiterals.test.js` fails on raw colors, weights, font sizes, radii,
box-shadows, non-token spacing, gradients, hover lifts and unknown breakpoints. A
justified exception is an allowlist entry `{ file, property, value, reason }`; one
entry covers repeats of the same declaration in that file, and unused entries fail
the test so the list cannot go stale.

## Contrast thresholds

Normal text >= 4.5:1 (text, muted text, amount-in, accent on canvas/surface and the
sunken/raised surfaces); non-text >= 3:1 (border-strong, focus ring).

## iOS app

The native app (`ios/`) ports the web's semantic colors, type feel, radii and spacing through one
theme layer: `ios/Ordo/Theme/Theme.swift` (tokens) and `ThemeStyles.swift` (button styles, status
tones, list and amount helpers). Colors are asset-catalog color sets in
`ios/Ordo/Resources/Assets.xcassets/Theme/` (the accent is the global `AccentColor`), each with a
light and a dark value, and Increase Contrast variants where the web palette has a stronger one. The
app follows the system appearance; it has no in-app picker. Views never use raw colors.

### Color map

| Web token | iOS `ThemeColor` | Light | Dark |
|---|---|---|---|
| `--color-canvas` | `canvas` | #F5F5F1 | #0D1017 |
| `--color-surface` | `surface` | #FFFFFF | #151923 |
| `--color-surface-raised` | `surfaceRaised` | #FAFAF7 | #1C2130 |
| `--color-surface-sunken` | `surfaceSunken` | #F5F5F1 | #1C2130 |
| `--color-border-subtle` | `borderSubtle` | #E7E8EC | #242938 |
| `--color-border` | `border` | #DEDFE2 | #2B3040 |
| `--color-border-strong` | `borderStrong` | #8B8D94 | #666C7D |
| `--color-text` | `text` | #181A20 | #F3F3F0 |
| `--color-text-muted` | `textMuted` | #666873 | #A1A4AD |
| `--color-accent` | `accent` (`AccentColor`) | #5458C9 | #8D91FF |
| `--color-accent-hover` | `accentHover` (pressed fill) | #4549AE | #A5A8FF |
| `--color-on-accent` | `onAccent` | #FFFFFF | #0D1017 |
| `--color-amount-in` | `amountIn` | #087A55 | #55D6A6 |
| `--color-amount-out` | `amountOut` (code alias of `text`) | #181A20 | #F3F3F0 |
| `--color-disabled-text` | `disabledText` | #62667F | #B1B5D2 |
| `--color-disabled-surface` | `disabledSurface` | #EEEFFA | #262C40 |
| `--color-disabled-border` | `disabledBorder` | #8B8D94 | #666C7D |
| `--color-danger` / `-soft` | `danger` / `dangerSoft` | #C4324B / #FFF0F3 | #FF7187 / #351923 |
| `--color-warning` / `-soft` | `warning` / `warningSoft` | #9A5B00 / #FFF6DF | #FFC15C / #302510 |
| `--color-success` / `-soft` | `success` / `successSoft` | #087A55 / #E8F8F1 | #55D6A6 / #102A23 |
| `--color-info` / `-soft` | `info` / `infoSoft` | #566A7A / #EDF2F5 | #91AAB9 / #1B272E |

Not ported: `accent-subtle`, `on-danger`, `text-placeholder`, the `--chart-*` colors, shadows and the
legacy aliases.

Increase Contrast variants (all existing web palette values), light / dark: `textMuted` #181A20 /
#F3F3F0; `accent` #4549AE / #A5A8FF; `borderSubtle` and `border` #8B8D94 / #666C7D;
`borderStrong` #666873 / #A1A4AD. Every other color keeps its base value.

### Type, weight, radius, spacing

- Type uses iOS text styles only (Dynamic Type), never a fixed size or a custom font: 3xl/display ->
  `largeTitle` (navigation title); 2xl -> `title`, xl -> `title2` (reserved); lg -> `title3`
  semibold (section headers); base -> `body`, `headline` for row titles; sm -> `subheadline`,
  `footnote` for fine print; xs -> `caption` (semibold for field captions). The web's `-0.04em`
  heading tracking is not copied.
- Weights: 400 regular, 500 medium, 600 semibold; the web's 700 becomes semibold for UI labels and
  buttons.
- Radius: xs 4, sm 6, md 8, lg 12, pill, with continuous corners. Spacing: `space-1` to `space-8` ->
  4, 8, 12, 16, 24, 32, 48, 64 pt. The minimum touch target is 44 pt and scales.
- Money is monospaced-digit semibold and trailing. The sign and the kind label carry direction;
  color only reinforces it: cash in uses `amountIn`, spending uses neutral `amountOut`, never red.

### Where the app differs from the web

Grouped lists replace bordered row boxes; sheets replace inline panels; the system navigation bar
replaces the sidebar; buttons are custom (`OrdoPrimaryButtonStyle`, `OrdoSecondaryButtonStyle`,
`OrdoDestructiveButtonStyle`) because the system prominent style puts a white label on the tint,
which is 2.75:1 on the dark accent. The destructive style is outlined, not filled (white on dark
`danger` is 2.64:1).

### Contrast (computed; text >= 4.5:1, non-text >= 3:1)

| Pair | Light | Dark |
|---|---|---|
| text on canvas / surface | 15.91 / 17.39 | 17.12 / 15.80 |
| textMuted on canvas / surface / sunken | 5.07 / 5.54 / 5.07 | 7.64 / 7.05 / 6.44 |
| accent on canvas / surface | 5.31 / 5.81 | 6.91 / 6.38 |
| onAccent on accent / accentHover | 5.81 / 7.45 | 6.91 / 8.74 |
| amountIn on canvas / surface | 4.89 / 5.35 | 10.47 / 9.67 |
| danger on surface / canvas / dangerSoft | 5.38 / 4.92 / 4.87 | 6.66 / 7.22 / 6.06 |
| warning on surface / warningSoft | 5.43 / 5.04 | 10.91 / 9.33 |
| success on successSoft | 4.87 | 8.39 |
| info on infoSoft / surface | 4.98 / 5.62 | 6.29 / 7.24 |
| disabledText on disabledSurface | 4.93 | 6.86 |
| non-text: borderStrong on surface / canvas | 3.31 / 3.03 | 3.35 / 3.63 |

`borderSubtle` and `border` are decorative dividers below 3:1, as on the web; Increase Contrast
raises them to `borderStrong`'s level. Increased contrast never lowers any pair.

### Enforcement

`ThemeColorTests` checks every color exists and resolves opaque in light, dark and both Increase
Contrast appearances, that the values equal the table above, and that the Swift cases match the
`*.colorset` folders. `ThemeContrastTests` resolves every foreground/background pair the theme
composes from the catalog and checks the thresholds above. `ThemeSourceRulesTests` scans
`ios/Ordo/Views` and fails on `Color(`, `UIColor`, `.foregroundColor(`, system colors used as styles,
`.font(.system(size:` and `.buttonStyle(.bordered...)`, mirroring `tokenLiterals.test.js`.
