# Security

## Reporting a problem

Please do not open a public issue for a security problem.

Report it privately on GitHub instead: open the repository's **Security** tab and choose
**Report a vulnerability**. Say what you found, how to reproduce it, and which Prism version
you used.

## Supported versions

Only the newest release gets fixes. Prism updates itself, so please update before you report.

## What Prism does to stay safe

- **Signed updates.** The in-app update runs a new installer only when it carries a valid
  Ed25519 signature made by the release workflow (`src/main/updateSignature.ts`).
- **Media stays inside what you opened.** Prism serves media only from folders you browsed
  to in the Explorer, or from files it made itself.
- **The phone page is read-only.** It works on your own network only, and a phone has to
  be paired before it can browse.
