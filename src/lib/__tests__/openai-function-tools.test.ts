import fs from 'fs';
import os from 'os';
import path from 'path';
import { createOpenAIFunctionTools } from '../openai-function-tools';

jest.mock('../../ui', () => ({
  getUI: jest.fn().mockReturnValue({
    syncTodos: jest.fn(),
  }),
}));

jest.mock('../wizard-tools', () => ({
  fetchSkillMenu: jest.fn().mockResolvedValue({ categories: {} }),
  downloadSkill: jest.fn(),
  resolveEnvPath: jest.requireActual('../wizard-tools').resolveEnvPath,
  parseEnvKeys: jest.requireActual('../wizard-tools').parseEnvKeys,
  mergeEnvValues: jest.requireActual('../wizard-tools').mergeEnvValues,
  ensureGitignoreCoverage:
    jest.requireActual('../wizard-tools').ensureGitignoreCoverage,
}));

describe('createOpenAIFunctionTools', () => {
  const defineTools = async (workingDirectory: string) => {
    return createOpenAIFunctionTools({
      tool: (definition) => definition,
      workingDirectory,
      detectPackageManager: jest.fn(),
      skillsBaseUrl: 'https://example.com/skills',
      checkToolAccess: jest.fn(),
      mcpMissingSignal: '[ERROR-MCP-MISSING]',
    }) as Promise<Array<Record<string, any>>>;
  };

  it('emits OpenAI-strict schemas for optional fields by requiring all keys and allowing nulls', async () => {
    const tools = await defineTools(process.cwd());
    const readTool = tools.find((tool) => tool.name === 'Read');

    expect(readTool?.parameters).toEqual({
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to the file, relative to the project root.',
        },
        offset: {
          type: ['integer', 'null'],
          description: 'Optional zero-based line offset.',
        },
        limit: {
          type: ['integer', 'null'],
          description: 'Optional maximum number of lines to return.',
        },
      },
      required: ['file_path', 'offset', 'limit'],
      additionalProperties: false,
    });
  });

  it('uses a strict-compatible array shape for set_env_values instead of a dynamic object', async () => {
    const tools = await defineTools(process.cwd());
    const setEnvValuesTool = tools.find(
      (tool) => tool.name === 'set_env_values',
    );

    expect(setEnvValuesTool?.parameters).toEqual({
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to the .env file, relative to the project root.',
        },
        values: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: {
                type: 'string',
                description: 'Environment variable key to set.',
              },
              value: {
                type: 'string',
                description: 'Environment variable value to write.',
              },
            },
            required: ['key', 'value'],
            additionalProperties: false,
          },
          description: 'Key-value pairs to set.',
        },
      },
      required: ['filePath', 'values'],
      additionalProperties: false,
    });
  });

  it('normalizes nullable optional inputs before executing the tool', async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'wizard-openai-tools-'),
    );
    const filePath = path.join(tempDir, 'example.txt');
    fs.writeFileSync(filePath, 'line 1\nline 2\nline 3\n', 'utf8');

    const tools = await defineTools(tempDir);
    const readTool = tools.find((tool) => tool.name === 'Read');

    const output = readTool?.execute({
      file_path: 'example.txt',
      offset: null,
      limit: null,
    });

    expect(output).toBe('line 1\nline 2\nline 3\n');
  });
});
