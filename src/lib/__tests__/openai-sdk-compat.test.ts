import {
  applyOpenAIResponsesUsageCompatPatch,
  sanitizeOpenAIResponseDoneEventUsage,
} from '../openai-sdk-compat';

describe('openai-sdk-compat', () => {
  it('sanitizes null token detail values in response_done usage payloads', () => {
    expect(
      sanitizeOpenAIResponseDoneEventUsage({
        type: 'response_done',
        response: {
          id: 'resp_123',
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
            inputTokensDetails: {
              audio_tokens: null,
              text_tokens: null,
              cached_tokens: 4,
            },
            outputTokensDetails: {
              text_tokens: null,
              reasoning_tokens: 2,
            },
            requestUsageEntries: [
              {
                inputTokens: 10,
                outputTokens: 5,
                totalTokens: 15,
                inputTokensDetails: {
                  audio_tokens: null,
                  text_tokens: 8,
                },
                outputTokensDetails: {
                  text_tokens: null,
                },
              },
            ],
          },
        },
      }),
    ).toEqual({
      type: 'response_done',
      response: {
        id: 'resp_123',
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          inputTokensDetails: {
            cached_tokens: 4,
          },
          outputTokensDetails: {
            reasoning_tokens: 2,
          },
          requestUsageEntries: [
            {
              inputTokens: 10,
              outputTokens: 5,
              totalTokens: 15,
              inputTokensDetails: {
                text_tokens: 8,
              },
              outputTokensDetails: {},
            },
          ],
        },
      },
    });
  });

  it('patches the SDK response_done parser to sanitize usage details first', () => {
    const parse = jest.fn((input) => input);
    const sdkModule = {
      protocol: {
        StreamEventResponseCompleted: {
          parse,
        },
      },
    };

    applyOpenAIResponsesUsageCompatPatch(sdkModule);

    sdkModule.protocol.StreamEventResponseCompleted.parse({
      type: 'response_done',
      response: {
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          inputTokensDetails: {
            audio_tokens: null,
            text_tokens: 1,
          },
        },
      },
    });

    expect(parse).toHaveBeenCalledWith({
      type: 'response_done',
      response: {
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          inputTokensDetails: {
            text_tokens: 1,
          },
          outputTokensDetails: undefined,
          requestUsageEntries: undefined,
        },
      },
    });
  });
});
