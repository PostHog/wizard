import fs from 'fs';
import { WIZARD_YARA_REPORT_FILE } from '@utils/paths';

// The flush runs inside the agent, which has no UI: the report line is
// returned to the caller, who decides where it goes.
vi.mock('@ui', () => ({
  getUI: () => {
    throw new Error('agent code reached the UI');
  },
}));
vi.mock('@utils/debug');
vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn(), captureException: vi.fn() },
}));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    default: { ...actual, writeFileSync: vi.fn() },
    writeFileSync: vi.fn(),
  };
});

import {
  flushScanReport,
  recordExternalScan,
  resetScanReport,
} from '@agent/yara-hooks';

describe('flushScanReport', () => {
  beforeEach(() => {
    resetScanReport();
    vi.mocked(fs.writeFileSync).mockClear();
  });

  it('returns the report line once when a report was requested', () => {
    recordExternalScan('PostToolUse', 'Write', [], 'warned');

    const line = flushScanReport({ yaraReport: true });

    expect(line).toContain(`YARA scan report: ${WIZARD_YARA_REPORT_FILE}`);
    expect(line).toContain('1 tool calls scanned, 0 violations detected');
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      WIZARD_YARA_REPORT_FILE,
      expect.stringContaining('"totalScans": 1'),
    );
    // Idempotent: the first flush zeroed the scan state.
    expect(flushScanReport({ yaraReport: true })).toBeUndefined();
  });

  it('returns nothing without --yara-report, but still flushes the state', () => {
    recordExternalScan('PostToolUse', 'Write', [], 'warned');

    expect(flushScanReport({ yaraReport: false })).toBeUndefined();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(flushScanReport({ yaraReport: true })).toBeUndefined();
  });
});
