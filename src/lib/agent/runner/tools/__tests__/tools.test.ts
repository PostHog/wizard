import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  readTool,
  writeTool,
  editTool,
  globTool,
  grepTool,
} from '../filesystem';
import { bashTool } from '../bash';
import {
  taskCreateTool,
  taskUpdateTool,
  taskGetTool,
  taskListTool,
} from '../tasks';
import { listMcpResourcesTool } from '../list-mcp-resources';
import {
  BUILTIN_TOOLS,
  toAnthropicTools,
  createToolDispatcher,
} from '../registry';
import type { ToolContext } from '../types';

let dir: string;
let ctx: ToolContext;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-tools-'));
  ctx = { workingDirectory: dir, tasks: new Map() };
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('Read', () => {
  it('returns 1-indexed line-numbered content', async () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo');
    const res = await readTool.handler({ file_path: 'a.txt' }, ctx);
    expect(res.isError).toBeFalsy();
    expect(res.content).toBe('     1\tone\n     2\ttwo');
  });
  it('honors offset and limit', async () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'l1\nl2\nl3\nl4');
    const res = await readTool.handler(
      { file_path: 'a.txt', offset: 2, limit: 2 },
      ctx,
    );
    expect(res.content).toBe('     2\tl2\n     3\tl3');
  });
  it('errors on a missing file', async () => {
    const res = await readTool.handler({ file_path: 'nope.txt' }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/File not found/);
  });
});

describe('Write', () => {
  it('writes a file and creates parent dirs', async () => {
    const res = await writeTool.handler(
      { file_path: 'nested/deep/x.txt', content: 'hello' },
      ctx,
    );
    expect(res.isError).toBeFalsy();
    expect(fs.readFileSync(path.join(dir, 'nested/deep/x.txt'), 'utf-8')).toBe(
      'hello',
    );
  });
});

describe('Edit', () => {
  beforeEach(() => fs.writeFileSync(path.join(dir, 'e.txt'), 'foo bar foo'));
  it('replaces a unique occurrence', async () => {
    fs.writeFileSync(path.join(dir, 'e.txt'), 'alpha beta');
    const res = await editTool.handler(
      { file_path: 'e.txt', old_string: 'beta', new_string: 'gamma' },
      ctx,
    );
    expect(res.isError).toBeFalsy();
    expect(fs.readFileSync(path.join(dir, 'e.txt'), 'utf-8')).toBe(
      'alpha gamma',
    );
  });
  it('errors when old_string is absent', async () => {
    const res = await editTool.handler(
      { file_path: 'e.txt', old_string: 'zzz', new_string: 'x' },
      ctx,
    );
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/not found/);
  });
  it('errors on a non-unique match without replace_all', async () => {
    const res = await editTool.handler(
      { file_path: 'e.txt', old_string: 'foo', new_string: 'x' },
      ctx,
    );
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/not unique/);
  });
  it('replaces all when replace_all is set', async () => {
    const res = await editTool.handler(
      {
        file_path: 'e.txt',
        old_string: 'foo',
        new_string: 'x',
        replace_all: true,
      },
      ctx,
    );
    expect(res.isError).toBeFalsy();
    expect(fs.readFileSync(path.join(dir, 'e.txt'), 'utf-8')).toBe('x bar x');
  });
});

describe('Glob', () => {
  it('finds matching files', async () => {
    fs.writeFileSync(path.join(dir, 'a.ts'), '');
    fs.writeFileSync(path.join(dir, 'b.js'), '');
    const res = await globTool.handler({ pattern: '*.ts' }, ctx);
    expect(res.content).toContain('a.ts');
    expect(res.content).not.toContain('b.js');
  });
  it('reports when nothing matches', async () => {
    const res = await globTool.handler({ pattern: '*.xyz' }, ctx);
    expect(res.content).toBe('No files found');
  });
});

describe('Grep', () => {
  beforeEach(() => {
    fs.writeFileSync(path.join(dir, 'one.ts'), 'const needle = 1;');
    fs.writeFileSync(path.join(dir, 'two.ts'), 'nothing here');
  });
  it('lists files with matches by default', async () => {
    const res = await grepTool.handler({ pattern: 'needle' }, ctx);
    expect(res.content).toContain('one.ts');
    expect(res.content).not.toContain('two.ts');
  });
  it('returns matching lines in content mode', async () => {
    const res = await grepTool.handler(
      { pattern: 'needle', output_mode: 'content' },
      ctx,
    );
    expect(res.content).toMatch(/one\.ts:1:const needle/);
  });
  it('errors on an invalid regex', async () => {
    const res = await grepTool.handler({ pattern: '(' }, ctx);
    expect(res.isError).toBe(true);
  });
});

describe('Bash', () => {
  it('captures stdout', async () => {
    const res = await bashTool.handler({ command: 'echo hi' }, ctx);
    expect(res.isError).toBeFalsy();
    expect(res.content).toBe('hi');
  });
  it('runs in the working directory', async () => {
    fs.writeFileSync(path.join(dir, 'marker.txt'), '');
    const res = await bashTool.handler({ command: 'ls' }, ctx);
    expect(res.content).toContain('marker.txt');
  });
  it('flags a non-zero exit as an error', async () => {
    const res = await bashTool.handler({ command: 'exit 3' }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/exited with code 3/);
  });
});

describe('Task tools', () => {
  it('creates, gets, updates, and lists tasks', async () => {
    const created = await taskCreateTool.handler(
      { content: 'do a thing' },
      ctx,
    );
    expect(created.content).toBe('Created task-1');

    const got = await taskGetTool.handler({ taskId: 'task-1' }, ctx);
    expect(got.content).toContain('do a thing');
    expect(got.content).toContain('pending');

    const updated = await taskUpdateTool.handler(
      { taskId: 'task-1', status: 'completed' },
      ctx,
    );
    expect(updated.isError).toBeFalsy();
    expect(ctx.tasks.get('task-1')?.status).toBe('completed');

    const list = await taskListTool.handler({}, ctx);
    expect(list.content).toContain('task-1');
  });
  it('errors updating a missing task', async () => {
    const res = await taskUpdateTool.handler(
      { taskId: 'ghost', status: 'completed' },
      ctx,
    );
    expect(res.isError).toBe(true);
  });
});

describe('ListMcpResourcesTool', () => {
  it('returns an empty list (stub until PR 04)', async () => {
    const res = await listMcpResourcesTool.handler({}, ctx);
    expect(res.content).toBe('[]');
  });
});

describe('registry', () => {
  it('advertises every tool with a name, description, and schema', () => {
    const specs = toAnthropicTools();
    expect(specs).toHaveLength(BUILTIN_TOOLS.length);
    for (const spec of specs) {
      expect(spec.name).toBeTruthy();
      expect(spec.description).toBeTruthy();
      expect(spec.input_schema).toMatchObject({ type: 'object' });
    }
  });

  it('routes a tool_use block to its handler', async () => {
    const dispatcher = createToolDispatcher(ctx);
    fs.writeFileSync(path.join(dir, 'r.txt'), 'data');
    const res = await dispatcher.dispatch({
      type: 'tool_use',
      id: 't1',
      name: 'Read',
      input: { file_path: 'r.txt' },
    });
    expect(res.isError).toBeFalsy();
    expect(String(res.content)).toContain('data');
  });

  it('returns an error result for an unknown tool', async () => {
    const dispatcher = createToolDispatcher(ctx);
    const res = await dispatcher.dispatch({
      type: 'tool_use',
      id: 't2',
      name: 'Nonexistent',
      input: {},
    });
    expect(res.isError).toBe(true);
    expect(String(res.content)).toMatch(/Unknown tool/);
  });
});
