/**
 * The shapes a control action or setter takes before it is bound to a store,
 * and the commits several screens share. Core and program TUI entries build
 * their tables from these; this module imports no program and no registry.
 */
import { FRAMEWORK_REGISTRY } from '@programs';
import type { Integration } from '@shared/constants';
import { McpOutcome } from '@shared/run-state';
import {
  BadParamError,
  optionalOneOf,
  optionalStringArray,
  requireString,
} from '@shared/control/params';
import type { ControlAction, ControlSetter } from '@shared/control/types';
import type { WizardStore } from '../store.js';

/** An action before it is bound to a store. */
export type ActionDef = Omit<ControlAction, 'apply'> & {
  apply: (store: WizardStore, params: Record<string, unknown>) => void;
};

/** A setter before it is bound to a store. */
export type SetterDef = Omit<ControlSetter, 'apply'> & {
  apply: (store: WizardStore, params: Record<string, unknown>) => void;
};

/** An outro payload param, as the session store's setters read it. */
export { outroDataParam as outroData } from '@programs';

export const confirmSetup: ActionDef = {
  id: 'confirm_setup',
  description: 'Confirm the intro and continue (sets setupConfirmed).',
  apply: (store) => store.completeSetup(),
};

export const dismissOutro: ActionDef = {
  id: 'dismiss_outro',
  description: 'Dismiss the outro (sets outroDismissed).',
  apply: (store) => store.setOutroDismissed(),
};

export const setMcpOutcome = (description: string): ActionDef => ({
  id: 'set_mcp_outcome',
  description,
  params: {
    outcome: '"installed" | "skipped" (default skipped)',
    clients: 'string[] (optional)',
  },
  apply: (store, params) => {
    const outcome = optionalOneOf(
      'set_mcp_outcome',
      params,
      'outcome',
      ['installed', 'skipped'] as const,
      'skipped',
    );
    store.setMcpComplete(
      outcome === 'installed' ? McpOutcome.Installed : McpOutcome.Skipped,
      optionalStringArray('set_mcp_outcome', params, 'clients'),
    );
  },
});

/** Commit the project a detect screen's picker would: its path and framework. */
export const pickIntegrationTarget = (pathKey: string): ActionDef => ({
  id: 'pick_integration_target',
  description:
    "Commit the project to set up, as the detect screen's picker would: " +
    'its path relative to the repo root and its framework.',
  params: {
    path: 'project path relative to the repo root ("." = root)',
    integration: 'framework id, e.g. "nextjs"',
  },
  apply: (store, params) => {
    const path = requireString('pick_integration_target', params, 'path');
    const integration = requireString(
      'pick_integration_target',
      params,
      'integration',
    ) as Integration;
    const config = FRAMEWORK_REGISTRY[integration];
    if (!config) {
      throw new BadParamError(
        'pick_integration_target',
        'integration',
        `unknown framework "${integration}"`,
      );
    }
    store.setFrameworkContext(pathKey, path);
    store.setFrameworkConfig(integration, config);
  },
});
