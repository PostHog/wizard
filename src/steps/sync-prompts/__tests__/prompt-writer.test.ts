import {
  promptToSkillContent,
  promptToCursorRule,
  formatPromptBody,
} from '../prompt-writer';
import type { ApiPrompt } from '../../../lib/api';

const basePrompt: ApiPrompt = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  name: 'debug-funnel',
  prompt: 'You are a PostHog expert. Help debug funnel issues.',
  version: 3,
  created_at: '2026-01-15T10:00:00Z',
  updated_at: '2026-03-30T14:00:00Z',
};

describe('prompt-writer', () => {
  describe('formatPromptBody', () => {
    it('returns strings as-is', () => {
      expect(formatPromptBody('Hello world')).toBe('Hello world');
    });

    it('wraps JSON objects in a fenced code block', () => {
      const result = formatPromptBody({ role: 'assistant', content: 'hi' });
      expect(result).toBe(
        '```json\n{\n  "role": "assistant",\n  "content": "hi"\n}\n```',
      );
    });

    it('wraps JSON arrays in a fenced code block', () => {
      const result = formatPromptBody([{ step: 1 }, { step: 2 }]);
      expect(result).toContain('```json');
      expect(result).toContain('"step": 1');
    });

    it('handles null prompt', () => {
      const result = formatPromptBody(null);
      expect(result).toBe('```json\nnull\n```');
    });
  });

  describe('promptToSkillContent', () => {
    it('generates valid SKILL.md with YAML frontmatter for string prompts', () => {
      const content = promptToSkillContent(basePrompt, 12345);

      expect(content).toContain('---');
      expect(content).toContain('name: posthog-prompt/debug-funnel');
      expect(content).toContain(
        'description: "PostHog prompt: debug-funnel (v3)"',
      );
      expect(content).toContain('source: posthog-prompt-sync');
      expect(content).toContain('team_id: 12345');
      expect(content).toContain(
        'prompt_id: "550e8400-e29b-41d4-a716-446655440000"',
      );
      expect(content).toContain('version: 3');
      expect(content).toContain('synced_at:');
      expect(content).toContain(
        'You are a PostHog expert. Help debug funnel issues.',
      );
    });

    it('generates SKILL.md with JSON code block for object prompts', () => {
      const prompt: ApiPrompt = {
        ...basePrompt,
        prompt: { system: 'You are helpful', temperature: 0.7 },
      };
      const content = promptToSkillContent(prompt, 12345);

      expect(content).toContain('```json');
      expect(content).toContain('"system": "You are helpful"');
    });

    it('includes proper frontmatter delimiters', () => {
      const content = promptToSkillContent(basePrompt, 1);
      const lines = content.split('\n');

      expect(lines[0]).toBe('---');
      const closingIndex = lines.indexOf('---', 1);
      expect(closingIndex).toBeGreaterThan(0);
    });

    it('ends with a newline', () => {
      const content = promptToSkillContent(basePrompt, 1);
      expect(content.endsWith('\n')).toBe(true);
    });
  });

  describe('promptToCursorRule', () => {
    it('generates .mdc with Cursor frontmatter for string prompts', () => {
      const content = promptToCursorRule(basePrompt);

      expect(content).toContain('---');
      expect(content).toContain(
        'description: "PostHog prompt: debug-funnel (v3)"',
      );
      expect(content).toContain('alwaysApply: true');
      expect(content).toContain('globs:');
      expect(content).toContain(
        'You are a PostHog expert. Help debug funnel issues.',
      );
    });

    it('generates .mdc with JSON code block for object prompts', () => {
      const prompt: ApiPrompt = {
        ...basePrompt,
        prompt: { system: 'You are helpful' },
      };
      const content = promptToCursorRule(prompt);

      expect(content).toContain('```json');
      expect(content).toContain('"system": "You are helpful"');
    });

    it('does not include Claude Code metadata fields', () => {
      const content = promptToCursorRule(basePrompt);

      expect(content).not.toContain('source:');
      expect(content).not.toContain('team_id:');
      expect(content).not.toContain('prompt_id:');
      expect(content).not.toContain('synced_at:');
    });

    it('ends with a newline', () => {
      const content = promptToCursorRule(basePrompt);
      expect(content.endsWith('\n')).toBe(true);
    });
  });
});
