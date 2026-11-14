/** Draws each program's task graph from its agent prompts' frontmatter, as the waves the orchestrator runs; see scripts/README.md. */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const PROGRAMS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'programs',
);
/** A folder made for this run, so the page is never written to a path that already exists. */
const OUT_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-agent-dags-')),
  'wizard-agent-dags.html',
);

type Task = {
  id: string;
  label: string;
  seed: boolean;
  sink: boolean;
  runnerSeeded: boolean;
  dependsOn: string[];
  model: string;
  effort: string;
};

/** The frontmatter's scalars and inline lists, which is all a prompt declares. */
function frontmatter(text: string): Record<string, string> {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
  const fields: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const field = /^([\w-]+):\s*(.*)$/.exec(line.replace(/\s+#.*$/, ''));
    if (field) fields[field[1]] = field[2].replace(/^['"]|['"]$/g, '');
  }
  return fields;
}

const list = (value = ''): string[] =>
  value
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

/** Every program's tasks, read from its `agent/` folder. */
function loadPrograms(): Map<string, Task[]> {
  const programs = new Map<string, Task[]>();
  for (const program of fs.readdirSync(PROGRAMS_DIR).sort()) {
    const dir = path.join(PROGRAMS_DIR, program, 'agent');
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((file) => file.endsWith('.md'));
    programs.set(
      program,
      files.sort().map((file) => {
        const fields = frontmatter(
          fs.readFileSync(path.join(dir, file), 'utf8'),
        );
        const id = fields.type || file.replace(/\.md$/, '');
        return {
          id,
          label: fields.label || id,
          seed: fields.seed === 'true',
          sink: fields.sink === 'true',
          runnerSeeded: fields.runnerSeeded === 'true',
          dependsOn: list(fields.dependsOn),
          model: (fields.model_pi ?? '').replace(/^.*\//, '') || '—',
          effort: fields.effort_pi || '—',
        };
      }),
    );
  }
  return programs;
}

/** A task the wizard queues itself that names no dependency: it runs after every task but the sink. */
const runsAfterTheRest = (task: Task): boolean =>
  task.runnerSeeded && task.dependsOn.length === 0;

/** Tasks grouped by wave: one past a task's deepest dependency, then the tasks that wait for the rest, then the sink. */
function wavesOf(tasks: Task[]): Task[][] {
  const drawn = tasks.filter((task) => !task.seed);
  const byId = new Map(
    drawn.filter((task) => !task.sink).map((task) => [task.id, task]),
  );
  const depth = new Map<string, number>();
  const depthOf = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    depth.set(id, 0); // guards a cycle from recursing forever
    const deps = (byId.get(id)?.dependsOn ?? []).filter((dep) => byId.has(dep));
    const own = deps.length ? 1 + Math.max(...deps.map(depthOf)) : 0;
    depth.set(id, own);
    return own;
  };
  const waves: Task[][] = [];
  for (const task of byId.values()) {
    if (!runsAfterTheRest(task)) (waves[depthOf(task.id)] ??= []).push(task);
  }
  return [
    ...waves,
    drawn.filter((task) => !task.sink && runsAfterTheRest(task)),
    drawn.filter((task) => task.sink),
  ].filter((wave) => wave?.length);
}

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** What a task waits for, in words: the sink and a task that names nothing wait for more than they declare. */
function waitsFor(task: Task): string {
  if (task.sink) return 'last, after every other task';
  if (runsAfterTheRest(task)) return 'queued by the wizard, after the rest';
  return task.dependsOn.length ? `after ${task.dependsOn.join(', ')}` : '';
}

const card = (task: Task): string => `
        <div class="task${task.seed ? ' seed' : ''}">
          <div class="name">${escape(task.label)}</div>
          <div class="meta">${escape(task.model)} · ${escape(task.effort)}</div>
          ${
            waitsFor(task)
              ? `<div class="deps">${escape(waitsFor(task))}</div>`
              : ''
          }
        </div>`;

function sectionFor(program: string, tasks: Task[]): string {
  const seed = tasks.find((task) => task.seed);
  const waves = wavesOf(tasks);
  const rows: string[] = [];
  rows.push(
    seed
      ? `<div class="wave"><div class="label">seed — plans the graph</div>
      <div class="tasks">${card(seed)}</div></div>`
      : `<div class="note">No planner: the wizard queues this graph from the frontmatter.</div>`,
  );
  if (seed) rows.push('<div class="arrow">↓</div>');
  waves.forEach((wave, index) => {
    const label = wave.length > 1 ? `${wave.length} run in parallel` : '1 task';
    rows.push(`<div class="wave"><div class="label">${label}</div>
      <div class="tasks">${wave.map(card).join('')}</div></div>`);
    if (index < waves.length - 1) rows.push('<div class="arrow">↓</div>');
  });
  return `<section>
    <h2>${escape(program)} <span>${tasks.length} agents · ${
    waves.length
  } waves</span></h2>
    ${rows.join('\n    ')}
  </section>`;
}

function render(programs: Map<string, Task[]>): string {
  const sections = [...programs.entries()]
    .map(([program, tasks]) => sectionFor(program, tasks))
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Agent DAGs</title>
<style>
  body { font: 15px/1.5 -apple-system, system-ui, sans-serif; margin: 2rem auto; max-width: 56rem;
         color: #1d1d1f; background: #fff; }
  h1 { font-size: 1.4rem; }
  h2 { font-size: 1.1rem; border-bottom: 1px solid #e5e5e5; padding-bottom: .4rem; }
  h2 span { font-weight: 400; color: #86868b; font-size: .85rem; }
  .wave { border: 1px solid #d8d8d8; border-radius: 10px; padding: .6rem .9rem 1rem; background: #fafafa; }
  .wave > .label { font-size: .75rem; text-transform: uppercase; letter-spacing: .04em;
                   color: #86868b; margin-bottom: .6rem; }
  .note { color: #6e6e73; font-size: .85rem; margin-bottom: .6rem; }
  .tasks { display: flex; flex-wrap: wrap; gap: .75rem; }
  .task { flex: 1 1 13rem; border: 1px solid #d8d8d8; border-radius: 8px; padding: .7rem .8rem;
          background: #fff; }
  .task.seed { background: #fdf2e9; border-color: #e8a33d; }
  .task .name { font-weight: 600; }
  .task .meta { color: #6e6e73; font-size: .8rem; margin-top: .15rem; }
  .task .deps { color: #86868b; font-size: .75rem; margin-top: .3rem; }
  .arrow { text-align: center; color: #b0b0b0; font-size: 1.1rem; margin: .35rem 0; }
</style>
</head>
<body>
<h1>Agent DAGs</h1>
${sections}
</body>
</html>
`;
}

const programs = loadPrograms();
fs.writeFileSync(OUT_PATH, render(programs));
console.log(`Wrote ${programs.size} program graphs to ${OUT_PATH}`);
if (!process.env.NO_OPEN) {
  const opener =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
      ? 'explorer'
      : 'xdg-open';
  const child = spawn(opener, [OUT_PATH], { stdio: 'ignore', detached: true });
  // The page is written either way, so a missing opener only skips the open.
  child.on('error', () => undefined);
  child.unref();
}
