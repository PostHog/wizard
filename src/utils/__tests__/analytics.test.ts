import { Analytics } from '../analytics';
import { PostHog } from 'posthog-node';
import { v4 as uuidv4 } from 'uuid';

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
          properties: {
            ...properties,
          },
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
          properties: {
            testTag: 'testValue',
            ...properties,
          },
        },
      );
    });

    it('should capture exception with distinct ID when set', () => {
      const error = new Error('Test error');
      const distinctId = 'user-123';

      analytics.setDistinctId(distinctId);
      analytics.captureException(error);

      expect(mockPostHogInstance.captureException).toHaveBeenCalledWith(
        error,
        distinctId,
        {
          properties: {},
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
          properties: {},
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
          properties: {
            environment: 'test',
            version: '1.0.0',
            integration: 'nextjs',
            step: 'installation',
          },
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
          properties: {
            integration: 'react',
          },
        },
      );
    });
  });

  describe('integration with other methods', () => {
    it('should work correctly with setTag and captureException', () => {
      const error = new Error('Test error');

      analytics.setTag('integration', 'nextjs');
      analytics.setTag('forceInstall', true);
      analytics.setTag('debug', false);

      analytics.captureException(error, {
        arguments: JSON.stringify({ installDir: '/test' }),
        step: 'wizard-execution',
      });

      expect(mockPostHogInstance.captureException).toHaveBeenCalledWith(
        error,
        'test-uuid',
        {
          properties: {
            integration: 'nextjs',
            forceInstall: true,
            debug: false,
            arguments: JSON.stringify({ installDir: '/test' }),
            step: 'wizard-execution',
          },
        },
      );
    });

    it('should work correctly with setDistinctId and captureException', () => {
      const error = new Error('Test error');
      const distinctId = 'user-456';

      analytics.setDistinctId(distinctId);
      analytics.setTag('integration', 'svelte');
      analytics.captureException(error);

      expect(mockPostHogInstance.captureException).toHaveBeenCalledWith(
        error,
        distinctId,
        {
          properties: {
            integration: 'svelte',
          },
        },
      );
    });
  });
});
