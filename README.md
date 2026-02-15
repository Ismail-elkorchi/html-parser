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
