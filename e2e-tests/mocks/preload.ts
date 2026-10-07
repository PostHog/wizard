/**
 * Starts the MSW mock server inside the wizard's own process. The e2e suite
 * spawns the built wizard, so the jest-side server in `setup.ts` can't
 * intercept its requests; `startWizardInstance` preloads this file instead.
 */
import { server } from './server';

server.listen({ onUnhandledRequest: 'bypass' });
