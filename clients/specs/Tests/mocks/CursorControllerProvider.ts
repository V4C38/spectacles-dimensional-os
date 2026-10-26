const cursors = new Map<unknown, unknown>();
export function setMockCursor(interactor: unknown, cursor: unknown): void { cursors.set(interactor, cursor); }
export function clearMockCursors(): void { cursors.clear(); }
export class CursorControllerProvider {
  static getInstance() { return { getCursorByInteractor: (interactor: unknown) => cursors.get(interactor) ?? null }; }
}
