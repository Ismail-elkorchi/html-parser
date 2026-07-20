# Contributing

## Set up the repository

Create changes on a short-lived branch and submit them through a pull request.
Install the locked toolchain; all conformance fixtures are checked in:

```bash
npm ci
```

## Verify a change

Run the fast gate before every pull request:

```bash
npm run check:fast
```

For parser or serializer semantics, also run `npm run test:conformance`. For
portable entry points or runtime-sensitive code, run `npm run eval:ci`.
`npm run eval:release` is reserved for release qualification.

The [maintainer guide](./docs/maintainers/index.md) maps specialized testing,
corpus, architecture, and implementation-source concerns.

## Pull requests

Keep each pull request focused. Explain the user-visible effect, record the
commands that were actually run, and call out known risks or follow-up work.
The preferred merge strategy is squash merge with branch deletion.
