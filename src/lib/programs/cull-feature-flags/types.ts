import { z } from 'zod';

const FlagGroupSchema = z.object({
  rollout_percentage: z.number().nullable().optional(),
  properties: z.array(z.unknown()).optional(),
  variant: z.string().nullable().optional(),
});

// Every classification field is optional so an API drift degrades a flag to
// healthy, never to cullable.
export const FeatureFlagSchema = z.object({
  id: z.number(),
  key: z.string(),
  name: z.string().optional(),
  active: z.boolean(),
  archived: z.boolean().optional(),
  deleted: z.boolean().optional(),
  status: z.string().optional(),
  filters: z
    .object({
      groups: z.array(FlagGroupSchema).optional(),
      multivariate: z
        .object({ variants: z.array(z.unknown()).optional() })
        .nullable()
        .optional(),
    })
    .optional(),
  experiment_set: z.array(z.unknown()).nullable().optional(),
  is_remote_configuration: z.boolean().optional(),
  has_encrypted_payloads: z.boolean().optional(),
});
export type FeatureFlag = z.infer<typeof FeatureFlagSchema>;

export const FeatureFlagListResponseSchema = z.object({
  results: z.array(FeatureFlagSchema),
  next: z.string().nullable().optional(),
});

export type CullBucket =
  | 'dead-code-reference'
  | 'archived-still-referenced'
  | 'disabled-but-referenced'
  | 'unreferenced-comment-only'
  | 'unreferenced'
  | 'fully-rolled-out'
  | 'never-enabled'
  | 'deleted-still-referenced'
  | 'multi-callsite-no-wrapper'
  | 'healthy';

export type CullVerdict = 'stale' | 'warning' | 'healthy';

export interface CullCandidate {
  key: string;
  bucket: CullBucket;
  /** Display name of the bucket, the ledger row's `area`. */
  area: string;
  verdict: CullVerdict;
  /** One line the ledger label shows next to the key. */
  proposedAction: string;
  /** Why the flag landed in its bucket, plus PostHog state the skill should see. */
  reason: string;
  flagId?: number;
  flagName?: string;
  callSites: { file: string; line: number; api: string }[];
}
