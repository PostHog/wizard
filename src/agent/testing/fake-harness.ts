import type { Harness } from '@store/types';
import type {
  AgentHarness,
  AgentResult,
  BackendRunInputs,
  TaskRunInputs,
} from '../runner/harness/types.js';

/** Records every run and task input; returns the scripted result. */
export class FakeAgentHarness implements AgentHarness {
  readonly runs: BackendRunInputs[] = [];
  readonly tasks: TaskRunInputs[] = [];

  constructor(
    readonly name: Harness,
    private readonly result: AgentResult = {},
  ) {}

  run(inputs: BackendRunInputs): Promise<AgentResult> {
    this.runs.push(inputs);
    return Promise.resolve(this.result);
  }

  runTask(inputs: TaskRunInputs): Promise<AgentResult> {
    this.tasks.push(inputs);
    return Promise.resolve(this.result);
  }
}
