/**
 * Status-bar window sizes. How many status lines the bar shows collapsed vs
 * expanded. Kept in a dependency-free module so both the renderer
 * (TabContainer) and the store (which caps retained history to the window)
 * share one definition.
 */

export const COLLAPSED_COUNT = 2;
export const EXPANDED_COUNT = 10;
