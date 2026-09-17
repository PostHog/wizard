import type { GatewayMintRefused } from './gateway-session';
import {
  OutroKind,
  type OutroData,
  type WizardSession,
} from './wizard-session';
import type { ProgramConfig } from './programs/program-step';
import { writeWizardSpellbook } from './wizard-spellbook';
import { detectFramework } from './detection/framework';
import { FRAMEWORK_REGISTRY } from './registry';

export const PROVISIONED_ACCOUNT_GATEWAY_DISABLED =
  'provisioned_account_gateway_disabled';
export const PROVISIONED_ACCOUNT_HANDOFF_MESSAGE =
  'Continue setup in your coding agent';
export const PROVISIONED_ACCOUNT_HANDOFF_BODY =
  'Your PostHog account is ready. Use the installation skills with your own coding agent to finish setup.';

export class ProvisionedAccountHandoff extends Error {
  constructor() {
    super(PROVISIONED_ACCOUNT_HANDOFF_MESSAGE);
    this.name = 'ProvisionedAccountHandoff';
  }
}

export function isProvisionedAccountHandoff(error: unknown): boolean {
  return (
    error instanceof ProvisionedAccountHandoff ||
    (error instanceof Error &&
      error.name === 'GatewayMintRefused' &&
      (error as GatewayMintRefused).status === 403 &&
      (error as GatewayMintRefused).outcome ===
        PROVISIONED_ACCOUNT_GATEWAY_DISABLED)
  );
}

export function provisionedAccountOutro(): OutroData {
  return {
    kind: OutroKind.Success,
    handoffReason: 'provisioned_account',
    message: PROVISIONED_ACCOUNT_HANDOFF_MESSAGE,
    body: PROVISIONED_ACCOUNT_HANDOFF_BODY,
  };
}

export async function saveProvisionedAccountSkills(
  session: WizardSession,
  program: ProgramConfig,
) {
  if (!session.credentials) {
    throw new Error(
      'Project credentials are required to save setup instructions.',
    );
  }
  const integration =
    session.integration ?? (await detectFramework(session.installDir));
  return writeWizardSpellbook(
    {
      ...session,
      integration: integration ?? null,
      frameworkConfig:
        session.frameworkConfig ??
        (integration ? FRAMEWORK_REGISTRY[integration] : null),
    },
    program,
    {
      project: session.credentials,
    },
  );
}
