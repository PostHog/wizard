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

export interface HealthIssueSummary {
  total: number;
  by_severity: Record<HealthIssueSeverity, number>;
}
