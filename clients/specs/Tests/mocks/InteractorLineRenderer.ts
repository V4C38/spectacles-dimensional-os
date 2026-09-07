export enum VisualStyle {
  Full = 0,
  FadedStart = 1,
  FadedEnd = 2,
}

export default class InteractorLineRenderer {
  public points: unknown[] = [];
  public startColor: unknown = null;
  public endColor: unknown = null;
  public visualStyle: VisualStyle = VisualStyle.Full;
  private readonly _sceneObject = {
    setParent: (_parent: unknown) => {},
  };

  constructor(_options: Record<string, unknown>) {}

  public setSolidColor(_color: unknown): void {}

  public getSceneObject(): { setParent: (parent: unknown) => void } {
    return this._sceneObject;
  }
}
