/**
 * Run-scoped record of install_skill outcomes, shared by both harnesses.
 *
 * The `agent continued without skill` analytics event means: the run attempted
 * to install a skill, never got one, and proceeded best-effort without it.
 * That is a statement about tool results, so it is derived from the
 * install_skill handlers recording here — never from parsing the agent's
 * prose, which literal models pollute by echoing prompt instructions.
 *
 * A dependency-free leaf module so the wizard-tools MCP server, pi's custom
 * tools, and both run loops can all import it without cycles.
 */

export interface SkillInstallTracker {
  /** An install_skill call succeeded — the run has a skill. */
  recordSuccess(): void;
  /** An install_skill call failed; `detail` is "<skillId>: <reason>". */
  recordFailure(detail: string): void;
  /**
   * The joined failure details when the run tried to install a skill and
   * never succeeded — or undefined when a skill installed (even after
   * earlier failures) or no install was ever attempted.
   */
  continuedWithoutSkill(): string | undefined;
}

export function createSkillInstallTracker(): SkillInstallTracker {
  const failures: string[] = [];
  let succeeded = false;
  return {
    recordSuccess() {
      succeeded = true;
    },
    recordFailure(detail: string) {
      failures.push(detail);
    },
    continuedWithoutSkill() {
      if (succeeded || failures.length === 0) return undefined;
      return failures.join('; ');
    },
  };
}
