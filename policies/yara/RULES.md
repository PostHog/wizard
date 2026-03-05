# YARA Rules for the PostHog Wizard

Reference for writing `wizard.yar`. This describes what the wizard agent does, what it can touch, and what YARA rules should catch.

## What is the wizard?

An AI coding agent (Claude) that instruments a user's codebase with PostHog analytics. It reads project files, writes/edits source code, and runs shell commands (package installs, builds, linters). It supports JavaScript (Next.js, React, Vue, Nuxt, Angular, Astro, Svelte, etc.), Python (Django, Flask, FastAPI), Ruby (Rails), PHP (Laravel), Swift, and Android (Kotlin).

## What does the agent write?

- `posthog.capture('event_name', { properties })` calls (JS/TS)
- `posthog.capture(event='...', properties={...})` calls (Python)
- PostHog SDK initialization: `posthog.init('<api-key>', { ... })` (JS) or similar
- Provider/wrapper components (e.g. `<PostHogProvider>`)
- Environment variable references like `process.env.NEXT_PUBLIC_POSTHOG_KEY`
- `.env` / `.env.local` files with `POSTHOG_KEY=phc_...` entries (via MCP tools only)
- Config file edits (`next.config.js`, `nuxt.config.ts`, `settings.py`, etc.)

## What tools does the agent have?

| Tool | What it does |
|------|-------------|
| `Read` | Read any file |
| `Write` | Create/overwrite a file |
| `Edit` | String-replace in a file |
| `Glob` | Find files by pattern |
| `Grep` | Search file contents (ripgrep) |
| `Bash` | Run shell commands (restricted — see below) |
| `Skill` | Load PostHog integration skills from MCP |
| `ListMcpResourcesTool` | Discover available MCP resources |
| MCP: `check_env_keys` | Check which env var keys exist in a .env file |
| MCP: `set_env_values` | Write env vars to a .env file |
| MCP: `detect_package_manager` | Detect npm/yarn/pnpm/etc. |

### Bash restrictions (existing L1 — `canUseTool`)

- **Blocked operators:** `;` `` ` `` `$` `(` `)` — prevents command injection/chaining
- **Allowed commands:** package installs (`npm install`, `pip install`, etc.), builds, type checking, linting/formatting (200+ linters whitelisted)
- **Blocked:** direct `.env` file access via Read/Write/Edit/Grep (must use MCP tools)

---

## YARA rules to write

### Category 1: PII leakage in analytics calls

The agent should NEVER put personally identifiable information inside `capture()` calls. Scan **PostToolUse on Write/Edit** outputs.

Note: `identify()` calls are exempt from email, phone, and name checks — setting user properties like email and name is a standard PostHog pattern (see [Identifying users docs](https://posthog.com/docs/product-analytics/identify)). However, highly sensitive PII (SSN, credit card, etc.) should still never appear in any analytics call.

| Rule name | What to match | Why |
|-----------|--------------|-----|
| `pii_email_in_capture` | `capture(` ... `email` ... `)` | Email addresses should not be event properties |
| `pii_phone_in_capture` | `capture(` ... `phone` ... `)` | Phone numbers are PII |
| `pii_name_in_capture` | `capture(` ... `full_name` or `fullName` or `first_name` or `last_name` ... `)` | Names are PII |
| `pii_address_in_capture` | `capture(` ... `address` or `street` or `zip_code` ... `)` | Physical addresses are PII |
| `pii_ssn_in_capture` | `capture(` ... `ssn` or `social_security` ... `)` | SSN is PII |
| `pii_credit_card` | `capture(` ... `card_number` or `cvv` or `credit_card` ... `)` | Payment info is PII |
| `pii_ip_address` | `capture(` ... `ip_address` or `client_ip` or `remote_addr` ... `)` | IP addresses are PII |

**Pattern guidance:** Match broadly within the parens of `.capture(` calls only. Use case-insensitive matching. Examples:

```
$email = /\.capture\([^)]{0,200}email[^)]*\)/ nocase
$phone = /\.capture\([^)]{0,200}phone[^)]*\)/ nocase
```

**Applies to:** `PostToolUse:Write`, `PostToolUse:Edit`

### Category 2: Hardcoded secrets

The agent should use environment variables, never inline secrets.

| Rule name | What to match | Why |
|-----------|--------------|-----|
| `hardcoded_posthog_key` | `phc_` followed by 20+ alphanumeric chars | PostHog project API keys should be in env vars |
| `hardcoded_posthog_host` | Literal `https://us.i.posthog.com` or `https://eu.i.posthog.com` in source code (not in `.env`) | Host URL should be in env vars too |
| `hardcoded_generic_api_key` | `api_key = "..."` or `apiKey: "..."` with a long string value | Any hardcoded key is suspicious |

**Pattern guidance:**

```
$phc_key = /phc_[a-zA-Z0-9]{20,}/
$host_literal = /['"]https:\/\/(us|eu)\.i\.posthog\.com['"]/
```

**Applies to:** `PostToolUse:Write`, `PostToolUse:Edit`

### Category 3: Dangerous PostHog configuration

The agent should not disable features that are on by default.

| Rule name | What to match | Why |
|-----------|--------------|-----|
| `autocapture_disabled` | `autocapture: false` or `autocapture = False` (Python) | Autocapture should stay enabled unless user explicitly asks |
| `session_recording_disabled` | `disable_session_recording: true` | Should not disable session recording |
| `opt_out_capturing` | `posthog.opt_out_capturing()` or `opted_out: true` | Should never opt out of capturing |
| `capture_pageview_false` | `capture_pageview: false` in a non-SPA context | Only valid for SPAs with manual pageview tracking — be careful with this one, might have false positives in React/Next.js where it's correct |

**Pattern guidance:**

```
$autocapture_off = /autocapture\s*[:=]\s*(false|False|0)/ nocase
$opt_out = /opt_out_capturing/ nocase
```

**Applies to:** `PostToolUse:Write`, `PostToolUse:Edit`

**Note on `capture_pageview: false`:** This is actually correct for single-page apps (Next.js, React, Vue, etc.) where the agent sets up manual pageview tracking. You may want to skip this rule or make it informational-only to avoid false positives.

### Category 4: Prompt injection detection

Files the agent reads might contain adversarial instructions trying to hijack the agent.

| Rule name | What to match | Why |
|-----------|--------------|-----|
| `prompt_injection_ignore` | "ignore previous instructions", "ignore all instructions" | Classic prompt injection |
| `prompt_injection_role` | "you are now", "act as", "pretend you are" | Role hijacking |
| `prompt_injection_disregard` | "disregard all", "disregard previous", "disregard your" | Override attempt |
| `prompt_injection_forget` | "forget your instructions", "forget everything" | Memory wipe attempt |
| `prompt_injection_system` | "system prompt:", "new instructions:" | Fake system message |
| `prompt_injection_do_not` | "do not follow", "stop following" | Instruction override |
| `prompt_injection_base64` | Base64-encoded blocks in unexpected places (e.g. inside comments or strings that decode to instructions) | Obfuscated injection |

**Pattern guidance:**

```
$ignore = "ignore previous instructions" nocase
$role = /you are now\s+(a|an|the)\b/ nocase
$system = "system prompt:" nocase
```

**Applies to:** `PostToolUse:Read`, `PostToolUse:Grep` (scan what the agent reads back)

**Severity:** CRITICAL — if triggered, the agent should be **aborted** (its context is now poisoned). Do not just block the tool call; the agent has already seen the content.

### Category 5: Secret exfiltration via commands

The agent might try to send secrets over the network via shell commands.

| Rule name | What to match | Why |
|-----------|--------------|-----|
| `exfil_curl_env` | `curl` with env var references (`$KEY`, `${SECRET}`, etc.) | Sending secrets via HTTP |
| `exfil_wget` | `wget` with secret-like args | Same via wget |
| `exfil_base64_pipe` | `base64` piped to `curl` or `wget` | Obfuscated exfiltration |
| `exfil_nc` | `nc` or `netcat` usage | Raw socket exfiltration |
| `exfil_dns` | `dig`, `nslookup`, `host` with variable interpolation | DNS exfiltration |

**Pattern guidance:**

```
$curl_env = /curl.*\$\{?[A-Z_]*KEY/ nocase
$base64_pipe = /base64.*\|.*curl/ nocase
$nc = /\bnc\b|\bnetcat\b/ nocase
```

**Applies to:** `PreToolUse:Bash`

**Note:** Most of these are already blocked by L1 (`canUseTool` blocks `$`, `` ` ``, etc.), so these are defense-in-depth. They'd only fire if L1 has a bypass bug.

### Category 6: File system safety

| Rule name | What to match | Why |
|-----------|--------------|-----|
| `destructive_rm` | `rm -rf` or `rm -r` on broad paths | Should never mass-delete |
| `git_force_push` | `git push --force` or `git push -f` | Should never force push |
| `git_reset_hard` | `git reset --hard` | Should never discard user's changes |
| `env_file_read` | Direct `.env` file path in Read/Grep tool input | Defense-in-depth for L1 .env blocking |
| `chmod_dangerous` | `chmod 777` or `chmod a+rwx` | Should not open permissions |

**Applies to:** `PreToolUse:Bash`, `PreToolUse:Read`, `PreToolUse:Write`

### Category 7: Package supply chain

| Rule name | What to match | Why |
|-----------|--------------|-----|
| `wrong_posthog_package` | Installing `posthog` (the wrong npm package) instead of `posthog-js` or `posthog-node` | Common mistake — `posthog` on npm is not the official SDK |
| `unexpected_package` | `npm install` / `pip install` / `gem install` of packages not related to PostHog or the detected framework | Agent shouldn't install random packages |
| `npm_install_global` | `npm install -g` | Should never install globally |

**Applies to:** `PreToolUse:Bash`

**Note on `unexpected_package`:** This one is hard to express purely in YARA without a big allowlist. Consider making it advisory or skipping it if the allowlist approach is impractical. The key packages to allow are: `posthog-js`, `posthog-node`, `posthog`, `posthog-python`, `posthog-ruby`, `posthog-php`, and their framework wrappers.

---

## How YARA rules get invoked

The sondera harness calls YARA on the **content** of tool inputs and outputs. Each rule has a `meta.applies_to` field specifying when it runs:

- `PreToolUse:Bash` — before a shell command executes (scan the command string)
- `PostToolUse:Write` / `PostToolUse:Edit` — after the agent writes/edits a file (scan the written content)
- `PostToolUse:Read` / `PostToolUse:Grep` — after the agent reads file content (scan what it got back)

## What happens when a rule matches

| Category | Action |
|----------|--------|
| Prompt injection (cat 4) | **Abort the agent entirely** — context is poisoned |
| PII / hardcoded secrets (cat 1-2) | **Block + instruct agent to revert** the change |
| Dangerous config (cat 3) | **Block + instruct agent to fix** |
| Exfiltration / destructive (cat 5-6) | **Block the tool call** before execution |
| Supply chain (cat 7) | **Block the tool call** before execution |

## Files to produce

Your teammate should create:

```
policies/yara/wizard.yar    ← all rules in one file (or split by category)
```

The file at `policies/yara/RULES.md` (this file) is the spec. The `.yar` file is the implementation.
