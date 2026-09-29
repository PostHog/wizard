import { setHostingEnvUploadSkip, buildHostingEnvSkipWarning } from '../index';
import type { WizardSession } from '@lib/wizard-session';

function makeSession(): WizardSession {
  return { frameworkContext: {} } as unknown as WizardSession;
}

describe('hosting env upload skip wiring', () => {
  it('surfaces an outro warning line after postRun records a skip', () => {
    const sess = makeSession();

    setHostingEnvUploadSkip(sess, 'Vercel');

    expect(buildHostingEnvSkipWarning(sess)).toBe(
      "⚠️ Not added to Vercel — add them there too, or your deployed site won't send events",
    );
  });

  it('returns no warning when postRun never records a skip', () => {
    const sess = makeSession();

    expect(buildHostingEnvSkipWarning(sess)).toBe('');
  });

  it('returns no warning when the skip was explicitly cleared', () => {
    const sess = makeSession();

    setHostingEnvUploadSkip(sess, undefined);

    expect(buildHostingEnvSkipWarning(sess)).toBe('');
  });
});
