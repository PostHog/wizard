import {
  gatewayAuth,
  GatewayMintFailed,
  GatewayMintRefused,
  type GatewayAuth,
} from '@lib/gateway-session';
import { OutroKind } from '@lib/wizard-session';
import { getUI } from '@ui';
import { LoggingUI } from '@ui/logging-ui';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import { runCleanups, wizardAbort } from '@utils/wizard-abort';

const pendingAborts = new WeakMap<Error, Promise<never>>();

/**
 * Stop the agent on a mint failure before a harness or security hook can
 * swallow it, and hand the user the mint-failure screen.
 *
 * In the TUI the caller parks forever: the screen owns what happens next
 * (save a skill, open an agent, continue to MCP/Slack, or exit), and
 * run-wizard owns the exit. Headless runs have no screen, so they abort.
 */
export async function requireGatewayAuth(
  ...args: Parameters<typeof gatewayAuth>
): Promise<GatewayAuth> {
  try {
    return await gatewayAuth(...args);
  } catch (error) {
    if (
      !(error instanceof GatewayMintRefused) &&
      !(error instanceof GatewayMintFailed)
    ) {
      throw error;
    }
    let abort = pendingAborts.get(error);
    if (!abort) {
      const ui = getUI();
      if (ui instanceof LoggingUI) {
        abort = wizardAbort({ message: error.message, error });
      } else {
        logToFile('[gateway] mint failed, handing off to the user:', error);
        runCleanups();
        analytics.captureException(error, {
          ...error.context,
          error_code: error.code,
        });
        ui.outroError({
          kind: OutroKind.Error,
          errorCode: error.code,
          message: error.message,
        });
        abort = new Promise<never>(() => undefined);
      }
      pendingAborts.set(error, abort);
    }
    return abort;
  }
}
