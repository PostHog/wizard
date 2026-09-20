/** Full store controls: one route per FlowStore setter a parent may call, whatever the current screen. */
import type { FrameworkConfig } from '../framework-config.js';
import { HostResolution } from '../host-resolution.js';
import { flowFor } from '../programs/flow-for.js';
import { PROGRAM_REGISTRY } from '../programs/program-registry.js';
import { FRAMEWORK_REGISTRY } from '../registry.js';
import {
  AdditionalFeature,
  DiscoveredFeature,
  McpOutcome,
  type AskAnswers,
} from '../session/wizard-session.js';
import type { Integration } from '../shared/constants.js';
import {
  BadParamError,
  MissingParamError,
  optionalBoolean,
  optionalOneOf,
  optionalStringArray,
  requireBoolean,
  requireNumber,
  requireOneOf,
  requireRecord,
  requireString,
} from './params.js';
import type { SetterView, StoreSetter } from './types.js';

/** Thrown for a name outside the table. Maps to 400. */
export class UnknownSetterError extends Error {
  constructor(name: string) {
    super(`No store setter "${name}". Read GET /store for the list.`);
    this.name = 'UnknownSetterError';
  }
}

const enumValues = <T extends string>(e: Record<string, T>): readonly T[] =>
  Object.values(e);

/** The MCP step's feature choice: absent, the word "all", or a list of feature ids. */
function featuresSelected(
  subject: string,
  params: Record<string, unknown>,
): 'all' | string[] | undefined {
  const v = params.featuresSelected;
  if (v === undefined || v === 'all') return v;
  if (Array.isArray(v) && v.every((f) => typeof f === 'string')) {
    return v;
  }
  throw new BadParamError(
    subject,
    'featuresSelected',
    'expected "all" or string[]',
  );
}

/**
 * The session setters a parent uses to configure a run or answer a screen.
 * Run-level atoms (tasks, status, phase, outro data) stay the agent's; setters
 * with effects beyond the store (account provisioning, settings backups, the
 * OAuth code flow) stay off the wire.
 */
export const CONTROL_SETTERS: readonly StoreSetter[] = [
  {
    name: 'completeSetup',
    description: 'Confirm the intro (setupConfirmed).',
    apply: (store) => store.completeSetup(),
  },
  {
    name: 'grantSharing',
    description: 'Grant sharing of scan results.',
    apply: (store) => store.grantSharing(),
  },
  {
    name: 'declineSharing',
    description: 'Decline sharing of scan results.',
    apply: (store) => store.declineSharing(),
  },
  {
    name: 'setCredentials',
    description:
      'Commit project credentials the parent already holds; the state only ever shows hasCredentials and projectId.',
    params: {
      accessToken: 'string',
      projectApiKey: 'string',
      projectId: 'number',
      apiHost: 'absolute URL, e.g. https://us.posthog.com',
    },
    apply: (store, p) => {
      const apiHost = requireString('setCredentials', p, 'apiHost');
      try {
        new URL(apiHost);
      } catch {
        throw new BadParamError(
          'setCredentials',
          'apiHost',
          'expected an absolute URL',
        );
      }
      store.setCredentials({
        accessToken: requireString('setCredentials', p, 'accessToken'),
        projectApiKey: requireString('setCredentials', p, 'projectApiKey'),
        projectId: requireNumber('setCredentials', p, 'projectId'),
        host: HostResolution.fromApiHost(apiHost),
      });
    },
  },
  {
    name: 'setRoleAtOrganization',
    description: "The user's role; absent clears it.",
    params: { role: 'string (optional)' },
    apply: (store, p) =>
      store.setRoleAtOrganization(
        p.role === undefined
          ? null
          : requireString('setRoleAtOrganization', p, 'role'),
      ),
  },
  {
    name: 'setFrameworkConfig',
    description:
      'Pick the framework by id, as detection would (integration + frameworkConfig from the registry).',
    params: { integration: 'framework id, e.g. "nextjs"' },
    apply: (store, p) => {
      const integration = requireString('setFrameworkConfig', p, 'integration');
      const config = (
        FRAMEWORK_REGISTRY as Partial<Record<string, FrameworkConfig>>
      )[integration];
      if (!config) {
        throw new BadParamError(
          'setFrameworkConfig',
          'integration',
          `unknown framework "${integration}"`,
        );
      }
      store.setFrameworkConfig(integration as Integration, config);
    },
  },
  {
    name: 'setDetectedFramework',
    description: 'The human label detection shows (detectedFrameworkLabel).',
    params: { label: 'string' },
    apply: (store, p) =>
      store.setDetectedFramework(
        requireString('setDetectedFramework', p, 'label'),
      ),
  },
  {
    name: 'setDetectionComplete',
    description: 'Mark detection done so detect screens advance.',
    apply: (store) => store.setDetectionComplete(),
  },
  {
    name: 'setFrameworkContext',
    description:
      'Commit one framework-context value (what detect and picker screens write); value is any JSON.',
    params: { key: 'string', value: 'JSON value' },
    apply: (store, p) => {
      const key = requireString('setFrameworkContext', p, 'key');
      if (!('value' in p)) {
        throw new MissingParamError('setFrameworkContext', 'value');
      }
      store.setFrameworkContext(key, p.value);
    },
  },
  {
    name: 'setIntegrate',
    description: 'Self-driving: whether to run the integration first.',
    params: { integrate: 'boolean' },
    apply: (store, p) =>
      store.setIntegrate(requireBoolean('setIntegrate', p, 'integrate')),
  },
  {
    name: 'enableFeature',
    description:
      'Queue an additional feature for the run (llm also sets llmOptIn).',
    params: { feature: enumValues(AdditionalFeature).join(' | ') },
    apply: (store, p) =>
      store.enableFeature(
        requireOneOf(
          'enableFeature',
          p,
          'feature',
          enumValues(AdditionalFeature),
        ),
      ),
  },
  {
    name: 'addDiscoveredFeature',
    description: 'Record a feature discovery would have found.',
    params: { feature: enumValues(DiscoveredFeature).join(' | ') },
    apply: (store, p) =>
      store.addDiscoveredFeature(
        requireOneOf(
          'addDiscoveredFeature',
          p,
          'feature',
          enumValues(DiscoveredFeature),
        ),
      ),
  },
  {
    name: 'switchProgram',
    description:
      "Register another program's flow: its gates, screens, and control actions replace the current ones.",
    params: { programId: 'a registered program id' },
    apply: (store, p) => {
      const programId = requireString('switchProgram', p, 'programId');
      if (!PROGRAM_REGISTRY.some((c) => c.id === programId)) {
        throw new BadParamError(
          'switchProgram',
          'programId',
          `unknown program "${programId}"`,
        );
      }
      store.switchProgram(flowFor(programId).flow);
    },
  },
  {
    name: 'setMcpComplete',
    description: 'Complete the MCP step.',
    params: {
      outcome: `${enumValues(McpOutcome).join(' | ')} (default skipped)`,
      installedClients: 'string[] (optional)',
      featuresSelected: '"all" | string[] (optional)',
      loginCommands: 'string[] (optional)',
    },
    apply: (store, p) => {
      const S = 'setMcpComplete';
      store.setMcpComplete(
        optionalOneOf(
          S,
          p,
          'outcome',
          enumValues(McpOutcome),
          McpOutcome.Skipped,
        ),
        optionalStringArray(S, p, 'installedClients'),
        featuresSelected(S, p),
        optionalStringArray(S, p, 'loginCommands'),
      );
    },
  },
  {
    name: 'setSkillsComplete',
    description: 'Complete the keep-skills step.',
    params: { kept: 'boolean (default true)' },
    apply: (store, p) =>
      store.setSkillsComplete(
        optionalBoolean('setSkillsComplete', p, 'kept', true),
      ),
  },
  {
    name: 'setMcpSuggestedPromptsDismissed',
    description: 'Dismiss the suggested-prompts step.',
    apply: (store) => store.setMcpSuggestedPromptsDismissed(),
  },
  {
    name: 'setSlackStepDismissed',
    description: 'Skip or finish the Connect-Slack step.',
    apply: (store) => store.setSlackStepDismissed(),
  },
  {
    name: 'setSlackConnected',
    description: 'Mark Slack connected.',
    params: { connected: 'boolean (default true)' },
    apply: (store, p) =>
      store.setSlackConnected(
        optionalBoolean('setSlackConnected', p, 'connected', true),
      ),
  },
  {
    name: 'setGithubConnected',
    description: 'Mark GitHub connected.',
    params: { connected: 'boolean (default true)' },
    apply: (store, p) =>
      store.setGithubConnected(
        optionalBoolean('setGithubConnected', p, 'connected', true),
      ),
  },
  {
    name: 'confirmSelfDrivingHandoff',
    description: 'Confirm the self-driving handoff screen.',
    apply: (store) => store.confirmSelfDrivingHandoff(),
  },
  {
    name: 'setOutroDismissed',
    description: 'Dismiss the outro of the active run.',
    params: { dismissed: 'boolean (default true)' },
    apply: (store, p) =>
      store.setOutroDismissed(
        optionalBoolean('setOutroDismissed', p, 'dismissed', true),
      ),
  },
  {
    name: 'setMintHandoff',
    description:
      'Decide the failed-run handoff: continue to the follow-ups or exit.',
    params: { action: 'continue | exit' },
    apply: (store, p) =>
      store.setMintHandoff(
        requireOneOf('setMintHandoff', p, 'action', [
          'continue',
          'exit',
        ] as const),
      ),
  },
  {
    name: 'resolvePendingQuestion',
    description:
      'Answer the pending wizard_ask request: { [questionId]: string | string[] }.',
    params: { answers: 'Record<questionId, string | string[]>' },
    apply: (store, p) => {
      const answers = requireRecord('resolvePendingQuestion', p, 'answers');
      for (const [id, value] of Object.entries(answers)) {
        const ok =
          typeof value === 'string' ||
          (Array.isArray(value) && value.every((v) => typeof v === 'string'));
        if (!ok) {
          throw new BadParamError(
            'resolvePendingQuestion',
            'answers',
            `"${id}" must be a string or string[]`,
          );
        }
      }
      store.resolvePendingQuestion(answers as AskAnswers);
    },
  },
  {
    name: 'resolveTaskNotice',
    description:
      'Resolve the task-notice overlay: keep runs the step, false skips it.',
    params: { keep: 'boolean (default true)' },
    apply: (store, p) =>
      store.resolveTaskNotice(
        optionalBoolean('resolveTaskNotice', p, 'keep', true),
      ),
  },
  {
    name: 'dismissOutage',
    description: 'Dismiss the blocking outage screen.',
    apply: (store) => store.dismissOutage(),
  },
];

export function setterNamed(name: string): StoreSetter | undefined {
  return CONTROL_SETTERS.find((s) => s.name === name);
}

export function toSetterView(setter: StoreSetter): SetterView {
  return {
    name: setter.name,
    description: setter.description,
    ...(setter.params ? { params: setter.params } : {}),
  };
}
