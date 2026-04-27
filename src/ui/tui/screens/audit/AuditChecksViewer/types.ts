import type { AuditCheck } from '../../../../../lib/workflows/audit/types.js';

export type AuditTaskStatus = 'pending' | 'in_progress' | 'completed';

export interface AuditTaskItem {
  label: string;
  activeForm?: string;
  status: AuditTaskStatus;
}

export type RenderRow =
  | { kind: 'item'; item: AuditCheck }
  | { kind: 'detail'; item: AuditCheck }
  | { kind: 'separator' }
  | { kind: 'section'; label: 'Up next' | 'Complete' };
