import { useEffect } from 'react';
import { WizardStore } from '@ui/tui/store';
import { AutonomyOnboardingScreen } from '@ui/tui/screens/AutonomyOnboardingScreen';
import type { AutonomyPlan } from '@lib/wizard-session';

const FIXTURE: AutonomyPlan = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  project: {
    integration: 'nextjs',
    host: 'https://us.posthog.com',
    projectId: 12345,
  },
  responders: [
    {
      type: 'error-tracking',
      enabled: true,
      rationale:
        'PostHog Error Tracking is set up; auto-investigate new crashes.',
      trigger: { kind: 'new_issue' },
    },
    {
      type: 'support',
      enabled: false,
      rationale: 'No evidence of PostHog Conversations in this project.',
      trigger: { kind: 'new_ticket' },
    },
  ],
  scouts: [
    {
      id: 'onboarding-funnel',
      name: 'Onboarding funnel health',
      area: 'Signup + onboarding flow',
      cadence: 'daily',
      skillFile: 'scouts/onboarding-funnel.md',
      mcpServers: ['posthog'],
      rationale:
        'Watch onboarding step-3 drop-off and surface deltas > 2x week-over-week.',
    },
    {
      id: 'checkout-conversion',
      name: 'Checkout conversion',
      area: 'Cart → payment flow',
      cadence: 'hourly',
      skillFile: 'scouts/checkout-conversion.md',
      mcpServers: ['posthog'],
      rationale:
        'Detect conversion drops and correlate with deploy timestamps.',
    },
    {
      id: 'api-latency',
      name: 'API latency budget',
      area: 'Public API endpoints',
      cadence: 'hourly',
      skillFile: 'scouts/api-latency.md',
      mcpServers: ['posthog'],
      rationale: 'P95 latency above 800ms for any high-traffic endpoint.',
    },
    {
      id: 'feature-adoption',
      name: 'New feature adoption',
      area: 'Recently shipped features (90d)',
      cadence: 'weekly',
      skillFile: 'scouts/feature-adoption.md',
      mcpServers: ['posthog'],
      rationale: 'Track adoption curves of recently launched features.',
    },
  ],
};

interface AutonomyDemoProps {
  store: WizardStore;
}

export const AutonomyDemo = ({ store }: AutonomyDemoProps) => {
  useEffect(() => {
    store.setAutonomyPlan(FIXTURE);
  }, [store]);
  return <AutonomyOnboardingScreen store={store} />;
};
