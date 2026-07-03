## Model notes
- NEVER include PII as properties in `capture()` or `identify()` calls — no email, name, phone, address, or free-text the user typed. The security scanner blocks the edit and you lose turns recovering. Use non-identifying properties instead (ids, counts, categories, booleans).
- Server-side captures must use the request's REAL user distinct id, taken from the session/auth context of that request — never a hardcoded string, module-level constant, or placeholder.
- Construct the server-side PostHog client ONCE in a shared module and export that singleton; never `new PostHog(...)` per request, per route, or per capture call.
- Instrument the handful of events that describe the user journey end-to-end (auth, core actions, errors) rather than exhaustively covering every handler — match the depth shown in the skill's example project.
- If the project's build or typecheck fails ONLY because required app environment variables (database URLs, third-party secrets) are missing in this environment, do not chase it: note the limitation, verify your changes by reading the files, and continue.
