import { Analytics, groupsFromUser, sessionProperties } from '@utils/analytics';
import { PostHog } from 'posthog-node';
import { v4 as uuidv4 } from 'uuid';
import { ANALYTICS_TEAM_TAG, WIZARD_FLAG_KEYS } from '@lib/constants';
import { VERSION } from '@lib/version';
import type { ApiUser } from '@lib/api';
import {
  buildSession,
  DiscoveredFeature,
  ScanConsent,
} from '@lib/wizard-session';

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
  taskRunId: undefined as string | undefined,
  taskId: undefined as string | undefined,
}));
vi.mock('@env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@env')>()),
  get IS_PRODUCTION_BUILD() {
    return envState.isProductionBuild;
  },
  get RUN_SURFACE() {
    return envState.runSurface;
  },
  get TASK_RUN_ID() {
    return envState.taskRunId;
  },
  get TASK_ID() {
    return envState.taskId;
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
    envState.taskRunId = undefined;
    envState.taskId = undefined;
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
      groupIdentify: vi.fn(),
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
          version: VERSION,
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
          version: VERSION,
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
          version: VERSION,
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
          version: VERSION,
        },
      );
    });

    it('should merge tags with provided properties', () => {
      const error = new Error('Test error');
      const properties = { integration: 'nextjs', step: 'installation' };

      analytics.setTag('environment', 'test');
      // Not `version`: that key is now one of the constructor's own tags.
      analytics.setTag('framework_version', '1.0.0');
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
          version: VERSION,
          environment: 'test',
          framework_version: '1.0.0',
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
          version: VERSION,
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
          version: VERSION,
        },
      );
    });
  });

  describe('flag exposure', () => {
    // The getFlag spy *is* the exposure assertion — the SDK emits the event, not the wizard.
    let snapshot: {
      getFlag: MockedFunction<(key: string) => string | boolean | undefined>;
      getFlagPayload: MockedFunction<() => undefined>;
    };

    function mockFlags(flags: Record<string, string | boolean>): void {
      snapshot = {
        getFlag: vi.fn((key: string) => flags[key]),
        getFlagPayload: vi.fn(() => undefined),
      };
      (mockPostHogInstance as any).evaluateFlags = vi
        .fn()
        .mockResolvedValue(snapshot);
    }

    beforeEach(() => {
      mockFlags({
        'wizard-orchestrator': true,
        'wizard-orchestrator-override': 'sol-review',
        'unrelated-flag': 'variant-x',
      });
    });

    it('reads each wizard flag through getFlag', async () => {
      await analytics.getAllFlagsForWizard();
      expect(snapshot.getFlag.mock.calls.map(([k]) => k)).toEqual([
        ...WIZARD_FLAG_KEYS,
      ]);
    });

    it("skips another team's flag", async () => {
      await analytics.getAllFlagsForWizard();
      expect(snapshot.getFlag).not.toHaveBeenCalledWith('unrelated-flag');
    });

    it('does not hand-roll $feature_flag_called', async () => {
      await analytics.getAllFlagsForWizard();
      const handRolled = mockPostHogInstance.capture.mock.calls.filter(
        ([arg]) => (arg as any).event === '$feature_flag_called',
      );
      expect(handRolled).toEqual([]);
    });

    it('resolves only wizard flags into the map', async () => {
      const flags = await analytics.getAllFlagsForWizard();
      expect(flags).toEqual({
        'wizard-orchestrator': 'true',
        'wizard-orchestrator-override': 'sol-review',
      });
    });

    it('stamps $feature/<key> for wizard flags only', async () => {
      await analytics.getAllFlagsForWizard();
      analytics.wizardCapture('switchboard resolved', { program: 'x' });
      const call = mockPostHogInstance.capture.mock.calls.find(
        ([arg]) => (arg as any).event === 'wizard: switchboard resolved',
      );
      const props = (call![0] as any).properties;
      expect(props['$feature/wizard-orchestrator']).toBe(true);
      expect(props['$feature/wizard-orchestrator-override']).toBe('sol-review');
      expect(props['$feature/unrelated-flag']).toBeUndefined();
    });

    it('lists only enabled wizard flags in $active_feature_flags', async () => {
      mockFlags({
        'wizard-orchestrator': true,
        'wizard-self-driving-use-pi-harness': false,
        'wizard-orchestrator-override': 'sol-review',
        'unrelated-flag': 'variant-x',
      });
      await analytics.getAllFlagsForWizard();
      analytics.wizardCapture('switchboard resolved');
      const call = mockPostHogInstance.capture.mock.calls.find(
        ([arg]) => (arg as any).event === 'wizard: switchboard resolved',
      );
      expect((call![0] as any).properties.$active_feature_flags).toEqual([
        'wizard-orchestrator',
        'wizard-orchestrator-override',
      ]);
    });

    it("tags the SDK's exposure event", () => {
      const beforeSend = MockedPostHog.mock.calls[0][1]!.before_send as (
        e: any,
      ) => any;
      const sent = beforeSend({
        event: '$feature_flag_called',
        properties: { $feature_flag: 'wizard-orchestrator' },
      });
      expect(sent.properties).toMatchObject({
        $feature_flag: 'wizard-orchestrator',
        $app_name: 'wizard',
        run_id: 'run-uuid',
        run_surface: 'local',
        build: 'dev',
      });
    });

    it('carries no $feature props before the fetch', () => {
      analytics.wizardCapture('early event');
      const call = mockPostHogInstance.capture.mock.calls.find(
        ([arg]) => (arg as any).event === 'wizard: early event',
      );
      const keys = Object.keys((call![0] as any).properties).filter((k) =>
        k.startsWith('$feature/'),
      );
      expect(keys).toEqual([]);
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

  describe('task run tags', () => {
    it('omits both ids on a run the sandbox did not launch', () => {
      analytics.capture('wizard: test');

      const properties = (mockPostHogInstance.capture as Mock).mock.calls.at(
        -1,
      )?.[0].properties;
      expect(properties).not.toHaveProperty('task_run_id');
      expect(properties).not.toHaveProperty('task_id');
    });

    it('tags every event with the launching task run', () => {
      envState.taskRunId = 'task-run-uuid';
      envState.taskId = 'task-uuid';
      const cloud = new Analytics();

      cloud.capture('wizard: test');
      cloud.captureException(new Error('e'));

      // Both paths merge the same tag bag, so the join back to the task run has
      // to hold for exceptions too, not just explicit captures.
      expect(
        (mockPostHogInstance.capture as Mock).mock.calls.at(-1)?.[0].properties,
      ).toMatchObject({ task_run_id: 'task-run-uuid', task_id: 'task-uuid' });
      expect(
        (mockPostHogInstance.captureException as Mock).mock.calls.at(-1)?.[2],
      ).toMatchObject({ task_run_id: 'task-run-uuid', task_id: 'task-uuid' });
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
        version: VERSION,
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
    it('passes a flush deadline through to the PostHog client', async () => {
      await analytics.flush(2_000);

      expect(mockPostHogInstance.shutdown).toHaveBeenCalledWith(2_000);
    });

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

  describe('groupIdentify', () => {
    it('forwards groupType, groupKey, and properties to the client', () => {
      analytics.groupIdentify('organization', 'org-1', {
        wizard_ai_sdk_detected: true,
      });

      expect(mockPostHogInstance.groupIdentify).toHaveBeenCalledWith({
        groupType: 'organization',
        groupKey: 'org-1',
        properties: { wizard_ai_sdk_detected: true },
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
          version: VERSION,
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
          version: VERSION,
          $session_id: 'session-uuid',
          integration: 'svelte',
        },
      );
    });
  });
});

describe('sessionProperties', () => {
  it('includes discovered_features once consent is granted', () => {
    const session = buildSession({ installDir: '/tmp/app' });
    session.discoveredFeatures = [DiscoveredFeature.Stripe];
    session.scanConsent = ScanConsent.Granted;

    const properties = sessionProperties(session);

    expect(properties.discovered_features).toEqual([DiscoveredFeature.Stripe]);
  });

  it('omits discovered_features entirely when the user declined sharing', () => {
    const session = buildSession({ installDir: '/tmp/app' });
    session.discoveredFeatures = [DiscoveredFeature.Stripe];
    session.scanConsent = ScanConsent.Declined;

    const properties = sessionProperties(session);

    expect(properties).not.toHaveProperty('discovered_features');
  });

  it('omits discovered_features on a --signup run before the user answers', () => {
    // --signup renders the full TUI, so these events fire while the intro
    // screen is still on screen. Granting on the flag would put scan results
    // on every one of them, including for a user who then declines.
    const session = buildSession({ installDir: '/tmp/app', signup: true });
    session.discoveredFeatures = [DiscoveredFeature.Stripe];

    const properties = sessionProperties(session);

    expect(properties).not.toHaveProperty('discovered_features');
  });

  it('omits discovered_features while consent is still undecided', () => {
    const session = buildSession({ installDir: '/tmp/app' });
    session.discoveredFeatures = [DiscoveredFeature.Stripe];
    session.scanConsent = ScanConsent.Undecided;

    const properties = sessionProperties(session);

    // Undecided reads the same as declined: a path that reports before the
    // user has been asked must send nothing, not everything.
    expect(properties).not.toHaveProperty('discovered_features');
  });

  it('sends scan_consent in every state, so an absent list is explainable', () => {
    for (const consent of [
      ScanConsent.Undecided,
      ScanConsent.Granted,
      ScanConsent.Declined,
    ]) {
      const session = buildSession({ installDir: '/tmp/app' });
      session.scanConsent = consent;

      expect(sessionProperties(session).scan_consent).toBe(consent);
    }
  });

  it('never sends an empty array in place of the omitted key', () => {
    const session = buildSession({ installDir: '/tmp/app' });
    session.discoveredFeatures = [];
    session.scanConsent = ScanConsent.Declined;

    const properties = sessionProperties(session);

    // Absent, not []. An empty array would misread as "we looked and found
    // nothing" instead of "we didn't report what we found".
    expect('discovered_features' in properties).toBe(false);
  });

  it('leaves every other property untouched by a decline', () => {
    const session = buildSession({ installDir: '/tmp/app' });
    session.scanConsent = ScanConsent.Declined;
    session.integration = null;
    session.additionalFeatureQueue = [];

    const properties = sessionProperties(session);

    expect(properties).toMatchObject({
      integration: null,
      detected_framework: null,
      typescript: false,
      additional_features: [],
      run_phase: session.runPhase,
    });
  });
});
