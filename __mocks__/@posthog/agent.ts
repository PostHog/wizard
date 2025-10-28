// Mock for @posthog/agent to avoid ESM/CommonJS compatibility issues in Jest

export enum PermissionMode {
  ACCEPT_EDITS = 'accept_edits',
  REJECT_EDITS = 'reject_edits',
  PROMPT = 'prompt',
}

export class Agent {
  constructor(_config: unknown) {
    // Mock constructor
  }

  async run(_prompt: string, _options?: unknown): Promise<void> {
    // Mock run method
    return Promise.resolve();
  }

  on(_event: string, _handler: (...args: unknown[]) => void): void {
    // Mock event handler
  }
}
