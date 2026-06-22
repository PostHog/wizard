/**
 * Render a recording to per-frame TUI snapshots — one `.ans` file per key
 * moment, the REAL Ink screen rendered to ANSI (via replay's renderFrame, which
 * needs real ink, hence tsx not jest).
 *
 * These are the snapshots the workbench's visual-comparison flow diffs against a
 * committed baseline. A recording comes from a real `--e2e` run, so the
 * snapshots are what the user actually saw; run-to-run differences (e.g. the
 * agent enqueuing a different task) show up in the side-by-side for a human to
 * review.
 *
 *   tsx scripts/render-snapshots.no-jest.ts <recording.json> <outDir>
 */
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import type { ProgramId } from '@ui/tui/router';
import { loadRecording, renderFrame } from '@e2e-harness/replay';

const [recordingPath, outDir] = process.argv.slice(2);
if (!recordingPath || !outDir) {
  process.stderr.write('usage: render-snapshots <recording.json> <outDir>\n');
  process.exit(2);
}

const rec = loadRecording(recordingPath);
const program = rec.meta.program as ProgramId;

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const frame of rec.frames) {
  const seq = String(frame.seq).padStart(2, '0');
  // One file per key moment: <seq>-<screen>[-<triggers>].ans
  const name = `${seq}-${frame.screen}.ans`;
  writeFileSync(join(outDir, name), renderFrame(frame, program));
}

process.stdout.write(`rendered ${rec.frames.length} snapshots → ${outDir}\n`);
