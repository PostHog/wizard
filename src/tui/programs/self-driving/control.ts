/** Self-driving's control commits: the actions on its screens and its named setters. */
import {
  GITHUB_REQUIRED_BODY,
  GITHUB_REQUIRED_MESSAGE,
  SELF_DRIVING_INTEGRATE_PATH_KEY,
} from '@programs/self-driving';
import { OutroKind } from '@shared/outro';
import {
  optionalBoolean,
  requireBoolean,
  requireOneOf,
  requireString,
} from '@shared/control/params';
import {
  outroData,
  pickIntegrationTarget,
  type ActionDef,
  type SetterDef,
} from '@tui/control/defs';
import { SelfDrivingScreenId } from './screen-ids.js';
import {
  chooseProvisionAccount,
  confirmSelfDrivingHandoff,
  declineGithub,
  setGithubConnected,
  setIntegrate,
} from './store-actions.js';

export const SELF_DRIVING_ACTIONS: Readonly<
  Record<string, readonly ActionDef[]>
> = {
  [SelfDrivingScreenId.IntegrationCheck]: [
    {
      id: 'set_integrate',
      description:
        'Decide whether the integration runs before Self-driving (the user already has an account).',
      params: { integrate: 'boolean' },
      apply: (store, params) =>
        setIntegrate(
          store,
          requireBoolean('set_integrate', params, 'integrate'),
        ),
    },
  ],
  [SelfDrivingScreenId.IntegrationDetect]: [
    pickIntegrationTarget(SELF_DRIVING_INTEGRATE_PATH_KEY),
  ],
  [SelfDrivingScreenId.Handoff]: [
    {
      id: 'confirm_self_driving_handoff',
      description:
        'Confirm the handoff from the integration run to Self-driving.',
      apply: (store) => confirmSelfDrivingHandoff(store),
    },
  ],
  [SelfDrivingScreenId.Github]: [
    {
      id: 'set_github_connected',
      description: 'Record the GitHub App connection the check would find.',
      params: { connected: 'boolean (default true)' },
      apply: (store, params) =>
        setGithubConnected(
          store,
          optionalBoolean('set_github_connected', params, 'connected', true),
        ),
    },
    {
      id: 'decline_github',
      description:
        'Answer "I can\'t connect right now": the run ends before the agent starts.',
      apply: (store) =>
        declineGithub(store, {
          kind: OutroKind.Cancel,
          message: GITHUB_REQUIRED_MESSAGE,
          body: GITHUB_REQUIRED_BODY,
        }),
    },
  ],
};

export const SELF_DRIVING_SETTERS: readonly SetterDef[] = [
  {
    name: 'chooseProvisionAccount',
    description:
      'Self-driving: provision a new account on auth (sets signup, email, region and integrate).',
    params: { email: 'string', region: '"us" | "eu"' },
    apply: (store, p) =>
      chooseProvisionAccount(
        store,
        requireString('chooseProvisionAccount', p, 'email'),
        requireOneOf('chooseProvisionAccount', p, 'region', [
          'us',
          'eu',
        ] as const),
      ),
  },
  {
    name: 'setIntegrate',
    description: 'Self-driving: whether to run the integration first.',
    params: { integrate: 'boolean' },
    apply: (store, p) =>
      setIntegrate(store, requireBoolean('setIntegrate', p, 'integrate')),
  },
  {
    name: 'confirmSelfDrivingHandoff',
    description: 'Confirm the self-driving handoff screen.',
    apply: (store) => confirmSelfDrivingHandoff(store),
  },
  {
    name: 'setGithubConnected',
    description: 'Mark GitHub connected.',
    params: { connected: 'boolean (default true)' },
    apply: (store, p) =>
      setGithubConnected(
        store,
        optionalBoolean('setGithubConnected', p, 'connected', true),
      ),
  },
  {
    name: 'declineGithub',
    description: 'Decline the GitHub connection and end on this outro.',
    params: { data: 'OutroData ({ kind, message?, body?, ... })' },
    apply: (store, p) => declineGithub(store, outroData('declineGithub', p)),
  },
];
