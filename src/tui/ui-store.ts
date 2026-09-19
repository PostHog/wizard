/**
 * UiStore — presentation state the TUI keeps beside the FlowStore: status
 * bar expansion, learn card progress, the token HUD toggle, and the direction
 * hint for screen transitions. It watches the store and re-emits every store
 * commit, so React subscribes here once for both.
 */

import { atom } from 'nanostores';
import { IS_DEV } from '@env';
import type { FlowStore } from '@store/types';

export class UiStore {
  private $version = atom(0);
  private $statusExpanded = atom(false);
  private $learnCardBlockIdx = atom(0);
  private $learnCardComplete = atom(false);
  // Defaults on for local/dev/test runs so contributors see the HUD without
  // knowing the shortcut; off for the published build. Ctrl+T toggles either way.
  private $tokenHudVisible = atom(IS_DEV);
  private _lastDirection: 'push' | 'pop' | null = null;
  private _lastDepth: number;

  constructor(readonly store: FlowStore) {
    this._lastDepth = store.interruptDepth;
    store.subscribe(() => this._onStoreChange());
  }

  /** A dismissed interrupt animates back; every other commit animates forward. */
  private _onStoreChange(): void {
    const depth = this.store.interruptDepth;
    this._lastDirection = depth < this._lastDepth ? 'pop' : 'push';
    this._lastDepth = depth;
    this._bump();
  }

  private _bump(): void {
    this.$version.set(this.$version.get() + 1);
  }

  get activeScreen(): string {
    return this.store.currentScreen;
  }

  /** Direction hint for screen transitions. */
  get lastNavDirection(): 'push' | 'pop' | null {
    return this._lastDirection;
  }

  get statusExpanded(): boolean {
    return this.$statusExpanded.get();
  }

  toggleStatusExpanded(): void {
    this.$statusExpanded.set(!this.$statusExpanded.get());
    this._bump();
  }

  setStatusExpanded(expanded: boolean): void {
    if (this.$statusExpanded.get() !== expanded) {
      this.$statusExpanded.set(expanded);
      this._bump();
    }
  }

  get tokenHudVisible(): boolean {
    return this.$tokenHudVisible.get();
  }

  /** Hidden Ctrl+T shortcut — see ScreenContainer. Never a keyboard hint. */
  toggleTokenHud(): void {
    this.$tokenHudVisible.set(!this.$tokenHudVisible.get());
    this._bump();
  }

  get learnCardBlockIdx(): number {
    return this.$learnCardBlockIdx.get();
  }

  setLearnCardBlockIdx(idx: number): void {
    this.$learnCardBlockIdx.set(idx);
  }

  get learnCardComplete(): boolean {
    return this.$learnCardComplete.get();
  }

  setLearnCardComplete(): void {
    this.$learnCardComplete.set(true);
    this._bump();
  }

  subscribe(callback: () => void): () => void {
    return this.$version.listen(() => callback());
  }

  getSnapshot(): number {
    return this.$version.get();
  }
}
