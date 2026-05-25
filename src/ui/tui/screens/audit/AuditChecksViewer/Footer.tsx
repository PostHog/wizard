import { Legend } from './Legend.js';
import { Summary } from './Header.js';
import type { AuditStatus } from '../../../../../lib/programs/audit/types.js';

interface FooterProps {
  total: number;
  counts: Record<AuditStatus, number>;
}

export const Footer = ({ total, counts }: FooterProps) => (
  <>
    <Legend />
    <Summary total={total} counts={counts} />
  </>
);
