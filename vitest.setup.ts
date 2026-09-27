import { vi } from 'vitest';

// Tests must never send events or exceptions to production PostHog.
vi.mock('posthog-node');
