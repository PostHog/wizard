#!/usr/bin/env node
/**
 * ANSI "screenshot" tests for the wizard CLI command surface.
 *
 * For each command below, this launches the REAL built binary in a real
 * pseudo-terminal (via node-pty — Ink won't render without a TTY, and the pty
 * needs a fixed size or screens paint blank), captures the **raw bytes** it
 * writes to the terminal, and compares them **byte-for-byte** against a
 * committed golden dump under scripts/__screenshots__/. It catches regressions
 * in the command → intro-screen wiring: a command falling through to the
 * default flow, the wrong screen, or nothing rendering.
 *
 * The goldens are raw binary ANSI dumps — the actual "screenshot" (colour +
 * layout), not stripped text. For byte-exact comparison to be stable:
 *   - the pty size is fixed (COLS×ROWS),
 *   - colour output is forced (FORCE_COLOR) so it's identical local ↔ CI,
 *   - capture waits for the screen to SETTLE (output stops) before snapshotting.
 * If a screen animates (e.g. a spinner) it won't settle to a stable frame —
 * handle those case-by-case (pin the screen, or exclude it) rather than
 * loosening the whole comparison.
 *
 * Usage:
 *   pnpm build && node scripts/cli-screenshots.mjs            # check vs goldens
 *   pnpm build && node scripts/cli-screenshots.mjs --update   # (re)capture goldens
 *
 * Requires node-pty (devDependency) built — `pnpm install` with node-pty in
 * pnpm.onlyBuiltDependencies.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pty from 'node-pty';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const BIN = path.join(REPO, 'dist', 'bin.js');
const GOLDEN_DIR = path.join(HERE, '__screenshots__');

// Fixed terminal geometry — layout (and therefore the bytes) must be identical
// when seeding and when checking, on macOS and in CI alike.
const COLS = 100;
const ROWS = 40;
/** Snapshot once output has been quiet for this long (screen has painted). */
const SETTLE_MS = 1200;
/** Hard cap, in case a screen never goes quiet. */
const MAX_CAPTURE_MS = 12000;

/**
 * Commands to snapshot. `slug` is the golden filename; `args` is the wizard
 * argv. Keep in sync with the command surface (`bin.ts` + the audit family).
 * `unknown-command` is a negative case — it must error, not run a flow.
 */
const COMMANDS = [
  { slug: 'default', args: [] },
  { slug: 'audit', args: ['audit'] },
  { slug: 'audit-events', args: ['audit', 'events'] },
  { slug: 'audit-all', args: ['audit', 'all'] },
  { slug: 'revenue-analytics', args: ['revenue-analytics'] },
  { slug: 'migrate', args: ['migrate'] },
  { slug: 'upload-source-maps', args: ['upload-source-maps'] },
  { slug: 'mcp-add', args: ['mcp', 'add'] },
  { slug: 'slack-add', args: ['slack', 'add'] },
  { slug: 'skill-list', args: ['skill', 'list'] },
  { slug: 'doctor', args: ['doctor'] },
  { slug: 'unknown-command', args: ['asdf'] },
];

const UPDATE = process.argv.includes('--update');

/** Run one command in a sized pty, snapshot once it settles, return raw bytes. */
function capture(args) {
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = pty.spawn('node', [BIN, ...args, '--no-telemetry'], {
        name: 'xterm-256color',
        cols: COLS,
        rows: ROWS,
        cwd: REPO,
        // Force a stable colour level so the bytes match across environments.
        env: { ...process.env, FORCE_COLOR: '3', TERM: 'xterm-256color' },
        encoding: null, // hand back Buffers, not decoded strings
      });
    } catch (err) {
      reject(err);
      return;
    }

    const chunks = [];
    let settleTimer;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(settleTimer);
      clearTimeout(maxTimer);
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
    };
    proc.onData((data) => {
      chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'));
      clearTimeout(settleTimer);
      settleTimer = setTimeout(finish, SETTLE_MS);
    });
    const maxTimer = setTimeout(finish, MAX_CAPTURE_MS);
    proc.onExit(() => {
      clearTimeout(settleTimer);
      clearTimeout(maxTimer);
      resolve(Buffer.concat(chunks));
    });
  });
}

async function main() {
  if (!existsSync(BIN)) {
    console.error(`✖ ${BIN} not found — run \`pnpm build\` first.`);
    process.exit(1);
  }
  mkdirSync(GOLDEN_DIR, { recursive: true });

  let failures = 0;
  for (const { slug, args } of COMMANDS) {
    const goldenFile = path.join(GOLDEN_DIR, `${slug}.ans`);
    const label = `wizard ${args.join(' ') || '(default)'}`;

    let captured;
    try {
      captured = await capture(args);
    } catch (err) {
      console.error(`✖ ${slug} (${label}): capture failed — ${err.message}`);
      failures++;
      continue;
    }
    if (captured.length === 0) {
      console.error(`✖ ${slug} (${label}): empty capture — the screen rendered nothing`);
      failures++;
      continue;
    }

    if (UPDATE) {
      writeFileSync(goldenFile, captured);
      console.log(`updated  ${slug}  (${captured.length} bytes)`);
      continue;
    }
    if (!existsSync(goldenFile)) {
      console.error(`✖ ${slug} (${label}): no golden yet — run with --update to seed it.`);
      failures++;
      continue;
    }
    if (captured.equals(readFileSync(goldenFile))) {
      console.log(`ok       ${slug}`);
    } else {
      console.error(`✖ ${slug} (${label}): bytes differ from golden`);
      failures++;
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} screenshot check(s) failed`);
    process.exit(1);
  }
  console.log(`\nAll ${COMMANDS.length} screenshot checks passed`);
}

main();
