import * as THREE from "three";
import { Text } from "troika-three-text";
import { ROBOT_LABEL_STYLE } from "@dimos-ar-client/presentation/WorldVisualStyle";
import { UI_FONT_REGULAR, UI_FONT_SEMIBOLD, syncText } from "./UIFonts";
const TAG_WIDTH = ROBOT_LABEL_STYLE.widthM,
  TAG_PADDING = ROBOT_LABEL_STYLE.paddingM;
export class RobotMarkerLabel extends THREE.Group {
  private feedbackKey = "";
  readonly tagTitle = new Text();
  readonly tagStatus = new Text();
  readonly tagMessage = new Text();
  readonly tagDot: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  constructor() {
    super();

    this.name = "RobotMarkerLabel";
    this.tagDot = new THREE.Mesh(
      new THREE.ShapeGeometry(
        new THREE.Shape().absarc(
          0,
          0,
          ROBOT_LABEL_STYLE.dot.radiusM,
          0,
          Math.PI * 2,
          false,
        ),
        20,
      ),
      new THREE.MeshBasicMaterial({
        color: 0x8e8e93,
        transparent: true,
        depthWrite: false,
      }),
    );

    for (const [text, font, size, color] of [
      [this.tagTitle, UI_FONT_SEMIBOLD, ROBOT_LABEL_STYLE.title.emM, 0xffffff],
      [
        this.tagStatus,
        UI_FONT_REGULAR,
        ROBOT_LABEL_STYLE.activity.emM,
        0xffffff,
      ],
      [
        this.tagMessage,
        UI_FONT_REGULAR,
        ROBOT_LABEL_STYLE.detail.emM,
        0xaeaeb2,
      ],
    ] as const) {
      text.font = font;
      text.fontSize = size;
      text.color = color;
      text.anchorX = "center";
      text.anchorY = "top";
      text.maxWidth = TAG_WIDTH - TAG_PADDING * 2;
      text.position.x = 0;
      text.raycast = () => {};
    }
    this.tagTitle.position.x = ROBOT_LABEL_STYLE.title.xM;
    this.tagTitle.maxWidth = ROBOT_LABEL_STYLE.title.widthM;
    for (const [index, child] of [
      this.tagDot,
      this.tagTitle,
      this.tagStatus,
      this.tagMessage,
    ].entries()) {
      child.position.z = index === 0 ? 0 : 0.001;
      child.renderOrder = 20 + Math.min(index, 2);
      this.add(child);
    }
  }
  setFeedback(
    title: string,
    status: string,
    detail = "",
    color = 0x8e8e93,
  ): void {
    const key = [title, status, detail, color].join("\n");
    if (key === this.feedbackKey) return;
    this.feedbackKey = key;
    this.tagTitle.text = title;
    (this.tagStatus as Text & { whiteSpace: string }).whiteSpace = "nowrap";
    this.tagStatus.maxWidth = Infinity;
    this.tagStatus.text = status.replace(/\s+/g, " ").trim();
    this.tagMessage.text = detail;
    this.tagMessage.visible = detail.length > 0;
    this.tagTitle.position.y = ROBOT_LABEL_STYLE.title.yM;
    this.tagStatus.position.y = ROBOT_LABEL_STYLE.activity.yM;
    this.tagMessage.position.y = ROBOT_LABEL_STYLE.detail.yM;
    this.tagDot.position.set(-0.06, ROBOT_LABEL_STYLE.dot.yM, 0.001);
    this.tagDot.material.color.setHex(color);
    syncText(this.tagTitle, this.tagStatus, this.tagMessage);
    if (typeof Worker !== "undefined")
      this.tagTitle.sync(() => {
        const bounds = this.tagTitle.textRenderInfo?.blockBounds;
        if (!bounds) return;
        this.tagDot.position.x =
          -(bounds[2] - bounds[0] + ROBOT_LABEL_STYLE.dot.gapM) / 2 +
          ROBOT_LABEL_STYLE.dot.radiusM;
      });
  }
}
