"""Prepare the same disposable native harness for compilation and Preview."""
import re
import shutil
from pathlib import Path

from integration_catalog import write_lens_catalog


def review_code(path: Path, entry_name: str = "IntegrationScenario") -> str:
    return (path.read_text(encoding="utf-8")
            .replace("../../Assets/Scripts/", "../Scripts/")
            .replace("../../../../tools/integration-tests/support/", "./")
            .replace(f'"./{entry_name}"', '"./ReviewScenario"')
            .replace(f"'./{entry_name}'", "'./ReviewScenario'"))


def prepare_harness(destination: Path, harness: Path) -> None:
    review_dir = destination / "Assets" / "Review"
    review_dir.mkdir(exist_ok=True)
    # The harness owns no domain code. Rebase its production imports to the
    # location in the disposable Lens, keeping Vitest outside Assets.
    # Only ship helpers reachable from this scenario. Reused review projects may
    # previously have hosted the main scheduler, whose case helpers require its
    # ReviewScenario type and cannot compile against a standalone probe.
    helpers: dict[str, Path] = {}
    pending = [harness]
    while pending:
        source = pending.pop().read_text(encoding="utf-8")
        for name in re.findall(
            r"(?:\bfrom\s*|\bimport\s*)[\"'](?:\./|\.\./\.\./\.\./\.\./tools/integration-tests/support/)(Integration\w+)[\"']", source
        ):
            if name in {harness.stem, "IntegrationCatalog"} or name in helpers:
                continue
            helper = harness.with_name(name + ".ts")
            if name == "IntegrationArmFixture" and not helper.is_file():
                helper = Path(__file__).resolve().parents[2] / "core/tests/support/IntegrationArmFixture.ts"
            if not helper.is_file():
                shared = Path(__file__).resolve().parents[3] / "tools/integration-tests/support" / (name + ".ts")
                if shared.is_file():
                    helper = shared
            helpers[name] = helper
            pending.append(helper)
    for stale in review_dir.glob("Integration*.ts"):
        if stale.stem not in helpers:
            stale.unlink()
    code = review_code(harness, harness.stem)
    (review_dir / "ReviewScenario.ts").write_text(code, encoding="utf-8")
    write_lens_catalog(review_dir)
    for helper in helpers.values():
        (review_dir / helper.name).write_text(
            review_code(helper, harness.stem), encoding="utf-8"
        )
    for name in ("CameraFixture.png", "CameraFixture.png.meta"):
        fixture = harness.with_name(name)
        if fixture.is_file():
            shutil.copy2(fixture, review_dir / name)
