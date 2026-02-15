# TypeScript strictness

Strictness is configured in `tsconfig.base.json` and inherited by build/lint configs.
Enabled checks prioritize correctness and deterministic diagnostics:
- `strict`
- `noUncheckedIndexedAccess`
- `exactOptionalPropertyTypes`
- `useUnknownInCatchVariables`
- `noImplicitOverride`
- `noImplicitReturns`
- `noFallthroughCasesInSwitch`
- `noUnusedLocals`
- `noUnusedParameters`
- `isolatedModules`
- `verbatimModuleSyntax`

Noise control:
- `skipLibCheck` is enabled to reduce third-party type drift failures.

Commands:
- `npm run typecheck`
- `npm run build`
