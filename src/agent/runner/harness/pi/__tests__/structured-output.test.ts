import { structuredOutputExtension } from '../structured-output';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { GatewayApi } from '../gateway';

const schema = {
  type: 'object',
  properties: { projects: { type: 'array' } },
  required: ['projects'],
  additionalProperties: false,
};

function apply(api: GatewayApi, payload: unknown) {
  let handler: ((event: { payload: unknown }) => unknown) | undefined;
  structuredOutputExtension(
    schema,
    api,
  )({
    on: (event: string, callback: typeof handler) => {
      expect(event).toBe('before_provider_request');
      handler = callback;
    },
  } as ExtensionAPI);
  return handler?.({ payload });
}

it('enforces strict JSON schema on Luna Responses requests while retaining tools and reasoning', () => {
  const payload = {
    model: 'openai/gpt-5.6-luna',
    tools: [{ type: 'function', name: 'read' }],
    reasoning: { effort: 'low' },
    text: { verbosity: 'low' },
  };
  expect(apply('openai-responses', payload)).toEqual({
    ...payload,
    text: {
      verbosity: 'low',
      format: {
        type: 'json_schema',
        name: 'wizard_result',
        strict: true,
        schema,
      },
    },
  });
  expect(payload.text).toEqual({ verbosity: 'low' });
});
