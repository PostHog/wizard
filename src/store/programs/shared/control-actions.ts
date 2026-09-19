import type { DriverAction } from '../../control/types.js';
import { BadParamError, requireString } from '../../control/params.js';
import { FRAMEWORK_REGISTRY } from '../../registry.js';
import type { Integration } from '../../shared/constants.js';

/** Commit the project a detect screen's picker would: its path and framework. */
export function pickIntegrationTargetAction(pathKey: string): DriverAction {
  return {
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
      );
      const config = (FRAMEWORK_REGISTRY as Partial<Record<string, unknown>>)[
        integration
      ];
      if (!config) {
        throw new BadParamError(
          'pick_integration_target',
          'integration',
          `unknown framework "${integration}"`,
        );
      }
      store.setFrameworkContext(pathKey, path);
      store.setFrameworkConfig(
        integration as Integration,
        FRAMEWORK_REGISTRY[integration as Integration],
      );
    },
  };
}
