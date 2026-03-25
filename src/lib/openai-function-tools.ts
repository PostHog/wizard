import fs from 'fs';
import path from 'path';
import { execFile, spawn } from 'child_process';
import fg from 'fast-glob';
import { promisify } from 'util';
import { getUI } from '../ui';
import { logToFile } from '../utils/debug';
import { scan, scanSkillDirectory } from './yara-scanner';
import {
  fetchSkillMenu,
  downloadSkill,
  resolveEnvPath,
  parseEnvKeys,
  mergeEnvValues,
  ensureGitignoreCoverage,
  type SkillEntry,
} from './wizard-tools';
import type { PackageManagerDetector } from './package-manager-detection';

const execFileAsync = promisify(execFile);
const RECENT_READ_WINDOW_MS = 60_000;
const DEFAULT_BASH_TIMEOUT_MS = 60_000;
const DEFAULT_BASH_MAX_OUTPUT = 12_000;
const DEFAULT_READ_LIMIT = 400;
const DEFAULT_GREP_LIMIT = 200;

type RecentReadTracker = Map<string, number>;

export interface OpenAIFunctionToolsOptions {
  tool: (definition: Record<string, unknown>) => unknown;
  workingDirectory: string;
  detectPackageManager: PackageManagerDetector;
  skillsBaseUrl: string;
  checkToolAccess: (toolName: string, input: Record<string, unknown>) => void;
  mcpMissingSignal: string;
}

function resolveProjectPath(
  workingDirectory: string,
  filePath: string,
): string {
  const resolved = path.resolve(workingDirectory, filePath);
  if (
    !resolved.startsWith(workingDirectory + path.sep) &&
    resolved !== workingDirectory
  ) {
    throw new Error(
      `Path traversal rejected: "${filePath}" resolves outside working directory`,
    );
  }
  return resolved;
}

function rememberRead(recentReads: RecentReadTracker, filePath: string): void {
  recentReads.set(filePath, Date.now());
}

function assertRecentlyRead(
  recentReads: RecentReadTracker,
  filePath: string,
): void {
  const lastRead = recentReads.get(filePath);
  if (!lastRead || Date.now() - lastRead > RECENT_READ_WINDOW_MS) {
    throw new Error(
      `You must read "${filePath}" immediately before writing it.`,
    );
  }
}

function checkPreCommandScan(command: string): void {
  const result = scan(command, 'PreToolUse', 'Bash');
  if (result.matched) {
    throw new Error(
      `[YARA] ${result.matches[0].rule.name}: ${result.matches[0].rule.description}`,
    );
  }
}

function checkPostReadScan(toolName: 'Read' | 'Grep', content: string): void {
  const result = scan(content, 'PostToolUse', toolName);
  if (!result.matched) return;

  const match = result.matches[0];
  if (match.rule.severity === 'critical') {
    throw new Error(
      `[YARA CRITICAL] ${match.rule.name}: ${match.rule.description}`,
    );
  }

  logToFile(
    `[YARA] ${toolName} warning ${match.rule.name}: ${match.rule.description}`,
  );
}

function checkWriteScan(toolName: 'Write' | 'Edit', content: string): void {
  const result = scan(content, 'PostToolUse', toolName);
  if (!result.matched) return;

  const match = result.matches[0];
  throw new Error(
    `[YARA VIOLATION] ${match.rule.name}: ${match.rule.description}`,
  );
}

async function scanInstalledSkillDirectory(absoluteDir: string): Promise<void> {
  if (!fs.existsSync(absoluteDir)) return;

  const files = await fg('**/*.{md,txt,yaml,yml,json,js,ts,py,rb,sh}', {
    cwd: absoluteDir,
    absolute: true,
  });

  const fileContents: Array<{ path: string; content: string }> = [];
  for (const filePath of files) {
    try {
      fileContents.push({
        path: filePath,
        content: fs.readFileSync(filePath, 'utf8'),
      });
    } catch {
      // Ignore unreadable skill files and scan what we can.
    }
  }

  const result = scanSkillDirectory(fileContents);
  if (result.matched) {
    const match = result.matches[0];
    throw new Error(
      `[YARA CRITICAL] ${match.rule.name}: ${match.rule.description}`,
    );
  }
}

function buildStrictObjectSchema(
  properties: Record<string, unknown>,
  required: string[],
): Record<string, unknown> {
  const normalizedProperties = Object.fromEntries(
    Object.entries(properties).map(([key, schema]) => [
      key,
      required.includes(key) ? schema : makeNullableSchema(schema),
    ]),
  );

  return {
    type: 'object',
    properties: normalizedProperties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function makeNullableSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object' || !('type' in schema)) {
    return {
      anyOf: [schema, { type: 'null' }],
    };
  }

  const typedSchema = schema as { type: string | string[] };
  const schemaType = typedSchema.type;
  if (Array.isArray(schemaType)) {
    return schemaType.includes('null')
      ? schema
      : { ...typedSchema, type: [...schemaType, 'null'] };
  }

  return { ...typedSchema, type: [schemaType, 'null'] };
}

function normalizeNullableInput(value: unknown): unknown {
  if (value === null) return undefined;
  if (Array.isArray(value)) {
    return value.map((item) => normalizeNullableInput(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        normalizeNullableInput(nested),
      ]),
    );
  }
  return value;
}

function truncateOutput(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(
    0,
    maxLength,
  )}\n[output truncated to ${maxLength} chars]`;
}

async function runCommand(
  command: string,
  workingDirectory: string,
  timeoutMs = DEFAULT_BASH_TIMEOUT_MS,
  maxOutputLength = DEFAULT_BASH_MAX_OUTPUT,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/zsh', ['-lc', command], {
      cwd: workingDirectory,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > maxOutputLength) {
        stdout = stdout.slice(0, maxOutputLength);
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > maxOutputLength) {
        stderr = stderr.slice(0, maxOutputLength);
      }
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const output = truncateOutput(
        [stdout, stderr].filter(Boolean).join(stderr ? '\n' : ''),
        maxOutputLength,
      );
      if (code === 0) {
        resolve(output || 'Command completed successfully with no output.');
      } else {
        reject(
          new Error(output || `Command exited with code ${code ?? 'unknown'}`),
        );
      }
    });
  });
}

function formatFileSlice(
  content: string,
  offset = 0,
  limit = DEFAULT_READ_LIMIT,
): string {
  const lines = content.split('\n');
  const start = Math.max(0, offset);
  const end = Math.min(lines.length, start + Math.max(1, limit));
  return lines.slice(start, end).join('\n');
}

async function grepWithRipgrep(
  workingDirectory: string,
  grepPath: string,
  pattern: string,
  glob?: string,
): Promise<string> {
  const args = ['-n', '-S', pattern];
  if (glob) {
    args.push('--glob', glob);
  }
  args.push(grepPath);

  try {
    const { stdout } = await execFileAsync('rg', args, {
      cwd: workingDirectory,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      const fallbackArgs = ['-RIn', pattern, grepPath];
      const { stdout } = await execFileAsync('grep', fallbackArgs, {
        cwd: workingDirectory,
        maxBuffer: 1024 * 1024,
      });
      return stdout.trim();
    }

    if (error.code === 1 && typeof error.stdout === 'string') {
      return error.stdout.trim();
    }
    throw error;
  }
}

export async function createOpenAIFunctionTools(
  options: OpenAIFunctionToolsOptions,
): Promise<unknown[]> {
  const {
    tool,
    workingDirectory,
    detectPackageManager,
    skillsBaseUrl,
    checkToolAccess,
    mcpMissingSignal,
  } = options;
  const recentReads: RecentReadTracker = new Map();
  const defineTool = (definition: Record<string, unknown>) =>
    tool({
      ...definition,
      execute: (input: unknown, ...args: unknown[]) =>
        (definition.execute as (...toolArgs: unknown[]) => unknown)(
          normalizeNullableInput(input),
          ...args,
        ),
    });

  let cachedSkillMenu = await fetchSkillMenu(skillsBaseUrl);

  const ensureSkillMenu = async () => {
    if (!cachedSkillMenu) {
      cachedSkillMenu = await fetchSkillMenu(skillsBaseUrl);
    }
    return cachedSkillMenu;
  };

  const readTool = defineTool({
    name: 'Read',
    description:
      'Read a file from the project. Use this immediately before writing any existing file.',
    parameters: buildStrictObjectSchema(
      {
        file_path: {
          type: 'string',
          description: 'Path to the file, relative to the project root.',
        },
        offset: {
          type: 'integer',
          description: 'Optional zero-based line offset.',
        },
        limit: {
          type: 'integer',
          description: 'Optional maximum number of lines to return.',
        },
      },
      ['file_path'],
    ),
    execute: (input: any) => {
      checkToolAccess('Read', input);

      const absolutePath = resolveProjectPath(
        workingDirectory,
        input.file_path,
      );
      const content = fs.readFileSync(absolutePath, 'utf8');
      rememberRead(recentReads, absolutePath);
      checkPostReadScan('Read', content);
      return formatFileSlice(content, input.offset, input.limit);
    },
  });

  const writeTool = defineTool({
    name: 'Write',
    description:
      'Write an entire file. Use this for new files or when replacing all content in an existing file.',
    parameters: buildStrictObjectSchema(
      {
        file_path: {
          type: 'string',
          description: 'Path to the file, relative to the project root.',
        },
        content: {
          type: 'string',
          description: 'The full content to write.',
        },
      },
      ['file_path', 'content'],
    ),
    execute: (input: any) => {
      checkToolAccess('Write', input);

      const absolutePath = resolveProjectPath(
        workingDirectory,
        input.file_path,
      );
      if (fs.existsSync(absolutePath)) {
        assertRecentlyRead(recentReads, absolutePath);
      }
      checkWriteScan('Write', input.content);

      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, input.content, 'utf8');
      rememberRead(recentReads, absolutePath);
      return `Wrote ${input.file_path}`;
    },
  });

  const editTool = defineTool({
    name: 'Edit',
    description:
      'Edit a file by replacing exact text. Read the file immediately beforehand and prefer precise, minimal replacements.',
    parameters: buildStrictObjectSchema(
      {
        file_path: {
          type: 'string',
          description: 'Path to the file, relative to the project root.',
        },
        old_str: {
          type: 'string',
          description: 'Exact existing text to replace.',
        },
        new_str: {
          type: 'string',
          description: 'Replacement text.',
        },
        replace_all: {
          type: 'boolean',
          description: 'Replace all matches instead of exactly one match.',
        },
      },
      ['file_path', 'old_str', 'new_str'],
    ),
    execute: (input: any) => {
      checkToolAccess('Edit', input);

      const absolutePath = resolveProjectPath(
        workingDirectory,
        input.file_path,
      );
      assertRecentlyRead(recentReads, absolutePath);

      const existing = fs.readFileSync(absolutePath, 'utf8');
      if (!existing.includes(input.old_str)) {
        throw new Error(
          `Could not find the text to replace in ${input.file_path}`,
        );
      }

      const matchCount = existing.split(input.old_str).length - 1;
      if (matchCount > 1 && !input.replace_all) {
        throw new Error(
          `Found ${matchCount} matches in ${input.file_path}; set replace_all=true or make old_str more specific.`,
        );
      }

      checkWriteScan('Edit', input.new_str);

      const nextContent = input.replace_all
        ? existing.split(input.old_str).join(input.new_str)
        : existing.replace(input.old_str, input.new_str);

      fs.writeFileSync(absolutePath, nextContent, 'utf8');
      rememberRead(recentReads, absolutePath);
      return `Edited ${input.file_path}`;
    },
  });

  const globTool = defineTool({
    name: 'Glob',
    description: 'Find files by glob pattern.',
    parameters: buildStrictObjectSchema(
      {
        pattern: {
          type: 'string',
          description: 'Glob pattern, for example src/**/*.ts',
        },
        path: {
          type: 'string',
          description:
            'Optional search root relative to the project root. Defaults to the project root.',
        },
      },
      ['pattern'],
    ),
    execute: async (input: any) => {
      const searchRoot = input.path
        ? resolveProjectPath(workingDirectory, input.path)
        : workingDirectory;

      const matches = await fg(input.pattern, {
        cwd: searchRoot,
        dot: false,
        onlyFiles: false,
      });
      return matches.join('\n');
    },
  });

  const grepTool = defineTool({
    name: 'Grep',
    description: 'Search file contents with ripgrep and return matching lines.',
    parameters: buildStrictObjectSchema(
      {
        pattern: {
          type: 'string',
          description: 'Text or regex pattern to search for.',
        },
        path: {
          type: 'string',
          description:
            'Optional file or directory relative to the project root. Defaults to the project root.',
        },
        glob: {
          type: 'string',
          description: 'Optional glob filter, for example *.tsx.',
        },
      },
      ['pattern'],
    ),
    execute: async (input: any) => {
      checkToolAccess('Grep', { path: input.path ?? '' });

      const searchPath = input.path
        ? resolveProjectPath(workingDirectory, input.path)
        : workingDirectory;
      const output = await grepWithRipgrep(
        workingDirectory,
        searchPath,
        input.pattern,
        input.glob,
      );
      checkPostReadScan('Grep', output);

      const lines = output.split('\n');
      return lines.slice(0, DEFAULT_GREP_LIMIT).join('\n');
    },
  });

  const bashTool = defineTool({
    name: 'Bash',
    description:
      'Run an allowed shell command for installs, builds, type checks, linting, or formatting. Use other tools for file inspection and edits.',
    parameters: buildStrictObjectSchema(
      {
        command: {
          type: 'string',
          description: 'The shell command to run.',
        },
        timeout_ms: {
          type: 'integer',
          description: 'Optional timeout in milliseconds.',
        },
      },
      ['command'],
    ),
    execute: (input: any) => {
      checkToolAccess('Bash', { command: input.command });
      checkPreCommandScan(input.command);

      return runCommand(
        input.command,
        workingDirectory,
        input.timeout_ms,
        DEFAULT_BASH_MAX_OUTPUT,
      );
    },
  });

  const todoWriteTool = defineTool({
    name: 'TodoWrite',
    description:
      'Update the wizard todo list to reflect high-level progress for the current integration.',
    parameters: buildStrictObjectSchema(
      {
        todos: {
          type: 'array',
          items: buildStrictObjectSchema(
            {
              content: { type: 'string' },
              status: { type: 'string' },
              activeForm: { type: 'string' },
            },
            ['content', 'status'],
          ),
        },
      },
      ['todos'],
    ),
    execute: (input: any) => {
      getUI().syncTodos(input.todos);
      return `Updated ${input.todos.length} todos.`;
    },
  });

  const checkEnvKeysTool = defineTool({
    name: 'check_env_keys',
    description:
      'Check whether environment variable keys exist in a local .env file without revealing values.',
    parameters: buildStrictObjectSchema(
      {
        filePath: {
          type: 'string',
          description: 'Path to the .env file, relative to the project root.',
        },
        keys: {
          type: 'array',
          items: { type: 'string' },
          description: 'Environment variable keys to check.',
        },
      },
      ['filePath', 'keys'],
    ),
    execute: (input: any) => {
      const resolved = resolveEnvPath(workingDirectory, input.filePath);
      const existingKeys = fs.existsSync(resolved)
        ? parseEnvKeys(fs.readFileSync(resolved, 'utf8'))
        : new Set<string>();

      const result: Record<string, 'present' | 'missing'> = {};
      for (const key of input.keys) {
        result[key] = existingKeys.has(key) ? 'present' : 'missing';
      }
      return JSON.stringify(result, null, 2);
    },
  });

  const setEnvValuesTool = defineTool({
    name: 'set_env_values',
    description:
      'Create or update values in a local .env file and ensure .gitignore covers that file.',
    parameters: buildStrictObjectSchema(
      {
        filePath: {
          type: 'string',
          description: 'Path to the .env file, relative to the project root.',
        },
        values: {
          type: 'array',
          items: buildStrictObjectSchema(
            {
              key: {
                type: 'string',
                description: 'Environment variable key to set.',
              },
              value: {
                type: 'string',
                description: 'Environment variable value to write.',
              },
            },
            ['key', 'value'],
          ),
          description: 'Key-value pairs to set.',
        },
      },
      ['filePath', 'values'],
    ),
    execute: (input: any) => {
      const values = Object.fromEntries(
        input.values.map((entry: { key: string; value: string }) => [
          entry.key,
          entry.value,
        ]),
      );

      const forbidden = Object.keys(values).find(
        (key) => key.toUpperCase() === 'POSTHOG_API_KEY',
      );
      if (forbidden) {
        throw new Error(
          `"${forbidden}" is not a valid PostHog env var name. Use the framework-specific key name, such as NEXT_PUBLIC_POSTHOG_KEY.`,
        );
      }

      const resolved = resolveEnvPath(workingDirectory, input.filePath);
      const existing = fs.existsSync(resolved)
        ? fs.readFileSync(resolved, 'utf8')
        : '';
      const content = mergeEnvValues(existing, values);

      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, content, 'utf8');
      ensureGitignoreCoverage(workingDirectory, path.basename(resolved));

      return `Updated ${Object.keys(values).length} key(s) in ${
        input.filePath
      }`;
    },
  });

  const detectPackageManagerTool = defineTool({
    name: 'detect_package_manager',
    description:
      'Detect which package manager the project uses. Call this before any install commands.',
    parameters: buildStrictObjectSchema({}, []),
    execute: async () => {
      const result = await detectPackageManager(workingDirectory);
      return JSON.stringify(result, null, 2);
    },
  });

  const loadSkillMenuTool = defineTool({
    name: 'load_skill_menu',
    description:
      'List available PostHog skills for a category so you can pick the correct integration skill.',
    parameters: buildStrictObjectSchema(
      {
        category: {
          type: 'string',
          description: 'Skill category to list, usually "integration".',
        },
      },
      ['category'],
    ),
    execute: async (input: any) => {
      const menu = await ensureSkillMenu();
      if (!menu) {
        throw new Error(`${mcpMissingSignal} Could not load skill menu`);
      }

      const skills = menu.categories[input.category];
      if (!skills || skills.length === 0) {
        throw new Error(`No skills found for category "${input.category}".`);
      }

      return skills
        .map((skill: SkillEntry) => `- ${skill.id}: ${skill.name}`)
        .join('\n');
    },
  });

  const installSkillTool = defineTool({
    name: 'install_skill',
    description:
      'Download and install a PostHog skill by ID into the project skill directory.',
    parameters: buildStrictObjectSchema(
      {
        skillId: {
          type: 'string',
          description: 'Skill ID from load_skill_menu.',
        },
      },
      ['skillId'],
    ),
    execute: async (input: any) => {
      const menu = await ensureSkillMenu();
      const skills = Object.values(menu?.categories ?? {}).flat();
      const skill = skills.find((entry) => entry.id === input.skillId);
      if (!skill) {
        throw new Error(
          `Skill "${input.skillId}" not found. Use load_skill_menu first.`,
        );
      }

      const result = downloadSkill(skill, workingDirectory);
      if (!result.success) {
        throw new Error(result.error || 'Failed to install skill.');
      }

      const skillDir = path.join(
        workingDirectory,
        '.claude',
        'skills',
        input.skillId,
      );
      await scanInstalledSkillDirectory(skillDir);
      return `Skill installed to .claude/skills/${input.skillId}/`;
    },
  });

  return [
    readTool,
    writeTool,
    editTool,
    globTool,
    grepTool,
    bashTool,
    todoWriteTool,
    checkEnvKeysTool,
    setEnvValuesTool,
    detectPackageManagerTool,
    loadSkillMenuTool,
    installSkillTool,
  ];
}
