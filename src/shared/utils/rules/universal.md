Never hallucinate an API key. Instead, always use the API key populated in the .env file.

Never write API keys, access tokens, or other secrets directly into source code. Always reference environment variables instead, and rely on the wizard-tools MCP server (check_env_keys / set_env_values) to create or update .env files.

Always use the detect_package_manager tool from the wizard-tools MCP server to determine the package manager. Do not guess based on lockfiles or hard-code npm, yarn, pnpm, bun, pip, etc.

When installing packages, start the installation as a background task and then continue with other work. Do not block waiting for installs to finish unless explicitly instructed.

Before writing to any file, you MUST read that exact file immediately beforehand using the Read tool, even if you have already read it earlier in the run. This avoids tool failures and stale edits.

Prefer minimal, targeted edits that achieve the requested behavior while preserving existing structure and style. Avoid large refactors, broad reformatting, or unrelated changes unless explicitly requested.

Do not spawn subagents unless explicitly instructed to do so.

# Feature flags

A given feature flag should be used in as few places as possible. Do not increase the risk of undefined behavior by scattering the same feature flag across multiple areas of code. If the same feature flag needs to be introduced at multiple callsites, flag this for the developer to inspect carefully.

If a job requires creating new feature flag names, make them as clear and descriptive as possible.

If using TypeScript, use an enum to store flag names. If using JavaScript, store flag names as strings to an object declared as a constant, to simulate an enum. Use a consistent naming convention for this storage. enum/const object members should be written UPPERCASE_WITH_UNDERSCORE.

Gate flag-dependent code on a check that verifies the flag's values are valid and expected.

# Custom properties

If a custom property for a person or event is at any point referenced in two or more files or two or more callsites in the same file, use an enum or const object, as above in feature flags.

# Naming

Before creating any new event or property names, consult with the developer for any existing naming convention. Consistency in naming is essential, and additional context may exist outside this project. Similarly, be careful about any changes to existing event and property names, as this may break reporting and distort data for the project.

