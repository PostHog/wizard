// Both registered publish_handoff tools, Pi and MCP, must hand the report to the host.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { LLMProvider } from '@posthog/warlock';
import type { SkillMenu } from '@shared/skill-menu';
import type { MatchKeys } from '@shared/skill-resolution';
import type { AgentProgress } from '@agent/progress';
import type { OrchestratorToolsContext } from '@agent/runner/sequence/orchestrator/queue-tools';
import { createWizardPiTools } from '@agent/runner/harness/pi/tools';
import { createWizardToolsServer } from '../mcp';
import { fetchSkillMenu } from '@shared/skill-menu';
import {
  PUBLISH_HANDOFF_DESCRIPTION,
  PUBLISH_HANDOFF_TOOL_NAME,
  TASK_REPORTING_NOTE,
  publishHandoff,
} from '../handoff';
import { syncHandoffNotebook } from '../handoff-notebook';

// The MCP server's tool list, without the SDK's transport around it.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: ((
    name: string,
    description: string,
    inputSchema: unknown,
    handler: (args: unknown) => unknown,
  ) => ({ name, description, inputSchema, handler })) as never,
  createSdkMcpServer: (options: unknown) => options,
}));
vi.mock('../handoff', async (original) => {
  const actual = await original<typeof import('../handoff')>();
  return { ...actual, publishHandoff: vi.fn(actual.publishHandoff) };
});
vi.mock('../handoff-notebook', () => ({ syncHandoffNotebook: vi.fn() }));
vi.mock('../tools', async (original) => ({
  ...(await original<typeof import('../tools')>()),
  fetchSkillMenu: vi.fn().mockResolvedValue(null),
}));
vi.mock('@shared/skill-menu', async (original) => ({
  ...(await original<typeof import('@shared/skill-menu')>()),
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
    vi.mocked(syncHandoffNotebook).mockReset().mockResolvedValue({
      outcome: 'skipped',
      reason: 'no_login',
      description: 'not logged in to PostHog',
    });
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

  const mcpPublishTool = async (
    orchestrator?: OrchestratorToolsContext,
    program: { programId?: string; handoffNotebook?: boolean } = {},
  ) => {
    const server = (await createWizardToolsServer({
      workingDirectory,
      detectPackageManager: vi.fn(),
      skillsBaseUrl: 'http://localhost:0',
      triageProvider: {} as LLMProvider,
      emit: (event) => events.push(event),
      orchestrator,
      ...program,
    })) as unknown as {
      tools: { name: string; handler: (args: unknown) => unknown }[];
    };
    const tool = server.tools.find((t) => t.name === PUBLISH_HANDOFF_TOOL_NAME);
    if (!tool) throw new Error('publish_handoff not registered');
    return tool;
  };

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
    const tool = await mcpPublishTool();

    const result = (await tool.handler({ content: REPORT })) as {
      content: [{ text: string }];
      isError?: boolean;
    };

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Handoff published');
    expect(result.content[0].text).not.toContain(TASK_REPORTING_NOTE);
    expect(handoffs()).toEqual([REPORT]);
  });

  // Both facades hand this tool to every task of an orchestrated run, and only
  // the reporting step should call it. The description says so; these hold the
  // reminder the others get when they call it anyway.
  it('tells a Pi task agent that complete_task still has to run', async () => {
    const tools = createWizardPiTools({
      workingDirectory,
      skillsBaseUrl: 'http://localhost:0',
      emit: (event) => events.push(event),
      taskAgent: true,
    });
    const tool = tools.find((t) => t.name === PUBLISH_HANDOFF_TOOL_NAME);
    if (!tool) throw new Error('publish_handoff not registered');

    const result = (await (
      tool.execute as (id: string, args: unknown) => Promise<unknown>
    )('call-1', { content: REPORT })) as { content: [{ text: string }] };

    expect(result.content[0].text).toContain(TASK_REPORTING_NOTE);
    expect(result.content[0].text.endsWith(TASK_REPORTING_NOTE)).toBe(true);
  });

  it('tells an MCP task agent that complete_task still has to run', async () => {
    const tool = await mcpPublishTool({
      store: {} as never,
      validTypes: ['report'],
      currentTaskId: 'task-1',
    });

    const result = (await tool.handler({ content: REPORT })) as {
      content: [{ text: string }];
    };

    expect(result.content[0].text).toContain(TASK_REPORTING_NOTE);
    expect(result.content[0].text.endsWith(TASK_REPORTING_NOTE)).toBe(true);
  });

  it('a task agent is told its next action is one complete_task call, not a closing message', async () => {
    const result = await publishHandoff(REPORT, undefined, { taskAgent: true });

    expect(result.ok).toBe(true);
    expect(TASK_REPORTING_NOTE).toMatch(
      /next action must be exactly one complete_task tool call/,
    );
    expect(TASK_REPORTING_NOTE).toMatch(/Do not send a closing message/);
    expect(result.message.endsWith(TASK_REPORTING_NOTE)).toBe(true);
  });

  it('both tools pass the program id and its notebook setting to publishHandoff', async () => {
    const program = { programId: 'metrics', handoffNotebook: true };
    const piTool = createWizardPiTools({
      workingDirectory,
      skillsBaseUrl: 'http://localhost:0',
      emit: (event) => events.push(event),
      ...program,
    }).find((t) => t.name === PUBLISH_HANDOFF_TOOL_NAME);
    if (!piTool) throw new Error('publish_handoff not registered');
    const mcpTool = await mcpPublishTool(undefined, program);
    vi.mocked(publishHandoff).mockClear();

    await (piTool.execute as (id: string, args: unknown) => Promise<unknown>)(
      'call-1',
      { content: REPORT },
    );
    await mcpTool.handler({ content: REPORT });

    expect(vi.mocked(publishHandoff).mock.calls.map((c) => c[2])).toEqual([
      expect.objectContaining(program),
      expect.objectContaining(program),
    ]);
    expect(syncHandoffNotebook).toHaveBeenCalledTimes(2);
    expect(syncHandoffNotebook).toHaveBeenLastCalledWith(REPORT, 'metrics');
  });

  it('a program that does not mirror makes no notebook through either tool', async () => {
    const piTool = createWizardPiTools({
      workingDirectory,
      skillsBaseUrl: 'http://localhost:0',
      emit: (event) => events.push(event),
      programId: 'audit',
    }).find((t) => t.name === PUBLISH_HANDOFF_TOOL_NAME);
    if (!piTool) throw new Error('publish_handoff not registered');
    const mcpTool = await mcpPublishTool(undefined, { programId: 'audit' });

    await (piTool.execute as (id: string, args: unknown) => Promise<unknown>)(
      'call-1',
      { content: REPORT },
    );
    await mcpTool.handler({ content: REPORT });

    expect(syncHandoffNotebook).not.toHaveBeenCalled();
  });

  it('describes publishing as the run report, not a task outcome', () => {
    expect(PUBLISH_HANDOFF_DESCRIPTION).toContain('complete_task');
  });
});

describe('createWizardToolsServer load_skill_menu filtering', () => {
  const realFixture = JSON.parse(
    readFileSync(
      resolve(__dirname, '../../../../fixtures/context-mill/skill-menu.json'),
      'utf8',
    ),
  ) as SkillMenu;

  const menuWithSdk: SkillMenu = {
    categories: {
      ...realFixture.categories,
      'sdk/posthog-python': [
        {
          id: 'sdk-posthog-python-v7',
          name: 'PostHog Python v7',
          description: 'Python SDK v7',
          family: 'sdk-posthog-python',
          tags: ['sdkPython:7'],
          downloadUrl: 'https://skills.test/py7.zip',
        },
        {
          id: 'sdk-posthog-python-v8',
          name: 'PostHog Python v8',
          description: 'Python SDK v8',
          family: 'sdk-posthog-python',
          tags: ['sdkPython:8', 'default'],
          downloadUrl: 'https://skills.test/py8.zip',
        },
      ],
    },
  };

  let workingDirectory: string;

  beforeEach(() => {
    workingDirectory = mkdtempSync(join(tmpdir(), 'wizard-mcp-menu-'));
    vi.mocked(fetchSkillMenu).mockReset().mockResolvedValue(menuWithSdk);
  });

  afterEach(() => {
    rmSync(workingDirectory, { recursive: true, force: true });
    vi.mocked(fetchSkillMenu).mockReset().mockResolvedValue(null);
  });

  const loadSkillMenuFor = async (matchKeys?: () => MatchKeys) => {
    const server = (await createWizardToolsServer({
      workingDirectory,
      detectPackageManager: vi.fn(),
      skillsBaseUrl: 'http://localhost:0',
      triageProvider: {} as LLMProvider,
      emit: vi.fn(),
      matchKeys,
    })) as unknown as {
      tools: {
        name: string;
        handler: (args: { category: string }) => {
          content: [{ text: string }];
          isError?: boolean;
        };
      }[];
    };
    const tool = server.tools.find((t) => t.name === 'load_skill_menu');
    if (!tool) throw new Error('load_skill_menu not registered');
    return tool;
  };

  it('filters sdk/posthog-python by detected SDK major on brownfield and default on greenfield', async () => {
    const brownfield = await loadSkillMenuFor(() => ({ sdkPython: ['7'] }));
    const brownfieldOut = brownfield.handler({
      category: 'sdk/posthog-python',
    });
    expect(brownfieldOut.isError).toBeUndefined();
    expect(brownfieldOut.content[0].text).toContain('sdk-posthog-python-v7');
    expect(brownfieldOut.content[0].text).not.toContain(
      'sdk-posthog-python-v8',
    );

    const greenfield = await loadSkillMenuFor(() => ({
      framework: ['fastapi'],
    }));
    const greenfieldOut = greenfield.handler({
      category: 'sdk/posthog-python',
    });
    expect(greenfieldOut.isError).toBeUndefined();
    expect(greenfieldOut.content[0].text).toContain('sdk-posthog-python-v8');
    expect(greenfieldOut.content[0].text).not.toContain(
      'sdk-posthog-python-v7',
    );
  });

  it('retains ai-observability LLM-provider framework tags when a web framework is detected', async () => {
    const tool = await loadSkillMenuFor(() => ({
      framework: ['nextjs'],
      sdkNode: ['5'],
    }));
    const result = tool.handler({ category: 'ai-observability' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('ai-observability-openai-node');
    expect(result.content[0].text).toContain('ai-observability-anthropic-node');
  });

  it('filters integration skills by detected wizard framework', async () => {
    const tool = await loadSkillMenuFor(() => ({ framework: ['nextjs'] }));
    const result = tool.handler({ category: 'integration' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('integration-nextjs-app-router');
    expect(result.content[0].text).not.toContain(
      'integration-react-react-router-6',
    );
  });
});
