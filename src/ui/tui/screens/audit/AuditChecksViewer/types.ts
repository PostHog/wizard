export type AuditTaskStatus = 'pending' | 'in_progress' | 'completed';

export interface AuditTaskItem {
  label: string;
  activeForm?: string;
  status: AuditTaskStatus;
}
