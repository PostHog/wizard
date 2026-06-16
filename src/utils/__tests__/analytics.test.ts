import { Analytics, groupsFromUser } from '@utils/analytics';
import { PostHog } from 'posthog-node';
import { v4 as uuidv4 } from 'uuid';
import { ANALYTICS_TEAM_TAG } from '@lib/constants';
import type { ApiUser } from '@lib/api';

jest.mock('posthog-node');
jest.mock('uuid');

const mockUuidv4 = uuidv4 as jest.MockedFunction<typeof uuidv4>;
const MockedPostHog = PostHog as jest.MockedClass<typeof PostHog>;

describe('Analytics', () => {
  let analytics: Analytics;
  let mockPostHogInstance: jest.Mocked<PostHog>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUuidv4.mockReturnValue('test-uuid' as any);

    mockPostHogInstance = {
      capture: jest.fn(),
      captureException: jest.fn(),
      alias: jest.fn(),
      identify: jest.fn(),
      shutdown: jest.fn().mockResolvedValue(undefined),
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
        },
      );
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
        (mockPostHogInstance.identify as jest.Mock).mock.invocationCallOrder[0],
      ).toBeLessThan(
        (mockPostHogInstance.alias as jest.Mock).mock.invocationCallOrder[0],
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
          integration: 'svelte',
        },
      );
    });
  });
});
