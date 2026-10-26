export interface NavigationTargetHit {
  interactable: { getSceneObject(): SceneObject };
}

export interface NavigationTargetSelector<T extends NavigationTargetHit> {
  getNearestDeeplyNestedInteractable(hits: T[]): T | null;
}

/** SIK 0.17.2 has no per-interactable ray priority. Delegate to its own chooser,
 * ignoring the robot box only when the next eligible winner is our navigation marker.
 * This changes the real SIK target (cursor, hover and drag), without shared collider toggles. */
export class SpecsNavigationTargetPriority<T extends NavigationTargetHit> {
  private readonly previous: (hits: T[]) => T | null;
  private readonly choose: (hits: T[]) => T | null;
  private disposed = false;

  constructor(private readonly selector: NavigationTargetSelector<T>, private readonly ownsRobot: (object: SceneObject) => boolean,
    private readonly ownsMarker: (object: SceneObject) => boolean) {
    this.previous = selector.getNearestDeeplyNestedInteractable;
    this.choose = hits => {
      const nearest = this.previous.call(selector, hits);
      if (this.disposed || !nearest || !this.ownsRobot(nearest.interactable.getSceneObject())) return nearest;
      const withoutRobot = hits.filter(hit => !this.ownsRobot(hit.interactable.getSceneObject()));
      const candidate = this.previous.call(selector, withoutRobot);
      return candidate && this.ownsMarker(candidate.interactable.getSceneObject()) ? candidate : nearest;
    };
    selector.getNearestDeeplyNestedInteractable = this.choose;
  }

  dispose(): void {
    this.disposed = true;
    if (this.selector.getNearestDeeplyNestedInteractable === this.choose)
      this.selector.getNearestDeeplyNestedInteractable = this.previous;
  }
}
