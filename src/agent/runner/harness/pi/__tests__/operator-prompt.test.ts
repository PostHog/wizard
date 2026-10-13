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
  operatorPromptExtension,
} from '../gateway';
import type { GatewayApi } from '../gateway';
import { createTriageLLMProvider } from '@agent/triage-provider';
import { Harness } from '@shared/constants';

vi.mock('@utils/debug');

// Real pi-ai, real request bodies: a local server stands in for the gateway and
// records what pi actually sends. The gateway hashes the first system unit of
// each shape, so these tests pin the shapes pi emits, not our idea of them.

const PINNED = '  You are the wizard.\n\n[posthog:abort] é 🦔\n';
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
  // The wizard routes no model here today, but the gateway accepts the shape.
  ['openai-completions', 'openai/gpt-5.6-terra'],
];

/** The body pi sends for one call, with the pin extension reading `pinned`. */
async function sendBody(
  api: GatewayApi,
  modelId: string,
  pinned: string | undefined,
  hook = true,
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
  const handlers: ((event: { payload: unknown }) => unknown)[] = [];
  operatorPromptExtension(
    api,
    () => pinned,
  )({
    on: (_event: string, handler: (event: { payload: unknown }) => unknown) =>
      handlers.push(handler),
  } as never);
  await completeSimple(
    model as never,
    {
      systemPrompt: WIZARD_OWN,
      messages: [{ role: 'user', content: 'go', timestamp: 0 }],
    },
    {
      apiKey: 'phe_test',
      maxRetries: 0,
      onPayload: hook ? (payload) => handlers[0]({ payload }) : undefined,
    },
  );
  expect(bodies).toHaveLength(1);
  return bodies[0];
}

/** What the gateway checks: the first system unit, per shape. */
function systemUnits(api: GatewayApi, body: Record<string, unknown>): string[] {
  const units =
    api === 'anthropic-messages'
      ? (body.system as { text: string }[]).map((b) => b.text)
      : ((body.messages ?? body.input) as { role: string; content: string }[])
          .filter((m) => m.role === 'system' || m.role === 'developer')
          .map((m) => m.content);
  return units;
}

describe('the pinned operator prompt on the wire', () => {
  it.each(SHAPES)(
    'leads %s with the exact text, the wizard prompt a separate unit after it',
    async (api, modelId) => {
      const body = await sendBody(api, modelId, PINNED);

      expect(systemUnits(api, body)).toEqual([PINNED, WIZARD_OWN]);
      // Nothing at the developer rank: the gateway refuses it under a pin.
      expect(JSON.stringify(body)).not.toContain('"role":"developer"');
    },
  );

  it.each(SHAPES)(
    'sends %s exactly as it does today when the mint pinned nothing',
    async (api, modelId) => {
      const withoutHook = await sendBody(api, modelId, undefined, false);
      bodies = [];
      const withHook = await sendBody(api, modelId, undefined);

      expect(withHook).toEqual(withoutHook);
      expect(systemUnits(api, withHook)).toEqual([WIZARD_OWN]);
    },
  );
});

describe('the wizard prompt rank', () => {
  it('is system, not developer, on a reasoning model, since the gateway refuses developer under a pin', async () => {
    const body = await sendBody(
      'openai-responses',
      'openai/gpt-5.6-terra',
      undefined,
    );

    expect(body.input).toMatchObject([
      { role: 'system', content: WIZARD_OWN },
      {},
    ]);
  });
});

describe('the pinned operator prompt on triage calls', () => {
  it.each([
    [Harness.pi, 'openai-responses'],
    [Harness.anthropic, 'anthropic-messages'],
  ] as const)(
    "is the only system unit of a %s run's triage request",
    async (harness, api) => {
      const triage = createTriageLLMProvider(
        { baseURL: gatewayUrl, authToken: 'phe_test', systemPrompt: PINNED },
        harness,
      );

      await triage('verdict?');

      expect(systemUnits(api, bodies[0])).toEqual([PINNED]);
    },
  );

  it('sends no system unit when the mint pinned nothing, as it always has', async () => {
    const triage = createTriageLLMProvider(
      { baseURL: gatewayUrl, authToken: 'phe_test' },
      Harness.pi,
    );

    await triage('verdict?');

    expect(bodies[0].input).toHaveLength(1);
    expect(bodies[0]).not.toHaveProperty('instructions');
  });
});

describe('the pinned operator prompt on a subagent call', () => {
  it("leads the child session's request, ahead of the subagent's own prompt", async () => {
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
      operatorPrompt: operatorPromptExtension(api, () => PINNED),
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
    expect(units[0]).toBe(PINNED);
    expect(units).toHaveLength(2);
    expect(units[1]).toContain('read-only research subagent');
  });
});
