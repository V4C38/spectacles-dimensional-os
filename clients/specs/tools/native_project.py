"""Prepare the same disposable native harness for compilation and Preview."""
from pathlib import Path
import shutil

from integration_catalog import write_lens_catalog


def prepare_harness(destination: Path, harness: Path) -> None:
    review_dir = destination / "Assets" / "Review"
    review_dir.mkdir(exist_ok=True)
    # The harness owns no domain code. Rebase its production imports to the
    # location in the disposable Lens, keeping Vitest outside Assets.
    code = harness.read_text(encoding="utf-8")
    code = code.replace("../../Assets/Scripts/", "../Scripts/")
    (review_dir / "ReviewScenario.ts").write_text(code, encoding="utf-8")
    write_lens_catalog(review_dir)
    for helper in harness.parent.glob("Integration*.ts"):
        if helper != harness and helper.name != "IntegrationScenario.ts" and not helper.name.endswith("Probe.ts"):
            shutil.copy2(helper, review_dir / helper.name)
    for name in ("CameraFixture.png", "CameraFixture.png.meta"):
        fixture = harness.with_name(name)
        if fixture.is_file():
            shutil.copy2(fixture, review_dir / name)
