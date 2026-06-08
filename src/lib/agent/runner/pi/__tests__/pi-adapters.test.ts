import { toNonStrictParameters } from '../tools';
import { descriptorToStreamableHttpOptions } from '../mcp';

describe('toNonStrictParameters', () => {
  it('fills in required and additionalProperties for the SDK shape', () => {
    expect(
      toNonStrictParameters({
        type: 'object',
        properties: { file_path: { type: 'string' } },
        required: ['file_path'],
      }),
    ).toEqual({
      type: 'object',
      properties: { file_path: { type: 'string' } },
      required: ['file_path'],
      additionalProperties: true,
    });
  });

  it('defaults missing required to [] and missing properties to {}', () => {
    expect(toNonStrictParameters({ type: 'object' })).toEqual({
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: true,
    });
  });
});

describe('descriptorToStreamableHttpOptions', () => {
  it('maps a neutral descriptor onto streamable-HTTP options with headers', () => {
    expect(
      descriptorToStreamableHttpOptions({
        name: 'posthog-wizard',
        url: 'https://mcp.posthog.com/mcp',
        headers: { Authorization: 'Bearer phx_x', 'User-Agent': 'wizard' },
      }),
    ).toEqual({
      name: 'posthog-wizard',
      url: 'https://mcp.posthog.com/mcp',
      requestInit: {
        headers: { Authorization: 'Bearer phx_x', 'User-Agent': 'wizard' },
      },
    });
  });
});
