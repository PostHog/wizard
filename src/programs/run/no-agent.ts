import { ApiError, type Credentials } from '@shared/posthog/api';
import { ErrorCodes, type ErrorCode } from '@shared/errors';
import { fetchHealthIssues } from '../posthog-doctor/fetch';
import { analytics } from '@utils/analytics';

export type NoAgentProgramInput = {
  installDir: string;
  credentials?: Pick<Credentials, 'accessToken' | 'host' | 'projectId'>;
  mcp?: { local?: boolean; features?: string[]; apiKey?: string };
};

export type NoAgentWorkflowRequest = {
  programId: 'mcp-tutorial' | 'slack';
  installDir: string;
  credentials?: NoAgentProgramInput['credentials'];
};

export type NoAgentMcpClientResult = {
  name: string;
  status: 'changed' | 'unchanged' | 'failed';
  detail?: string;
};

export type NoAgentMcpPort = {
  detectSupportedClients(): Promise<string[]>;
  add(
    clientNames: string[],
    options: { local: boolean; features?: string[]; apiKey?: string },
  ): Promise<NoAgentMcpClientResult[]>;
  detectInstalledClients(local: boolean): Promise<string[]>;
  remove(
    clientNames: string[],
    local: boolean,
  ): Promise<NoAgentMcpClientResult[]>;
};

export type NoAgentProgramOptions = {
  mcp?: NoAgentMcpPort;
  workflow?: (request: NoAgentWorkflowRequest) => Promise<{
    outcome: 'success' | 'aborted';
    data?: Record<string, unknown>;
  }>;
};

export type NoAgentProgramResult =
  | { outcome: 'success' | 'aborted'; data?: Record<string, unknown> }
  | {
      outcome: 'failed' | 'interactive-required';
      failure: { code?: ErrorCode; message: string };
      data?: Record<string, unknown>;
    };

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 } as const;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const namesWithStatus = (
  results: NoAgentMcpClientResult[],
  status: NoAgentMcpClientResult['status'],
): string[] =>
  results
    .filter((result) => result.status === status)
    .map((result) => result.name);

async function runDoctor(
  input: NoAgentProgramInput,
): Promise<NoAgentProgramResult> {
  const credentials = input.credentials;
  if (!credentials) {
    return {
      outcome: 'failed',
      failure: {
        code: ErrorCodes.ArgsMissingApiKey,
        message: 'PostHog credentials are required to run posthog-doctor.',
      },
    };
  }
  try {
    const issues = await fetchHealthIssues(
      credentials.accessToken,
      credentials.host.apiHost,
      credentials.projectId,
    );
    return {
      outcome: 'success',
      data: {
        kind: 'doctor',
        issues: [...issues].sort(
          (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
        ),
        hasIssues: issues.length > 0,
      },
    };
  } catch (error) {
    const invalidKey = error instanceof ApiError && error.statusCode === 401;
    return {
      outcome: 'failed',
      failure: {
        code: invalidKey
          ? ErrorCodes.AuthInvalidOrExpired
          : ErrorCodes.InternalUnhandled,
        message: invalidKey
          ? 'Your PostHog API key is invalid or expired.'
          : errorMessage(error),
      },
    };
  }
}

async function runMcpAdd(
  input: NoAgentProgramInput,
  mcp: NoAgentMcpPort,
): Promise<NoAgentProgramResult> {
  try {
    const clients = await mcp.detectSupportedClients();
    if (clients.length === 0) {
      return {
        outcome: 'failed',
        data: {
          kind: 'mcp-add',
          installed: [],
          changed: [],
          alreadyInstalled: [],
          failed: [],
          attempted: [],
        },
        failure: { message: 'No supported MCP clients were installed.' },
      };
    }
    const results = await mcp.add(clients, {
      apiKey: input.mcp?.apiKey,
      features: input.mcp?.features,
      local: input.mcp?.local ?? false,
    });
    const changed = namesWithStatus(results, 'changed');
    const alreadyInstalled = namesWithStatus(results, 'unchanged');
    const failed = results.filter((result) => result.status === 'failed');
    const installed = [...changed, ...alreadyInstalled];
    const attempted = clients;
    analytics.wizardCapture('mcp servers added', {
      clients: installed,
      already_installed_clients: alreadyInstalled,
      failed_clients: failed.map((result) => result.name),
      attempted_clients: attempted,
      integration: undefined,
    });
    const data = {
      kind: 'mcp-add',
      installed,
      changed,
      alreadyInstalled,
      failed,
      attempted,
    };
    if (failed.length > 0) {
      return {
        outcome: 'failed',
        data,
        failure: {
          message: `Could not add the PostHog MCP server to ${failed
            .map((result) => result.name)
            .join(', ')}.`,
        },
      };
    }
    if (installed.length === 0)
      return {
        outcome: 'failed',
        data,
        failure: { message: 'No supported MCP client accepted the server.' },
      };
    return { outcome: 'success', data };
  } catch (error) {
    return {
      outcome: 'failed',
      failure: { message: errorMessage(error) },
    };
  }
}

async function runMcpRemove(
  input: NoAgentProgramInput,
  mcp: NoAgentMcpPort,
): Promise<NoAgentProgramResult> {
  try {
    const clients = await mcp.detectInstalledClients(input.mcp?.local ?? false);
    if (clients.length === 0) {
      analytics.wizardCapture('mcp no servers to remove', {
        integration: undefined,
      });
      return {
        outcome: 'success',
        data: {
          kind: 'mcp-remove',
          removed: [],
          unchanged: [],
          failed: [],
          attempted: [],
        },
      };
    }
    const results = await mcp.remove(clients, input.mcp?.local ?? false);
    const removed = namesWithStatus(results, 'changed');
    const unchanged = namesWithStatus(results, 'unchanged');
    const failed = results.filter((result) => result.status === 'failed');
    const attempted = clients;
    analytics.wizardCapture('mcp servers removed', {
      clients: removed,
      nothing_to_remove_clients: unchanged,
      failed_clients: failed.map((result) => result.name),
      attempted_clients: attempted,
      integration: undefined,
    });
    return {
      outcome: 'success',
      data: { kind: 'mcp-remove', removed, unchanged, failed, attempted },
    };
  } catch (error) {
    return {
      outcome: 'failed',
      failure: { message: errorMessage(error) },
    };
  }
}

export async function runNoAgentProgram(
  programId: string,
  input: NoAgentProgramInput,
  options: NoAgentProgramOptions = {},
): Promise<NoAgentProgramResult> {
  switch (programId) {
    case 'posthog-doctor':
      return runDoctor(input);
    case 'mcp-add':
      return options.mcp
        ? runMcpAdd(input, options.mcp)
        : {
            outcome: 'failed',
            failure: {
              code: ErrorCodes.InternalUnhandled,
              message: `MCP capability is required to run ${programId}.`,
            },
          };
    case 'mcp-remove':
      return options.mcp
        ? runMcpRemove(input, options.mcp)
        : {
            outcome: 'failed',
            failure: {
              code: ErrorCodes.InternalUnhandled,
              message: `MCP capability is required to run ${programId}.`,
            },
          };
    case 'mcp-tutorial':
    case 'slack':
      if (!options.workflow) {
        return {
          outcome: 'interactive-required',
          failure: {
            code: ErrorCodes.CliInteractiveRequired,
            message: `${programId} requires an interactive workflow.`,
          },
        };
      }
      try {
        return await options.workflow({
          programId,
          installDir: input.installDir,
          credentials: input.credentials,
        });
      } catch (error) {
        return { outcome: 'failed', failure: { message: errorMessage(error) } };
      }
    default:
      return {
        outcome: 'failed',
        failure: { message: `Unknown no-agent program: ${programId}` },
      };
  }
}
