import { OutroKind, type OutroData } from '@lib/wizard-session';

/**
 * Surface agent-flagged manual follow-up steps on a successful outro. A run can
 * finish everything it is able to and still leave the user one action (e.g. an
 * install that must happen outside the sandbox). Those are not failures, so the
 * outro stays a Success and lists the steps under nextSteps.
 */
export function applyManualSteps(
  outroData: OutroData | null | undefined,
  manualSteps: string[] | undefined,
): OutroData | null | undefined {
  if (!outroData || outroData.kind !== OutroKind.Success) return outroData;
  const steps = (manualSteps ?? []).map((s) => s.trim()).filter(Boolean);
  if (steps.length === 0) return outroData;
  return {
    ...outroData,
    message:
      steps.length === 1
        ? 'Almost done. One step left.'
        : 'Almost done. A few steps left.',
    nextSteps: {
      heading:
        outroData.nextSteps?.heading ??
        (steps.length === 1 ? 'One step left' : 'Steps left'),
      items: [...steps, ...(outroData.nextSteps?.items ?? [])],
    },
  };
}
