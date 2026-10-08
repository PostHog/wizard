import { createHash } from 'node:crypto';
import { v5 as uuidv5 } from 'uuid';
import { fetchProjectData, type Credentials } from '@shared/api';
import { analytics, type Analytics } from '@utils/analytics';
import { ciOverriddenFlagKeys } from '@utils/ci-flag-overrides';
import { IS_PRODUCTION_BUILD } from '@env';
import { currentCredentials, oauthCredentials } from '@shared/oauth-session';
import { isGrantRevoked } from '@shared/auth-session-state';

export const WORKFLOWS_DISTRIBUTION_WAVE = 'workflows-distribution-v1';
const ASSIGNMENT_FLAG = 'workflows-distribution';
const MAX_WAIT_MS = 4000;
export type WorkflowsDistributionPlacement =
  | 'sdk-wizard'
  | 'instrumentation-skill';
export type WorkflowsDistributionSource = {
  credentials: Credentials;
  placementId: WorkflowsDistributionPlacement;
  waveId: typeof WORKFLOWS_DISTRIBUTION_WAVE;
  sourceActionId: string;
  signal: AbortSignal;
};
export type WorkflowsDistributionResult = Readonly<
  | {
      status: 'unenrolled';
      reason:
        | 'unavailable'
        | 'project-mismatch'
        | 'overridden'
        | 'diagnostic'
        | 'cancelled'
        | 'timeout'
        | 'context-changed'
        | 'invalid-context'
        | 'unauthorized';
    }
  | {
      status: 'offer' | 'control';
      projectId: number;
      projectUuid: string;
      appHost: string;
      waveId: typeof WORKFLOWS_DISTRIBUTION_WAVE;
      placementId: WorkflowsDistributionPlacement;
      contextKey: string;
      eligibleAt: string;
      eligibilityCapture: 'attempted' | 'failed';
    }
>;

export class WorkflowsDistributionGate {
  private context: string | undefined;
  private generation = new AbortController();
  private decisions = new Map<
    string,
    {
      promise: Promise<WorkflowsDistributionResult>;
      cancellation: AbortController;
    }
  >();

  constructor(private readonly client: Analytics = analytics) {}

  invalidate(): void {
    this.generation.abort('context-changed');
    this.generation = new AbortController();
    this.context = undefined;
    this.decisions.clear();
  }

  private authorizationContext(credentials: Credentials): string {
    return createHash('sha256')
      .update(
        JSON.stringify([
          this.client.runId,
          credentials.accessToken,
          credentials.projectId,
          credentials.host.appHost,
          credentials.host.apiHost,
          credentials.missingScopes,
        ]),
      )
      .digest('hex');
  }

  private interrupted(signal: AbortSignal): WorkflowsDistributionResult {
    const reason: unknown = signal.reason;
    return {
      status: 'unenrolled',
      reason:
        reason === 'context-changed'
          ? 'context-changed'
          : reason instanceof Error && reason.name === 'TimeoutError'
          ? 'timeout'
          : 'cancelled',
    };
  }

  private async evaluateBound(
    source: WorkflowsDistributionSource,
    context: string,
    signal: AbortSignal,
  ): Promise<WorkflowsDistributionResult> {
    try {
      const { placementId, waveId, sourceActionId } = source;
      const credentials = await currentCredentials(source.credentials);
      const held = await oauthCredentials();
      if (
        held &&
        this.authorizationContext(held) !==
          this.authorizationContext(credentials)
      )
        return { status: 'unenrolled', reason: 'context-changed' };
      if (
        isGrantRevoked() ||
        credentials.missingScopes?.includes('project:read')
      )
        return { status: 'unenrolled', reason: 'unauthorized' };
      const project = await fetchProjectData(
        credentials.accessToken,
        credentials.projectId,
        credentials.host.appHost,
        { signal, timeout: MAX_WAIT_MS },
      );
      if (signal.aborted) return this.interrupted(signal);
      if (
        this.context !== context ||
        this.authorizationContext(source.credentials) !== context
      )
        return { status: 'unenrolled', reason: 'context-changed' };
      if (project.id !== credentials.projectId)
        return { status: 'unenrolled', reason: 'project-mismatch' };
      const placementFlag = `${ASSIGNMENT_FLAG}-${placementId}`;
      const snapshot = await this.client.evaluateProjectFlags(project.uuid, [
        ASSIGNMENT_FLAG,
        placementFlag,
      ]);
      if (signal.aborted) return this.interrupted(signal);
      if (
        this.context !== context ||
        this.authorizationContext(source.credentials) !== context
      )
        return { status: 'unenrolled', reason: 'context-changed' };
      const current = await oauthCredentials();
      if (signal.aborted) return this.interrupted(signal);
      if (
        this.context !== context ||
        this.authorizationContext(source.credentials) !== context ||
        (current &&
          this.authorizationContext(current) !==
            this.authorizationContext(credentials))
      )
        return { status: 'unenrolled', reason: 'context-changed' };
      if (isGrantRevoked())
        return { status: 'unenrolled', reason: 'unauthorized' };
      if (
        ciOverriddenFlagKeys().some((key) =>
          [ASSIGNMENT_FLAG, placementFlag].includes(key),
        )
      )
        return { status: 'unenrolled', reason: 'overridden' };
      const assignment = snapshot.getFlag(ASSIGNMENT_FLAG);
      if (
        snapshot.getFlag(placementFlag) !== true ||
        (assignment !== 'offer' && assignment !== 'control')
      )
        return { status: 'unenrolled', reason: 'unavailable' };
      const contextKey = uuidv5(
        JSON.stringify([project.uuid, waveId, placementId, sourceActionId]),
        uuidv5.URL,
      );
      const eligibleAt = new Date().toISOString();
      const result: WorkflowsDistributionResult = {
        status: assignment,
        projectId: project.id,
        projectUuid: project.uuid,
        appHost: credentials.host.appHost,
        waveId,
        placementId,
        contextKey,
        eligibleAt,
        eligibilityCapture: 'attempted',
      };
      try {
        this.client.capture(
          'workflow distribution eligible',
          {
            project_id: project.id,
            project_uuid: project.uuid,
            wave_id: waveId,
            placement_id: placementId,
            context_key: contextKey,
            arm: assignment,
            stage: 'eligible',
            eligible_at: eligibleAt,
          },
          { project: project.uuid, instance: credentials.host.appHost },
        );
      } catch {
        return Object.freeze({ ...result, eligibilityCapture: 'failed' });
      }
      return Object.freeze(result);
    } catch {
      return signal.aborted
        ? this.interrupted(signal)
        : { status: 'unenrolled', reason: 'unavailable' };
    }
  }

  async evaluate(
    source: WorkflowsDistributionSource,
  ): Promise<WorkflowsDistributionResult> {
    const context = this.authorizationContext(source.credentials);
    if (this.context !== context) {
      this.invalidate();
      this.context = context;
    }
    if (
      !Number.isSafeInteger(source.credentials.projectId) ||
      source.credentials.projectId <= 0 ||
      source.waveId !== WORKFLOWS_DISTRIBUTION_WAVE ||
      !['sdk-wizard', 'instrumentation-skill'].includes(source.placementId) ||
      !source.sourceActionId ||
      source.sourceActionId.length > 128
    )
      return { status: 'unenrolled', reason: 'invalid-context' };
    if (
      isGrantRevoked() ||
      source.credentials.missingScopes?.includes('project:read')
    )
      return { status: 'unenrolled', reason: 'unauthorized' };
    const requestedKeys = [
      ASSIGNMENT_FLAG,
      `${ASSIGNMENT_FLAG}-${source.placementId}`,
    ];
    if (ciOverriddenFlagKeys().some((key) => requestedKeys.includes(key)))
      return { status: 'unenrolled', reason: 'overridden' };
    if (
      !IS_PRODUCTION_BUILD ||
      this.client.build !== 'prod' ||
      !['https://us.posthog.com', 'https://eu.posthog.com'].includes(
        source.credentials.host.appHost,
      )
    )
      return { status: 'unenrolled', reason: 'diagnostic' };
    if (source.signal.aborted) return this.interrupted(source.signal);
    const key = JSON.stringify([
      source.waveId,
      source.placementId,
      source.sourceActionId,
    ]);
    const existing = this.decisions.get(key);
    if (existing) {
      const listener = (): void =>
        existing.cancellation.abort(source.signal.reason);
      source.signal.addEventListener('abort', listener, { once: true });
      return existing.promise.finally(() =>
        source.signal.removeEventListener('abort', listener),
      );
    }
    const cancellation = new AbortController();
    const signal = AbortSignal.any([
      source.signal,
      cancellation.signal,
      this.generation.signal,
      AbortSignal.timeout(MAX_WAIT_MS),
    ]);
    let stop!: () => void;
    const cancelled = new Promise<WorkflowsDistributionResult>((resolve) => {
      const listener = (): void => resolve(this.interrupted(signal));
      signal.addEventListener('abort', listener, { once: true });
      stop = (): void => signal.removeEventListener('abort', listener);
    });
    const pending = Promise.race([
      this.evaluateBound(source, context, signal),
      cancelled,
    ]).finally(stop);
    this.decisions.set(key, { promise: pending, cancellation });
    return pending;
  }
}
