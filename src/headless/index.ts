/** The headless surface's public runtime entry. The control server loads through its loader. */
export { LoggingUI } from './renderers/logging-ui';
export { HeadlessUI } from './renderers/headless-ui';

/** The control server loads only when a run asks for a socket. */
export const loadControl = () => import('./control/index');
