# React + Vite

## Commitment change review flag

The complete commitment-change review workflow is guarded by
`VITE_COMMITMENT_CHANGE_REVIEW_ENABLED`. It defaults to disabled when unset;
the repository example value is `false`. While disabled, the frontend neither
requests `/api/commitment-changes` nor renders the workflow.

Enabling this flag in production requires the separately approved schema-first
migration, backend deployment, and verification sequence documented in
[`../docs/commitment-intelligence.md`](../docs/commitment-intelligence.md).

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
