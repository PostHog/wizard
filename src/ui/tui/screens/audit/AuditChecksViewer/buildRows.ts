import type { AuditCheck } from '../../../../../lib/workflows/audit/types.js';
import type { RenderRow } from './types.js';

/** Compose the visible row list: section headers, items (+ optional detail
 *  rows when expanded), and the separator that splits Up next / Complete. */
export function buildRenderRows(
  sorted: ReadonlyArray<AuditCheck>,
  expanded: boolean,
): RenderRow[] {
  const out: RenderRow[] = [];
  const pushItem = (item: AuditCheck) => {
    out.push({ kind: 'item', item });
    if (expanded && item.details) out.push({ kind: 'detail', item });
  };

  out.push({ kind: 'section', label: 'Up next' });
  for (const it of sorted) if (it.status === 'pending') pushItem(it);

  out.push({ kind: 'separator' }, { kind: 'separator' });

  out.push({ kind: 'section', label: 'Complete' });
  for (const it of sorted) if (it.status !== 'pending') pushItem(it);

  return out;
}
