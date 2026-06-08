import * as fs from 'fs';
import * as path from 'path';
import { IS_PRODUCTION_BUILD } from '@env';

/**
 * Read `WIZARD_API_KEY` from .env.local or .env in the current working
 * directory. Returns undefined when no key is found.
 *
 * This is the same `WIZARD_API_KEY` the `--api-key` flag reads from the
 * environment in dev/CI — one name for the wizard's API key. It's a dev/CI-only
 * convenience: published builds ignore it (`IS_PRODUCTION_BUILD`) so the shipped
 * CLI is driven by the `--api-key` flag rather than the environment.
 */
export function readApiKeyFromEnv(): string | undefined {
  if (IS_PRODUCTION_BUILD) return undefined;
  const envFiles = ['.env.local', '.env'];
  for (const envFile of envFiles) {
    const envPath = path.join(process.cwd(), envFile);
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const match = content.match(/^WIZARD_API_KEY=(.+)$/m);
      if (match) {
        return match[1].trim();
      }
    }
  }
  return undefined;
}
