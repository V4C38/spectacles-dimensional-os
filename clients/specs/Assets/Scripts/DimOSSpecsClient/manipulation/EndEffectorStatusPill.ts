import { EndEffectorStatus, END_EFFECTOR_STATUS_STYLE, type EndEffectorStatusInput } from "DimOSARClient.lspkg/Scripts/DimOSARClient/manipulation/EndEffectorStatus";
import { ViewerNotificationPresenter } from "../presentation/ViewerNotificationPresenter";

export class EndEffectorStatusPill {
  private readonly status = new EndEffectorStatus();
  private readonly presenter: ViewerNotificationPresenter;

  constructor(parent: SceneObject) {
    this.presenter = new ViewerNotificationPresenter(parent, {
      ...END_EFFECTOR_STATUS_STYLE, fontSize: 1.36 * 32 / 0.69492703,
    }, parent);
  }

  apply(input: EndEffectorStatusInput, anchor: SceneObject, camera: SceneObject, now: number): void {
    const sample = this.status.sample(input, now);
    this.presenter.draw(sample.notification, sample.elapsedS, sample.opacity, {
      plateAlpha: 0.94, warningColor: [1, 0.65, 0], neutralColor: [1, 1, 1],
    });
    if (!sample.notification) return;
    const rotation = camera.getTransform().getWorldRotation();
    const transform = this.presenter.root.getTransform();
    transform.setWorldPosition(anchor.getTransform().getWorldPosition().add(rotation.multiplyVec3(
      new vec3(END_EFFECTOR_STATUS_STYLE.rightM * 100, END_EFFECTOR_STATUS_STYLE.upM * 100, 0))));
    transform.setWorldRotation(rotation);
    transform.setLocalScale(vec3.one().uniformScale(sample.scale));
  }
}
