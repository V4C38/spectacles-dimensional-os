"""Package freshness is determined by real archive contents, without Lens Studio."""
import asyncio
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools"))
from core_package import ARCHIVE_PREFIX, check_package, extract_sources, prepare_builder, read_package_sources


class CorePackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        self.source.mkdir()
        (self.source / "module.ts").write_text("export const value = 1;\n")
        self.package = self.root / "Core.lspkg"

    def archive(self, files=None):
        with zipfile.ZipFile(self.package, "w") as z:
            z.writestr("Package/Assets/package.native", "- !<NativePackageDescriptor/11111111-1111-1111-1111-111111111111>\n")
            z.writestr("Package/Assets/package.native.meta", "PrimaryAsset: !<reference> 11111111-1111-1111-1111-111111111111\n")
            for name, data in (files or {ARCHIVE_PREFIX + "module.ts": "export const value = 1;\n"}).items():
                z.writestr(name, data)
                if name.endswith(".ts") and name + ".meta" not in (files or {}):
                    z.writestr(name + ".meta", "PrimaryAsset: !<reference> 22222222-2222-2222-2222-222222222222\n")

    def test_exact_match_and_changed_source(self):
        self.archive()
        self.assertTrue(check_package(self.source, self.package)["passed"])
        (self.source / "module.ts").write_text("export const value = 2;\n")
        result = check_package(self.source, self.package)
        self.assertFalse(result["passed"])
        self.assertEqual(result["changed"], ["module.ts"])

    def test_added_and_removed_files(self):
        self.archive({ARCHIVE_PREFIX + "old.ts": "old"})
        result = check_package(self.source, self.package)
        self.assertEqual(result["missing"], ["module.ts"])
        self.assertEqual(result["extra"], ["old.ts"])

    def test_archive_content_cannot_hide_behind_a_stamped_hash(self):
        self.archive({ARCHIVE_PREFIX + "module.ts": "tampered"})
        self.assertFalse(check_package(self.source, self.package)["passed"])

    def test_rejects_unsafe_and_non_core_scripts(self):
        for name in ["../outside.ts", "Package/Assets/Host.ts", "/absolute.ts"]:
            with self.subTest(name=name):
                self.archive({name: "bad"})
                with self.assertRaises(ValueError):
                    read_package_sources(self.package)

    def test_rejects_missing_descriptor(self):
        with zipfile.ZipFile(self.package, "w") as z:
            z.writestr(ARCHIVE_PREFIX + "module.ts", "code")
        with self.assertRaisesRegex(ValueError, "descriptor"):
            read_package_sources(self.package)

    def test_extract_replaces_stale_modules_and_preserves_bytes(self):
        self.archive()
        target = self.root / "extracted"
        target.mkdir()
        (target / "stale.ts").write_text("stale")
        extract_sources(self.package, target)
        self.assertFalse((target / "stale.ts").exists())
        self.assertEqual((target / "module.ts").read_bytes(), (self.source / "module.ts").read_bytes())

    def test_sync_with_matching_source_does_not_open_editor(self):
        from core_package import main

        self.archive()
        args = ["core_package.py", "sync", "--source", str(self.source), "--package", str(self.package)]
        with patch.object(sys, "argv", args), patch("core_package.synchronize", new_callable=AsyncMock) as sync:
            self.assertEqual(main(), 0)
        sync.assert_not_awaited()

    def test_sync_rejects_authoring_cache_inside_repository(self):
        from core_package import REPO_ROOT, main

        with patch.object(sys, "argv", ["core_package.py", "sync", "--cache", str(REPO_ROOT / "authoring")]):
            self.assertEqual(main(), 1)
        self.assertFalse((REPO_ROOT / "authoring").exists())

    def test_rejects_malformed_descriptor(self):
        with zipfile.ZipFile(self.package, "w") as z:
            z.writestr("Package/Assets/package.native", "not a native descriptor")
        with self.assertRaisesRegex(ValueError, "Malformed"):
            read_package_sources(self.package)

    def test_rejects_missing_descriptor_metadata(self):
        with zipfile.ZipFile(self.package, "w") as z:
            z.writestr("Package/Assets/package.native", "- !<NativePackageDescriptor/11111111-1111-1111-1111-111111111111>\n")
        with self.assertRaisesRegex(ValueError, "descriptor metadata"):
            read_package_sources(self.package)

    def test_source_metadata_identity_change_requires_sync(self):
        self.archive()
        (self.source / "module.ts.meta").write_text("PrimaryAsset: !<reference> 22222222-2222-2222-2222-222222222222\n")
        original = check_package(self.source, self.package)
        self.assertTrue(original["passed"])
        (self.source / "module.ts.meta").write_text("PrimaryAsset: !<reference> 33333333-3333-3333-3333-333333333333\n")
        result = check_package(self.source, self.package)
        self.assertFalse(result["passed"])
        self.assertEqual(result["metadata_changed"], ["module.ts"])
        self.assertNotEqual(result["fingerprint"], original["fingerprint"])

    def test_release_version_must_match_manifest(self):
        self.archive()
        (self.source.parent / "package.json").write_text('{"version":"0.2.0"}')
        result = check_package(self.source, self.package)
        self.assertFalse(result["passed"])
        self.assertTrue(result["version_changed"])

    def test_builder_restores_descriptor_and_uuid_metadata(self):
        self.archive({ARCHIVE_PREFIX + "module.ts": "old source",
                      ARCHIVE_PREFIX + "module.ts.meta": "PrimaryAsset: !<reference> 22222222-2222-2222-2222-222222222222\n"})
        app = self.root / "Editor.app"
        template = app / "Contents/Resources/ModelResources.bundle/ProjectTemplates/Default"
        template.mkdir(parents=True)
        (template / "Project.esproj").write_text("installed editor template")
        workspace = self.root / "external-builder"
        prepare_builder(self.source, self.package, workspace, app)
        stage = workspace / "Assets/DimOSARClient.lspkg"
        self.assertIn("NativePackageDescriptor/11111111", (stage / "package.native").read_text())
        self.assertIn("22222222-2222", (stage / "Scripts/DimOSARClient/module.ts.meta").read_text())
        self.assertEqual((stage / "Scripts/DimOSARClient/module.ts").read_bytes(), (self.source / "module.ts").read_bytes())


class PackagePublicationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.package = self.root / "installed.lspkg"
        self.package.write_bytes(b"previous package")
        self.candidate = self.root / "candidate.lspkg"
        self.candidate.write_bytes(b"new package")

    async def test_success_keeps_verified_candidate(self):
        from core_package import publish_candidate

        verify, restore = AsyncMock(return_value=True), AsyncMock()
        await publish_candidate(self.candidate, self.package, verify, restore)
        self.assertEqual(self.package.read_bytes(), b"new package")
        verify.assert_awaited_once()
        restore.assert_not_awaited()

    async def test_failed_handoff_restores_previous_before_revalidation(self):
        from core_package import publish_candidate

        async def revalidate_previous():
            self.assertEqual(self.package.read_bytes(), b"previous package")

        restore = AsyncMock(side_effect=revalidate_previous)
        with self.assertRaisesRegex(RuntimeError, "handoff failed"):
            await publish_candidate(self.candidate, self.package, AsyncMock(return_value=False), restore)
        restore.assert_awaited_once()
        self.assertEqual(self.package.read_bytes(), b"previous package")

    async def test_bootstrap_failure_restores_absent_archive(self):
        from core_package import publish_candidate

        self.package.unlink()
        async def restore_without_package():
            self.assertFalse(self.package.exists())
        restore = AsyncMock(side_effect=restore_without_package)
        with self.assertRaises(RuntimeError):
            await publish_candidate(self.candidate, self.package, AsyncMock(return_value=False), restore)
        restore.assert_awaited_once()
        self.assertFalse(self.package.exists())

    async def test_raised_error_and_cancellation_preserve_original_failure(self):
        from core_package import publish_candidate

        for failure in (RuntimeError("native audit error"), asyncio.CancelledError("cancelled")):
            with self.subTest(failure=type(failure).__name__):
                restore = AsyncMock()
                with self.assertRaises(type(failure)) as caught:
                    await publish_candidate(self.candidate, self.package, AsyncMock(side_effect=failure), restore)
                self.assertIs(caught.exception, failure)
                self.assertEqual(self.package.read_bytes(), b"previous package")
                restore.assert_awaited_once()

    async def test_revalidation_failure_does_not_mask_primary_error(self):
        from core_package import publish_candidate

        failure = RuntimeError("new package failed")
        with self.assertRaises(RuntimeError) as caught:
            await publish_candidate(self.candidate, self.package, AsyncMock(side_effect=failure),
                                    AsyncMock(side_effect=RuntimeError("previous audit failed")))
        self.assertIs(caught.exception, failure)
        self.assertEqual(self.package.read_bytes(), b"previous package")
        self.assertIn("Previous production state was not verified", caught.exception.__notes__[0])

    async def test_atomic_publish_failure_keeps_previous_and_restores_editor(self):
        from core_package import publish_candidate

        restore = AsyncMock()
        with patch("core_package.atomic_write", side_effect=OSError("write failed")), self.assertRaises(OSError):
            await publish_candidate(self.candidate, self.package, AsyncMock(return_value=True), restore)
        self.assertEqual(self.package.read_bytes(), b"previous package")
        restore.assert_awaited_once()


class PackageOwnershipTests(unittest.TestCase):
    def test_unrelated_project_is_rejected(self):
        from core_package import validate_project_owner

        with self.assertRaisesRegex(ValueError, "Another project"):
            validate_project_owner(Path("/other/project"), Path("/production"), Path("/authoring"))
        validate_project_owner(Path("/production"), Path("/production"), Path("/authoring"))
        validate_project_owner(Path("/authoring"), Path("/production"), Path("/authoring"))

    def test_extract_cannot_delete_canonical_source(self):
        from core_package import CORE_ROOT, main

        with patch.object(sys, "argv", ["core_package.py", "extract", "--destination", str(CORE_ROOT)]):
            self.assertEqual(main(), 1)


if __name__ == "__main__":
    unittest.main()
