import { consoleLog } from '@shared/console-log';
import { readApiKeyFromEnv } from '@utils/env-api-key';
import { DOCTOR, runDoctorReport, Tool } from '@tools';
import { exitWith, tuiSessionArgs, withSignals } from '@cli/runners';
import { skillProgramOptions } from './skill-program-options';
import type { Command } from './command';

export const doctorCommand: Command = {
  name: 'doctor',
  description: DOCTOR.description,
  options: { ...skillProgramOptions },
  handler: (argv) => {
    const options = { ...argv } as Record<string, unknown>;
    // In CI there is no screen: fetch the project's health issues and print them.
    if (options.ci) {
      exitWith(() =>
        runDoctorReport(
          {
            apiKey:
              (options.apiKey as string | undefined) ??
              readApiKeyFromEnv() ??
              undefined,
            projectId: options.projectId
              ? Number(options.projectId as string)
              : undefined,
            baseUrl: options.baseUrl as string | undefined,
          },
          { log: consoleLog },
        ),
      );
      return;
    }
    withSignals(async (signal) => {
      // Loaded here, not at startup: a console run never loads the TUI.
      const { runTuiTool } = await import('@tui');
      return runTuiTool(Tool.PosthogDoctor, {
        session: tuiSessionArgs(options),
        signal,
      });
    });
  },
};
