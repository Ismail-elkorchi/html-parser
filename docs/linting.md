# Linting

The lint pipeline is deterministic by design:
- ESLint flat config (`eslint.config.mjs`)
- Type-aware TypeScript rules from `typescript-eslint`
- Import discipline from `eslint-plugin-import`
- Layer boundaries from `eslint-plugin-boundaries`

Boundary policy:
- `src/public` may import `src/public` and `src/internal`
- `src/internal` may import `src/internal` only
- `tests` may import all layers

Commands:
- `npm run lint`
- `npm run lint:fix`
