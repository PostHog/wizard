---
name: adding-framework-support
description: Add a new framework integration to the PostHog wizard. Use when adding support for a new language or framework (e.g. Ruby on Rails, Go, Angular). Covers creating the agent config, detection logic, registry entry, and enum/label additions.
compatibility: Designed for Claude Code working on the PostHog wizard codebase.
metadata:
  author: posthog
  version: "1.0"
---

# Adding Framework Support

## Architecture Overview

Every framework integration is a single `FrameworkConfig` object. The wizard has no switch statements or per-framework routing — everything is data-driven through:

1. **`FrameworkConfig`** (`src/lib/framework-config.ts`) — the interface each framework implements
2. **`FRAMEWORK_REGISTRY`** (`src/lib/registry.ts`) — maps `Integration` enum values to configs
3. **`Integration` enum** (`src/lib/constants.ts`) — enum order determines detection priority and menu display order

The universal runner (`src/lib/agent-runner.ts`) handles all shared behavior: debug logging, version checking, welcome message, beta notices, AI consent, credential flow, agent execution, error handling, and outro messaging.

## Steps to Add a New Framework

### 1. Add to the Integration enum and labels

In `src/lib/constants.ts`, add the new value to `Integration`. **Enum order matters** — it controls both the detection priority (first match wins) and the display order in the CLI select menu. The display label comes from `metadata.name` in your `FrameworkConfig`.

```ts
export enum Integration {
  // ... existing entries
  rails = 'rails',  // insert at the desired detection/display position
}
```

### 2. Create the agent config file

Create `src/<framework>/<framework>-wizard-agent.ts`. This file exports:

- A `FrameworkConfig` object (the full integration definition)
- A thin runner function that just calls `runAgentWizard(CONFIG, options)`

Use an existing config as a template. The config has these sections:

#### `metadata`
- `name` — display name (e.g. "Ruby on Rails")
- `integration` — the enum value
- `docsUrl` — PostHog docs URL for manual setup fallback
- `unsupportedVersionDocsUrl` — optional fallback for old versions
- `beta` — set `true` to show a `[BETA]` notice before running
- `gatherContext` — optional async function to detect project-specific context (e.g. router type, project variant)

#### `detection`
- `packageName` — the package to check (e.g. `'rails'`)
- `packageDisplayName` — human-readable name for error messages
- `usesPackageJson` — set `false` for non-JS frameworks (Python, PHP, Ruby, etc.)
- `getVersion` — extract version from package.json (return `undefined` if `usesPackageJson: false`)
- `getVersionBucket` — optional function to bucket versions for analytics (e.g. `'7.x'`)
- `minimumVersion` — optional minimum version string; runner auto-checks and bails if too old
- `getInstalledVersion` — async function to get the installed version
- `detect` — async function that returns `true` if this framework is present in the project

#### `environment`
- `uploadToHosting` — whether to offer uploading env vars to hosting providers
- `getEnvVars` — returns the env var names and values for this framework

#### `analytics`
- `getTags` — returns analytics tags from gathered context

#### `prompts`
- `projectTypeDetection` — text describing how to confirm the project type
- `packageInstallation` — text describing package manager conventions
- `getAdditionalContextLines` — optional function returning extra prompt lines from context

#### `ui`
- `successMessage`, `estimatedDurationMinutes`
- `getOutroChanges` — returns "what the agent did" bullets
- `getOutroNextSteps` — returns "next steps" bullets

### 3. Register in the framework registry

In `src/lib/registry.ts`, import the config and add it:

```ts
import { NEW_AGENT_CONFIG } from '../<framework>/<framework>-wizard-agent';

export const FRAMEWORK_REGISTRY: Record<Integration, FrameworkConfig> = {
  // ... existing entries
  [Integration.newFramework]: NEW_AGENT_CONFIG,
};
```

### 4. Create framework utilities (if needed)

If the framework needs project type detection, version extraction, or other complex logic, create `src/<framework>/utils.ts` with the relevant functions. Keep this separate from the agent config to maintain testability.

## Detection Guidelines

- For JS/TS frameworks: check `package.json` for the framework package using `hasPackageInstalled` and `tryGetPackageJson` from `src/utils/clack-utils.ts` and `src/utils/package-json.ts`
- For Python frameworks: glob for `requirements*.txt`, `pyproject.toml`, `setup.py`, `Pipfile` and check contents
- For PHP frameworks: check `composer.json` or framework-specific files (e.g. `artisan` for Laravel)
- For Ruby frameworks: check `Gemfile` or `Gemfile.lock` for the framework gem
- Always ignore virtual environment and dependency directories in globs

## Verification

After adding a framework:

```bash
pnpm build    # Must compile with no errors
pnpm test     # All tests must pass
pnpm fix      # No new lint errors (warnings are OK)
```

## Reference Configs

Good examples to study:
- **JS framework**: `src/nextjs/nextjs-wizard-agent.ts` — package.json detection, context gathering (router type)
- **Python framework**: `src/django/django-wizard-agent.ts` — filesystem detection, `usesPackageJson: false`
- **PHP framework**: `src/laravel/laravel-wizard-agent.ts` — composer.json detection, multiple detection strategies
