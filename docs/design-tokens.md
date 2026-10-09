# Design tokens

Ordo's styling lives in `frontend/src/styles`. Feature CSS uses tokens, never raw
colors, radii, weights, or (mostly) spacing. `tokenLiterals.test.js` enforces this.

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
   `--focus-ring-*`, `--size-touch-target`, `--row-padding-block`, `--table-cell-*`, ...

New and migrated CSS uses the semantic names. Legacy aliases keep unmigrated rules
working: `--color-bg` (canvas), `-bg-accent` (accent-subtle), `-surface-subtle`
(surface-sunken), `-divider` (border-subtle), `-control-border` (border-strong),
`-placeholder` (text-placeholder), `-primary`, `-primary-hover`, `-on-primary`
(accent family), `--shadow-sm/md/lg` (`--shadow-md` equals `--shadow-overlay`).

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

- Radius: xs 4px, sm 6px, md 8px, lg 12px, xl 16px, pill. Cards use `--card-radius`.
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

## No-literals rule and allowlist

`src/styles/tokenLiterals.test.js` fails on raw colors, weights, font sizes, radii,
box-shadows, non-token spacing, gradients, hover lifts and unknown breakpoints. A
justified exception is an allowlist entry `{ file, property, value, reason }`; one
entry covers repeats of the same declaration in that file, and unused entries fail
the test so the list cannot go stale.

## Contrast thresholds

Normal text >= 4.5:1 (text, muted text, amount-in, accent on canvas/surface and the
sunken/raised surfaces); non-text >= 3:1 (border-strong, focus ring).
