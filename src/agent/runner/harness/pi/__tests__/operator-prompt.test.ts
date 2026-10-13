import http from 'node:http';
import { onTestFinished } from 'vitest';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildGatewayModel,
  buildGatewayProvider,
  GATEWAY_PROVIDER,
} from '../gateway';
import type { GatewayApi } from '../gateway';
import { createTriageLLMProvider } from '@agent/triage-provider';
import { Harness } from '@shared/constants';

vi.mock('@utils/debug');

// Real pi-ai request bodies, recorded by a local server standing in for the gateway.
// On a pinned token the gateway injects the operator prompt, so no body carries it.

const PINNED_VERSION = 4;
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
  ['anthropic-messages', 'claude-sonnet-5'],
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

/** The system units in a request body, per shape. */
function systemUnits(api: GatewayApi, body: Record<string, unknown>): string[] {
  if (api === 'anthropic-messages')
    return ((body.system ?? []) as { text: string }[]).map((b) => b.text);
  return ((body.messages ?? body.input) as { role: string; content: string }[])
    .filter((m) => m.role === 'system' || m.role === 'developer')
    .map((m) => m.content);
}

describe('pi request bodies', () => {
  it.each(SHAPES)(
    'carries only the wizard prompt for %s, at the system rank',
    async (api, modelId) => {
      const body = await sendBody(api, modelId);

      expect(systemUnits(api, body)).toEqual([WIZARD_OWN]);
      // The gateway refuses a caller developer message on a pinned token.
      expect(JSON.stringify(body)).not.toContain('"role":"developer"');
    },
  );
});

describe('triage request bodies', () => {
  it.each([
    [Harness.pi, 'openai-responses'],
    [Harness.anthropic, 'anthropic-messages'],
  ] as const)(
    'carry no system unit on a pinned %s run',
    async (harness, api) => {
      const triage = createTriageLLMProvider(
        {
          baseURL: gatewayUrl,
          authToken: 'phe_test',
          promptPolicyVersion: PINNED_VERSION,
        },
        harness,
      );

      await triage('verdict?');

      expect(systemUnits(api, bodies[0])).toEqual([]);
      expect(bodies[0]).not.toHaveProperty('instructions');
    },
  );
});

describe('pi subagent request bodies', () => {
  it("carry only the subagent's own system prompt", async () => {
    const sdk = await import('@earendil-works/pi-coding-agent');
    const { createDispatchAgentTool } = await import('../subagent');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-subagent-'));
    onTestFinished(() => fs.rmSync(dir, { recursive: true, force: true }));
    const { provider, api } = buildGatewayProvider({
      gatewayUrl,
      accessToken: 'phe_test',
      wizardMetadata: {},
      wizardFlags: {},
      modelId: 'openai/gpt-5.6-terra',
    });
    const registry = sdk.ModelRegistry.inMemory(sdk.AuthStorage.create());
    registry.registerProvider(GATEWAY_PROVIDER, provider as never);
    const tool = createDispatchAgentTool({
      model: registry.find(GATEWAY_PROVIDER, 'openai/gpt-5.6-terra')!,
      modelRegistry: registry,
      cwd: dir,
      agentDir: dir,
      securityFactory: (() => undefined) as never,
      refuseOnText: () => false,
      bashTool: sdk.createBashToolDefinition(dir) as never,
      sdk,
    });

    // The server refuses the call, so the child ends in an error; the request it sent is what counts.
    await tool
      .execute(
        'id',
        { description: 'look', prompt: 'find it' },
        undefined,
        undefined,
        undefined as never,
      )
      .catch(() => undefined);

    const units = systemUnits(api, bodies[0]);
    expect(units).toHaveLength(1);
    expect(units[0]).toContain('read-only research subagent');
  });
});
