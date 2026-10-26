let interactors: unknown[] = [];
export function setMockInteractors(value: unknown[]): void { interactors = value; }
export class InteractionManager {
  static getInstance() { return { getInteractorsByType: () => interactors }; }
}
