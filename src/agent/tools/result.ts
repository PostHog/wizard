/**
 * publish_result — the agent publishes the run's machine-readable result (the
 * savings it sized and the ids of what it created) in one explicit call. The
 * host designates the destination file; the product reads it after the run.
 */

import { z } from 'zod';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import { runtimeEnv } from '@env';
import { TASK_REPORTING_NOTE, writeHostFileAtomically } from './handoff';
import { WIZARD_TOOL_NAMES } from './tools';

export const PUBLISH_RESULT_TOOL_NAME = 'publish_result';

/** Opt-in: a run gets publish_result only when its allow list names it, MCP-prefixed or bare. */
export function allowsPublishResult(
  allowedTools: readonly string[] | undefined,
): boolean {
  return (allowedTools ?? []).some(
    (name) =>
      name === WIZARD_TOOL_NAMES.publishResult ||
      name === PUBLISH_RESULT_TOOL_NAME,
  );
}

/** Shared between the MCP server and the pi facade so the contract can't drift. */
export const PUBLISH_RESULT_DESCRIPTION =
  'Publish the run result — the machine-readable summary the product reads after the run: the savings sized in billable units, the ids of every dashboard and insight the run created, the notebook, and the checks that passed. ' +
  'A run publishes once: call it only when your own instructions ask you to write the result, after everything it lists exists, passing the complete object as `result`. ' +
  'Never state a dollar amount; the product prices the volumes. Never write the file yourself. ' +
  'A refusal names the field that failed: fix that field and call again.';

export const PUBLISH_RESULT_PARAM_DESCRIPTION =
  'The complete result object, exactly the fields the result skill lists: version, notebook_short_id, dashboard_ids, insight_ids, savings, value_items, checks_passed.';

// Cap matching the handoff: the backend reads the file into memory.
export const MAX_RESULT_TEXT_CHARS = 64 * 1024;

const nonNegativeInt = z.number().int().nonnegative();
const nonEmpty = z.string().trim().min(1);

const savingSchema = z
  .object({
    id: nonEmpty,
    title: nonEmpty.max(200),
    billing_type: nonEmpty,
    unit: nonEmpty,
    before: nonNegativeInt,
    after: z
      .object({ low: nonNegativeInt, high: nonNegativeInt })
      .strict()
      .refine((range) => range.low <= range.high, {
        message: 'after.low must not exceed after.high',
        path: ['low'],
      }),
    evidence: nonEmpty,
    tradeoff: nonEmpty,
    effort: z.enum(['code', 'setting', 'billing']),
    fixed_in: z.enum(['pr', 'notebook']),
  })
  .strict()
  .refine((saving) => saving.after.high <= saving.before, {
    message: 'after.high must not exceed before',
    path: ['after', 'high'],
  });

const valueItemSchema = z
  .object({
    title: nonEmpty.max(200),
    reason: nonEmpty,
    insight_ids: z.array(nonNegativeInt).min(1),
  })
  .strict();

/**
 * The result file contract. `strict()` everywhere: the product rejects unknown
 * fields, so refusing them here lets the agent fix the call instead of losing
 * the projection after the run.
 */
export const runResultSchema = z
  .object({
    version: z.literal(1),
    notebook_short_id: nonEmpty,
    dashboard_ids: z.array(nonNegativeInt),
    insight_ids: z.array(nonNegativeInt),
    savings: z.array(savingSchema),
    value_items: z.array(valueItemSchema),
    checks_passed: z.array(nonEmpty),
  })
  .strict();

export type RunResult = z.infer<typeof runResultSchema>;

export interface PublishResultResult {
  ok: boolean;
  message: string;
}

/** The first validation issue as the agent can act on it: a field path and what went wrong. */
export function describeResultIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'invalid result';
  const where = issue.path.length > 0 ? issue.path.join('.') : 'result';
  return `${where}: ${issue.message}`;
}

export function publishResult(
  result: unknown,
  opts: {
    /** Set by both facades when the caller is one task of an orchestrated run. */
    taskAgent?: boolean;
  } = {},
): PublishResultResult {
  const parsed = runResultSchema.safeParse(result);
  if (!parsed.success) {
    const reason = describeResultIssue(parsed.error);
    analytics.wizardCapture('result published', {
      result_ok: false,
      result_reject_reason: 'invalid_shape',
    });
    return {
      ok: false,
      message: `Error: the result was not published. ${reason}. Fix that field and call publish_result again.`,
    };
  }

  const text = JSON.stringify(parsed.data);
  if (text.length > MAX_RESULT_TEXT_CHARS) {
    analytics.wizardCapture('result published', {
      result_ok: false,
      result_reject_reason: 'too_large',
      result_chars: text.length,
    });
    return {
      ok: false,
      message: `Error: the result is ${text.length} characters; the limit is ${MAX_RESULT_TEXT_CHARS}. Shorten evidence and tradeoff strings and call publish_result again.`,
    };
  }

  const outputPath = runtimeEnv('POSTHOG_RESULT_OUTPUT_PATH');
  let outputWritten: boolean | undefined;
  let outputError: string | undefined;
  if (outputPath) {
    // Fail-open like the handoff: a broken host path never fails the run, but the
    // agent and the log both learn that the product will not see the file.
    const write = writeHostFileAtomically(outputPath, text);
    outputWritten = write.ok;
    if (!write.ok) {
      outputError = write.reason;
      logToFile(
        `[publish_result] host output write failed (${write.reason}): ${write.detail}`,
      );
    }
  }

  // Counts only — never the result itself, whose evidence quotes the user's data.
  analytics.wizardCapture('result published', {
    result_ok: true,
    result_chars: text.length,
    result_savings: parsed.data.savings.length,
    result_value_items: parsed.data.value_items.length,
    result_checks_passed: parsed.data.checks_passed.length,
    result_dashboards: parsed.data.dashboard_ids.length,
    result_insights: parsed.data.insight_ids.length,
    result_output_written: outputWritten,
  });

  const notes: string[] = [];
  if (outputPath === undefined) {
    notes.push(
      'no host destination in this run, so the product will not read it',
    );
  }
  if (outputError) notes.push(`host output write failed: ${outputError}`);
  return {
    ok: true,
    message: `Result published (${parsed.data.savings.length} savings, ${
      parsed.data.value_items.length
    } value items, ${parsed.data.checks_passed.length} checks passed${
      notes.length > 0 ? `; ${notes.join('; ')}` : ''
    }).${opts.taskAgent ? TASK_REPORTING_NOTE : ''}`,
  };
}
