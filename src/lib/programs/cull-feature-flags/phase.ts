export interface CullProgress {
  pass: 'idle' | 'edit' | 'verify' | 'disable';
  activeKey: string | null;
  activeFile: string | null;
  edited: string[];
}

export const INITIAL_CULL_PROGRESS: CullProgress = {
  pass: 'idle',
  activeKey: null,
  activeFile: null,
  edited: [],
};

export function reduceCullProgress(
  state: CullProgress,
  message: string,
): CullProgress {
  const cullingMatch = message.match(/^Culling (.+)$/);
  if (cullingMatch) {
    const edited = state.activeKey
      ? [...state.edited, state.activeKey]
      : state.edited;
    return {
      pass: 'edit',
      activeKey: cullingMatch[1],
      activeFile: null,
      edited,
    };
  }

  const editingMatch = message.match(/^Editing (.+)$/);
  if (editingMatch) {
    return { ...state, activeFile: editingMatch[1] };
  }

  if (/^Type checking \d+ files$/.test(message)) {
    const edited = state.activeKey
      ? [...state.edited, state.activeKey]
      : state.edited;
    return {
      pass: 'verify',
      activeKey: null,
      activeFile: null,
      edited,
    };
  }

  const disablingMatch = message.match(/^Disabling (.+) in PostHog$/);
  if (disablingMatch) {
    return {
      ...state,
      pass: 'disable',
      activeKey: disablingMatch[1],
      activeFile: null,
    };
  }

  return state;
}
