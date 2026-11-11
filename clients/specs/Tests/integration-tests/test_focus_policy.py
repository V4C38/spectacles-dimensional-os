from __future__ import annotations

from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class FocusPolicyTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("swiftc"), "Swift compiler unavailable")
    def test_budget_and_spacing_survive_recorder_restarts(self) -> None:
        policy = Path(__file__).resolve().parents[2] / "tools/FocusPolicy.swift"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            driver = root / "Driver.swift"
            driver.write_text('''
import Foundation
@main struct Check {
  static func expect(_ value: @autoclosure () throws -> Bool) throws {
    let passed = try value()
    precondition(passed)
  }
  static func main() throws {
    let url = URL(fileURLWithPath: CommandLine.arguments[1])
    var a = try FocusPolicy(url: url)
    try expect(a.request(now: 0, focused: false) == .initial)
    try expect(a.request(now: 0, focused: false) == .restore)
    var b = try FocusPolicy(url: url)
    try expect(b.request(now: 0.2, focused: false) == .wait)
    try expect(b.request(now: 1, focused: false) == .restore)
    try expect(b.request(now: 1.2, focused: true) == .focused)
    var c = try FocusPolicy(url: url)
    try expect(c.request(now: 2, focused: false) == .restore)
    try expect(c.request(now: 2.1, focused: true) == .focused)
    var d = try FocusPolicy(url: url)
    try expect(d.request(now: 2.2, focused: false) == .abort)
    var e = try FocusPolicy(url: url)
    try expect(e.request(now: 4, focused: true) == .abort)
    precondition(FileManager.default.fileExists(atPath: e.abortURL.path))
    try "3".write(to: url, atomically: true, encoding: .utf8)
    try FileManager.default.removeItem(at: e.abortURL)
    var legacy = try FocusPolicy(url: url)
    try expect(legacy.request(now: 10, focused: false) == .abort)
  }
}
''')
            binary = root / "check"
            compiled = subprocess.run(["swiftc", str(policy), str(driver), "-o", str(binary)],
                                      capture_output=True, text=True)
            self.assertEqual(compiled.returncode, 0, compiled.stderr)
            subprocess.run([str(binary), str(root / "focus-budget")], check=True,
                           capture_output=True, text=True)
