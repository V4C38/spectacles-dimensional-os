"""Small macOS editor lifecycle helpers; never close an authored project window."""
from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
import time


def dismiss_welcome(pid: int) -> None:
    """Close only Lens Studio's Home/Welcome windows, which can block MCP actions."""
    code = f'''
tell application "System Events"
  tell (first process whose unix id is {pid})
    repeat with targetWindow in every window
      set windowName to name of targetWindow
      if windowName is "Home" or windowName is "Welcome" or windowName is "Welcome to Lens Studio" then
        try
          click (first button of targetWindow whose subrole is "AXCloseButton")
        on error
          try
            perform action "AXClose" of targetWindow
          on error
            set frontmost to true
            perform action "AXRaise" of targetWindow
            delay 0.1
            set focusedName to name of (value of attribute "AXFocusedWindow")
            if focusedName is windowName then keystroke "w" using command down
          end try
        end try
      end if
    end repeat
  end tell
end tell
'''
    result = subprocess.run(["osascript", "-e", code], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("Could not dismiss Lens Studio Home/Welcome: " + result.stderr.strip())


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
