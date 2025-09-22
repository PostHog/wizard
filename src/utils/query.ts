import axios from 'axios';
import type { ZodSchema } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { AIModel, CloudRegion } from './types';
import { getCloudUrlFromRegion } from './urls';
import { analytics } from './analytics';
import { AxiosError } from 'axios';
import { debug } from './debug';
import { RateLimitError } from './errors';

export interface QueryOptions<S> {
  message: string;
  model?: AIModel;
  region: CloudRegion;
  schema: ZodSchema<S>;
  wizardHash: string;
}

export const query = async <S>({
  message,
  model = 'o4-mini',
  region,
  schema,
  wizardHash,
}: QueryOptions<S>): Promise<S> => {
  const fullSchema = zodToJsonSchema(schema, 'schema');
  const jsonSchema = fullSchema.definitions;

  debug('Full schema:', JSON.stringify(fullSchema, null, 2));
  debug('Query request:', {
    url: `${getCloudUrlFromRegion(region)}/api/wizard/query`,
    wizardHash,
    message: message.substring(0, 100) + '...',
    json_schema: { ...jsonSchema, name: 'schema', strict: true },
  });

  const response = await axios
    .post<{ data: unknown }>(
      `${getCloudUrlFromRegion(region)}/api/wizard/query`,
      {
        message,
        model,
        json_schema: { ...jsonSchema, name: 'schema', strict: true },
      },
      {
        headers: {
          'X-PostHog-Wizard-Hash': wizardHash,
          ...(process.env.RECORD_FIXTURES === 'true'
            ? { 'X-PostHog-Wizard-Fixture-Generation': true }
            : {}),
        },
      },
    )
    .catch((error) => {
      debug('Query error:', error);

      if (error instanceof AxiosError) {
        analytics.captureException(error, {
          response_status_code: error.response?.status,
          message,
          model,
          json_schema: jsonSchema,
          type: 'wizard_query_error',
        });

        if (error.response?.status === 429) {
          throw new RateLimitError();
        }
      }

      throw error;
    });

  debug('Query response:', {
    status: response.status,
    data: response.data,
  });

  const validation = schema.safeParse(response.data.data);

  if (!validation.success) {
    debug('Validation error:', validation.error);
    throw new Error(
      `Invalid response from wizard: ${validation.error.message}`,
    );
  }

  if (process.env.NODE_ENV === 'test') {
    const { fixtureTracker } = await import(
      '../../e2e-tests/mocks/fixture-tracker.js'
    );

    const requestBody = JSON.stringify({
      message,
      model,
      json_schema: { ...jsonSchema, name: 'schema', strict: true },
    });

    fixtureTracker.saveQueryFixture(requestBody, validation.data);
  }

  return validation.data;
};
