/** Records a context-mill release as the fixtures the behavior checks compare against; see scripts/README.md. */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const BASE_URL =
  process.argv[2] ??
  'https://github.com/PostHog/context-mill/releases/latest/download';
const OUT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'context-mill',
);

const AGENTS_DIR = path.join(OUT_DIR, 'agents');

type AgentMenuEntry = { id: string; flow?: string; downloadUrl: string };
type AgentMenu = { agents: AgentMenuEntry[] };

/** One path segment, the shape of every flow and id context-mill publishes. */
const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The file a prompt is recorded to. Throws unless its flow and id are each one segment, so a menu cannot name a file outside the fixtures. */
function promptFile(entry: AgentMenuEntry): string {
  const flow = entry.flow ?? 'unscoped';
  const segments: unknown[] = [flow, entry.id];
  if (!segments.every((s) => typeof s === 'string' && SEGMENT.test(s))) {
    throw new Error(
      `Agent menu entry ${JSON.stringify({
        flow,
        id: entry.id,
      })} is not recorded: its flow and id must each be one path segment.`,
    );
  }
  const file = path.join(AGENTS_DIR, flow, `${entry.id}.md`);
  if (!file.startsWith(AGENTS_DIR + path.sep)) {
    throw new Error(`${file} is outside ${AGENTS_DIR}`);
  }
  return file;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

async function main(): Promise<void> {
  const skillMenu = await fetchText(`${BASE_URL}/skill-menu.json`);
  const agentMenuText = await fetchText(`${BASE_URL}/agent-menu.json`);
  const agentMenu = JSON.parse(agentMenuText) as AgentMenu;
  // Every destination is checked before a prompt is fetched or a fixture is replaced.
  const targets = agentMenu.agents.map((entry) => ({
    entry,
    file: promptFile(entry),
  }));
  const prompts = await Promise.all(
    targets.map(async ({ entry, file }) => ({
      file,
      // A prompt is read beside the menu, so a base URL other than the release's works.
      text: await fetchText(
        `${BASE_URL}/${path.posix.basename(entry.downloadUrl)}`,
      ),
    })),
  );

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'skill-menu.json'), skillMenu);
  fs.writeFileSync(path.join(OUT_DIR, 'agent-menu.json'), agentMenuText);
  for (const prompt of prompts) {
    fs.mkdirSync(path.dirname(prompt.file), { recursive: true });
    fs.writeFileSync(prompt.file, prompt.text);
  }

  const version = (JSON.parse(skillMenu) as { buildVersion?: string })
    .buildVersion;
  console.log(
    `Recorded context-mill ${version ?? 'unknown version'}: ${
      prompts.length
    } agent prompts into ${path.relative(process.cwd(), OUT_DIR)}`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
