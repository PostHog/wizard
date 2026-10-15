---
name: monitoring-a-wizard-release
description:
  Prepare a monitoring plan for a wizard or context mill release from the
  wizard's PostHog events. Use before a release to decide what to watch, and in
  the hours and days after it to compare the new version with the previous one.
compatibility:
  Coding agents with read access to PostHog project 2 (US), through the PostHog
  MCP server or `posthog-cli api`.
metadata:
  author: posthog
  version: '1.0'
---

# Monitoring a wizard release

Write the plan before you test the release candidate. Post it on the release PR.
Then check it after the merge.

## The plan

For each metric, write the insight you will watch, the baseline from the
previous version, and the change that counts as a regression. Cover these five:

1. **Usage.** Runs started per program.
2. **Run duration.** p50 and p90 wall clock per run.
3. **Cost.** LLM cost per run.
4. **Completion rate.** Runs started that finish with `status = success`.
5. **Outcomes.** Success, cancelled, and error, with errors split by error code.

Split each one by `version`. Also split by `program_id`, `harness`, and `model`
when the release touches them.

## Filters for every query

- `build = prod`. Other values are `dev`, `ci`, and `headless`.
- Person `email` does not contain `@posthog.com`.
- `program_id` when the release touches one program.

## Key events

All of these fired in the last 14 days. Every wizard event carries `run_id`,
`version`, `build`, `run_surface`, `program_id`, and `command`.

| Event                               | Use it for                | Properties that matter                                                        |
| ----------------------------------- | ------------------------- | ----------------------------------------------------------------------------- |
| `wizard: started`                   | Runs started              | `program_id`, `version`, `run_id`                                             |
| `wizard: auth complete`             | Runs past login           | `program_id`, `version`                                                       |
| `wizard: switchboard resolved`      | Runner choice per run     | `harness` (`pi`, `anthropic`), `sequence` (`orchestrator`, `linear`), `model` |
| `setup wizard finished`             | The one terminal event    | `status` (`success`, `cancelled`, `error`), `run_phase`                       |
| `wizard: orchestrator run finished` | Orchestrator run shape    | `total_duration_ms`, `tasks_total`, `tasks_failed`, `retried_task_count`      |
| `wizard: orchestrator task failed`  | Failed tasks              | `type` (task type), `error`                                                   |
| `wizard: agent aborted`             | Aborted runs              | `failure_mode`, `duration_seconds`                                            |
| `$exception`                        | Failures by code          | `error_code` (`PHW_*`, see [error catalog](../../../docs/error-catalog.md))   |
| `$ai_generation`                    | LLM cost                  | `$ai_total_cost_usd`, `$ai_product` (`wizard:<program>`), `run_id`            |
| `wizard: mcp complete`              | MCP install after the run | `version`                                                                     |

Traps:

- `wizard: agent completed` fires once per task under the orchestrator. Its
  `duration_ms` is task time, not run time. Never use it to count runs.
- `wizard: agent started` fires before login, so it is not a sign that work
  began.
- `$ai_generation` has `run_id` but no `version`. Join it to `wizard: started`
  on `run_id` to get cost per version.
- The orchestrator sets `model = chosen-per-task`. Per-task models are on
  `wizard: orchestrator task models`.
- There is no context mill version property.

## Insights to build or reuse

| Metric       | Build                                                                                                                                     | Regression                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Usage        | Trend, `wizard: started` total count, breakdown `program_id`, daily                                                                       | A program drops to near zero, or runs fall with no outside cause |
| Completion   | Funnel `wizard: started` → `wizard: auth complete` → `setup wizard finished` where `status = success`, 2 hour window, breakdown `version` | Last step drops more than 3 points against the previous version  |
| Outcomes     | Trend, `setup wizard finished` total count, breakdown `status`, then a second trend on `$exception` with breakdown `error_code`           | Error share rises, or a new `PHW_*` code shows up                |
| Duration     | Trend on `wizard: orchestrator run finished`, p50 and p90 of `total_duration_ms`, breakdown `version`                                     | p50 or p90 up more than 20%                                      |
| Cost         | SQL below, or the [cost by program tile](https://us.posthog.com/project/2/insights/6yCE0nor)                                              | Cost per run up more than 20%                                    |
| Orchestrator | Trend on `wizard: orchestrator task failed`, breakdown `type`                                                                             | One task type starts failing                                     |

One query covers runs, outcomes, and cost per version. Change the window and the
program as needed:

```sql
WITH runs AS (
  SELECT toString(properties.run_id) AS run_id,
         argMin(toString(properties.version), timestamp) AS version,
         argMin(toString(properties.program_id), timestamp) AS program
  FROM events
  WHERE timestamp >= now() - INTERVAL 7 DAY
    AND event = 'wizard: started' AND properties.build = 'prod'
  GROUP BY run_id),
fin AS (
  SELECT toString(properties.run_id) AS run_id,
         argMax(toString(properties.status), timestamp) AS status
  FROM events
  WHERE timestamp >= now() - INTERVAL 7 DAY AND event = 'setup wizard finished'
  GROUP BY run_id),
cost AS (
  SELECT toString(properties.run_id) AS run_id,
         sum(toFloat(properties.$ai_total_cost_usd)) AS usd
  FROM events
  WHERE timestamp >= now() - INTERVAL 7 DAY AND event = '$ai_generation'
    AND toString(properties.$ai_product) LIKE 'wizard:%'
  GROUP BY run_id)
SELECT r.version, count() AS runs,
       round(countIf(f.status = 'success') / count() * 100, 1) AS success_pct,
       round(countIf(f.status = 'error') / count() * 100, 1) AS error_pct,
       round(countIf(f.status = 'cancelled') / count() * 100, 1) AS cancelled_pct,
       round(avgIf(c.usd, c.usd > 0), 2) AS cost_per_run_usd
FROM runs AS r
LEFT JOIN fin AS f ON f.run_id = r.run_id
LEFT JOIN cost AS c ON c.run_id = r.run_id
WHERE r.program = 'posthog-integration'
GROUP BY r.version
HAVING runs > 50
ORDER BY r.version DESC
```

About 10% of runs send no `setup wizard finished`, so the three shares do not
add up to 100.

## Starting points

- [Wizard v2 overview](https://us.posthog.com/project/2/dashboard/811546). Usage
  by program, abort count, task completions, and AI cost by program.
- [wizard-switchboard](https://us.posthog.com/project/2/dashboard/1793563).
  Completion, duration, and cost by runner arm, and orchestrator internals. Its
  filters fix the start date to 2026-07-22 and the program to
  `posthog-integration`. Set your own date range.

Tiles that are broken or misleading, as of 2026-10-15:

| Tile                                                                                   | Problem                                                                |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [Onboarding Wizard AI cost (copy)](https://us.posthog.com/project/2/insights/ei8Tk80w) | Zero since 2026-09-21. It filters on the old `ai_product = wizard` tag |
| [Wizard cost per user](https://us.posthog.com/project/2/insights/mtgWRRE5)             | Zero since 2026-09-28                                                  |
| [Agent started by workflow](https://us.posthog.com/project/2/insights/QsZRPSLd)        | `workflow` is no longer set, so every run is "None"                    |
| [Next wizard usage by version](https://us.posthog.com/project/2/insights/YvO1W1bi)     | `wizard interaction` has almost stopped firing                         |
| [Wizard Run Duration](https://us.posthog.com/project/2/insights/3UvqvQeN)              | Averages `agent completed`, which is task time under the orchestrator  |
| [Wizard Run Duration (copy)](https://us.posthog.com/project/2/insights/oDdnBz2P)       | Counts aborts longer than 15 minutes. It does not show a duration      |
| [Funnel: anthropic sdk](https://us.posthog.com/project/2/insights/LgLe5Tb1)            | One person since July. The anthropic linear arm barely runs            |
| [Remarks: orchestrator runs](https://us.posthog.com/project/2/insights/zvGvSCo4)       | Returns no rows                                                        |
| [Run duration by arm](https://us.posthog.com/project/2/insights/46ZWRnGK)              | The baseline arm has about 20 runs. Use the orchestrator row only      |

## Compare versions

- Break down by `version`, or filter to the new version and the previous one.
  The previous version is your baseline.
- New versions roll out as users run `npx @posthog/wizard@latest`, so the old
  version keeps running for days. Compare the two versions over the same days.
  Do not compare this week with last week.
- For a context mill release, the wizard version does not change. Compare the
  same wizard version before and after the release time. Add an annotation at
  the release time so it shows on every chart.
- Watch closely for the first 4 hours: usage, error share, and new error codes.
  Check again at 24 hours, when completion, duration, and cost have enough runs.
  Close the plan after 3 days if nothing moved.
- Wait for about 300 runs of the new version on `posthog-integration` before you
  trust a completion or cost change. Smaller programs need a longer window.
