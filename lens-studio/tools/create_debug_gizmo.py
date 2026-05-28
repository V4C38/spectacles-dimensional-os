#!/usr/bin/env python3
"""
Create debug gizmo in Lens Studio via MCP.
Requires Lens Studio to be open with the lens-studio project.
"""

import json
import sys
from pathlib import Path

# This script is meant to be run from Cursor with MCP access
# It creates a 3-axis gizmo (RGB cubes) under MarkerAnchor

GIZMO_STRUCTURE = {
    "parent": "DebugGizmo",
    "children": [
        {
            "name": "XAxis",
            "preset": "Mesh Visual",
            "color": {"x": 1.0, "y": 0.0, "z": 0.0},  # Red
            "scale": {"x": 0.1, "y": 0.01, "z": 0.01},
            "position": {"x": 0.05, "y": 0.0, "z": 0.0},
        },
        {
            "name": "YAxis",
            "preset": "Mesh Visual",
            "color": {"x": 0.0, "y": 1.0, "z": 0.0},  # Green
            "scale": {"x": 0.01, "y": 0.1, "z": 0.01},
            "position": {"x": 0.0, "y": 0.05, "z": 0.0},
        },
        {
            "name": "ZAxis",
            "preset": "Mesh Visual",
            "color": {"x": 0.0, "y": 0.0, "z": 1.0},  # Blue
            "scale": {"x": 0.01, "y": 0.01, "z": 0.1},
            "position": {"x": 0.0, "y": 0.0, "z": 0.05},
        },
    ],
}

def main():
    print("This script creates a debug gizmo in Lens Studio via MCP.")
    print("Steps:")
    print("1. Get scene graph")
    print("2. Find MarkerAnchor UUID")
    print("3. Create DebugGizmo parent")
    print("4. Create 3 axis meshes (RGB)")
    print("5. Wire to AlignmentController.debugGizmo")
    print()
    print("Run this from Cursor Agent with Lens Studio open:")
    print(f"  'Create debug gizmo using {Path(__file__).resolve()}'")
    print()
    print("MCP Tools needed:")
    print("  - GetLensStudioSceneGraph")
    print("  - CreateSceneObjectFromPresetTool (or CreateLensStudioSceneObject)")
    print("  - CreateComponentFromPresetTool")
    print("  - SetLensStudioProperty")
    return 0

if __name__ == "__main__":
    sys.exit(main())
