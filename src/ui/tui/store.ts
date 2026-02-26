/**
 * WizardStore — EventEmitter-backed reactive store for the TUI.
 * React components subscribe via useSyncExternalStore.
 */

import { EventEmitter } from 'events';
import { TaskStatus } from '../wizard-ui.js';

export { TaskStatus };

export type WizardPhase = 'setup' | 'running' | 'done';

export type ScreenName = 'welcome' | 'status' | 'run' | 'outro' | 'mcp';

export interface OutroData {
  kind: 'success' | 'error' | 'cancel';
  message?: string;
  changes?: string[];
  nextSteps?: string[];
  docsUrl?: string;
  continueUrl?: string;
}

export interface PendingPrompt<T = unknown> {
  type: 'select' | 'confirm' | 'text' | 'multiselect' | 'groupMultiselect';
  message: string;
  options?: Array<{ value: T; label: string; hint?: string }>;
  groupOptions?: Record<
    string,
    Array<{ value: T; label: string; hint?: string }>
  >;
  initialValue?: T;
  initialValues?: T[];
  required?: boolean;
  maxItems?: number;
  placeholder?: string;
  validate?: (value: string) => string | void;
  resolve: (value: T | T[] | symbol) => void;
}

export interface CompletedPrompt {
  message: string;
  answer: string;
}

export interface TaskItem {
  label: string;
  activeForm?: string;
  status: TaskStatus;
  /** Legacy compat */
  done: boolean;
}

export interface TabDefinition {
  id: string;
  label: string;
}

export class WizardStore extends EventEmitter {
  version = '';
  phase: WizardPhase = 'setup';
  statusMessages: string[] = [];

  /** Structured intro state — rendered by the StatusTab intro view */
  detectedFramework: string | null = null;
  wizardLabel: string | null = null;
  betaNotice: string | null = null;
  preRunNotice: string | null = null;
  disclosure: string | null = null;

  /** Service status data — shown on the status screen when there's an outage */
  serviceStatus: { description: string; statusPageUrl: string } | null = null;

  /** OAuth login URL — shown on welcome screen while waiting for auth */
  loginUrl: string | null = null;

  activeTab = 0;
  pendingPrompt: PendingPrompt | null = null;
  completedPrompts: CompletedPrompt[] = [];
  tasks: TaskItem[] = [];
  showTabBar = false;
  tabs: TabDefinition[] = [];

  currentScreen: ScreenName = 'welcome';
  outroData: OutroData | null = null;
  modalPrompt: PendingPrompt | null = null;

  private _version = 0;

  getVersion(): number {
    return this._version;
  }

  private bump(): void {
    this._version++;
    this.emit('change');
  }

  setPhase(phase: WizardPhase): void {
    this.phase = phase;
    if (phase === 'running') {
      this.showTabBar = true;
    }
    this.bump();
  }

  pushStatus(message: string): void {
    this.statusMessages.push(message);
    this.bump();
  }

  setIntro(fields: {
    detectedFramework?: string;
    wizardLabel?: string;
    betaNotice?: string;
    preRunNotice?: string;
    disclosure?: string;
  }): void {
    if (fields.detectedFramework !== undefined)
      this.detectedFramework = fields.detectedFramework;
    if (fields.wizardLabel !== undefined) this.wizardLabel = fields.wizardLabel;
    if (fields.betaNotice !== undefined) this.betaNotice = fields.betaNotice;
    if (fields.preRunNotice !== undefined)
      this.preRunNotice = fields.preRunNotice;
    if (fields.disclosure !== undefined) this.disclosure = fields.disclosure;
    this.bump();
  }

  setServiceStatus(data: { description: string; statusPageUrl: string }): void {
    this.serviceStatus = data;
    this.bump();
  }

  setLoginUrl(url: string | null): void {
    this.loginUrl = url;
    this.bump();
  }

  setActiveTab(index: number): void {
    if (index >= 0 && index < this.tabs.length) {
      this.activeTab = index;
      this.bump();
    }
  }

  setPendingPrompt(prompt: PendingPrompt | null): void {
    this.pendingPrompt = prompt;
    this.bump();
  }

  addCompletedPrompt(prompt: CompletedPrompt): void {
    this.completedPrompts.push(prompt);
    this.bump();
  }

  setTasks(tasks: TaskItem[]): void {
    this.tasks = tasks;
    this.bump();
  }

  updateTask(index: number, done: boolean): void {
    if (this.tasks[index]) {
      this.tasks[index].done = done;
      this.tasks[index].status = done
        ? TaskStatus.Completed
        : TaskStatus.Pending;
      this.bump();
    }
  }

  /**
   * Sync tasks from SDK TodoWrite tool_use blocks.
   * Retains previously completed tasks that aren't in the new list
   * (the agent resets its todo list on context compaction).
   */
  syncTodos(
    todos: Array<{ content: string; status: string; activeForm?: string }>,
  ): void {
    const incoming = todos.map((t) => ({
      label: t.content,
      activeForm: t.activeForm,
      status: (t.status as TaskStatus) || TaskStatus.Pending,
      done: t.status === TaskStatus.Completed,
    }));

    const incomingLabels = new Set(incoming.map((t) => t.label));

    // Keep completed tasks from before that aren't in the new list
    const retained = this.tasks.filter(
      (t) => t.done && !incomingLabels.has(t.label),
    );

    this.tasks = [...retained, ...incoming];
    this.bump();
  }

  registerTabs(tabs: TabDefinition[]): void {
    this.tabs = tabs;
    this.bump();
  }

  setScreen(screen: ScreenName): void {
    this.currentScreen = screen;
    if (screen === 'run') {
      this.phase = 'running';
      this.showTabBar = true;
    }
    this.bump();
  }

  setOutroData(data: OutroData): void {
    this.outroData = data;
    this.bump();
  }

  setModalPrompt(prompt: PendingPrompt | null): void {
    this.modalPrompt = prompt;
    this.bump();
  }

  subscribe(callback: () => void): () => void {
    this.on('change', callback);
    return () => {
      this.off('change', callback);
    };
  }

  getSnapshot(): number {
    return this._version;
  }
}
