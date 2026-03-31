import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';

import type { ApiPrompt } from '../../../lib/api';
import {
  ClaudeCodePromptSyncClient,
  CursorPromptSyncClient,
  getAllPromptSyncClients,
  getPromptSyncClientsBySlugs,
} from '../prompt-sync-client';

const testPrompt: ApiPrompt = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  name: 'test-prompt',
  prompt: 'You are a helpful assistant.',
  version: 1,
  created_at: '2026-01-15T10:00:00Z',
  updated_at: '2026-03-30T14:00:00Z',
};

describe('prompt-sync-client', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'prompt-sync-client-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('ClaudeCodePromptSyncClient', () => {
    const client = new ClaudeCodePromptSyncClient();

    it('has the correct name and slug', () => {
      expect(client.name).toBe('Claude Code');
      expect(client.slug).toBe('claude-code');
    });

    it('writes SKILL.md in a subdirectory named after the prompt', () => {
      client.writePrompt(testPrompt, 42, tmpDir);

      const skillPath = join(tmpDir, 'test-prompt', 'SKILL.md');
      expect(fs.existsSync(skillPath)).toBe(true);

      const content = fs.readFileSync(skillPath, 'utf-8');
      expect(content).toContain('name: posthog-prompt/test-prompt');
      expect(content).toContain('You are a helpful assistant.');
    });

    it('getTargetDir returns project-level path when not global', () => {
      const dir = client.getTargetDir(false);
      expect(dir).toContain('.claude');
      expect(dir).toContain('skills');
      expect(dir).toContain('posthog-prompts');
    });

    it('getTargetDir returns user-level path when global', () => {
      const dir = client.getTargetDir(true);
      expect(dir).toContain(os.homedir());
      expect(dir).toContain('.claude');
    });

    it('getTargetDir uses custom dir name', () => {
      const dir = client.getTargetDir(false, 'my-prompts');
      expect(dir).toContain('my-prompts');
      expect(dir).not.toContain('posthog-prompts');
    });
  });

  describe('CursorPromptSyncClient', () => {
    const client = new CursorPromptSyncClient();

    it('has the correct name and slug', () => {
      expect(client.name).toBe('Cursor');
      expect(client.slug).toBe('cursor');
    });

    it('writes an .mdc file named after the prompt', () => {
      client.writePrompt(testPrompt, 42, tmpDir);

      const mdcPath = join(tmpDir, 'test-prompt.mdc');
      expect(fs.existsSync(mdcPath)).toBe(true);

      const content = fs.readFileSync(mdcPath, 'utf-8');
      expect(content).toContain('alwaysApply: true');
      expect(content).toContain('You are a helpful assistant.');
    });

    it('getTargetDir returns project-level path when not global', () => {
      const dir = client.getTargetDir(false);
      expect(dir).toContain('.cursor');
      expect(dir).toContain('rules');
      expect(dir).toContain('posthog-prompts');
    });

    it('getTargetDir returns user-level path when global', () => {
      const dir = client.getTargetDir(true);
      expect(dir).toContain(os.homedir());
      expect(dir).toContain('.cursor');
    });

    it('getTargetDir uses custom dir name', () => {
      const dir = client.getTargetDir(false, 'custom-rules');
      expect(dir).toContain('custom-rules');
    });
  });

  describe('getAllPromptSyncClients', () => {
    it('returns both Claude Code and Cursor clients', () => {
      const clients = getAllPromptSyncClients();
      expect(clients).toHaveLength(2);
      expect(clients.map((c) => c.name)).toEqual(['Claude Code', 'Cursor']);
    });
  });

  describe('getPromptSyncClientsBySlugs', () => {
    it('returns only matching clients', () => {
      const clients = getPromptSyncClientsBySlugs(['cursor']);
      expect(clients).toHaveLength(1);
      expect(clients[0].name).toBe('Cursor');
    });

    it('returns empty array for unknown slugs', () => {
      const clients = getPromptSyncClientsBySlugs(['unknown']);
      expect(clients).toHaveLength(0);
    });

    it('returns multiple matching clients', () => {
      const clients = getPromptSyncClientsBySlugs(['claude-code', 'cursor']);
      expect(clients).toHaveLength(2);
    });
  });
});
