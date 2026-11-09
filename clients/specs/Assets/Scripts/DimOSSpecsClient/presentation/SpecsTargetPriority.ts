export interface TargetHit {
  interactable: { getSceneObject(): SceneObject };
}

export interface TargetSelector<T extends TargetHit> {
  getNearestDeeplyNestedInteractable(hits: T[]): T | null;
}

type TargetPolicy = {
  ownsOccluder(object: SceneObject): boolean;
  ownsTarget(object: SceneObject): boolean;
};

/** One hook owns our SIK priority policies without changing unrelated occlusion. */
export class SpecsTargetPriority<T extends TargetHit> {
  private readonly previous: (hits: T[]) => T | null;
  private readonly choose: (hits: T[]) => T | null;
  private readonly policies: TargetPolicy[] = [];
  private disposed = false;

  constructor(private readonly selector: TargetSelector<T>) {
    this.previous = selector.getNearestDeeplyNestedInteractable;
    this.choose = hits => this.select(hits, this.policies.length);
    selector.getNearestDeeplyNestedInteractable = this.choose;
  }

  addPolicy(ownsOccluder: TargetPolicy["ownsOccluder"], ownsTarget: TargetPolicy["ownsTarget"]): () => void {
    if (this.disposed) throw new Error("Target priority is disposed");
    const policy = { ownsOccluder, ownsTarget };
    this.policies.push(policy);
    return () => {
      const index = this.policies.indexOf(policy);
      if (index >= 0) this.policies.splice(index, 1);
    };
  }

  private select(hits: T[], count: number): T | null {
    if (this.disposed || count === 0) return this.previous.call(this.selector, hits);
    const policy = this.policies[count - 1];
    const nearest = this.select(hits, count - 1);
    if (!nearest || !policy.ownsOccluder(nearest.interactable.getSceneObject())) return nearest;
    const candidate = this.select(hits.filter(hit => !policy.ownsOccluder(hit.interactable.getSceneObject())), count - 1);
    return candidate && policy.ownsTarget(candidate.interactable.getSceneObject()) ? candidate : nearest;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.policies.length = 0;
    if (this.selector.getNearestDeeplyNestedInteractable === this.choose)
      this.selector.getNearestDeeplyNestedInteractable = this.previous;
  }
}
