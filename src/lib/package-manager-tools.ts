/**
 * In-process MCP server that detects the project's package manager(s).
 * Delegates to the framework-specific PackageManagerDetector so the agent
 * gets instant, structured results instead of hunting for lockfiles.
 */

import { logToFile } from '../utils/debug';
import type { PackageManagerDetector } from './package-manager-detection';

// Dynamic import cache for ESM module (same pattern as env-file-tools.ts)
let _sdkModule: any = null;
async function getSDKModule(): Promise<any> {
  if (!_sdkModule) {
    _sdkModule = await import('@anthropic-ai/claude-agent-sdk');
  }
  return _sdkModule;
}

/**
 * Create an in-process MCP server with the detect_package_manager tool.
 * Must be called asynchronously because the SDK is an ESM module loaded via dynamic import.
 */
export async function createPackageManagerServer(
  detector: PackageManagerDetector,
  workingDirectory: string,
) {
  const sdk = await getSDKModule();
  const { tool, createSdkMcpServer } = sdk;

  const detectPackageManager = tool(
    'detect_package_manager',
    'Detect which package manager(s) the project uses. Returns the name, install command, and run command for each detected package manager. Call this before running any install commands.',
    {},
    async () => {
      logToFile(`detect_package_manager: scanning ${workingDirectory}`);

      const result = await detector(workingDirectory);

      logToFile(
        `detect_package_manager: detected ${result.detected.length} package manager(s)`,
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  return createSdkMcpServer({
    name: 'package-manager-tools',
    version: '1.0.0',
    tools: [detectPackageManager],
  });
}

/** Tool names exposed by the package manager server, for use in allowedTools */
export const PACKAGE_MANAGER_TOOL_NAMES = [
  'package-manager-tools:detect_package_manager',
];
