import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export type CodingAgent = 'claude' | 'codex';
const quote = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`;
const batchQuote = (value: string): string => `"${value.replace(/%/g, '%%')}"`;

async function executable(name: string): Promise<string> {
  const extensions =
    process.platform === 'win32' ? ['.exe', '.cmd', '.bat'] : [''];
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!path.isAbsolute(directory)) continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, name + extension);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        continue;
      }
    }
  }
  throw new Error(
    `${
      name === 'claude' ? 'Claude Code' : name === 'codex' ? 'Codex' : name
    } is not installed or could not be found.`,
  );
}

function launch(
  command: string,
  args: string[],
  cwd: string,
  verbatim = false,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'ignore',
      detached: true,
      shell: false,
      windowsVerbatimArguments: verbatim,
    });
    const timer = setTimeout(() => {
      child.unref();
      resolve();
    }, 500);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error('Could not open a terminal for your agent.'));
    });
  });
}

export async function openCodingAgent(
  agent: CodingAgent,
  directory: string,
  spellbookPath: string,
): Promise<void> {
  const cwd = path.resolve(directory);
  const command = await executable(agent);
  const prompt = `Read <${path.resolve(
    spellbookPath,
  )}> and complete the task described in the Wizard's spell books. Inspect what has already been done before making changes.`;
  if (process.platform === 'linux') {
    await launch(
      await executable('x-terminal-emulator'),
      ['-e', command, prompt],
      cwd,
    );
    return;
  }
  const mac = process.platform === 'darwin';
  if (!mac && process.platform !== 'win32') {
    throw new Error(
      'Opening an agent is not supported on this system. Use the saved skill path to continue.',
    );
  }
  const folder = await mkdtemp(path.join(tmpdir(), 'wizard-handoff-'));
  const script = path.join(
    folder,
    mac ? 'open-agent.command' : 'open-agent.cmd',
  );
  try {
    const lines = mac
      ? [
          '#!/bin/sh',
          `rm -f ${quote(script)}`,
          `rmdir ${quote(folder)}`,
          `export PATH=${quote(process.env.PATH ?? '')}`,
          `cd ${quote(cwd)} || exit 1`,
          `exec ${quote(command)} ${quote(prompt)}`,
        ]
      : [
          '@echo off',
          'chcp 65001 >nul',
          'setlocal DisableDelayedExpansion',
          `cd /d ${batchQuote(cwd)} || exit /b 1`,
          `del "%~f0" & rmdir ${batchQuote(folder)} & ${batchQuote(
            command,
          )} ${batchQuote(prompt)}`,
        ];
    await writeFile(script, lines.join(mac ? '\n' : '\r\n') + '\n', {
      mode: 0o700,
    });

    if (mac) {
      // The system default handler for `.command` files (Terminal unless the
      // user has changed it).
      await launch('/usr/bin/open', [script], cwd);
      return;
    }

    const shell = process.env.ComSpec ?? 'cmd.exe';
    // `start` opens the system default terminal application. /s strips the
    // outer quotes so the inner ones survive intact.
    await launch(
      shell,
      ['/d', '/s', '/c', `"start "" ${shell} /d /c "${script}""`],
      folder,
      true,
    );
  } catch (error) {
    await rm(folder, { recursive: true, force: true });
    throw error;
  }
}
