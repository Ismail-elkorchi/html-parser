# html-parser

Agent-first TypeScript HTML parser under strict deterministic and security policies.

## Runtime compatibility
- Node.js: LTS and current stable
- Deno: stable
- Bun: stable
- Browsers: modern evergreen releases

## Security and safety
- Resource budgets are mandatory and enforced.
- Structured failures are required for budget exhaustion.
- Evaluation gates and reports are tracked under `docs/` and `reports/`.

## Runtime dependencies
- Runtime dependencies are intentionally zero.
- No runtime dependencies are permitted in production code.
- `package.json` `dependencies` must remain empty.

## Development workflow
- Pull requests only.
- Squash merge and delete branch after merge.

## Verification commands
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm test`
- `npm run eval:ci`

## Release evaluation
- `npm run eval:release` is the release gate.
- Browser differential requires Chromium, Firefox, and WebKit.
- CI runs release oracle on `.github/workflows/oracle.yml` (scheduled/manual) and on tag releases.

## Readiness docs
- `docs/readiness.md` defines readiness using gates and report artifacts.
- `docs/acceptance-gates.md` defines mandatory CI and release gate evidence.
- `docs/naming-conventions.md` defines identifier and log-label naming rules.
