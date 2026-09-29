import { NEXTJS_AGENT_CONFIG } from '@programs/frameworks/nextjs/nextjs-wizard-agent';
import { NextJsRouter } from '@programs/frameworks/nextjs/utils';

// The Next.js label is built from the detected router; with no router it is
// undefined, so detection falls back to the framework's metadata name.
describe('Next.js detection label', () => {
  it.each([
    [{ router: NextJsRouter.APP_ROUTER }, 'Next.js app router 📱'],
    [{ router: NextJsRouter.PAGES_ROUTER }, 'Next.js pages router 📃'],
    [{}, undefined],
  ])('labels %j as %s', (context, label) => {
    expect(
      NEXTJS_AGENT_CONFIG.metadata.getDetectedFrameworkLabel?.(context),
    ).toBe(label);
  });
});
