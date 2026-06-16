# AGENTS.md — PostHog Wizard

Guidance for AI agents working in this repo. For human contributor docs see
[`README.md`](README.md); for architecture and design discipline see
[`CLAUDE.md`](CLAUDE.md) and `.claude/skills/wizard-development/SKILL.md`.

## CLI command surface

The CLI was overhauled to a smaller, extensible command surface. **Use the new
command names.** Old names mostly no longer exist — only two are kept as aliases.

| Old command | New command | Status |
|---|---|---|
| `wizard integrate` | `wizard` (default flow) | command removed |
| `wizard events-audit` | `wizard audit events` | moved into `audit` family |
| `wizard audit` (single) | `wizard audit [skill]` | now a family; `audit all` = comprehensive |
| `wizard audit-3000` | *removed* | retired |
| `wizard revenue` | `wizard revenue-analytics` | renamed (old `revenue` removed) |
| `wizard upload-sourcemaps` | `wizard upload-source-maps` | renamed; `upload-sourcemaps` kept as alias |

### Where the surface is defined (source of truth)

- **Registration:** [`bin.ts`](bin.ts) — the `.use()` chain wires each command.
- **Command shape:** [`src/commands/command.ts`](src/commands/command.ts) — the
  `Command` interface every command implements.
- **Flat native commands** (e.g. `revenue-analytics`, `upload-source-maps`) are
  built with `nativeCommandFactory`
  ([`src/commands/factories/native-command-factory.ts`](src/commands/factories/native-command-factory.ts)).
- **Family commands** (e.g. `audit`) resolve subcommands at runtime against the
  `cliEntries` in `skill-menu.json`. Logic lives in
  [`src/lib/programs/dispatch-family.ts`](src/lib/programs/dispatch-family.ts).
  Adding a skill-backed subcommand is a **context-mill** release, not a wizard
  change.

### Commands vs. programs (don't confuse these)

- A **command** is the word a user types (`audit`, `revenue-analytics`).
- A **program** is the internal business logic (`posthog-integration`,
  `revenue-analytics-setup`) that a command invokes, and that other programs
  depend on via `requires: [...]`.
- `posthog-integration` is a **program id, not a command**. It powers the default
  flow and is a dependency of most other programs. Do not treat it as a CLI
  command or reference it in CI as one.

### Adding a command alias (keep an old name working)

Mirror the existing pattern: give the `Command.name` an array of
`[newName, ...legacyNames]`. yargs treats the extra entries as aliases. See
[`src/commands/upload-sourcemaps.ts`](src/commands/upload-sourcemaps.ts). Reserve
aliases for names that external callers (users' scripts) may still use — when the
only caller is one we control, update the caller instead.

## Before you change the command surface

Read `.claude/skills/wizard-development/SKILL.md`. Keep product knowledge out of
infrastructure code — commands dispatch to typed `ProgramConfig`s; they don't
embed PostHog-specific logic.

## Verify changes

```bash
pnpm build && pnpm test && pnpm fix
```
