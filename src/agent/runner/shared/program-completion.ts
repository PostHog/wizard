import type { CompletionTaskOutcomes, SequenceContext } from './types';
import { TaskStatus, type TaskOutcome } from '../sequence/orchestrator/queue';

export function completionTaskOutcomes(
  outcomes: readonly TaskOutcome[],
): CompletionTaskOutcomes {
  if (outcomes.length > 64) {
    return Object.freeze({ kind: 'unavailable', reason: 'limit' });
  }
  const snapshot: Readonly<TaskOutcome>[] = [];
  for (const outcome of outcomes) {
    if (
      !outcome ||
      typeof outcome.type !== 'string' ||
      outcome.type.length === 0 ||
      !Object.values(TaskStatus).includes(outcome.status) ||
      typeof outcome.optional !== 'boolean'
    ) {
      return Object.freeze({ kind: 'unavailable', reason: 'invalid' });
    }
    if (outcome.type.length > 128) {
      return Object.freeze({ kind: 'unavailable', reason: 'limit' });
    }
    snapshot.push(
      Object.freeze({
        type: outcome.type,
        status: outcome.status,
        optional: outcome.optional,
      }),
    );
  }
  return Object.freeze({
    kind: 'available',
    outcomes: Object.freeze(snapshot),
  });
}

export async function prepareProgramOutro(
  { config, input, boot, signal }: SequenceContext,
  taskOutcomes: CompletionTaskOutcomes,
): Promise<() => void> {
  const hook = config.hooks?.prepareOutro;
  if (
    !hook ||
    input.invocation !== 'interactive' ||
    input.flags.ci ||
    config.composed ||
    config.run.structured ||
    signal?.aborted
  ) {
    return () => undefined;
  }

  const controller = new AbortController();
  const abortFromHost = (): void => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abortFromHost, { once: true });
  const deadline = setTimeout(() => controller.abort(), 4000);
  let onInterrupt!: () => void;
  const interrupted = new Promise<void>((resolve) => {
    onInterrupt = resolve;
    controller.signal.addEventListener('abort', onInterrupt, { once: true });
  });
  const close = (): void => {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', abortFromHost);
    controller.signal.removeEventListener('abort', onInterrupt);
    controller.abort();
  };
  const context = Object.freeze({
    signal: controller.signal,
    invocation: input.invocation,
    sequence: config.binding.sequence,
    programId: config.programId,
    skillId: input.skillId,
    composed: config.composed,
    structured: !!config.run.structured,
    taskOutcomes,
  });
  let settled = false;
  await Promise.race([
    Promise.resolve()
      .then(() => {
        if (!controller.signal.aborted) return hook(boot.credentials, context);
      })
      .then(
        () => {
          settled = true;
        },
        () => controller.abort(),
      ),
    interrupted,
  ]);
  clearTimeout(deadline);
  controller.signal.removeEventListener('abort', onInterrupt);
  if (!settled || controller.signal.aborted) close();
  return close;
}
