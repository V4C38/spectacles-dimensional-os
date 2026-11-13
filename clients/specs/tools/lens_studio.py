"""Small macOS editor lifecycle helpers; never close an authored project window."""
from __future__ import annotations

import argparse
from pathlib import Path
import re
import subprocess
import time

from ls_awake import KeepAwake


def dismiss_welcome(pid: int) -> None:
    """Close only Lens Studio's Home/Welcome windows, which can block MCP actions."""
    # Resolve one exact startup title per pass. Never retain accessibility indices
    # across a close: the project can replace Home while the script is running.
    code = f'''
tell application "System Events"
  tell (first process whose unix id is {pid})
    repeat with welcomeName in {{"Home", "Welcome", "Welcome to Lens Studio"}}
      set welcomeTitle to contents of welcomeName
      if exists (first window whose name is welcomeTitle) then
        set targetWindow to first window whose name is welcomeTitle
        if exists (first button of targetWindow whose subrole is "AXCloseButton") then
          click (first button of targetWindow whose subrole is "AXCloseButton")
        else
          perform action "AXClose" of targetWindow
        end if
        return "closed"
      end if
    end repeat
    return "none"
  end tell
end tell
'''
    detail = "Home/Welcome windows kept changing"
    for attempt in range(8):
        result = subprocess.run(["osascript", "-e", code], capture_output=True, text=True)
        if result.returncode == 0:
            if result.stdout.strip() == "none":
                return
            if result.stdout.strip() != "closed":
                raise RuntimeError("Could not dismiss Lens Studio Home/Welcome: unexpected accessibility response")
        else:
            detail = result.stderr.strip()
            # A disappearing AX window can invalidate even an exact-name lookup.
            # Retry only this race; permission/automation errors must stay visible.
            if not (re.search(r"\(-1719\)\s*$", detail)
                    and re.search(r"\binvalid index\b", detail, re.IGNORECASE)):
                raise RuntimeError("Could not dismiss Lens Studio Home/Welcome: " + detail)
        if attempt < 7:
            time.sleep(0.1)
    raise RuntimeError("Could not dismiss Lens Studio Home/Welcome: " + detail)


def launch_source(app: Path, project: Path) -> None:
    """Open the chosen editor/project and dismiss its startup window."""
    subprocess.run(["open", "-a", str(app), str(project)], check=True)
    executable = str(app / "Contents/MacOS/Lens Studio")
    for _ in range(60):
        processes = subprocess.run(["pgrep", "-x", "Lens Studio"], capture_output=True, text=True)
        for value in processes.stdout.split():
            command = subprocess.check_output(["ps", "-p", value, "-o", "command="], text=True).strip()
            if command.startswith(executable):
                dismiss_welcome(int(value))
                windows = subprocess.run(["osascript", "-e",
                    f'tell application "System Events" to tell (first process whose unix id is {int(value)}) to get name of every window'],
                    capture_output=True, text=True)
                if "Lens Studio" in windows.stdout:
                    # The startup Home can arrive after the project window.
                    time.sleep(1)
                    dismiss_welcome(int(value))
                    return
        time.sleep(1)
    raise RuntimeError("Lens Studio did not start within 60 seconds; inspect its native crash log")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", type=Path, required=True)
    parser.add_argument("--project", type=Path, required=True)
    args = parser.parse_args()
    with KeepAwake():
        launch_source(args.app.expanduser().resolve(), args.project.expanduser().resolve())


def resize_project_window(pid: int, height: int | None = None, width: int | None = None, bounds: dict | None = None) -> dict:
    """Resize the editor window for a viewport test; return actual geometry."""
    changes = ""
    if bounds is not None:
        changes = "set position of targetWindow to {%d, %d}\nset size of targetWindow to {%d, %d}" % (bounds["x"], bounds["y"], bounds["width"], bounds["height"])
    elif height is not None or width is not None:
        current = resize_project_window(pid)
        changes = "set size of targetWindow to {%d, %d}" % (width or current["width"], height or current["height"])
    code = f'''tell application "System Events"
  tell (first process whose unix id is {pid})
    set targetWindow to first window whose name contains "Lens Studio"
    {changes}
    return (position of targetWindow) & (size of targetWindow)
  end tell
end tell'''
    result = subprocess.run(["osascript", "-e", code], capture_output=True, text=True, check=True)
    values = [int(value.strip()) for value in result.stdout.strip().split(",")]
    return dict(zip(("x", "y", "width", "height"), values, strict=True))


if __name__ == "__main__":
    main()
