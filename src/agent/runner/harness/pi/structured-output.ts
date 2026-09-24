import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { AgentRunDefinition } from '../../shared/types';
import type { GatewayApi } from './gateway';

/** Apply the output contract at the provider boundary on every agent turn. */
export function structuredOutputExtension(
  output: NonNullable<AgentRunDefinition['outputFormat']>,
  api: GatewayApi,
): (pi: ExtensionAPI) => void {
  return (pi) => {
    pi.on('before_provider_request', (event) => {
      const payload = event.payload as Record<string, unknown>;
      const format = { type: 'json_schema', schema: output.schema };
      if (api === 'anthropic-messages') {
        return {
          ...payload,
          output_config: { ...(payload.output_config as object), format },
        };
      }
      const openaiFormat = { ...format, name: 'wizard_result', strict: true };
      return api === 'openai-responses'
        ? {
            ...payload,
            text: { ...(payload.text as object), format: openaiFormat },
          }
        : {
            ...payload,
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: 'wizard_result',
                strict: true,
                schema: output.schema,
              },
            },
          };
    });
  };
}
