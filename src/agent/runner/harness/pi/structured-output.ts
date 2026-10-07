import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { GatewayApi } from './gateway';

/** Apply the output contract at the provider boundary on every agent turn. */
export function structuredOutputExtension(
  schema: Record<string, unknown>,
  api: GatewayApi,
): (pi: ExtensionAPI) => void {
  return (pi) => {
    pi.on('before_provider_request', (event) => {
      const payload = event.payload as Record<string, unknown>;
      const format = { type: 'json_schema', schema };
      switch (api) {
        case 'anthropic-messages':
          return {
            ...payload,
            output_config: { ...(payload.output_config as object), format },
          };
        case 'openai-responses':
          return {
            ...payload,
            text: {
              ...(payload.text as object),
              format: { ...format, name: 'wizard_result', strict: true },
            },
          };
        case 'openai-completions':
          // `gatewayApiFor` never routes here, so no envelope is defined for it.
          throw new Error(
            'Structured output is not supported on Chat Completions',
          );
      }
    });
  };
}
