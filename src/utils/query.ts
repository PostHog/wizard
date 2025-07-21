import axios from 'axios';
import type { ZodSchema } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { AIModel, CloudRegion } from './types';
import { getCloudUrlFromRegion } from './urls';
import { analytics } from './analytics';
import { AxiosError } from 'axios';
import { fixtureTracker } from '../../e2e-tests/mocks/fixture-tracker';
import { shouldRecord } from '../../e2e-tests/mocks/handlers';

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
  const jsonSchema = zodToJsonSchema(schema, 'schema').definitions;

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
          ...(shouldRecord
            ? { 'X-PostHog-Wizard-Fixture-Generation': true }
            : {}),
        },
      },
    )
    .catch((error) => {
      if (error instanceof AxiosError) {
        analytics.captureException(error, {
          response_status_code: error.response?.status,
          message,
          model,
          json_schema: jsonSchema,
          type: 'wizard_query_error',
        });
      }

      throw error;
    });

  const validation = schema.safeParse(response.data.data);

  if (!validation.success) {
    throw new Error(
      `Invalid response from wizard: ${validation.error.message}`,
    );
  }

  if (process.env.NODE_ENV === 'test') {
    const requestBody = JSON.stringify({
      message,
      model,
      json_schema: { ...jsonSchema, name: 'schema', strict: true },
    });

    fixtureTracker.saveQueryFixture(requestBody, validation.data);
  }

  return validation.data;
};
