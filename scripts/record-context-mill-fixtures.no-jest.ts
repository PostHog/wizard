/**
 * Records a context-mill release as the fixtures the behavior checks compare
 * against: the skill menu, the agent menu and every agent prompt it lists.
 * Run with `pnpm record:context-mill-fixtures [base-url]`; commit the result on
 * its own, with the reason, since a changed fixture changes what "unchanged" means.
 */

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

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT_DIR, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'skill-menu.json'), skillMenu);
  fs.writeFileSync(path.join(OUT_DIR, 'agent-menu.json'), agentMenuText);

  for (const entry of agentMenu.agents) {
    const flow = entry.flow ?? 'unscoped';
    const dir = path.join(OUT_DIR, 'agents', flow);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${entry.id}.md`),
      await fetchText(entry.downloadUrl),
    );
  }

  const version = (JSON.parse(skillMenu) as { buildVersion?: string })
    .buildVersion;
  console.log(
    `Recorded context-mill ${version ?? 'unknown version'}: ${
      agentMenu.agents.length
    } agent prompts into ${path.relative(process.cwd(), OUT_DIR)}`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
