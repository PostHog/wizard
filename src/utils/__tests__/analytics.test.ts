import { Analytics, groupsFromUser } from '@utils/analytics';
import { PostHog } from 'posthog-node';
import { v4 as uuidv4 } from 'uuid';
import { ANALYTICS_TEAM_TAG } from '@lib/constants';
import type { ApiUser } from '@lib/api';

vi.mock('posthog-node');
vi.mock('uuid');

// IS_PRODUCTION_BUILD is read live (property access) in the Analytics
// constructor, so a getter backed by this mutable flag lets a test flip the
// build type without re-importing the module. Defaults falsy → 'dev',
// matching every other test. vi.hoisted() runs before the hoisted vi.mock
// factory, so the getter can read the flag at import time without hitting the
// temporal dead zone.
const envState = vi.hoisted(() => ({
  isProductionBuild: false,
  runSurface: 'local' as 'cloud' | 'local',
}));
vi.mock('@env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@env')>()),
  get IS_PRODUCTION_BUILD() {
    return envState.isProductionBuild;
  },
  get RUN_SURFACE() {
    return envState.runSurface;
  },
}));

const mockUuidv4 = uuidv4 as unknown as MockedFunction<typeof uuidv4>;
const MockedPostHog = PostHog as MockedClass<typeof PostHog>;

describe('Analytics', () => {
  let analytics: Analytics;
  let mockPostHogInstance: Mocked<PostHog>;

  beforeEach(() => {
    vi.clearAllMocks();
    envState.isProductionBuild = false;
    // Each run mints several distinct uuids; mock them to different values
    // so the tests reflect reality (run_id !== $session_id) rather than
    // collapsing them. Call order: anonymousId, runId (both in the
    // constructor), then sessionId (lazily, on first identify).
    let uuidCall = 0;
    mockUuidv4.mockImplementation((() => {
      uuidCall += 1;
      if (uuidCall === 1) return 'test-uuid'; // anonymousId
      if (uuidCall === 2) return 'run-uuid'; // runId
      return 'session-uuid'; // sessionId (first identify)
    }) as any);

    mockPostHogInstance = {
      capture: vi.fn(),
      captureException: vi.fn(),
      alias: vi.fn(),
      identify: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
    } as any;

    MockedPostHog.mockImplementation(() => mockPostHogInstance);

    analytics = new Analytics();
  });

  describe('captureException', () => {
    it('should capture exception with error object and properties', () => {
      const error = new Error('Test error');
      const properties = { integration: 'nextjs' };

      analytics.captureException(error, properties);

      expect(mockPostHogInstance.captureException).toHaveBeenCalledWith(
        error,
        'test-uuid',
        {
          team: ANALYTICS_TEAM_TAG,
          $app_name: 'wizard',
          build: 'dev',
          run_id: 'run-uuid',
          run_surface: 'local',
          ...properties,
        },
      );
    });

    it('should capture exception with tags included in properties', () => {
      const error = new Error('Test error');
      const properties = { integration: 'nextjs' };

      analytics.setTag('testTag', 'testValue');
      analytics.captureException(error, properties);

      expect(mockPostHogInstance.captureException).toHaveBeenCalledWith(
        error,
        'test-uuid',
        {
          team: ANALYTICS_TEAM_TAG,
          $app_name: 'wizard',
          build: 'dev',
          run_id: 'run-uuid',
          run_surface: 'local',
          testTag: 'testValue',
          ...properties,
        },
      );
    });

    it('should capture exception with distinct ID when set', () => {
      const error = new Error('Test error');
      const distinctId = 'user-123';

      analytics.identifyUser({ distinct_id: distinctId } as unknown as ApiUser);
      analytics.captureException(error);

      expect(mockPostHogInstance.captureException).toHaveBeenCalledWith(
        error,
        distinctId,
        {
          team: ANALYTICS_TEAM_TAG,
          $app_name: 'wizard',
          build: 'dev',
          run_id: 'run-uuid',
          run_surface: 'local',
          $session_id: 'session-uuid',
        },
      );
    });

    it('should capture exception without properties when not provided', () => {
      const error = new Error('Test error');

      analytics.captureException(error);

      expect(mockPostHogInstance.captureException).toHaveBeenCalledWith(
        error,
        'test-uuid',
        {
          team: ANALYTICS_TEAM_TAG,
          $app_name: 'wizard',
          build: 'dev',
          run_id: 'run-uuid',
          run_surface: 'local',
        },
      );
    });

    it('should merge tags with provided properties', () => {
      const error = new Error('Test error');
      const properties = { integration: 'nextjs', step: 'installation' };

      analytics.setTag('environment', 'test');
      analytics.setTag('version', '1.0.0');
      analytics.captureException(error, properties);

      expect(mockPostHogInstance.captureException).toHaveBeenCalledWith(
        error,
        'test-uuid',
        {
          team: ANALYTICS_TEAM_TAG,
          $app_name: 'wizard',
          build: 'dev',
          run_id: 'run-uuid',
          run_surface: 'local',
          environment: 'test',
          version: '1.0.0',
          integration: 'nextjs',
          step: 'installation',
        },
      );
    });

    it('should override tags with properties when keys conflict', () => {
      const error = new Error('Test error');
      const properties = { integration: 'react' };

      analytics.setTag('integration', 'nextjs');
      analytics.captureException(error, properties);

      expect(mockPostHogInstance.captureException).toHaveBeenCalledWith(
        error,
        'test-uuid',
        {
          team: ANALYTICS_TEAM_TAG,
          $app_name: 'wizard',
          build: 'dev',
          run_id: 'run-uuid',
          run_surface: 'local',
          integration: 'react',
        },
      );
    });

    it('should always include team property in exceptions', () => {
      const error = new Error('Test error');

      analytics.captureException(error);

      expect(mockPostHogInstance.captureException).toHaveBeenCalledWith(
        error,
        'test-uuid',
        {
          team: ANALYTICS_TEAM_TAG,
          $app_name: 'wizard',
          build: 'dev',
          run_id: 'run-uuid',
          run_surface: 'local',
        },
      );
    });
  });

  describe('build tag', () => {
    it("tags dev/test runs as 'dev'", () => {
      analytics.captureException(new Error('e'));

      expect(
        (mockPostHogInstance.captureException as Mock).mock.calls.at(-1)?.[2],
      ).toMatchObject({ build: 'dev' });
    });

    it("tags production builds as 'prod'", () => {
      envState.isProductionBuild = true;
      const prodAnalytics = new Analytics();

      prodAnalytics.captureException(new Error('e'));

      expect(
        (mockPostHogInstance.captureException as Mock).mock.calls.at(-1)?.[2],
      ).toMatchObject({ build: 'prod' });
    });
  });

  describe('run_surface tag', () => {
    it("defaults every event to 'local'", () => {
      analytics.captureException(new Error('e'));

      expect(
        (mockPostHogInstance.captureException as Mock).mock.calls.at(-1)?.[2],
      ).toMatchObject({ run_surface: 'local' });
    });

    it("tags 'cloud' on the headless launch surface", () => {
      envState.runSurface = 'cloud';
      try {
        const cloud = new Analytics();
        cloud.captureException(new Error('e'));

        expect(
          (mockPostHogInstance.captureException as Mock).mock.calls.at(-1)?.[2],
        ).toMatchObject({ run_surface: 'cloud' });
      } finally {
        envState.runSurface = 'local';
      }
    });
  });

  describe('identifyUser', () => {
    const user = {
      distinct_id: 'user-123',
      email: 'v@posthog.com',
      first_name: 'Vincent',
      last_name: null,
    } as unknown as ApiUser;

    it('identifies the user, then merges the anonymous person in', () => {
      analytics.identifyUser(user);

      expect(mockPostHogInstance.identify).toHaveBeenCalledWith({
        distinctId: 'user-123',
        properties: {
          $set: { email: 'v@posthog.com', name: 'Vincent' },
        },
      });
      expect(mockPostHogInstance.alias).toHaveBeenCalledWith({
        distinctId: 'user-123',
        alias: 'test-uuid',
      });
      // Alias only ever fires after identification.
      expect(
        (mockPostHogInstance.identify as Mock).mock.invocationCallOrder[0],
      ).toBeLessThan(
        (mockPostHogInstance.alias as Mock).mock.invocationCallOrder[0],
      );
    });

    it('runs once per user — re-login does not re-identify or re-merge', () => {
      analytics.identifyUser(user);
      analytics.identifyUser(user);

      expect(mockPostHogInstance.identify).toHaveBeenCalledTimes(1);
      expect(mockPostHogInstance.alias).toHaveBeenCalledTimes(1);
    });

    it('does nothing when the id is the run anonymous id itself', () => {
      analytics.identifyUser({
        distinct_id: 'test-uuid',
      } as unknown as ApiUser);

      expect(mockPostHogInstance.identify).not.toHaveBeenCalled();
      expect(mockPostHogInstance.alias).not.toHaveBeenCalled();
    });

    it('opens the session ($session_id) only once the user is identified', () => {
      const error = new Error('e');

      // Pre-login: run_id is present, $session_id is not.
      analytics.captureException(error);
      const beforeLogin = (mockPostHogInstance.captureException as Mock).mock
        .calls[0][2];
      expect(beforeLogin).toMatchObject({ run_id: 'run-uuid' });
      expect(beforeLogin).not.toHaveProperty('$session_id');

      // Post-login: both ids ride along.
      analytics.identifyUser({ distinct_id: 'user-123' } as unknown as ApiUser);
      analytics.captureException(error);
      expect(
        (mockPostHogInstance.captureException as Mock).mock.calls[1][2],
      ).toMatchObject({ run_id: 'run-uuid', $session_id: 'session-uuid' });
    });

    it('omits person properties the user does not have', () => {
      analytics.identifyUser({
        distinct_id: 'user-123',
      } as unknown as ApiUser);

      expect(mockPostHogInstance.identify).toHaveBeenCalledWith({
        distinctId: 'user-123',
        properties: { $set: {} },
      });
    });
  });

  describe('exception repair (before_send)', () => {
    type TestEvent = Record<string, unknown> & {
      distinctId?: string;
      properties?: Record<string, unknown>;
    };
    type BeforeSendFn = (event: TestEvent | null) => TestEvent | null;

    const getBeforeSend = (): BeforeSendFn =>
      (MockedPostHog.mock.calls[0][1] as { before_send: BeforeSendFn })
        .before_send;

    it('reattaches identity and tags to autocaptured exceptions', () => {
      analytics.setTag('command', 'slack');
      const beforeSend = getBeforeSend();

      const result = beforeSend({
        event: '$exception',
        distinctId: 'random-uuidv7',
        properties: {
          $exception_list: [{ type: 'Error' }],
          $process_person_profile: false,
        },
      });

      expect(result?.distinctId).toBe('test-uuid');
      expect(result?.properties).toEqual({
        $app_name: 'wizard',
        build: 'dev',
        run_id: 'run-uuid',
        run_surface: 'local',
        command: 'slack',
        $exception_list: [{ type: 'Error' }],
      });
    });

    it('uses the real distinct id once set', () => {
      analytics.identifyUser({ distinct_id: 'user-123' } as unknown as ApiUser);
      const beforeSend = getBeforeSend();

      const result = beforeSend({
        event: '$exception',
        distinctId: 'random-uuidv7',
        properties: {},
      });

      expect(result?.distinctId).toBe('user-123');
    });

    it('leaves non-exception events untouched', () => {
      const beforeSend = getBeforeSend();
      const event = { event: 'x', distinctId: 'd', properties: { a: 1 } };

      expect(beforeSend(event)).toBe(event);
      expect(event.distinctId).toBe('d');
      expect(event.properties).toEqual({ a: 1 });
    });
  });

  describe('shutdown', () => {
    it('emits the terminal event once — the first status wins over the interrupt fallback', async () => {
      analytics.setTag('program_id', 'warehouse-source');

      await analytics.shutdown('success');
      // start-tui's ctrl+c fallback fires this on every TUI teardown.
      await analytics.shutdown('cancelled');

      const finishedCalls = mockPostHogInstance.capture.mock.calls.filter(
        ([arg]) => arg.event === 'setup wizard finished',
      );
      expect(finishedCalls).toHaveLength(1);
      expect(finishedCalls[0][0].properties).toMatchObject({
        status: 'success',
      });
    });
  });

  describe('groups (before_send injection)', () => {
    type TestEvent = Record<string, unknown> & {
      groups?: Record<string, string>;
    };
    type BeforeSendFn = (event: TestEvent | null) => TestEvent | null;

    const getBeforeSend = (): BeforeSendFn =>
      (MockedPostHog.mock.calls[0][1] as { before_send: BeforeSendFn })
        .before_send;

    it('does not attach groups before setGroups is called', () => {
      const beforeSend = getBeforeSend();
      const event = { event: 'x', distinctId: 'd', properties: {} };

      expect(beforeSend(event)).toBe(event);
      expect(event).not.toHaveProperty('groups');
    });

    it('injects the active group map into every event', () => {
      analytics.setGroups({
        instance: 'https://us.posthog.com',
        organization: 'org-1',
        project: 'team-uuid',
      });
      const beforeSend = getBeforeSend();

      const result = beforeSend({
        event: 'x',
        distinctId: 'd',
        properties: {},
      });

      expect(result?.groups).toEqual({
        instance: 'https://us.posthog.com',
        organization: 'org-1',
        project: 'team-uuid',
      });
    });

    it('lets per-event groups override the active map', () => {
      analytics.setGroups({ instance: 'https://us.posthog.com', project: 'a' });
      const beforeSend = getBeforeSend();

      const result = beforeSend({
        event: 'x',
        distinctId: 'd',
        properties: {},
        groups: { project: 'override' },
      });

      expect(result?.groups).toEqual({
        instance: 'https://us.posthog.com',
        project: 'override',
      });
    });

    it('passes null events through untouched', () => {
      analytics.setGroups({ instance: 'https://us.posthog.com' });
      const beforeSend = getBeforeSend();

      expect(beforeSend(null)).toBeNull();
    });
  });

  describe('groupsFromUser', () => {
    const userWith = (overrides: Partial<ApiUser>): ApiUser =>
      ({
        distinct_id: 'd',
        organization: { id: 'org-1' },
        team: { id: 1, uuid: 'team-uuid', organization: 'org-1' },
        organizations: [],
        ...overrides,
      } as unknown as ApiUser);

    it('always includes the host as the instance group', () => {
      expect(groupsFromUser(null, 'https://us.posthog.com')).toEqual({
        instance: 'https://us.posthog.com',
      });
    });

    it('maps org id, customer id, and team uuid (not numeric project id)', () => {
      const user = userWith({
        organization: {
          id: 'org-uuid',
          customer_id: 'cus_123',
        } as ApiUser['organization'],
        team: {
          id: 42,
          uuid: 'team-uuid',
          organization: 'org-uuid',
        } as ApiUser['team'],
      });

      expect(groupsFromUser(user, 'https://eu.posthog.com')).toEqual({
        instance: 'https://eu.posthog.com',
        organization: 'org-uuid',
        customer: 'cus_123',
        project: 'team-uuid',
      });
    });

    it('omits optional keys that are absent', () => {
      const user = userWith({
        organization: { id: 'org-uuid' } as ApiUser['organization'],
        team: { id: 42, organization: 'org-uuid' } as ApiUser['team'],
      });

      expect(groupsFromUser(user, 'https://us.posthog.com')).toEqual({
        instance: 'https://us.posthog.com',
        organization: 'org-uuid',
      });
    });
  });

  describe('integration with other methods', () => {
    it('should work correctly with setTag and captureException', () => {
      const error = new Error('Test error');

      analytics.setTag('integration', 'nextjs');
      analytics.setTag('localMcp', true);
      analytics.setTag('debug', false);

      analytics.captureException(error, {
        arguments: JSON.stringify({ installDir: '/test' }),
        step: 'wizard-execution',
      });

      expect(mockPostHogInstance.captureException).toHaveBeenCalledWith(
        error,
        'test-uuid',
        {
          team: ANALYTICS_TEAM_TAG,
          $app_name: 'wizard',
          build: 'dev',
          run_id: 'run-uuid',
          run_surface: 'local',
          integration: 'nextjs',
          localMcp: true,
          debug: false,
          arguments: JSON.stringify({ installDir: '/test' }),
          step: 'wizard-execution',
        },
      );
    });

    it('attributes exceptions to the identified user', () => {
      const error = new Error('Test error');
      const distinctId = 'user-456';

      analytics.identifyUser({ distinct_id: distinctId } as unknown as ApiUser);
      analytics.setTag('integration', 'svelte');
      analytics.captureException(error);

      expect(mockPostHogInstance.captureException).toHaveBeenCalledWith(
        error,
        distinctId,
        {
          team: ANALYTICS_TEAM_TAG,
          $app_name: 'wizard',
          build: 'dev',
          run_id: 'run-uuid',
          run_surface: 'local',
          $session_id: 'session-uuid',
          integration: 'svelte',
        },
      );
    });
  });
});
