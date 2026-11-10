import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMProvider } from '@posthog/warlock';
import { createWizardPiTools } from '@agent/runner/harness/pi/tools';
import { createWizardToolsServer } from '../mcp';
import { WIZARD_TOOL_NAMES } from '../tools';
import {
  MAX_RESULT_TEXT_CHARS,
  PUBLISH_RESULT_TOOL_NAME,
  publishResult,
} from '../result';
import { TASK_REPORTING_NOTE } from '../handoff';

// The MCP server's tool list, without the SDK's transport around it.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: ((name: string) => ({ name })) as never,
  createSdkMcpServer: (options: unknown) => options,
}));
vi.mock('../tools', async (original) => ({
  ...(await original<typeof import('../tools')>()),
  fetchSkillMenu: vi.fn().mockResolvedValue(null),
}));

const RESULT = {
  version: 1,
  notebook_short_id: 'aB3dE9fG',
  dashboard_ids: [412],
  insight_ids: [9921, 9922],
  savings: [
    {
      id: 'replay-minimum-duration',
      title: 'Skip recordings shorter than 10 seconds',
      billing_type: 'session_replay',
      unit: 'recordings',
      before: 210000,
      after: { low: 88000, high: 105000 },
      evidence: '52% of recordings in the last 30 days were under 10 seconds',
      tradeoff: 'Fewer replays to attach to support tickets',
      effort: 'setting',
      fixed_in: 'notebook',
    },
  ],
  value_items: [
    {
      title: 'Checkout funnel',
      reason: 'Both events are captured but no insight uses them',
      insight_ids: [9921],
    },
  ],
  checks_passed: ['Group analytics is in use'],
};

describe('publishResult', () => {
  let temporaryDirectory: string;
  let ambientOutputPath: string | undefined;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'wizard-result-'));
    ambientOutputPath = process.env.POSTHOG_RESULT_OUTPUT_PATH;
    delete process.env.POSTHOG_RESULT_OUTPUT_PATH;
  });

  afterEach(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    if (ambientOutputPath === undefined) {
      delete process.env.POSTHOG_RESULT_OUTPUT_PATH;
    } else {
      process.env.POSTHOG_RESULT_OUTPUT_PATH = ambientOutputPath;
    }
  });

  it('writes the validated result to the host path as one JSON document', () => {
    const target = join(temporaryDirectory, 'result.json');
    process.env.POSTHOG_RESULT_OUTPUT_PATH = target;

    const result = publishResult(RESULT);

    expect(result.ok).toBe(true);
    expect(result.message).toContain('1 savings');
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual(RESULT);
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });

  it('publishes without a host path and says the product will not read it', () => {
    const result = publishResult(RESULT);
    expect(result.ok).toBe(true);
    expect(result.message).toContain('no host destination');
  });

  it('tells a task agent that complete_task still has to run', () => {
    const result = publishResult(RESULT, { taskAgent: true });
    expect(result.message.endsWith(TASK_REPORTING_NOTE)).toBe(true);
  });

  it.each([
    [
      'an unknown field',
      { ...RESULT, notes: 'extra' },
      'result: Unrecognized key',
    ],
    [
      'a saving whose range exceeds what was measured',
      {
        ...RESULT,
        savings: [{ ...RESULT.savings[0], after: { low: 1000, high: 300000 } }],
      },
      'savings.0.after.high: after.high must not exceed before',
    ],
    [
      'a saving whose low end exceeds its high end',
      {
        ...RESULT,
        savings: [{ ...RESULT.savings[0], after: { low: 9000, high: 8000 } }],
      },
      'savings.0.after.low: after.low must not exceed after.high',
    ],
    [
      'a dollar amount smuggled in as a field',
      {
        ...RESULT,
        savings: [{ ...RESULT.savings[0], saving_usd: 120 }],
      },
      'savings.0: Unrecognized key',
    ],
    [
      'a missing notebook',
      { ...RESULT, notebook_short_id: '' },
      'notebook_short_id',
    ],
    ['a wrong version', { ...RESULT, version: 2 }, 'version'],
  ])('refuses %s and names the field', (_label, bad, expected) => {
    const target = join(temporaryDirectory, 'result.json');
    process.env.POSTHOG_RESULT_OUTPUT_PATH = target;

    const result = publishResult(bad);

    expect(result.ok).toBe(false);
    expect(result.message).toContain(expected);
    expect(() => statSync(target)).toThrow();
  });

  it('refuses a result over the size cap', () => {
    const result = publishResult({
      ...RESULT,
      checks_passed: ['x'.repeat(MAX_RESULT_TEXT_CHARS)],
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('limit');
  });

  it('is registered on the Pi harness and writes through the same path', async () => {
    const target = join(temporaryDirectory, 'result.json');
    process.env.POSTHOG_RESULT_OUTPUT_PATH = target;
    const tools = createWizardPiTools({
      workingDirectory: temporaryDirectory,
      skillsBaseUrl: 'http://localhost:0',
      allowedTools: [PUBLISH_RESULT_TOOL_NAME],
    });
    const tool = tools.find((t) => t.name === PUBLISH_RESULT_TOOL_NAME);
    if (!tool) throw new Error('publish_result not registered');

    const output = (await (
      tool.execute as (id: string, args: unknown) => Promise<unknown>
    )('call-1', { result: RESULT })) as { content: [{ text: string }] };

    expect(output.content[0].text).toContain('Result published');
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual(RESULT);
  });
});

describe('publish_result registration', () => {
  const piToolNames = (allowedTools?: readonly string[]) =>
    createWizardPiTools({
      workingDirectory: tmpdir(),
      skillsBaseUrl: 'http://localhost:0',
      allowedTools,
    }).map((t) => t.name);

  const mcpToolNames = async (allowedTools?: readonly string[]) => {
    const server = (await createWizardToolsServer({
      workingDirectory: tmpdir(),
      detectPackageManager: vi.fn(),
      skillsBaseUrl: 'http://localhost:0',
      triageProvider: {} as LLMProvider,
      allowedTools,
    })) as unknown as { tools: { name: string }[] };
    return server.tools.map((t) => t.name);
  };

  it('is left off the Pi tools unless the allow list names it', () => {
    expect(piToolNames()).not.toContain(PUBLISH_RESULT_TOOL_NAME);
    expect(piToolNames(['Read'])).not.toContain(PUBLISH_RESULT_TOOL_NAME);
    expect(piToolNames([PUBLISH_RESULT_TOOL_NAME])).toContain(
      PUBLISH_RESULT_TOOL_NAME,
    );
    expect(piToolNames([WIZARD_TOOL_NAMES.publishResult])).toContain(
      PUBLISH_RESULT_TOOL_NAME,
    );
  });

  it('is left off the wizard-tools MCP server unless the allow list names it', async () => {
    expect(await mcpToolNames()).not.toContain(PUBLISH_RESULT_TOOL_NAME);
    expect(await mcpToolNames([WIZARD_TOOL_NAMES.publishResult])).toContain(
      PUBLISH_RESULT_TOOL_NAME,
    );
    expect(await mcpToolNames([PUBLISH_RESULT_TOOL_NAME])).toContain(
      PUBLISH_RESULT_TOOL_NAME,
    );
  });
});
