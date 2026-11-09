function event() {
  const handlers = new Set<() => void>();
  return { add(handler: () => void) { handlers.add(handler); return () => handlers.delete(handler); },
    invoke() { for (const handler of handlers) handler(); }, get size() { return handlers.size; } };
}

// These setters deliberately mirror SUK's requirement that initialize creates its button handler.
export class Frame {
  static getTypeName(): string { return "Test.Frame"; }
  initialized = false;
  sceneObject?: { enabled: boolean };
  listenersDuringInitialize = -1;
  readonly onInitialized = event();
  readonly onTranslationStart = event();
  readonly onScalingUpdate = event();
  content!: SceneObject;
  roundedRectangle = { cornerRadius: 0, renderMeshVisual: { enabled: true } };
  autoShowHide = true;
  opacity = 1;
  isVisible = true;
  private initialHidePending = false;
  finishAnimations(): void {
    if (!this.initialHidePending) return;
    this.opacity = 0; this.isVisible = false;
    this.roundedRectangle.renderMeshVisual.enabled = false;
    this.initialHidePending = false;
  }
  innerSize = { x: 0, y: 0 };
  padding = { x: 0, y: 0 };
  border = 0;
  private close = true;
  private follow = true;
  get showCloseButton(): boolean { return this.close; }
  set showCloseButton(value: boolean) {
    if (!this.initialized) throw new Error("Frame button handler is not initialized");
    this.close = value;
  }
  get showFollowButton(): boolean { return this.follow; }
  set showFollowButton(value: boolean) {
    if (!this.initialized) throw new Error("Frame button handler is not initialized");
    this.follow = value;
  }
  initialize(): void {
    if (this.initialized) return;
    // Native Frame creates Billboard during initialize; disabled hosts defer its onAwake.
    if (this.sceneObject?.enabled === false) throw new Error("Nested Billboard has not awoken on a disabled Frame host");
    this.listenersDuringInitialize = this.onScalingUpdate.size + this.onTranslationStart.size + this.onInitialized.size;
    this.onScalingUpdate.invoke(); this.onTranslationStart.invoke(); this.onInitialized.invoke();
    this.content = global.scene.createSceneObject("content");
    this.initialHidePending = this.autoShowHide;
    this.initialized = true;
  }
  setUseFollow(_value: boolean): void {}
  setFollowing(_value: boolean): void {}
}
