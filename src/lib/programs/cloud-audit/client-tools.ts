/**
 * The local "hands" a hosted audit agent operates.
 *
 * In the cloud audit the model runs server-side and has no filesystem, so the
 * agent's spec declares these as `kind: "client"` tools: the runner emits a
 * `client_tool_call` over SSE, we execute it here against the real project, and
 * POST the result back. The remote tool call blocks until we do.
 *
 * Everything here is read-only except `write_file`, which exists solely so the
 * agent can lay down the finished report in one shot.
 */
import { promises as fs } from 'fs';
import { execFile } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';

const execFileP = promisify(execFile);

/** Tool ids this client advertises to the platform on session start. */
export const CLOUD_AUDIT_CLIENT_TOOLS = [
  'grep_files',
  'read_file',
  'list_files',
  'write_file',
] as const;

/**
 * Vendored / build output is not project source. Excluding it keeps the file
 * listing relevant and small — a full `.venv` or `node_modules` walk overruns
 * the ingress body limit on its own.
 */
const EXCLUDE_DIRS = [
  'node_modules',
  '.git',
  '__pycache__',
  '.venv',
  'venv',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
];

/** Caps on what we'll hand back, so one call can't blow the request body. */
const MAX_GREP_MATCHES = 400;
const MAX_LISTED_PATHS = 2000;
const GREP_BUFFER_BYTES = 8 * 1024 * 1024;

/**
 * Resolve a model-supplied path strictly inside the project root.
 *
 * The path comes from a remote model, so it is untrusted input: this is what
 * stands between `../../.ssh/id_rsa` and a read. Compare against the resolved
 * root with a separator suffix so `/proj-evil` can't pass as `/proj`.
 *
 * The check is lexical — it does not resolve symlinks, so a symlink already
 * inside the project can still point out of it. That's a deliberate floor
 * rather than a ceiling: the local audit arm runs an agent with unrestricted
 * filesystem access, so this is strictly the more contained of the two. Tighten
 * it (realpath the target) before this is ever pointed at a repo the user
 * doesn't trust.
 */
export function resolveInWorkdir(
  workdir: string,
  p: string | undefined,
): string {
  const root = path.resolve(workdir);
  const full = path.resolve(root, p ?? '.');
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error(`path escapes the project directory: ${p}`);
  }
  return full;
}

async function grepFiles(
  workdir: string,
  args: { pattern?: string; dir?: string },
): Promise<{ matches: string[] }> {
  const dir = resolveInWorkdir(workdir, args.dir ?? '.');
  const root = path.resolve(workdir);
  try {
    const { stdout } = await execFileP(
      'grep',
      [
        '-rnE',
        ...EXCLUDE_DIRS.map((d) => `--exclude-dir=${d}`),
        String(args.pattern ?? ''),
        dir,
      ],
      { cwd: root, maxBuffer: GREP_BUFFER_BYTES },
    );
    const matches = stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => l.replace(root + path.sep, ''))
      .slice(0, MAX_GREP_MATCHES);
    return { matches };
  } catch (e) {
    // grep exits 1 with no output when there are simply no matches.
    const err = e as { code?: number | string; stdout?: string };
    if (err.code === 1 && !err.stdout) return { matches: [] };
    throw e;
  }
}

async function readFile(
  workdir: string,
  args: { path?: string },
): Promise<{ found: boolean; content?: string; error?: string }> {
  const fp = resolveInWorkdir(workdir, args.path);
  try {
    return { found: true, content: await fs.readFile(fp, 'utf8') };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return { found: false, error: `no file at ${args.path}` };
    }
    throw e;
  }
}

async function listFiles(
  workdir: string,
  args: { dir?: string },
): Promise<{ paths: string[] }> {
  const root = path.resolve(workdir);
  const baseDir = resolveInWorkdir(workdir, args.dir ?? '.');
  const out: string[] = [];

  const walk = async (d: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw e;
    }
    for (const entry of entries) {
      if (EXCLUDE_DIRS.includes(entry.name)) continue;
      const fp = path.join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(fp);
      } else {
        out.push(path.relative(root, fp));
      }
    }
  };

  await walk(baseDir);
  return { paths: out.sort().slice(0, MAX_LISTED_PATHS) };
}

async function writeFile(
  workdir: string,
  args: { path?: string; content?: string },
): Promise<{ ok: true; path: string | undefined }> {
  const fp = resolveInWorkdir(workdir, args.path);
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.writeFile(fp, String(args.content ?? ''), 'utf8');
  return { ok: true, path: args.path };
}

/**
 * Execute one client tool call against the project on disk. Throws on unknown
 * tool ids and on any path that escapes the project root; the caller turns a
 * throw into a `client_tool_result` error so the agent can react.
 */
export async function execClientTool(
  workdir: string,
  toolId: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  switch (toolId) {
    case 'grep_files':
      return grepFiles(workdir, args as { pattern?: string; dir?: string });
    case 'read_file':
      return readFile(workdir, args as { path?: string });
    case 'list_files':
      return listFiles(workdir, args as { dir?: string });
    case 'write_file':
      return writeFile(workdir, args as { path?: string; content?: string });
    default:
      throw new Error(`unknown client tool: ${toolId}`);
  }
}
