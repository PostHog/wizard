import { it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import type { AuditCheck, AuditStatus } from '@programs/audit/types';
import { AuditChecksOutroSection } from '../screens/audit/AuditChecksOutroSection';
import { Summary } from '../screens/audit/AuditChecksViewer/Header';
import { WriteReportSlide } from '../screens/audit/slides/writeReport';

vi.mock('ink', () =>
  vi.importActual('../../../../node_modules/ink/build/index.js'),
);

afterEach(cleanup);

const check = (status: AuditStatus): AuditCheck => ({
  id: status,
  area: 'Installation',
  label: `A ${status} check`,
  status,
});

it('uses singular nouns in the outro count line when a count is one', () => {
  const { lastFrame } = render(
    <AuditChecksOutroSection checks={[check('error')]} installDir="/project" />,
  );
  expect(lastFrame()).toContain('1 check · 1 error · 0 warnings');

  const mixed = render(
    <AuditChecksOutroSection
      checks={[check('error'), check('warning'), check('suggestion')]}
      installDir="/project"
    />,
  );
  expect(mixed.lastFrame()).toContain(
    '3 checks · 1 error · 1 warning · 1 suggestion',
  );
});

it('uses singular nouns in the checks viewer summary when a count is one', () => {
  const { lastFrame } = render(
    <Summary
      total={4}
      counts={{ pending: 0, pass: 1, error: 1, warning: 1, suggestion: 1 }}
    />,
  );
  expect(lastFrame()).toBe(
    '4 total · 0 pending · 1 error · 1 warning · 1 suggestion · 1 pass',
  );

  const plural = render(
    <Summary
      total={0}
      counts={{ pending: 0, pass: 0, error: 0, warning: 0, suggestion: 0 }}
    />,
  );
  expect(plural.lastFrame()).toBe(
    '0 total · 0 pending · 0 errors · 0 warnings · 0 suggestions · 0 passes',
  );
});

it('has no stray period after the report file name on the write report slide', () => {
  expect(WriteReportSlide.intro[0]).toContain(
    'at ./posthog-audit-report.md that summarizes',
  );
});
