/**
 * Middleware pipeline orchestrator.
 *
 * Implements the same { onMessage, finalize } interface that runAgent() expects,
 * while internally dispatching to an ordered list of middleware plugins.
 */

import { PhaseDetector } from './phase-detector';
import type {
  Middleware,
  MiddlewareContext,
  MiddlewareStore,
  SDKMessage,
} from './types';

export class MiddlewarePipeline {
  private middlewares: Middleware[];
  private store = new Map<string, unknown>();
  private phaseDetector: PhaseDetector;
  private autoDetectPhases: boolean;
  private _currentPhase = 'setup';
  private _currentPhaseFreshContext = true;

  constructor(
    middlewares: Middleware[],
    opts?: { phaseDetector?: PhaseDetector; autoDetectPhases?: boolean },
  ) {
    this.middlewares = middlewares;
    this.phaseDetector = opts?.phaseDetector ?? new PhaseDetector();
    this.autoDetectPhases = opts?.autoDetectPhases ?? true;

    const ctx = this.createContext();
    for (const mw of this.middlewares) {
      mw.onInit?.(ctx);
    }
  }

  /** Feed an SDK message through all middleware (satisfies tracker.onMessage) */
  onMessage(message: SDKMessage): void {
    // Phase detection first — updates context before middleware sees it
    if (this.autoDetectPhases) {
      const newPhase = this.phaseDetector.detect(message);
      if (newPhase && newPhase !== this._currentPhase) {
        this.transitionPhase(newPhase, false);
      }
    }

    const ctx = this.createContext();
    const storeHandle = this.createStore();
    for (const mw of this.middlewares) {
      mw.onMessage?.(message, ctx, storeHandle);
    }
  }

  /** Finalize the run (satisfies tracker.finalize) */
  finalize(resultMessage: any, totalDurationMs: number): any {
    const ctx = this.createContext();
    const storeHandle = this.createStore();
    let result: any;
    for (const mw of this.middlewares) {
      const r = mw.onFinalize?.(
        resultMessage,
        totalDurationMs,
        ctx,
        storeHandle,
      );
      if (r !== undefined) result = r;
    }
    return result;
  }

  /** Explicit phase start (for phased runner support) */
  startPhase(name: string, freshContext: boolean): void {
    this.transitionPhase(name, freshContext);
  }

  private transitionPhase(newPhase: string, freshContext: boolean): void {
    const oldPhase = this._currentPhase;
    this._currentPhase = newPhase;
    this._currentPhaseFreshContext = freshContext;
    const ctx = this.createContext();
    const storeHandle = this.createStore();
    for (const mw of this.middlewares) {
      mw.onPhaseTransition?.(oldPhase, newPhase, ctx, storeHandle);
    }
  }

  private createContext(): MiddlewareContext {
    return {
      currentPhase: this._currentPhase,
      currentPhaseFreshContext: this._currentPhaseFreshContext,
      get: <T>(key: string) => this.store.get(key) as T | undefined,
    };
  }

  private createStore(): MiddlewareStore {
    return {
      set: (key: string, value: unknown) => this.store.set(key, value),
    };
  }
}
