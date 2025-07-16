<p align="center">
  <img alt="posthoglogo" src="https://user-images.githubusercontent.com/65415371/205059737-c8a4f836-4889-4654-902e-f302b187b6a0.png">
</p>

> **⚠️ Experimental:** This wizard is still in an experimental phase. If you
> have any feedback, please drop an email to **joshua** [at] **posthog** [dot] >
> **com**.

<h1>PostHog wizard ✨</h1>
<h4>The PostHog wizard helps you quickly add PostHog to your project using AI.</h4>

# Usage

To use the wizard, you can run it directly using:

```bash
npx @posthog/wizard
```

Currently the wizard can be used for **React, NextJS, Svelte, Astro and React
Native** projects. If you have other integrations you would like the wizard to
support, please open a [GitHub issue](https://github.com/posthog/wizard/issues)!

## MCP Commands

The wizard also includes commands for managing PostHog MCP (Model Context
Protocol) servers:

```bash
# Install PostHog MCP server to supported clients
npx @posthog/wizard mcp add

# Remove PostHog MCP server from supported clients
npx @posthog/wizard mcp remove
```

# Options

The following CLI arguments are available:

| Option            | Description                                                      | Type    | Default | Choices                                              | Environment Variable           |
| ----------------- | ---------------------------------------------------------------- | ------- | ------- | ---------------------------------------------------- | ------------------------------ |
| `--help`          | Show help                                                        | boolean |         |                                                      |                                |
| `--version`       | Show version number                                              | boolean |         |                                                      |                                |
| `--debug`         | Enable verbose logging                                           | boolean | `false` |                                                      | `POSTHOG_WIZARD_DEBUG`         |
| `--region`        | PostHog cloud region (when not specified, prompts for selection) | string  |         | "us", "eu"                                           | `POSTHOG_WIZARD_REGION`        |
| `--default`       | Use default options for all prompts                              | boolean | `true`  |                                                      | `POSTHOG_WIZARD_DEFAULT`       |
| `--signup`        | Create a new PostHog account during setup                        | boolean | `false` |                                                      | `POSTHOG_WIZARD_SIGNUP`        |
| `--integration`   | Integration to set up                                            | string  |         | "nextjs", "astro", "react", "svelte", "react-native" |                                |
| `--force-install` | Force install packages even if peer dependency checks fail       | boolean | `false` |                                                      | `POSTHOG_WIZARD_FORCE_INSTALL` |
| `--install-dir`   | Directory to install PostHog in                                  | string  |         |                                                      | `POSTHOG_WIZARD_INSTALL_DIR`   |

> Note: A large amount of the scaffolding for this came from the amazing Sentry
> wizard, which you can find [here](https://github.com/getsentry/sentry-wizard)
> 💖

# Steal this code

While the wizard works great on its own, we also find the approach used by this
project is
[a powerful way to improve AI agent coding sessions](https://posthog.com/blog/envoy-wizard-llm-agent).
Agents can run CLI tools, which means that conventional code like this can
participate in the AI revolution as well – with all the benefits and control
that conventional code implies.

If you want to use this code as a starting place for your own project, here's a
quick explainer on its structure.

## Entrypoint: `run.ts`

The entrypoint for this tool is `run.ts`. Use this file to interpret arguments
and set up the general flow of the application.

## Analytics

Did you know you can capture PostHog events even for smaller, supporting
products like a command line tool? `src/utils/analytics.ts` is a great example
of how to do it.

This file wraps `posthog-node` with some convenience functions to set up an
analytics session and log events. We can see the usage and outcomes of this
wizard alongside all of our other PostHog product data, and this is very
powerful. For example: we could show in-product surveys to people who have used
the wizard to improve the experience.

## Leave rules behind

Supporting agent sessions after we leave is important. There are plenty of ways
to break or misconfigure PostHog, so guarding against this is key.

`src/utils/rules/add-editor-rules.ts` demonstrates how to dynamically construct
rules files and store them in the project's `.cursor/rules` directory.

## Prompts and LLM interactions

LLM agent sessions are _anti-deterministic_: really, anything can happen.

But using LLMs for code generation is really advantageous: they can interpret
existing code at scale and then modify it reliably.

_If_ they are well prompted.

`src/lib/prompts.ts` demonstrates how to wrap a deterministic fence around a
chaotic process. Every wizard session gets the same prompt, tailored to the
specific files in the project.

These prompts are channeled using `src/utils/query.ts` to an LLM interface we
host. This gives us more control: we can be certain of the model version and
provider which interpret the prompts and modify the files. This way, we can find
the right tools for the job and again, apply them consistently.

This also allows us to pick up the bill on behalf of our customers.

When we make improvements to this process, these are available instantly to all
users of the wizard, no training delays or other ambiguity.

## Running locally

Run:

```bash
pnpm try --install-dir=[a path]
```

To build and use the tool locally:

```bash
bin/build
```

This compiles the TypeScript code and prepares the `dist` directory. Run this
command any time you make changes to the wizard's source code.

```bash
pnpm link --global
```

This command makes your local version of the wizard available system-wide. You
generally only need to do this once.

Then:

```bash
wizard [options]
```

The wizard will execute your last build.

## Testing

To run unit tests, run:

```bash
bin/test
```

To run E2E tests run:

```bash
bin/test-e2e
```

E2E tests are a bit more complicated to create and adjust due to to their mocked
LLM calls. See the `e2e-tests/README.md` for more information.

## Publishing your tool

To make your version of a tool usable with a one-line `npx` command:

1. Edit `package.json`, especially details like `name`, `version`
2. Run [`npm publish`](https://docs.npmjs.com/cli/v7/commands/npm-publish) from
   your project directory
3. Now you can run it with `npx yourpackagename`
