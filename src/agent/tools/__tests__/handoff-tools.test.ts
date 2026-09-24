// Both registered publish_handoff tools, Pi and MCP, must hand the report to the host.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMProvider } from '@posthog/warlock';
import type { AgentProgress } from '@agent/progress';
import { createWizardPiTools } from '@agent/runner/harness/pi/tools';
import { createWizardToolsServer } from '../mcp';
import { PUBLISH_HANDOFF_TOOL_NAME } from '../handoff';

vi.mock('@ui', () => ({
  getUI: () => {
    throw new Error('agent code reached the UI');
  },
}));
// The MCP server's tool list, without the SDK's transport around it.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: (
    name: string,
    description: string,
    inputSchema: unknown,
    handler: (args: unknown) => unknown,
  ) => ({ name, description, inputSchema, handler }),
  createSdkMcpServer: (options: unknown) => options,
}));
vi.mock('../tools', async (original) => ({
  ...(await original<typeof import('../tools')>()),
  fetchSkillMenu: vi.fn().mockResolvedValue(null),
}));

const REPORT = '# Setup report\n\nAll done.';

describe('registered publish_handoff tools', () => {
  let workingDirectory: string;
  let events: AgentProgress[];
  let ambientOutputPath: string | undefined;

  beforeEach(() => {
    workingDirectory = mkdtempSync(join(tmpdir(), 'wizard-handoff-tools-'));
    events = [];
    ambientOutputPath = process.env.POSTHOG_HANDOFF_OUTPUT_PATH;
    delete process.env.POSTHOG_HANDOFF_OUTPUT_PATH;
  });

  afterEach(() => {
    rmSync(workingDirectory, { recursive: true, force: true });
    if (ambientOutputPath === undefined) {
      delete process.env.POSTHOG_HANDOFF_OUTPUT_PATH;
    } else {
      process.env.POSTHOG_HANDOFF_OUTPUT_PATH = ambientOutputPath;
    }
  });

  const handoffs = () =>
    events.flatMap((event) => (event.kind === 'handoff' ? [event.text] : []));

  it('the Pi tool reports the handoff to the host', async () => {
    const tools = createWizardPiTools({
      workingDirectory,
      skillsBaseUrl: 'http://localhost:0',
      emit: (event) => events.push(event),
    });
    const tool = tools.find((t) => t.name === PUBLISH_HANDOFF_TOOL_NAME);
    if (!tool) throw new Error('publish_handoff not registered');

    const result = (await (
      tool.execute as (id: string, args: unknown) => Promise<unknown>
    )('call-1', { content: REPORT })) as { content: [{ text: string }] };

    expect(result.content[0].text).toContain('Handoff published');
    expect(handoffs()).toEqual([REPORT]);
  });

  it('the MCP tool reports the handoff to the host', async () => {
    const server = (await createWizardToolsServer({
      workingDirectory,
      detectPackageManager: vi.fn(),
      skillsBaseUrl: 'http://localhost:0',
      triageProvider: {} as LLMProvider,
      emit: (event) => events.push(event),
    })) as unknown as {
      tools: { name: string; handler: (args: unknown) => unknown }[];
    };
    const tool = server.tools.find((t) => t.name === PUBLISH_HANDOFF_TOOL_NAME);
    if (!tool) throw new Error('publish_handoff not registered');

    const result = (await tool.handler({ content: REPORT })) as {
      content: [{ text: string }];
      isError?: boolean;
    };

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Handoff published');
    expect(handoffs()).toEqual([REPORT]);
  });
});
