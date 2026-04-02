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
  describe('Node.js / JavaScript', () => {
    test('finds distinct_id from posthog.identify() — frontend SDK', async () => {
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

    test('finds distinct_id from client.capture() — backend Node SDK', async () => {
      const { dir, cleanup } = createFixture({
        'src/events.ts': `client.capture({
  distinctId: req.user.id,
  event: 'purchase',
});`,
      });
      try {
        const result = await detectPostHogDistinctId(dir, 'node');
        expect(result.distinctIdExpression).toBe('req.user.id');
      } finally {
        cleanup();
      }
    });

    test('finds distinct_id from client.alias() — backend Node SDK', async () => {
      const { dir, cleanup } = createFixture({
        'src/auth.ts': `client.alias({
  distinctId: user.frontendId,
  alias: user.backendId,
});`,
      });
      try {
        const result = await detectPostHogDistinctId(dir, 'node');
        expect(result.distinctIdExpression).toBe('user.frontendId');
      } finally {
        cleanup();
      }
    });

    test('finds distinct_id from variable assignment', async () => {
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

    test('finds distinct_id from get_distinct_id() assignment', async () => {
      const { dir, cleanup } = createFixture({
        'src/tracking.ts': `const userId = posthog.get_distinct_id();`,
      });
      try {
        const result = await detectPostHogDistinctId(dir, 'node');
        expect(result.distinctIdExpression).toBe('userId');
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
    test('finds distinct_id from posthog.identify()', async () => {
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

    test('finds distinct_id from posthog.capture() — positional arg', async () => {
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

    test('finds distinct_id from posthog.alias()', async () => {
      const { dir, cleanup } = createFixture({
        'alias.py': `posthog.alias(previous_id=old_id, distinct_id=user.uuid)`,
      });
      try {
        const result = await detectPostHogDistinctId(dir, 'python');
        expect(result.distinctIdExpression).toBe('user.uuid');
      } finally {
        cleanup();
      }
    });
  });

  describe('Ruby', () => {
    test('finds distinct_id from capture() hash', async () => {
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

    test('finds distinct_id from identify() hash', async () => {
      const { dir, cleanup } = createFixture({
        'app/controllers/sessions_controller.rb': `posthog.identify({
  distinct_id: @user.id,
  properties: { email: @user.email }
})`,
      });
      try {
        const result = await detectPostHogDistinctId(dir, 'ruby');
        expect(result.distinctIdExpression).toBe('@user.id');
      } finally {
        cleanup();
      }
    });

    test('finds distinct_id from alias() hash', async () => {
      const { dir, cleanup } = createFixture({
        'app/services/alias.rb': `posthog.alias({
  distinct_id: user.frontend_id,
  alias: user.backend_id,
})`,
      });
      try {
        const result = await detectPostHogDistinctId(dir, 'ruby');
        expect(result.distinctIdExpression).toBe('user.frontend_id');
      } finally {
        cleanup();
      }
    });
  });

  describe('PHP', () => {
    test('finds distinct_id from PostHog::capture()', async () => {
      const { dir, cleanup } = createFixture({
        'app/Http/Controllers/EventController.php': `PostHog::capture([
  'distinctId' => $user->id,
  'event' => 'purchase',
]);`,
      });
      try {
        const result = await detectPostHogDistinctId(dir, 'php');
        expect(result.distinctIdExpression).toBe('$user->id');
      } finally {
        cleanup();
      }
    });

    test('finds distinct_id from PostHog::identify()', async () => {
      const { dir, cleanup } = createFixture({
        'app/Listeners/LoginListener.php': `PostHog::identify([
  'distinctId' => Auth::id(),
]);`,
      });
      try {
        const result = await detectPostHogDistinctId(dir, 'php');
        expect(result.distinctIdExpression).toBe('Auth::id()');
      } finally {
        cleanup();
      }
    });
  });

  describe('Go', () => {
    test('finds DistinctId from posthog.Capture struct', async () => {
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

    test('finds DistinctId from posthog.Identify struct', async () => {
      const { dir, cleanup } = createFixture({
        'analytics/identify.go': `client.Enqueue(posthog.Identify{
  DistinctId: req.UserID,
})`,
      });
      try {
        const result = await detectPostHogDistinctId(dir, 'go');
        expect(result.distinctIdExpression).toBe('req.UserID');
      } finally {
        cleanup();
      }
    });

    test('finds DistinctId from posthog.Alias struct', async () => {
      const { dir, cleanup } = createFixture({
        'analytics/alias.go': `client.Enqueue(posthog.Alias{
  DistinctId: user.FrontendID,
  Alias: user.BackendID,
})`,
      });
      try {
        const result = await detectPostHogDistinctId(dir, 'go');
        expect(result.distinctIdExpression).toBe('user.FrontendID');
      } finally {
        cleanup();
      }
    });
  });

  describe('Java / Kotlin', () => {
    test('finds distinct_id from posthog.capture() — Java', async () => {
      const { dir, cleanup } = createFixture({
        'src/main/java/Analytics.java': `posthog.capture(user.getId(), "purchase");`,
      });
      try {
        const result = await detectPostHogDistinctId(dir, 'java');
        expect(result.distinctIdExpression).toBe('user.getId()');
      } finally {
        cleanup();
      }
    });

    test('finds distinct_id from posthog.identify() — Java', async () => {
      const { dir, cleanup } = createFixture({
        'src/main/java/Auth.java': `posthog.identify(session.getUserId());`,
      });
      try {
        const result = await detectPostHogDistinctId(dir, 'java');
        expect(result.distinctIdExpression).toBe('session.getUserId()');
      } finally {
        cleanup();
      }
    });

    test('finds distinctId from PostHog.identify() — Kotlin/Android SDK', async () => {
      const { dir, cleanup } = createFixture({
        'app/src/main/kotlin/Analytics.kt': `PostHog.identify(distinctId = currentUser.uid)`,
      });
      try {
        const result = await detectPostHogDistinctId(dir, 'java');
        expect(result.distinctIdExpression).toBe('currentUser.uid');
      } finally {
        cleanup();
      }
    });
  });

  describe('.NET', () => {
    test('finds DistinctId from property assignment', async () => {
      const { dir, cleanup } = createFixture({
        'Services/Analytics.cs': `var options = new CaptureOptions
{
    DistinctId = user.Id,
    Event = "purchase",
};`,
      });
      try {
        const result = await detectPostHogDistinctId(dir, 'dotnet');
        expect(result.distinctIdExpression).toBe('user.Id');
      } finally {
        cleanup();
      }
    });

    test('finds distinct_id from Capture() call', async () => {
      const { dir, cleanup } = createFixture({
        'Services/Tracking.cs': `await posthog.CaptureAsync(userId, "purchase");`,
      });
      try {
        const result = await detectPostHogDistinctId(dir, 'dotnet');
        expect(result.distinctIdExpression).toBe('userId');
      } finally {
        cleanup();
      }
    });
  });

  describe('filtering', () => {
    test('ignores string literal distinct_ids', async () => {
      const { dir, cleanup } = createFixture({
        'test.ts': `posthog.identify("hardcoded-id");`,
      });
      try {
        const result = await detectPostHogDistinctId(dir, 'node');
        expect(result.distinctIdExpression).toBeNull();
      } finally {
        cleanup();
      }
    });

    test('ignores placeholder values from docs examples', async () => {
      const { dir, cleanup } = createFixture({
        'example.ts': `posthog.identify(distinct_id, { email: 'test@test.com' });`,
      });
      try {
        const result = await detectPostHogDistinctId(dir, 'node');
        // "distinct_id" is a placeholder, should be skipped
        expect(result.distinctIdExpression).toBeNull();
      } finally {
        cleanup();
      }
    });

    test('ignores test files', async () => {
      const { dir, cleanup } = createFixture({
        'src/__tests__/analytics.test.ts': `posthog.identify(testUser.id);`,
        'src/analytics.spec.ts': `posthog.identify(mockUser.id);`,
      });
      try {
        const result = await detectPostHogDistinctId(dir, 'node');
        expect(result.distinctIdExpression).toBeNull();
      } finally {
        cleanup();
      }
    });

    test('prefers identify() over capture() when both present', async () => {
      const { dir, cleanup } = createFixture({
        'src/posthog.ts': `posthog.identify(auth.user.id, { name: user.name });
posthog.capture('page_view', { url: window.location.href });`,
      });
      try {
        const result = await detectPostHogDistinctId(dir, 'node');
        expect(result.distinctIdExpression).toBe('auth.user.id');
      } finally {
        cleanup();
      }
    });
  });
});
