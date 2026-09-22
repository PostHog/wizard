import type { ProgramRun } from '@programs/program-run';

export const METRICS_REPORT_FILE = 'posthog-metrics-report.md';
export const METRICS_RUN: ProgramRun = {
  integrationLabel: 'metrics',
  // No `skillId`: the agent must load the menu and install the right
  // variant itself. The prompt below tells it how.
  customPrompt: () => `Instrument this project with PostHog application metrics.

This flow has no pre-installed skill — you install the right one yourself:

1. Call \`load_skill_menu\` with \`category: "metrics"\`. The menu is the
   source of truth: one variant per platform.

2. Pick the variant that matches the project:
   - Python tooling (\`pyproject.toml\`, \`requirements.txt\`, \`Pipfile\`) →
     \`metrics-python\` (needs \`posthog\` >= 7.23.0)
   - \`package.json\` with server-side Node code → \`metrics-nodejs\`
     (needs \`posthog-node\` >= 5.43.0)
   - \`package.json\` that is browser-only → \`metrics-javascript\`
     (needs \`posthog-js\` >= 1.399.0)
   - Kubernetes manifests / Helm charts and the user wants cluster-level
     scraping → \`metrics-kubernetes\`
   - Any other language → \`metrics-other\` (plain OTLP exporter)
   A full-stack app (e.g. Next.js) usually wants the server variant — metrics
   measure service work, not user actions. Genuinely ambiguous →
   \`wizard_ask\` with a multi-choice picker.

3. Call \`install_skill\` with the picked variant id. Then follow that skill's
   \`SKILL.md\` and references end-to-end — it covers where to place metrics
   (middleware, background jobs, external calls, business commit sites) and
   the low-cardinality attribute rules.

Make only additive changes — reuse an existing PostHog client by adding the
\`metrics\` config to it rather than constructing a second client, and do not
touch existing identify calls, event capture, or dashboards. The final report
is written to ./${METRICS_REPORT_FILE}.`,
  successMessage: `Application metrics configured! View the report at ./${METRICS_REPORT_FILE}`,
  reportFile: METRICS_REPORT_FILE,
  docsUrl: 'https://posthog.com/docs/metrics',
  spinnerMessage: 'Setting up application metrics...',
  estimatedDurationMinutes: 5,
};
