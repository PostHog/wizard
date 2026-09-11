import {
  gatewayAuth,
  GatewayMintFailed,
  GatewayMintRefused,
  type GatewayAuth,
} from '@lib/gateway-session';
import { wizardAbort } from '@utils/wizard-abort';

const pendingAborts = new WeakMap<Error, Promise<never>>();

/** End the wizard before a harness or security hook can swallow a mint failure. */
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
      abort = wizardAbort({ message: error.message, error });
      pendingAborts.set(error, abort);
    }
    return abort;
  }
}
