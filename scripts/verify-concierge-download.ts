/**
 * End-to-end verification for the concierge download path.
 *
 *   TOKEN=phx_xxx ID=<uuid> npx tsx scripts/verify-concierge-download.ts
 *
 * Exercises exactly what DownloadSkillScreen does:
 *   1. callMcpTool('notifications-get', { id }) against MCP
 *   2. parse `body` JSON → { skill, long_form_wizard_text }
 *   3. installSkillFromContent → writes SKILL.md to a temp install dir
 *
 * Exits non-zero with a printed reason on any failure.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callMcpTool } from '../src/utils/mcp-client';
import { installSkillFromContent } from '../src/lib/wizard-tools';

const TOKEN = process.env.TOKEN;
const ID = process.env.ID;
const MCP_URL = process.env.MCP_URL ?? 'http://localhost:8787/mcp';

if (!TOKEN || !ID) {
  console.error(
    'Usage: TOKEN=phx_xxx ID=<uuid> npx tsx scripts/verify-concierge-download.ts',
  );
  process.exit(2);
}

interface NotificationRecord {
  id: string;
  body: string;
  [k: string]: unknown;
}

interface NotificationContent {
  body?: string;
  skill?: string;
  long_form_wizard_text?: string;
  notification_style?: string;
}

console.log(`[1/3] notifications-get id=${ID} mcpUrl=${MCP_URL}`);
const record = await callMcpTool<NotificationRecord>({
  mcpUrl: MCP_URL,
  apiKey: TOKEN,
  toolName: 'notifications-get',
  arguments: { id: ID },
});

if (typeof record !== 'object' || record === null) {
  console.error('FAIL: notifications-get returned non-object:', record);
  process.exit(1);
}
if (typeof record.body !== 'string') {
  console.error('FAIL: notifications-get response has no `body` field');
  console.error('  keys:', Object.keys(record));
  process.exit(1);
}
console.log(
  `      ok — record keys: ${Object.keys(record)
    .filter((k) => k !== 'body')
    .join(', ')}, body=${record.body.length} chars`,
);

console.log('[2/3] parse body JSON');
let content: NotificationContent;
try {
  content = JSON.parse(record.body) as NotificationContent;
} catch (err) {
  console.error('FAIL: body is not valid JSON:', (err as Error).message);
  console.error('  body[0..200]:', record.body.slice(0, 200));
  process.exit(1);
}
if (!content.skill) {
  console.error('FAIL: body has no `skill` field');
  console.error('  body keys:', Object.keys(content));
  process.exit(1);
}
if (!content.long_form_wizard_text) {
  console.error('FAIL: body has no `long_form_wizard_text` field');
  process.exit(1);
}
console.log(
  `      ok — skill: ${content.skill.length} chars, letter: ${content.long_form_wizard_text.length} chars`,
);

console.log('[3/3] installSkillFromContent → temp dir');
const installDir = mkdtempSync(join(tmpdir(), 'concierge-verify-'));
const skillId = `concierge-${ID}`;
const result = installSkillFromContent(skillId, content.skill, installDir);
if (result.kind !== 'ok') {
  console.error('FAIL: installSkillFromContent returned', result);
  rmSync(installDir, { recursive: true, force: true });
  process.exit(1);
}
const expectedPath = join(installDir, '.claude', 'skills', skillId, 'SKILL.md');
const onDisk = readFileSync(expectedPath, 'utf8');
if (onDisk !== content.skill) {
  console.error(
    `FAIL: on-disk SKILL.md (${onDisk.length}b) does not match payload (${content.skill.length}b)`,
  );
  rmSync(installDir, { recursive: true, force: true });
  process.exit(1);
}
console.log(`      ok — wrote ${onDisk.length} chars to ${expectedPath}`);
rmSync(installDir, { recursive: true, force: true });

console.log('\nALL CHECKS PASSED');
console.log('  • MCP transport handshake works');
console.log('  • notifications-get returns the expected shape');
console.log('  • body parses as JSON with skill + long_form_wizard_text');
console.log('  • installSkillFromContent writes SKILL.md correctly');
