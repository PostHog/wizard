import { testRunnerContext } from '@programs/shared/__tests__/runner-context.no-jest';
import type { WizardSession } from '@services/session';

import {
  CHOSEN_WAREHOUSE_DESTINATION_KEY,
  config,
  getChosenWarehouseDestination,
} from '@programs/warehouse-destination';
import {
  DETECTED_WAREHOUSE_DESTINATIONS_KEY,
  DETECTED_WAREHOUSE_SOURCES_KEY,
} from '@services/warehouse-sources';

function session(
  frameworkContext: Record<string, unknown> = {},
): WizardSession {
  return { installDir: '/tmp/app', frameworkContext } as WizardSession;
}

const detected = (...types: string[]) =>
  types.map((type) => ({ type, label: `${type} label`, matchedSignal: 'sig' }));

async function resolveRun(sess: WizardSession) {
  const { run } = config;
  if (typeof run !== 'function') throw new Error('expected a run function');
  return run(sess, testRunnerContext());
}

describe('getChosenWarehouseDestination', () => {
  it.each([
    ['nothing chosen or detected', {}, null],
    [
      'the first detected warehouse',
      {
        [DETECTED_WAREHOUSE_DESTINATIONS_KEY]: detected(
          'BigQuery',
          'Snowflake',
        ),
      },
      'BigQuery',
    ],
    [
      'the user pick over detection',
      {
        [CHOSEN_WAREHOUSE_DESTINATION_KEY]: 'Redshift',
        [DETECTED_WAREHOUSE_DESTINATIONS_KEY]: detected('BigQuery'),
      },
      'Redshift',
    ],
    [
      'an unknown pick falls back to detection',
      {
        [CHOSEN_WAREHOUSE_DESTINATION_KEY]: 'Oracle',
        [DETECTED_WAREHOUSE_DESTINATIONS_KEY]: detected('Snowflake'),
      },
      'Snowflake',
    ],
    [
      'a non-string pick is ignored',
      { [CHOSEN_WAREHOUSE_DESTINATION_KEY]: 42 },
      null,
    ],
  ])('%s', (_name, frameworkContext, expected) => {
    expect(getChosenWarehouseDestination(session(frameworkContext))).toBe(
      expected,
    );
  });
});

describe('warehouse-destination run', () => {
  it('names the chosen warehouse as the destination type', async () => {
    const run = await resolveRun(
      session({ [CHOSEN_WAREHOUSE_DESTINATION_KEY]: 'Snowflake' }),
    );
    const prompt = run.customPrompt?.({} as never) ?? '';
    expect(prompt).toContain(
      "PostHog events to the user's Snowflake warehouse with a batch export",
    );
    expect(prompt).toContain('`Snowflake` is the warehouse destination type');
    expect(prompt).toContain('Never ask the user to paste a credential');
    expect(prompt).toContain('Credentials never pass through the terminal');
  });

  it('tells the agent to ask when there is no warehouse', async () => {
    const prompt =
      (await resolveRun(session())).customPrompt?.({} as never) ?? '';
    expect(prompt).toContain('Ask the user which warehouse they run');
  });

  it('lists detected warehouses and importable sources', async () => {
    const prompt =
      (
        await resolveRun(
          session({
            [DETECTED_WAREHOUSE_DESTINATIONS_KEY]: detected('BigQuery'),
            [DETECTED_WAREHOUSE_SOURCES_KEY]: [
              {
                kind: 'Stripe',
                label: 'Stripe',
                mode: 'in-cli',
                matchedSignal: 'stripe',
              },
            ],
          }),
        )
      ).customPrompt?.({} as never) ?? '';
    expect(prompt).toContain('BigQuery label (type: BigQuery)');
    expect(prompt).toContain('import (Stripe)');
  });
});
