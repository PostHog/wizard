import { z } from 'zod';

export const HealthIssueSeveritySchema = z.enum([
  'critical',
  'warning',
  'info',
]);
export type HealthIssueSeverity = z.infer<typeof HealthIssueSeveritySchema>;

export const HealthIssueStatusSchema = z.enum(['active', 'resolved']);

export const HealthIssueSchema = z.object({
  id: z.string(),
  kind: z.string(),
  severity: HealthIssueSeveritySchema,
  status: HealthIssueStatusSchema,
  dismissed: z.boolean(),
  payload: z.record(z.unknown()).nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  resolved_at: z.string().nullable().optional(),
});
export type HealthIssue = z.infer<typeof HealthIssueSchema>;

export const HealthIssueListResponseSchema = z.object({
  results: z.array(HealthIssueSchema),
  count: z.number().optional(),
  next: z.string().nullable().optional(),
  previous: z.string().nullable().optional(),
});
export type HealthIssueListResponse = z.infer<
  typeof HealthIssueListResponseSchema
>;

export const HealthIssueSummarySchema = z.object({
  total: z.number(),
  by_severity: z.record(z.number()),
  by_kind: z.record(z.number()),
});
export type HealthIssueSummary = z.infer<typeof HealthIssueSummarySchema>;
