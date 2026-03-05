# Security Posture

`html-parser` parses structure; it does not sanitize HTML.

Security-relevant defaults:
- Budget controls to bound CPU and memory work.
- No script execution.
- No network access from parser APIs.

Recommended usage for untrusted input:
- Always configure budgets.
- Treat parse failures as expected outcomes.
- Sanitize separately before rendering or storage.
