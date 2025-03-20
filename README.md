<p align="center">
  <img alt="posthoglogo" src="https://user-images.githubusercontent.com/65415371/205059737-c8a4f836-4889-4654-902e-f302b187b6a0.png">
</p>

> **⚠️ Experimental:** This wizard is still in an experimental phase. 
> If you have any feedback, please drop an email to **joshua** [at] **posthog** [dot] **com**.

<h1>PostHog Wizard</h1>
<h4>The PostHog Wizard helps you quickly add PostHog to your project.</h4>

# Usage

To use the wizard, you can run it directly using:

```bash
npx @posthog/wizard
```

Currently the wizard can be used for Next.js only. If you have other platforms you would like the wizard to support, please open a [GitHub issue](https://github.com/posthog/wizard/issues)!

# Options

The following CLI arguments are available:

| Option            | Description                                                                | Type    | Default                         | Choices    | Environment Variable         |
| ----------------- | -------------------------------------------------------------------------- | ------- | ------------------------------- | ---------- | ---------------------------- |
| `--help`          | Show help                                                                  | boolean |                                 |            |                              |
| `--version`       | Show version number                                                        | boolean |                                 |            |                              |
| `--debug`         | Enable verbose logging                                                     | boolean | `false`                         |            | `POSTHOG_WIZARD_DEBUG`       |
| `--integration`   | Choose the integration to setup                                            | choices | Select integration during setup | "nextjs"   | `POSTHOG_WIZARD_INTEGRATION` |
| `--force-install` | Force install the SDK NPM package (use with caution!)                      | boolean | `false`                         |            |                              |
| `--install-dir`   | Relative path to install in                                                | string  | `.`                             |            | `POSTHOG_WIZARD_INSTALL_DIR` |
| `--region`        | PostHog region to use                                                      | choices |                                 | "us", "eu" | `POSTHOG_WIZARD_REGION`      |
| `--default`       | Select the default option for all questions automatically (where possible) | boolean | `false`                         |            | `POSTHOG_WIZARD_DEFAULT`     |

> Note: A large amount of the scaffolding for this came from the amazing Sentry wizard, which you can find [here](https://github.com/getsentry/sentry-wizard) 💖
