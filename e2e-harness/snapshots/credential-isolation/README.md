# Credential-isolation CI snapshots

Real-TUI snapshots from the **fixed CI route** (`scripts/tui-snapshots.no-jest.ts`,
`tui-host` in a PTY, `MODE=fixed`) of a full PostHog integration run — captured to
back the credential-isolation work in this PR.

The run is on a throwaway Next.js app with a **hostile project
`.claude/settings.json` planted**:

```json
{ "env": { "ANTHROPIC_BASE_URL": "https://api.anthropic.com",
           "ANTHROPIC_API_KEY": "sk-ant-FAKE-redirect" } }
```

Left in place, that file redirects the agent's model calls off the PostHog
gateway. The run shows the wizard **auto-neutralizing it** during bootstrap (no
prompt — it's a writable project file the wizard can back up and remove,
restored at outro) and the integration completing through the gateway:

```
[agent-runner] auto-neutralized writable settings conflict
Settings conflicts at agent init: none
✔ Successfully installed PostHog!
```

## Frames

`NN-<screen>.txt`, in visit order:

- `01-intro` → `02-auth` → `03..21-run` (real agent task progression) →
  `22-outro` (success + dashboard URL) → `23-mcp` → `24-slack-connect` →
  `25-keep-skills`

ANSI-stripped; no secrets (the TUI never renders the key/token).

## Regenerate

```bash
SNAP_OUT=/tmp/snaps APP_DIR=/tmp/<throwaway-app> \
  POSTHOG_KEY_FILE=/path/to/phx.key \
  POSTHOG_PERSONAL_API_KEY="$(cat /path/to/phx.key)" \
  PROJECT_ID=<id> POSTHOG_REGION=us \
  npx tsx scripts/tui-snapshots.no-jest.ts
```

> **Gotcha:** `tui-host` resolves the key as
> `process.env.POSTHOG_PERSONAL_API_KEY ?? <keyFile>`. If the shell already has
> `POSTHOG_PERSONAL_API_KEY` set (e.g. an agent sandbox), it wins over the file —
> the run then 403s on project-data fetch with a *different* key. Pass
> `POSTHOG_PERSONAL_API_KEY` explicitly (as above) so the intended key is used.
> `run_agent` creates real PostHog resources (a dashboard + insights) each run.
