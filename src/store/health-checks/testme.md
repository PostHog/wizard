# Health checks

Run the existing health and gateway tests with mocked HTTP requests:

```bash
pnpm exec vitest run src/lib/health-checks/__tests__/health-checks.test.ts src/lib/__tests__/gateway-session.test.ts
```

The checks cover gateway readiness, endpoint retries, and skills downloads from
GitHub Releases and AWS. Either working skills origin is sufficient; both must
fail before startup is blocked. Third-party status pages are not queried.

| Check         | Endpoint                                   | Healthy response         |
| ------------- | ------------------------------------------ | ------------------------ |
| Gateway       | `/readyz` on the minted gateway URL        | HTTP 200                 |
| GitHub skills | `<GITHUB_SKILLS_BASE_URL>/skill-menu.json` | HTTP 200 after redirects |
| AWS skills    | `<AWS_SKILLS_BASE_URL>/skill-menu.json`    | HTTP 200 after redirects |
