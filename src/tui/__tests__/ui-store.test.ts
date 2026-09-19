import { WizardStore } from '@store/state/store';
import { UiStore } from '../ui-store.js';
import { Overlay } from '../router.js';
import { flowFor } from '@store/programs/flow-for';
import { Program } from '@store/programs/program-registry';

vi.mock('@store/shared/analytics', () => ({
  analytics: {
    capture: vi.fn(),
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  },
  sessionProperties: vi.fn(() => ({})),
}));

function pair() {
  const store = new WizardStore(flowFor(Program.PostHogIntegration).flow);
  return { store, ui: new UiStore(store) };
}

describe('UiStore', () => {
  describe('lastNavDirection', () => {
    it('starts as null', () => {
      expect(pair().ui.lastNavDirection).toBeNull();
    });

    it('is push after emitChange, push after an interrupt opens, pop after it closes', () => {
      const { store, ui } = pair();
      store.emitChange();
      expect(ui.lastNavDirection).toBe('push');
      store.pushInterrupt(Overlay.AuthError);
      expect(ui.lastNavDirection).toBe('push');
      store.popInterrupt();
      expect(ui.lastNavDirection).toBe('pop');
      store.emitChange();
      expect(ui.lastNavDirection).toBe('push');
    });
  });

  describe('status bar', () => {
    it('toggles and sets, and a same-value set notifies nothing', () => {
      const { ui } = pair();
      const versions: number[] = [];
      ui.subscribe(() => versions.push(ui.getSnapshot()));
      ui.toggleStatusExpanded();
      expect(ui.statusExpanded).toBe(true);
      ui.setStatusExpanded(true);
      expect(versions).toHaveLength(1);
      ui.setStatusExpanded(false);
      expect(ui.statusExpanded).toBe(false);
      expect(versions).toHaveLength(2);
    });
  });

  describe('token HUD', () => {
    it('is visible by default under vitest (IS_DEV) and toggles each call', () => {
      const { ui } = pair();
      expect(ui.tokenHudVisible).toBe(true);
      ui.toggleTokenHud();
      expect(ui.tokenHudVisible).toBe(false);
      ui.toggleTokenHud();
      expect(ui.tokenHudVisible).toBe(true);
    });
  });

  describe('learn card', () => {
    it('tracks the block index silently and completion with a notification', () => {
      const { ui } = pair();
      const versions: number[] = [];
      ui.subscribe(() => versions.push(ui.getSnapshot()));
      ui.setLearnCardBlockIdx(3);
      expect(ui.learnCardBlockIdx).toBe(3);
      expect(versions).toHaveLength(0);
      ui.setLearnCardComplete();
      expect(ui.learnCardComplete).toBe(true);
      expect(versions).toHaveLength(1);
    });
  });

  it('re-emits every store commit and mirrors the active screen', () => {
    const { store, ui } = pair();
    const versions: number[] = [];
    ui.subscribe(() => versions.push(ui.getSnapshot()));
    store.completeSetup();
    expect(versions).toHaveLength(1);
    expect(ui.activeScreen).toBe(store.currentScreen);
  });
});
