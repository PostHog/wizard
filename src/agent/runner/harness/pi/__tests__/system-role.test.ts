import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildGatewayModel } from '../gateway';
import type { GatewayApi } from '../gateway';

vi.mock('@utils/debug');

// Real pi-ai request bodies, recorded by a local server standing in for the gateway.
const WIZARD_OWN = 'WIZARD COMMANDMENTS: follow the checklist.';

let server: http.Server;
let gatewayUrl: string;
let bodies: Record<string, unknown>[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      bodies.push(JSON.parse(raw) as Record<string, unknown>);
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end('{"error":{"message":"bare"}}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  gatewayUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => {
  bodies = [];
});

const SHAPES: [GatewayApi, string][] = [
  ['openai-responses', 'openai/gpt-5.6-terra'],
  // No wizard model routes here, but the gateway accepts the shape.
  ['openai-completions', 'openai/gpt-5.6-terra'],
];

/** The body pi sends for one call. */
async function sendBody(
  api: GatewayApi,
  modelId: string,
): Promise<Record<string, unknown>> {
  const { completeSimple } = await import('@earendil-works/pi-ai');
  const model = {
    ...buildGatewayModel({
      gatewayUrl,
      accessToken: 'phe_test',
      wizardMetadata: {},
      wizardFlags: {},
      modelId,
    }),
    api,
  };
  if (api === 'openai-completions') model.baseUrl = `${gatewayUrl}/v1`;
  await completeSimple(
    model as never,
    {
      systemPrompt: WIZARD_OWN,
      messages: [{ role: 'user', content: 'go', timestamp: 0 }],
    },
    { apiKey: 'phe_test', maxRetries: 0 },
  );
  expect(bodies).toHaveLength(1);
  return bodies[0];
}

describe('pi request bodies', () => {
  // The gateway refuses a caller developer message on a pinned token.
  it.each(SHAPES)(
    'send the wizard prompt for %s at the system rank, never developer',
    async (api, modelId) => {
      const body = await sendBody(api, modelId);

      expect(JSON.stringify(body)).toContain(WIZARD_OWN);
      expect(JSON.stringify(body)).not.toContain('"role":"developer"');
    },
  );
});
