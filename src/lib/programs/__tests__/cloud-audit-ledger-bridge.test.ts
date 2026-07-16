import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { applyResolveChecksOutput } from '@lib/agent/runner/harness/agents-platform/ledger-bridge';
import {
  execClientTool,
  resolveInWorkdir,
} from '@lib/agent/runner/harness/agents-platform/client-tools';
import { CLOUD_AUDIT_PLACEHOLDER_CHECKS } from '@lib/programs/cloud-audit/seed';
import { readLedger } from '@lib/programs/audit/ledger';
import { AUDIT_CHECKS_FILE, type AuditCheck } from '@lib/programs/audit/types';

describe('cloud audit', () => {
  let dir: string;
  let ledger: string;

  const CATALOG = [
    {
      id: 'a',
      area: 'Event Capture',
      label: 'Static event names',
      status: 'pending',
    },
    {
      id: 'b',
      area: 'Event Capture',
      label: 'Naming convention',
      status: 'pending',
    },
  ];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-audit-'));
    ledger = path.join(dir, AUDIT_CHECKS_FILE);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const seed = (checks: AuditCheck[]): void => {
    fs.writeFileSync(ledger, JSON.stringify(checks), 'utf8');
  };

  describe('applyResolveChecksOutput', () => {
    it('seeds the checklist from the agent catalog, replacing the placeholder', () => {
      seed(CLOUD_AUDIT_PLACEHOLDER_CHECKS);

      applyResolveChecksOutput(ledger, { catalog: CATALOG, resolved: [] });

      // The placeholder must not survive, or the run screen shows a check
      // that never resolves.
      expect(readLedger(ledger).map((c) => c.id)).toEqual(['a', 'b']);
    });

    it('drops a stale ledger left by a previous audit run', () => {
      // The ledger lives in the user's project and outlives any single run, so
      // a local `wizard audit` (different, longer checklist) can precede this.
      seed([
        {
          id: 'old-check',
          area: 'Old',
          label: 'From a previous run',
          status: 'pass',
        },
      ]);

      applyResolveChecksOutput(ledger, { catalog: CATALOG, resolved: [] });

      expect(readLedger(ledger).map((c) => c.id)).toEqual(['a', 'b']);
    });

    it('applies findings over the catalog, keeping catalog order', () => {
      applyResolveChecksOutput(ledger, {
        catalog: CATALOG,
        resolved: [
          {
            id: 'b',
            area: 'Event Capture',
            label: 'Naming convention',
            status: 'error',
            file: 'app.py',
            details: 'bad',
          },
        ],
      });

      expect(readLedger(ledger)).toEqual([
        {
          id: 'a',
          area: 'Event Capture',
          label: 'Static event names',
          status: 'pending',
        },
        {
          id: 'b',
          area: 'Event Capture',
          label: 'Naming convention',
          status: 'error',
          file: 'app.py',
          details: 'bad',
        },
      ]);
    });

    it('keeps earlier findings when a later call only carries the catalog', () => {
      // The agent calls resolve_checks repeatedly; every result carries the
      // full catalog. Re-seeding from it must not erase what it already found.
      applyResolveChecksOutput(ledger, {
        catalog: CATALOG,
        resolved: [
          {
            id: 'a',
            area: 'Event Capture',
            label: 'Static event names',
            status: 'pass',
          },
        ],
      });
      applyResolveChecksOutput(ledger, { catalog: CATALOG, resolved: [] });

      expect(readLedger(ledger).find((c) => c.id === 'a')?.status).toBe('pass');
    });

    it.each([
      [
        'an unknown status',
        { id: 'a', area: 'x', label: 'y', status: 'exploded' },
      ],
      ['a missing id', { area: 'x', label: 'y', status: 'pass' }],
      ['a non-object row', 'nonsense'],
    ])('drops a row with %s rather than rendering it', (_label, row) => {
      // Rows cross a network boundary from a separately-versioned bundle, so
      // drift lands here rather than as a corrupted checklist.
      applyResolveChecksOutput(ledger, { catalog: [row], resolved: [] });

      expect(readLedger(ledger)).toEqual([]);
    });

    it.each([
      ['a non-object output', 'nope'],
      ['an output with neither field', {}],
    ])('leaves the ledger untouched for %s', (_label, output) => {
      seed(CLOUD_AUDIT_PLACEHOLDER_CHECKS);

      applyResolveChecksOutput(ledger, output);

      expect(readLedger(ledger)).toEqual(CLOUD_AUDIT_PLACEHOLDER_CHECKS);
    });

    it('handles the real wire payload from the hosted agent', () => {
      // Captured verbatim off the /listen SSE stream against a live
      // wizard-audit revision. The tool lives in a bundle we ship separately
      // from this package, so this pins the contract between them: if the
      // tool's return shape drifts, this fails here rather than as an empty
      // checklist in front of a user.
      const first = {
        resolved: [],
        unknown_ids: [],
        invalid: [],
        catalog: [
          {
            id: 'capture-event-names-static',
            area: 'Event Capture',
            label: 'Static event names',
            status: 'pending',
          },
          {
            id: 'event-naming-standardization',
            area: 'Event Capture',
            label: 'Naming convention',
            status: 'pending',
          },
          {
            id: 'event-duplicates-and-bloat',
            area: 'Event Capture',
            label: 'Duplicates & bloat',
            status: 'pending',
          },
          {
            id: 'event-quality-context-review',
            area: 'Event Capture',
            label: 'Capture quality (PII, cardinality, hot paths)',
            status: 'pending',
          },
        ],
      };
      const second = {
        ...first,
        resolved: [
          {
            id: 'capture-event-names-static',
            area: 'Event Capture',
            label: 'Static event names',
            status: 'error',
            file: 'app.py',
            details: 'probe',
          },
        ],
      };

      seed(CLOUD_AUDIT_PLACEHOLDER_CHECKS);
      applyResolveChecksOutput(ledger, first);
      applyResolveChecksOutput(ledger, second);

      const rows = readLedger(ledger);
      expect(rows).toHaveLength(4);
      expect(rows[0]).toEqual({
        id: 'capture-event-names-static',
        area: 'Event Capture',
        label: 'Static event names',
        status: 'error',
        file: 'app.py',
        details: 'probe',
      });
      // The other three stay pending, and the placeholder is gone.
      expect(rows.slice(1).every((c) => c.status === 'pending')).toBe(true);
      expect(rows.map((c) => c.id)).not.toContain('cloud-audit-connect');
    });
  });

  describe('read_ledger client tool', () => {
    it('returns the accumulated ledger the wizard has written to disk', async () => {
      // The agent re-grounds from this instead of its own context before writing
      // the report; if it stops returning the on-disk ledger, the report silently
      // reverts to memory and the corruption protection is gone with no error.
      const checks: AuditCheck[] = [
        {
          id: 'a',
          area: 'Event Capture',
          label: 'Static event names',
          status: 'pass',
        },
      ];
      seed(checks);

      await expect(execClientTool(dir, 'read_ledger')).resolves.toEqual({
        checks,
      });
    });

    it('returns an empty ledger before any resolution has been written', async () => {
      await expect(execClientTool(dir, 'read_ledger')).resolves.toEqual({
        checks: [],
      });
    });
  });

  describe('file tools delegate to pi', () => {
    // The wizard no longer implements read/grep/list/write itself — it routes to
    // pi's built-in tools. These catch a broken factory call, arg mapping, or a
    // lost jail, which would otherwise only surface in a live hosted run.
    it('read_file returns the file content through pi', async () => {
      fs.writeFileSync(path.join(dir, 'app.py'), 'posthog.capture("signup")\n');
      const result = (await execClientTool(dir, 'read_file', {
        path: 'app.py',
      })) as { content: Array<{ text?: string }> };
      const text = result.content.map((c) => c.text ?? '').join('');
      expect(text).toContain('posthog.capture("signup")');
    });

    it('write_file lands the file on disk through pi', async () => {
      await execClientTool(dir, 'write_file', {
        path: 'report.md',
        content: '# audit\n',
      });
      expect(fs.readFileSync(path.join(dir, 'report.md'), 'utf8')).toBe(
        '# audit\n',
      );
    });

    it('still jails a model path that escapes the project root', async () => {
      await expect(
        execClientTool(dir, 'read_file', { path: '../../etc/passwd' }),
      ).rejects.toThrow(/escapes/);
    });
  });

  describe('resolveInWorkdir', () => {
    it.each([
      ['a parent traversal', '../../etc/passwd'],
      ['an absolute path', '/etc/passwd'],
    ])('rejects %s', (_label, p) => {
      // The path comes from a remote model, so this is the only thing between
      // it and an arbitrary read of the user's disk.
      expect(() => resolveInWorkdir(dir, p)).toThrow(/escapes/);
    });

    it('rejects a sibling directory sharing the root as a prefix', () => {
      expect(() =>
        resolveInWorkdir(dir, `../${path.basename(dir)}-evil/x`),
      ).toThrow(/escapes/);
    });

    it.each([
      ['a nested path', 'src/app.py'],
      ['the root itself', '.'],
      ['an undefined path', undefined],
    ])('allows %s', (_label, p) => {
      // Compare lexically: the check is path.resolve-based and deliberately
      // doesn't touch the filesystem, and on macOS os.tmpdir() is itself a
      // symlink, so realpath would disagree for reasons unrelated to the jail.
      expect(resolveInWorkdir(dir, p).startsWith(path.resolve(dir))).toBe(true);
    });
  });
});
