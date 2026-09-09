# Coherence pilot

[Coherence](https://github.com/PostHog/coherence) checks declared architecture
contracts against source and existing tests. This is a local contributor tool,
not part of the published Wizard, a model harness, or a mandatory CI/commit
gate.

## Setup

Use the repository's Node and pnpm versions from
[package.json](../package.json), with Git and authenticated read access to
`PostHog/coherence`.

```bash
pnpm install --frozen-lockfile
pnpm coherence:install
pnpm coherence:check
```

[The installer](../tools/coherence.sh) pins Coherence v0.37.1 at commit
`d1a222795f45230e702cf6354d2f8e928b60eb04`. It clones into the ignored
`node_modules/.cache/coherence/` directory, installs the upstream lockfile with
lifecycle scripts disabled, then explicitly builds the CLI. Installation needs
network; subsequent structural checks run locally. Re-run installation after
deliberately updating the pin. Remove `node_modules/.cache/coherence/` to
uninstall; no global hooks or Claude/Codex settings are installed.

## Checks and scope

[wizard.spec.md](../wizard.spec.md) covers three existing contracts:

- Program bindings cover the program registry.
- Router screens are projected from program steps.
- A Pi tool-output scanner failure sets the `criticalViolation` latch.

`pnpm coherence:check` runs `verify --fast`: it checks declared imports,
boundary symbols, and statically identifiable test names. The three executable
boundary claims remain **skipped** until their tests run. Do not interpret this
as an end-to-end or behavioral pass. Unexpected skips, including misspelled
claims, need investigation; the CLI can exit successfully with skipped claims.
With this repository’s dynamic Vitest collection, a missing test name can remain
`UNKNOWN` in the fast scan. Full verification catches it from the actual test
report.

```bash
pnpm coherence verify
pnpm coherence graph
pnpm coherence context src/lib/agent/runner/switchboard/index.ts
```

Full verification runs only the three existing Vitest files named in
[coherence.config.json](../coherence.config.json), batched once and matched from
the JSON report. It does not launch Wizard sessions or paid model calls. A fresh
checkout needs `node scripts/generate-version.cjs` before the focused tests if
the generated version module is absent. The two scenario-based claims use
`via guard` because they test concrete behavior, not a complete live registry;
they do not claim exhaustive security coverage.

Coherence writes reports to ignored `.coherence/` and graph artifacts to ignored
`docs/coherence-generated/`. The wrapper exposes only `install`, `verify`,
`graph`, and `context`. In this pinned version, upstream `docs`/`overview`
writes a root `AGENTS.md` even with a different output directory. Those commands
and `claude` are deliberately unavailable through the wrapper to preserve the
authored [AGENTS.md](../AGENTS.md) and importing [CLAUDE.md](../CLAUDE.md). The
dependency cache lives under `node_modules` so Wizard's existing test and lint
exclusions also exclude Coherence's own sources and tests. Generated symbol
documentation jobs are advisory: do not generate comments across the repository
to satisfy them. Keep new code comments to one line and add only useful,
maintained documentation.

## Maintenance and limits

Keep each claim on one line; the Prettier override for `*.spec.md` prevents
wrapping from changing the parsed claim. Update the spec with its
implementation. Reuse existing meaningful tests rather than adding parallel
tests to satisfy Coherence. Verify a new claim can fail when its protected
behavior is broken; record observed evidence under `## refutations` rather than
inventing a passing assurance.

The scanner includes TypeScript and TSX sources. Ordinary skill Markdown is not
semantically verified, and hidden `.claude` directories are not graph nodes.
Review local links and skill accuracy separately. Gateway model/effort
allowlists and required prompt policy also live outside this checkout and need
coordinated review; this tool cannot validate their deployed state.

The current setup is explicit local invocation. Before introducing an automated
gate, include Markdown/specs, `.claude/skills`, TS/TSX, scripts, and
configuration changes in its trigger. Do not copy the older PostHog
agent-platform source-only pre-commit trigger. Defer lifecycle hooks and
work/decision ledgers until there is a concrete need for them.
