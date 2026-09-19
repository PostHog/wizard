/**
 * The controlled TUI surface: the real screens in a PTY, driven over the
 * socket exactly as the snapshot route and the MCP proxy drive them. Stops
 * before auth, so no credentials and no agent run.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ControlClient } from '@store/control';
import { Program } from '@store/programs';
import { buildLaunch, waitForSocket } from '@e2e-harness/launch';
import { captureTui, type TuiCapture } from '@e2e-harness/tui-capture';

const REPO = path.resolve(__dirname, '../..');
let cap: TuiCapture | null = null;
let dir: string | null = null;

afterEach(() => {
  cap?.kill();
  cap = null;
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe.skipIf(process.env.WIZARD_PTY_TESTS === '0')(
  'controlled TUI surface',
  () => {
    it('renders the intro, commits over the socket, refuses the headless route, and exits 0', async () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wz-tui-'));
      const app = path.join(dir, 'app');
      fs.mkdirSync(app);
      const socketPath = path.join(dir, 'w.sock');
      const launch = buildLaunch(
        {
          programId: Program.PostHogIntegration,
          appDir: app,
          socketPath,
          projectId: '1',
        },
        REPO,
      );
      cap = captureTui({ ...launch, cwd: REPO });
      await waitForSocket(socketPath, 90_000);
      expect(fs.statSync(socketPath).mode & 0o777).toBe(0o600);

      const client = new ControlClient(socketPath);
      expect(await client.health()).toMatchObject({ surface: 'tui' });
      const intro = await client.state();
      expect(intro.currentScreen).toBe('intro');
      expect(intro.actions.map((a) => a.id)).toEqual(['confirm_setup']);

      let state = await client.performAction('confirm_setup');
      // The readiness probe decides the health-check screen: wait for its verdict,
      // then dismiss an outage the way a person would.
      const deadline = Date.now() + 30_000;
      while (state.currentScreen === 'health-check' && Date.now() < deadline) {
        state = await client.waitForChange(state.version, 5_000);
        if (state.currentScreen === 'health-check') {
          const next = await client.performAction('dismiss_outage');
          if (next.currentScreen !== 'health-check') state = next;
        }
      }
      expect(state.currentScreen).toBe('auth');
      expect(state.session.runRequested).toBe(false);
      await expect(client.detect()).rejects.toMatchObject({ status: 501 });

      const frameDeadline = Date.now() + 10_000;
      while (
        !cap.frame().includes('PostHog Wizard') &&
        Date.now() < frameDeadline
      ) {
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(cap.frame()).toContain('PostHog Wizard');

      await client.shutdown();
      await cap.exited;
      expect(fs.existsSync(socketPath)).toBe(false);
    }, 120_000);
  },
);
