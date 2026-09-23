/**
 * Status-bar window sizes. How many status lines the bar shows collapsed vs
 * expanded. Kept in a dependency-free module so both the renderer
 * (TabContainer) and the store (which caps retained history to the window)
 * share one definition.
 */

export const COLLAPSED_COUNT = 2;
export { MAX_STATUS_MESSAGES as EXPANDED_COUNT } from '@shared/status-history';
