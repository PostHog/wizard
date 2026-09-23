/** The control API over a unix socket; the CLI imports it dynamically, only when a socket is asked for. */
export {
  attachControlServer,
  CONTROL_SERVER_MARKER,
  ROUTES,
  UnknownActionError,
  UnknownSetterError,
  type ControlServerHandle,
  type ControlServerOptions,
} from './server';
export { ControlClient, ControlClientError } from './client';
export { RunInFlightError, RunLedger } from './runs';
export * from '@shared/control/params';
export { isSecretKey, redactContext } from '@shared/control/redact';
export type * from '@shared/control/types';
