#!/usr/bin/env node
/**
 * ANSI "screenshot" tests for the wizard CLI command surface.
 *
 * For each command below, this launches the REAL built binary in a
 * pseudo-terminal (Ink won't render without a TTY) using the system `script`
 * command, captures the raw ANSI output, and compares it to a committed golden
 * dump under `scripts/__screenshots__/`. It catches regressions in the
 * command → intro-screen wiring: a command falling through to the default
 * flow, an intro screen not rendering, or the wrong screen showing.
 *
 * The goldens are the "jank screenshots" — raw ANSI bytes, so they capture
 * colour + layout, not just stripped text.
 *
 * A live TUI animates (spinners, cursor moves), so a byte-exact compare would
 * flake. `normalize()` strips the volatile escape sequences before comparing
 * (it keeps SGR colour codes so the screenshot still shows styling). Tune it if
 * a screen still flakes.
 *
 * Usage:
 *   pnpm build && node scripts/cli-screenshots.mjs            # check vs goldens
 *   pnpm build && node scripts/cli-screenshots.mjs --update   # (re)capture goldens
 *
 * NOTE: a pseudo-terminal is required, so goldens must be seeded once with
 * `--update` in a real terminal or CI runner — they are not generated in
 * environments without a TTY.
 */

import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const BIN = path.join(REPO, 'dist', 'bin.js');
const GOLDEN_DIR = path.join(HERE, '__screenshots__');

/** How long to let a screen render before killing it (intro screens wait for input). */
const CAPTURE_MS = 4000;

/**
 * Commands to snapshot. `slug` is the golden filename; `args` is the wizard
 * argv. Keep this in sync with the command surface (`bin.ts` + the audit
 * family). `unknown-command` is a negative case — it must error, not run a flow.
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

/** Build the platform-specific `script` invocation that runs the wizard in a pty. */
function scriptInvocation(outFile, args) {
  const inner = ['node', BIN, ...args, '--no-telemetry'];
  if (process.platform === 'darwin') {
    // BSD script: `script -q <file> <command...>`
    return ['-q', outFile, ...inner];
  }
  // util-linux: `script -q -e -c "<command>" <file>`
  const command = inner.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ');
  return ['-q', '-e', '-c', command, outFile];
}

/** Run one command in a pty, kill it after CAPTURE_MS, return the captured bytes. */
function capture(args) {
  return new Promise((resolve, reject) => {
    const outFile = path.join(
      tmpdir(),
      `wizard-shot-${process.pid}-${Math.random().toString(36).slice(2)}.ans`,
    );
    const child = spawn('script', scriptInvocation(outFile, args), {
      stdio: 'ignore',
    });
    const timer = setTimeout(() => child.kill('SIGTERM'), CAPTURE_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const buf = existsSync(outFile) ? readFileSync(outFile) : Buffer.alloc(0);
        rmSync(outFile, { force: true });
        resolve(buf);
      } catch (err) {
        reject(err);
      }
    });
  });
}

/** Strip volatile terminal noise so comparisons don't flake on animation/timing. */
function normalize(buf) {
  return (
    buf
      .toString('utf8')
      // `script` wrapper lines
      .replace(/^Script (started|done).*$/gm, '')
      // cursor moves / clear-line / clear-screen — i.e. how spinners repaint.
      // Keep SGR (`\x1b[...m`) so the screenshot still carries colour.
      .replace(/\x1b\[[0-9;]*[ABCDEFGHJKnsu]/g, '')
      .replace(/\r/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
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
      // No output means no pty (e.g. `script` couldn't allocate one) — fail
      // loudly rather than write/compare an empty golden.
      console.error(
        `✖ ${slug} (${label}): empty capture — needs a real terminal/CI (is \`script\` available?)`,
      );
      failures++;
      continue;
    }

    if (UPDATE) {
      writeFileSync(goldenFile, captured);
      console.log(`updated  ${slug}`);
      continue;
    }
    if (!existsSync(goldenFile)) {
      console.error(`✖ ${slug} (${label}): no golden yet — run with --update to seed it.`);
      failures++;
      continue;
    }
    if (normalize(captured) === normalize(readFileSync(goldenFile))) {
      console.log(`ok       ${slug}`);
    } else {
      console.error(`✖ ${slug} (${label}): output changed vs golden`);
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
