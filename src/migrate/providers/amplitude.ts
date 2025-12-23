import type { MigrationProviderConfig, MigrationDocsOptions } from '../types';

export const AMPLITUDE_PACKAGES = [
  '@amplitude/analytics-browser',
  '@amplitude/analytics-node',
  '@amplitude/analytics-react-native',
  'amplitude-js',
] as const;

const AMPLITUDE_TO_POSTHOG_MAP: Record<string, string> = {
  '@amplitude/analytics-browser': 'posthog-js',
  'amplitude-js': 'posthog-js',
  '@amplitude/analytics-node': 'posthog-node',
  '@amplitude/analytics-react-native': 'posthog-react-native',
};

function getPostHogEquivalent(amplitudePackage: string): string | undefined {
  return AMPLITUDE_TO_POSTHOG_MAP[amplitudePackage];
}

function getMigrationDocs(options: MigrationDocsOptions): string {
  const { language, envVarPrefix, framework } = options;

  const apiKeyText =
    envVarPrefix === 'VITE_PUBLIC_'
      ? 'import.meta.env.VITE_PUBLIC_POSTHOG_KEY'
      : envVarPrefix.startsWith('NEXT_PUBLIC_')
      ? `process.env.NEXT_PUBLIC_POSTHOG_KEY`
      : `process.env.${envVarPrefix}POSTHOG_KEY`;

  const hostText =
    envVarPrefix === 'VITE_PUBLIC_'
      ? 'import.meta.env.VITE_PUBLIC_POSTHOG_HOST'
      : envVarPrefix.startsWith('NEXT_PUBLIC_')
      ? `process.env.NEXT_PUBLIC_POSTHOG_HOST`
      : `process.env.${envVarPrefix}POSTHOG_HOST`;

  return `
==============================
AMPLITUDE TO POSTHOG MIGRATION GUIDE
==============================

This is a migration from Amplitude Analytics to PostHog. You need to:
1. Replace all Amplitude imports with PostHog imports
2. Replace Amplitude initialization with PostHog initialization
3. Replace all Amplitude tracking calls with PostHog equivalents
4. Remove Amplitude packages from the codebase
5. If there is an 'ampli' directory or generated Amplitude SDK wrapper, remove it entirely or replace with PostHog calls

==============================
IMPORT REPLACEMENTS
==============================

BEFORE (Amplitude):
- import { init, track, identify, setUserId, Identify, Revenue } from '@amplitude/analytics-browser';
- import amplitude from 'amplitude-js';
- import * as amplitude from '@amplitude/analytics-browser';
- import { ampli } from './ampli';  // Generated Amplitude SDK

AFTER (PostHog):
- import posthog from 'posthog-js';
- import { PostHogProvider, usePostHog } from 'posthog-js/react';  // For React

==============================
AMPLI (GENERATED SDK) MIGRATION
==============================

If the project uses Ampli (Amplitude's generated type-safe SDK):

BEFORE (Ampli):
--------------------------------------------------
import { ampli } from './ampli';

ampli.load({ client: { apiKey: 'API_KEY' } });
ampli.identify(userId, { requiredNumber: 42 });
ampli.track({ event_type: 'page', event_properties: { category: 'Docs' } });
ampli.eventNoProperties();
ampli.eventWithAllProperties({ requiredNumber: 1, requiredString: 'Hi' });
--------------------------------------------------

AFTER (PostHog):
--------------------------------------------------
import posthog from 'posthog-js';

posthog.init(${apiKeyText}, { api_host: ${hostText}, defaults: '2025-05-24' });
posthog.identify(userId, { requiredNumber: 42 });
posthog.capture('page', { category: 'Docs' });
posthog.capture('Event No Properties');
posthog.capture('Event With All Properties', { requiredNumber: 1, requiredString: 'Hi' });
--------------------------------------------------

NOTE: You can delete the entire 'ampli' folder/directory after migration since PostHog doesn't use generated SDKs.

==============================
INITIALIZATION REPLACEMENT
==============================

BEFORE (Amplitude):
--------------------------------------------------
import { init } from '@amplitude/analytics-browser';
init('AMPLITUDE_API_KEY');
// or
amplitude.getInstance().init('AMPLITUDE_API_KEY');
// or with ampli
ampli.load({ client: { apiKey: 'AMPLITUDE_API_KEY' } });
--------------------------------------------------

AFTER (PostHog):
--------------------------------------------------
import posthog from 'posthog-js';
posthog.init(${apiKeyText}, {
  api_host: ${hostText},
  defaults: '2025-05-24',
  capture_exceptions: true,
});
--------------------------------------------------

==============================
EVENT TRACKING REPLACEMENT
==============================

BEFORE (Amplitude):
--------------------------------------------------
import { track } from '@amplitude/analytics-browser';
track('Button Clicked', { buttonName: 'signup' });
// or
amplitude.getInstance().logEvent('Button Clicked', { buttonName: 'signup' });
// or with ampli
ampli.track({ event_type: 'Button Clicked', event_properties: { buttonName: 'signup' } });
ampli.buttonClicked({ buttonName: 'signup' });  // type-safe method
--------------------------------------------------

AFTER (PostHog):
--------------------------------------------------
import posthog from 'posthog-js';
posthog.capture('Button Clicked', { buttonName: 'signup' });
--------------------------------------------------

==============================
USER IDENTIFICATION REPLACEMENT
==============================

BEFORE (Amplitude):
--------------------------------------------------
import { identify, setUserId, Identify } from '@amplitude/analytics-browser';
setUserId('user-123');
const identifyObj = new Identify();
identifyObj.set('email', 'user@example.com');
identify(identifyObj);
// or
amplitude.getInstance().setUserId('user-123');
amplitude.getInstance().setUserProperties({ email: 'user@example.com' });
// or with ampli
ampli.identify('user-123', { email: 'user@example.com' });
--------------------------------------------------

AFTER (PostHog):
--------------------------------------------------
import posthog from 'posthog-js';
posthog.identify('user-123', {
  email: 'user@example.com',
});
--------------------------------------------------

==============================
RESET / LOGOUT REPLACEMENT
==============================

BEFORE (Amplitude):
--------------------------------------------------
import { reset } from '@amplitude/analytics-browser';
reset();
// or
amplitude.getInstance().setUserId(null);
amplitude.getInstance().regenerateDeviceId();
--------------------------------------------------

AFTER (PostHog):
--------------------------------------------------
import posthog from 'posthog-js';
posthog.reset();
--------------------------------------------------

==============================
GROUP/COMPANY IDENTIFICATION REPLACEMENT
==============================

BEFORE (Amplitude):
--------------------------------------------------
import { setGroup } from '@amplitude/analytics-browser';
setGroup('company', 'company-123');
// or
amplitude.getInstance().setGroup('company', 'company-123');
ampli.client.setGroup('test group', 'browser-ts-ampli');
ampli.client.groupIdentify('test group', 'browser-ts-ampli', amplitudeIdentify);
--------------------------------------------------

AFTER (PostHog):
--------------------------------------------------
import posthog from 'posthog-js';
posthog.group('company', 'company-123', {
  // optional group properties
  name: 'Acme Inc',
});
--------------------------------------------------

==============================
REVENUE TRACKING REPLACEMENT
==============================

BEFORE (Amplitude):
--------------------------------------------------
import { revenue, Revenue } from '@amplitude/analytics-browser';
const revenueEvent = new Revenue()
  .setProductId('product-123')
  .setPrice(9.99)
  .setQuantity(1);
revenue(revenueEvent);
--------------------------------------------------

AFTER (PostHog):
--------------------------------------------------
import posthog from 'posthog-js';
posthog.capture('purchase', {
  $set: { total_revenue: 9.99 },
  product_id: 'product-123',
  price: 9.99,
  quantity: 1,
});
--------------------------------------------------

==============================
USER PROPERTIES REPLACEMENT
==============================

BEFORE (Amplitude):
--------------------------------------------------
amplitude.getInstance().setUserProperties({ plan: 'premium' });
--------------------------------------------------

AFTER (PostHog):
--------------------------------------------------
posthog.capture('$set', {
  $set: { plan: 'premium' },
});
// Or include in identify call:
posthog.identify(userId, { plan: 'premium' });
--------------------------------------------------

==============================
OPT-OUT REPLACEMENT
==============================

BEFORE (Amplitude):
--------------------------------------------------
amplitude.getInstance().setOptOut(true);
--------------------------------------------------

AFTER (PostHog):
--------------------------------------------------
posthog.opt_out_capturing();
// To opt back in:
posthog.opt_in_capturing();
--------------------------------------------------

==============================
DEVICE ID REPLACEMENT
==============================

BEFORE (Amplitude):
--------------------------------------------------
const deviceId = amplitude.getInstance().getDeviceId();
--------------------------------------------------

AFTER (PostHog):
--------------------------------------------------
const distinctId = posthog.get_distinct_id();
--------------------------------------------------

==============================
${
  framework === 'react' || framework === 'nextjs'
    ? getReactSpecificDocs(apiKeyText, hostText, language)
    : ''
}
==============================
IMPORTANT MIGRATION NOTES
==============================

1. Remove ALL Amplitude packages from package.json after migration:
   - @amplitude/analytics-browser
   - @amplitude/analytics-node
   - @amplitude/analytics-react-native
   - amplitude-js

2. Remove any Amplitude-related environment variables like:
   - AMPLITUDE_API_KEY
   - REACT_APP_AMPLITUDE_API_KEY
   - NEXT_PUBLIC_AMPLITUDE_API_KEY
   - VITE_AMPLITUDE_API_KEY

3. Remove any 'ampli' directory or generated Amplitude SDK files

4. PostHog uses 'distinct_id' instead of Amplitude's 'user_id' and 'device_id' combination.

5. PostHog automatically captures page views and clicks by default (autocapture).
   If you want to disable this, add autocapture: false to the init options.

6. PostHog init options should include defaults: '2025-05-24' for the latest recommended settings.

7. Feature flags in PostHog use isFeatureEnabled() instead of Amplitude's experiments API.
`;
}

function getReactSpecificDocs(
  apiKeyText: string,
  hostText: string,
  _language: 'typescript' | 'javascript',
): string {
  return `
REACT-SPECIFIC MIGRATION
==============================

BEFORE (Amplitude with React):
--------------------------------------------------
// Using AmplitudeProvider or manual init in useEffect
import { init } from '@amplitude/analytics-browser';
import { ampli } from './ampli';

function App() {
  useEffect(() => {
    init('AMPLITUDE_API_KEY');
    // or
    ampli.load({ client: { apiKey: 'AMPLITUDE_API_KEY' } });
  }, []);

  return <MyApp />;
}
--------------------------------------------------

AFTER (PostHog with React):
--------------------------------------------------
import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';

// Initialize PostHog before rendering
posthog.init(${apiKeyText}, {
  api_host: ${hostText},
  defaults: '2025-05-24',
  capture_exceptions: true,
});

function App() {
  return (
    <PostHogProvider client={posthog}>
      <MyApp />
    </PostHogProvider>
  );
}
--------------------------------------------------

USING THE POSTHOG HOOK:
--------------------------------------------------
import { usePostHog } from 'posthog-js/react';

function MyComponent() {
  const posthog = usePostHog();

  const handleClick = () => {
    posthog.capture('button_clicked', { button: 'signup' });
  };

  return <button onClick={handleClick}>Sign Up</button>;
}
--------------------------------------------------

NOTE: Do not directly import posthog apart from the initialization file.
Use the usePostHog hook in components to access the PostHog client.
`;
}

export const amplitudeProvider: MigrationProviderConfig = {
  id: 'amplitude',
  name: 'Amplitude',
  packages: AMPLITUDE_PACKAGES,
  docsUrl: 'https://posthog.com/docs/migrate/migrate-from-amplitude',
  getPostHogEquivalent,
  getMigrationDocs,
  defaultChanges: `• Replaced Amplitude SDK with PostHog SDK
• Migrated event tracking calls from Amplitude to PostHog
• Migrated user identification from Amplitude to PostHog
• Updated initialization code
• Removed Amplitude packages`,
  nextSteps: `• Remove any remaining Amplitude environment variables
• Delete the 'ampli' directory if it exists (generated Amplitude SDK)
• Verify all events are being captured correctly in PostHog
• Set up feature flags and experiments in PostHog if previously using Amplitude experiments
• Configure PostHog autocapture settings as needed`,
};
