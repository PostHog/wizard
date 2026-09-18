/**
 * Status-bar window sizes: how many status lines the bar shows collapsed vs
 * expanded. The expanded window equals the store's retention cap.
 */
import { MAX_STATUS_MESSAGES } from './store.js';

export const COLLAPSED_COUNT = 2;
export const EXPANDED_COUNT = MAX_STATUS_MESSAGES;
