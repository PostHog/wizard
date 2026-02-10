/**
 * In-process MCP server that reads/writes .env files locally.
 * Secret values never leave the machine.
 */

import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { logToFile } from '../utils/debug';

// Dynamic import cache for ESM module (same pattern as agent-interface.ts)
let _sdkModule: any = null;
async function getSDKModule(): Promise<any> {
  if (!_sdkModule) {
    _sdkModule = await import('@anthropic-ai/claude-agent-sdk');
  }
  return _sdkModule;
}

/**
 * Resolve filePath relative to workingDirectory, rejecting path traversal.
 */
function resolveEnvPath(workingDirectory: string, filePath: string): string {
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

/**
 * Ensure the given env file basename is covered by .gitignore in the working directory.
 * Creates .gitignore if it doesn't exist; appends the entry if missing.
 */
function ensureGitignoreCoverage(
  workingDirectory: string,
  envFileName: string,
): void {
  const gitignorePath = path.join(workingDirectory, '.gitignore');

  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    // Check if the file (or a glob covering it) is already listed
    if (content.split('\n').some((line) => line.trim() === envFileName)) {
      return;
    }
    const newContent = content.endsWith('\n')
      ? `${content}${envFileName}\n`
      : `${content}\n${envFileName}\n`;
    fs.writeFileSync(gitignorePath, newContent, 'utf8');
  } else {
    fs.writeFileSync(gitignorePath, `${envFileName}\n`, 'utf8');
  }
}

/**
 * Create an in-process MCP server with env file tools.
 * Must be called asynchronously because the SDK is an ESM module loaded via dynamic import.
 */
export async function createEnvFileServer(workingDirectory: string) {
  const sdk = await getSDKModule();
  const { tool, createSdkMcpServer } = sdk;

  const checkEnvKeys = tool(
    'check_env_keys',
    'Check which environment variable keys are present or missing in a .env file. Never reveals values.',
    {
      filePath: z
        .string()
        .describe('Path to the .env file, relative to the project root'),
      keys: z
        .array(z.string())
        .describe('Environment variable key names to check'),
    },
    (args: { filePath: string; keys: string[] }) => {
      const resolved = resolveEnvPath(workingDirectory, args.filePath);
      logToFile(`check_env_keys: ${resolved}, keys: ${args.keys.join(', ')}`);

      const existingKeys: Set<string> = new Set();
      if (fs.existsSync(resolved)) {
        const content = fs.readFileSync(resolved, 'utf8');
        for (const line of content.split('\n')) {
          const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
          if (match) {
            existingKeys.add(match[1]);
          }
        }
      }

      const results: Record<string, 'present' | 'missing'> = {};
      for (const key of args.keys) {
        results[key] = existingKeys.has(key) ? 'present' : 'missing';
      }

      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(results, null, 2) },
        ],
      };
    },
  );

  const setEnvValues = tool(
    'set_env_values',
    'Create or update environment variable keys in a .env file. Creates the file if it does not exist. Ensures .gitignore coverage.',
    {
      filePath: z
        .string()
        .describe('Path to the .env file, relative to the project root'),
      values: z
        .record(z.string(), z.string())
        .describe('Key-value pairs to set'),
    },
    (args: { filePath: string; values: Record<string, string> }) => {
      const resolved = resolveEnvPath(workingDirectory, args.filePath);
      logToFile(
        `set_env_values: ${resolved}, keys: ${Object.keys(args.values).join(
          ', ',
        )}`,
      );

      let content = '';
      if (fs.existsSync(resolved)) {
        content = fs.readFileSync(resolved, 'utf8');
      }

      const updatedKeys = new Set<string>();

      for (const [key, value] of Object.entries(args.values)) {
        const regex = new RegExp(`^(\\s*${key}\\s*=).*$`, 'm');
        if (regex.test(content)) {
          content = content.replace(regex, `$1${value}`);
          updatedKeys.add(key);
        }
      }

      // Append keys that weren't already in the file
      const newKeys = Object.entries(args.values).filter(
        ([key]) => !updatedKeys.has(key),
      );
      if (newKeys.length > 0) {
        if (content.length > 0 && !content.endsWith('\n')) {
          content += '\n';
        }
        for (const [key, value] of newKeys) {
          content += `${key}=${value}\n`;
        }
      }

      // Ensure parent directory exists
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(resolved, content, 'utf8');

      // Ensure .gitignore coverage for this env file
      const envFileName = path.basename(resolved);
      ensureGitignoreCoverage(workingDirectory, envFileName);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Updated ${Object.keys(args.values).length} key(s) in ${
              args.filePath
            }`,
          },
        ],
      };
    },
  );

  return createSdkMcpServer({
    name: 'env-file-tools',
    version: '1.0.0',
    tools: [checkEnvKeys, setEnvValues],
  });
}

/** Tool names exposed by the env file server, for use in allowedTools */
export const ENV_FILE_TOOL_NAMES = [
  'env-file-tools:check_env_keys',
  'env-file-tools:set_env_values',
];
