import {
  Sequence,
  WIZARD_ORCHESTRATOR_FLAG_KEY,
  WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY,
} from '@shared/config/constants';
import type { ResolvedBinding } from '@agent/types';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import type { ProgramSwitchboardCtx } from './binding';

/** Record the selected route and its precedence sources once per program run. */
export function captureSwitchboardDecision(
  ctx: ProgramSwitchboardCtx,
  binding: ResolvedBinding,
): void {
  const trace = ctx.trace ?? {};
  const perTaskModel =
    binding.sequence === Sequence.orchestrator && trace.model === 'binding';
  const model = perTaskModel ? 'chosen-per-task' : binding.model;
  const modelSource = perTaskModel ? 'agent-prompts' : trace.model;
  analytics.wizardCapture('switchboard resolved', {
    program: ctx.program,
    flag_self_driving_use_pi_harness:
      ctx.flags[WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY],
    flag_self_driving_pi_payload: JSON.stringify(
      ctx.flagPayloads?.[WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY] ?? null,
    ),
    flag_orchestrator: ctx.flags[WIZARD_ORCHESTRATOR_FLAG_KEY],
    cli_harness: ctx.cliHarness,
    cli_sequence: ctx.cliSequence,
    cli_model: ctx.cliModel,
    harness_source: trace.harness,
    model_source: modelSource,
    sequence_source: trace.sequence,
    harness: binding.harness,
    model,
    thinking_level: binding.thinkingLevel,
    sequence: binding.sequence,
  });
  logToFile(
    `[switchboard] decision: program=${ctx.program}` +
      ` in(orchestrator=${ctx.flags[WIZARD_ORCHESTRATOR_FLAG_KEY] ?? '-'},` +
      ` cli=${ctx.cliHarness ?? '-'}/${ctx.cliSequence ?? '-'}/${
        ctx.cliModel ?? '-'
      })` +
      ` → harness=${binding.harness} (${trace.harness ?? '?'})` +
      ` model=${model} (${modelSource ?? '?'})` +
      ` sequence=${binding.sequence} (${trace.sequence ?? '?'})`,
  );
}
