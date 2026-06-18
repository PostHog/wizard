#!/usr/bin/env node
/**
 * "Screenshot" tests for the wizard CLI command surface.
 *
 * Per command: run the built binary in a sized pty, render the settled screen
 * through a headless emulator, and assert it contains a `marker` — the
 * program/skill id the command's source wires into the intro screen. Catches a
 * command routing to the wrong screen, the default flow, or nothing.
 *
 * Marker, not byte-for-byte golden: spinners, async fetches, and
 * project-dependent intros make whole-frame matching flake. We read the same
 * rendered screenshot, just assert the one line that proves the routing.
 *
 * Usage: pnpm build && node scripts/cli-screenshots.mjs
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pty from 'node-pty';
// CommonJS — default-import then destructure (named ESM imports fail).
import xtermHeadless from '@xterm/headless';
import addonSerialize from '@xterm/addon-serialize';

const { Terminal } = xtermHeadless;
const { SerializeAddon } = addonSerialize;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const BIN = path.join(REPO, 'dist', 'bin.js');
// Rendered screenshots for inspection / CI artifacts — gitignored, not goldens.
const SHOTS_DIR = path.join(HERE, '__screenshots__');

// Fixed geometry: capture and replay must agree, on macOS and CI alike.
const COLS = 100;
const ROWS = 40;
/** Snapshot once output has been quiet for this long (screen has painted). */
const SETTLE_MS = 1200;
/** Hard cap, in case a screen never goes quiet (e.g. a live spinner). */
const MAX_CAPTURE_MS = 12000;

/**
 * Each command and the marker its intro screen must contain. `marker` is in
 * normalized form (see normalize(): ANSI stripped, hyphens → spaces, collapsed,
 * lowercased). `src` ties the marker to wizard source, so it's a deliberate
 * "command → skill/program" assertion, not an eyeballed string.
 */
const COMMANDS = [
  // Strong: marker is the program/skill id the source wires into the intro row.
  {
    slug: 'default',
    args: [],
    marker: 'program ✔ posthog integration',
    src: "posthog-integration/index.ts id:'posthog-integration'",
  },
  {
    slug: 'audit',
    args: ['audit'],
    marker: 'program ✔ audit',
    src: "audit/index.ts id:'audit' (default leaf, context-mill #187)",
  },
  {
    slug: 'audit-events',
    args: ['audit', 'events'],
    marker: 'skill ✔ audit events',
    src: "agent-skill skillId 'audit-events' (AgentSkillIntroScreen)",
  },
  {
    slug: 'audit-all',
    args: ['audit', 'all'],
    marker: 'program ✔ audit',
    src: "audit/index.ts id:'audit'",
  },
  {
    slug: 'migrate',
    args: ['migrate'],
    marker: 'program ✔ migration',
    src: "migration/index.ts id:'migration'",
  },
  // These preflight-block in the wizard's OWN repo (no Stripe SDK / RN), so they
  // don't reach the skill-id intro. Marker proves routing, not the skill id.
  {
    slug: 'revenue-analytics',
    args: ['revenue-analytics'],
    marker: 'revenue analytics',
    src: "revenue-analytics-setup; preflight block in-repo (routing only)",
  },
  {
    slug: 'upload-source-maps',
    args: ['upload-source-maps'],
    marker: 'source map',
    src: 'error-tracking-upload-source-maps; preflight block in-repo (routing only)',
  },
  // Native / utility screens — marker is a stable, screen-specific phrase.
  {
    slug: 'doctor',
    args: ['doctor'],
    marker: 'posthog doctor',
    src: 'posthog-doctor intro title',
  },
  {
    slug: 'mcp-add',
    args: ['mcp', 'add'],
    marker: 'posthog mcp',
    src: 'McpScreen.tsx',
  },
  // Slack starts OAuth immediately, so the settled screen is the auth wait.
  // Weak: proves slack didn't fall through to the default flow, not a skill id.
  {
    slug: 'slack-add',
    args: ['slack', 'add'],
    marker: 'waiting for authentication',
    src: 'SlackConnectScreen.tsx (OAuth wait; routing smoke check)',
  },
  {
    slug: 'skill-list',
    args: ['skill', 'list'],
    marker: 'wizard audit events',
    src: 'skill catalog listing (skill.ts)',
  },
  // Negative case — a bogus command must error, not run a flow.
  {
    slug: 'unknown-command',
    args: ['asdf'],
    marker: 'unknown command',
    src: 'wizard.ts strictCommands() .fail()',
  },
];

/**
 * pnpm's extraction drops the +x bit on node-pty's prebuilt `spawn-helper`, so
 * `pty.spawn` dies with "posix_spawnp failed" on a fresh install. Re-add it.
 * No-op once node-pty fixes the packaging upstream.
 */
function ensureSpawnHelperExecutable() {
  const root = path.join(REPO, 'node_modules', 'node-pty');
  if (!existsSync(root)) return;
  // spawn-helper lives in prebuilds/<platform>/ or build/Release/.
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === 'spawn-helper') chmodSync(full, 0o755);
    }
  }
}

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
        // Force a stable colour level so the render matches across environments.
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

/**
 * Replay raw bytes into a headless emulator and serialize the screen to ANSI.
 * Spinner ticks and wait-frames collapse into the single settled frame.
 */
function renderFinalFrame(bytes) {
  return new Promise((resolve) => {
    const term = new Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true });
    const serializer = new SerializeAddon();
    term.loadAddon(serializer);
    // write() is async — serialize only once the bytes have been parsed.
    term.write(bytes, () => resolve(serializer.serialize()));
  });
}

/** Normalize a frame for marker matching: drop ANSI, hyphens → spaces, lower. */
function normalize(frame) {
  return frame
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '') // strip ANSI escapes
    .replace(/-/g, ' ') // 'audit-events' ↔ 'audit events'
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim()
    .toLowerCase();
}

async function main() {
  if (!existsSync(BIN)) {
    console.error(`✖ ${BIN} not found — run \`pnpm build\` first.`);
    process.exit(1);
  }
  mkdirSync(SHOTS_DIR, { recursive: true });
  ensureSpawnHelperExecutable();

  let failures = 0;
  for (const { slug, args, marker, src } of COMMANDS) {
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
      console.error(`✖ ${slug} (${label}): empty capture — nothing rendered`);
      failures++;
      continue;
    }

    const frame = await renderFinalFrame(captured);
    // Save the actual screenshot for inspection / CI artifacts (gitignored).
    writeFileSync(path.join(SHOTS_DIR, `${slug}.ans`), frame);

    if (normalize(frame).includes(marker)) {
      console.log(`ok       ${slug}  (found "${marker}")`);
    } else {
      console.error(
        `✖ ${slug} (${label}): expected "${marker}" [${src}] — not on screen.\n` +
          `    See scripts/__screenshots__/${slug}.ans for what rendered.`,
      );
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
