/**
 * Middleware system types for wizard agent runs.
 *
 * Middleware receives lifecycle events (messages, phase transitions, finalize)
 * and can publish data to a shared store for downstream middleware to read.
 */

import type clack from '../../utils/clack';

export type SDKMessage = any;

/** Read-only shared state available to all middleware */
export interface MiddlewareContext {
  /** Current detected phase name */
  readonly currentPhase: string;
  /** Whether the current phase started with fresh context (new query) */
  readonly currentPhaseFreshContext: boolean;
  /** Read a value from the shared store (published by upstream middleware) */
  get<T>(key: string): T | undefined;
}

/** Write handle for middleware to publish data to the shared store */
export interface MiddlewareStore {
  set(key: string, value: unknown): void;
}

/** Lifecycle hooks a middleware can implement */
export interface Middleware {
  /** Unique name for this middleware (used in config and store keys) */
  readonly name: string;
  /** Called once when the pipeline initializes */
  onInit?(ctx: MiddlewareContext): void;
  /** Called for every SDK message */
  onMessage?(
    message: SDKMessage,
    ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void;
  /** Called when a phase transition is detected */
  onPhaseTransition?(
    fromPhase: string,
    toPhase: string,
    ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void;
  /** Called at the end of the agent run. Return value from last middleware is used. */
  onFinalize?(
    resultMessage: any,
    totalDurationMs: number,
    ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): any;
}

/** Options bag passed to middleware factories during construction */
export interface MiddlewareFactoryOptions {
  spinner?: ReturnType<typeof clack.spinner>;
  outputPath?: string;
  phased?: boolean;
}
