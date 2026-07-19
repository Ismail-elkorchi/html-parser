# Security policy

## Supported versions

Security fixes target the latest published release and the current development
branch. Upgrade to the newest release before reporting a problem that only
affects an older pre-1.0 version.

## Safe usage boundary

Parsing is not sanitization. Parsed output can still contain dangerous markup,
attributes, and URLs. Sanitize transformed HTML for its rendering context
before inserting it into a browser or making a trust decision from it.

Resource budgets and cancellation reduce denial-of-service exposure, but the
containing application must also bound transport, storage, and downstream work.

## Report a vulnerability

Use a private
[GitHub Security Advisory](https://github.com/Ismail-elkorchi/html-parser/security/advisories/new).
Include the affected package version and runtime, a minimal reproduction, and
the security impact if known.
