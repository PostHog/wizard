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

type AgentMenu = {
  agents: { id: string; flow?: string; downloadUrl: string }[];
};

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

async function main(): Promise<void> {
  const skillMenu = await fetchText(`${BASE_URL}/skill-menu.json`);
  const agentMenuText = await fetchText(`${BASE_URL}/agent-menu.json`);
  const agentMenu = JSON.parse(agentMenuText) as AgentMenu;
  const prompts = await Promise.all(
    agentMenu.agents.map(async (entry) => ({
      file: path.join('agents', entry.flow ?? 'unscoped', `${entry.id}.md`),
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
    const file = path.join(OUT_DIR, prompt.file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, prompt.text);
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
