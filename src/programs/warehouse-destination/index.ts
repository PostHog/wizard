import {
  DEFAULT_AGENT_MODEL,
  Harness,
  Sequence,
  WIZARD_WAREHOUSE_DESTINATIONS_FLAG_KEY,
} from '@shared/constants';
import { LONGER_ASK_TIMEOUT_MS } from '@shared/ask-policy';
import type {
  ProgramConfig,
  ProgramRun,
  ProgramSession,
} from '@programs/program-contract';
import {
  getDetectedWarehouseDestinations,
  getDetectedWarehouseSources,
} from '@services/warehouse-sources';
import {
  WAREHOUSE_DESTINATION_POSTHOG_TOOLS,
  WAREHOUSE_DESTINATION_SCOPE_ADDITIONS,
} from './scopes.js';
import {
  detectWarehouseDestinationPrerequisites,
  getChosenWarehouseDestination,
  WAREHOUSE_DESTINATION_ABORT_CASES,
} from './detect.js';

const SKILL_ID = 'data-warehouse-destination-setup';
const REPORT_FILE = 'posthog-warehouse-export-report.md';
const DOCS_URL = 'https://posthog.com/docs/cdp/batch-exports';

/**
 * Inject the chosen warehouse and what detection found. The *how* — the
 * connect link, the target settings, the export model and interval — lives in
 * the skill. PostHog events leave only through a batch export; a warehouse
 * destination re-routes the rows that warehouse sources import.
 */
function buildPrompt(session: ProgramSession): string {
  const chosen = getChosenWarehouseDestination(session);
  const detected = getDetectedWarehouseDestinations(session);
  const sources = getDetectedWarehouseSources(session);

  const lines = [
    chosen
      ? `Send this project's PostHog events to the user's ${chosen} warehouse with a batch export. \`${chosen}\` is the warehouse destination type.`
      : 'The wizard found no warehouse in this project. Ask the user which warehouse they run before anything else.',
  ];
  if (detected.length > 0) {
    lines.push(
      '',
      'Warehouses the wizard detected in this project:',
      ...detected.map(
        (d) => `- ${d.label} (type: ${d.type}) — ${d.matchedSignal}`,
      ),
    );
  }
  if (sources.length > 0) {
    lines.push(
      '',
      `The project also has data the wizard can import (${sources
        .map((s) => s.label)
        .join(', ')}). ` +
        'If the PostHog project already has warehouse sources, offer to route their rows to this warehouse too, through a warehouse destination.',
    );
  }
  lines.push(
    '',
    'Credentials never pass through the terminal. Get a connect link, have the ' +
      'user save the connection in the browser, then wait for the integration ' +
      'with the connect-link status tool. Never ask the user to paste a ' +
      'credential or an integration id. Ask only for settings that are not ' +
      'secret, such as the dataset, schema or table.',
  );
  return lines.join('\n');
}

export const config: ProgramConfig = {
  command: 'destination',
  parentCommand: 'warehouse',
  description: 'Send your PostHog data to your own data warehouse',
  id: 'warehouse-destination',
  binding: {
    sequence: Sequence.linear,
    harness: Harness.pi,
    model: DEFAULT_AGENT_MODEL,
  },
  skillId: SKILL_ID,
  decisions: ['runs_data_warehouse'],
  scansCodebase: true,
  onReady: (ctx) =>
    detectWarehouseDestinationPrerequisites(
      ctx.session,
      ctx.setFrameworkContext,
    ),
  oauthScopeAdditions: WAREHOUSE_DESTINATION_SCOPE_ADDITIONS,
  posthogTools: WAREHOUSE_DESTINATION_POSTHOG_TOOLS,
  rolloutGate: {
    flagKey: WIZARD_WAREHOUSE_DESTINATIONS_FLAG_KEY,
    unavailableMessage:
      'Sending PostHog data to your warehouse is not available for your ' +
      `account yet. You can set up an export in PostHog: ${DOCS_URL}`,
  },
  healthCheck: false,
  reportFile: REPORT_FILE,
  run: (session: ProgramSession): Promise<ProgramRun> => {
    return Promise.resolve({
      skillId: SKILL_ID,
      integrationLabel: SKILL_ID,
      customPrompt: () => buildPrompt(session),
      successMessage: 'Your PostHog data is on its way to your warehouse!',
      reportFile: REPORT_FILE,
      docsUrl: DOCS_URL,
      spinnerMessage: 'Connecting your warehouse...',
      estimatedDurationMinutes: 5,
      // The user leaves the terminal to save credentials in the browser.
      askTimeoutMs: LONGER_ASK_TIMEOUT_MS,
      // The connect URL carries a long token; rich links let the user open or copy it whole.
      richLinks: true,
      abortCases: WAREHOUSE_DESTINATION_ABORT_CASES,
    });
  },
  requires: ['posthog-integration'],
};

export {
  CHOSEN_WAREHOUSE_DESTINATION_KEY,
  detectWarehouseDestinationPrerequisites,
  getChosenWarehouseDestination,
  WAREHOUSE_DESTINATION_ABORT_CASES,
  type WarehouseDestinationDetectError,
} from './detect.js';
export {
  getDetectedWarehouseDestinations,
  WAREHOUSE_DESTINATION_TYPES,
  type DetectedDestination,
  type WarehouseDestinationType,
} from '@services/warehouse-sources';
