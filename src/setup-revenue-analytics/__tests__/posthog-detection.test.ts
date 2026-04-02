import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { detectPostHogDistinctId } from '../posthog-detection';

function createFixture(files: Record<string, string>): {
  dir: string;
  cleanup: () => void;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-posthog-'));
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
  return {
    dir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

describe('detectPostHogDistinctId', () => {
  describe('Node.js', () => {
    test('finds distinct_id from posthog.identify call', async () => {
      const { dir, cleanup } = createFixture({
        'src/analytics.ts': `import posthog from 'posthog-js';
posthog.identify(user.id, { name: user.name });`,
      });
      try {
        const result = await detectPostHogDistinctId(dir, 'node');
        expect(result.distinctIdExpression).toBe('user.id');
        expect(result.sourceFile).toBe('src/analytics.ts');
      } finally {
        cleanup();
      }
    });

    test('finds distinct_id from distinctId assignment', async () => {
      const { dir, cleanup } = createFixture({
        'src/posthog.ts': `const distinctId = session.user.id;`,
      });
      try {
        const result = await detectPostHogDistinctId(dir, 'node');
        expect(result.distinctIdExpression).toBe('session.user.id');
      } finally {
        cleanup();
      }
    });

    test('returns null when no PostHog usage found', async () => {
      const { dir, cleanup } = createFixture({
        'src/app.ts': `console.log('hello');`,
      });
      try {
        const result = await detectPostHogDistinctId(dir, 'node');
        expect(result.distinctIdExpression).toBeNull();
      } finally {
        cleanup();
      }
    });
  });

  describe('Python', () => {
    test('finds distinct_id from posthog.identify', async () => {
      const { dir, cleanup } = createFixture({
        'analytics.py': `import posthog
posthog.identify(request.user.pk)`,
      });
      try {
        const result = await detectPostHogDistinctId(dir, 'python');
        expect(result.distinctIdExpression).toBe('request.user.pk');
      } finally {
        cleanup();
      }
    });

    test('finds distinct_id from posthog.capture', async () => {
      const { dir, cleanup } = createFixture({
        'events.py': `posthog.capture(user.id, 'purchase')`,
      });
      try {
        const result = await detectPostHogDistinctId(dir, 'python');
        expect(result.distinctIdExpression).toBe('user.id');
      } finally {
        cleanup();
      }
    });

    test('finds distinct_id from keyword argument', async () => {
      const { dir, cleanup } = createFixture({
        'track.py': `posthog.capture(distinct_id=user.email, event='sign_up')`,
      });
      try {
        const result = await detectPostHogDistinctId(dir, 'python');
        expect(result.distinctIdExpression).toBe('user.email');
      } finally {
        cleanup();
      }
    });
  });

  describe('Ruby', () => {
    test('finds distinct_id from hash', async () => {
      const { dir, cleanup } = createFixture({
        'app/services/tracking.rb': `posthog.capture({
  distinct_id: current_user.id,
  event: 'purchase'
})`,
      });
      try {
        const result = await detectPostHogDistinctId(dir, 'ruby');
        expect(result.distinctIdExpression).toBe('current_user.id');
      } finally {
        cleanup();
      }
    });
  });

  describe('Go', () => {
    test('finds DistinctId from struct field', async () => {
      const { dir, cleanup } = createFixture({
        'analytics/track.go': `client.Enqueue(posthog.Capture{
  DistinctId: user.ID,
  Event: "purchase",
})`,
      });
      try {
        const result = await detectPostHogDistinctId(dir, 'go');
        expect(result.distinctIdExpression).toBe('user.ID');
      } finally {
        cleanup();
      }
    });
  });

  test('ignores string literal distinct_ids', async () => {
    const { dir, cleanup } = createFixture({
      'test.ts': `posthog.identify("hardcoded-id");`,
    });
    try {
      const result = await detectPostHogDistinctId(dir, 'node');
      // Should not match string literals — we want variable expressions
      expect(result.distinctIdExpression).toBeNull();
    } finally {
      cleanup();
    }
  });
});
