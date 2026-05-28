# Debug Gizmo Setup

## Automatic Setup (when Lens Studio is open with MCP connected)

Run this from Cursor when Lens Studio is open:

```
Create Debug Gizmo via MCP:
1. Get scene graph to find MarkerAnchor UUID
2. Create DebugGizmo parent object under MarkerAnchor  
3. Create 3 colored cubes (X/Y/Z axes):
   - X axis: red cube, scale (0.1, 0.01, 0.01), position (0.05, 0, 0)
   - Y axis: green cube, scale (0.01, 0.1, 0.01), position (0, 0.05, 0)
   - Z axis: blue cube, scale (0.01, 0.01, 0.1), position (0, 0, 0.05)
4. Wire DebugGizmo to AlignmentController.debugGizmo input
```

## Manual Setup (in Lens Studio)

1. **Find MarkerAnchor** in Objects panel (under Image Tracking)

2. **Create parent object:**
   - Right-click MarkerAnchor → Add New → Scene Object
   - Name it "DebugGizmo"

3. **Create X axis (red):**
   - Right-click DebugGizmo → Add New → Mesh Visual
   - Name: "XAxis"
   - Add Component → Render Mesh Visual
   - Mesh: Cube
   - Material: Create new → Unlit, set color to RED
   - Transform: Scale (0.1, 0.01, 0.01), Position (0.05, 0, 0)

4. **Create Y axis (green):**
   - Right-click DebugGizmo → Add New → Mesh Visual
   - Name: "YAxis"
   - Mesh: Cube, Material: GREEN
   - Transform: Scale (0.01, 0.1, 0.01), Position (0, 0.05, 0)

5. **Create Z axis (blue):**
   - Right-click DebugGizmo → Add New → Mesh Visual
   - Name: "ZAxis"
   - Mesh: Cube, Material: BLUE
   - Transform: Scale (0.01, 0.01, 0.1), Position (0, 0, 0.05)

6. **Wire to AlignmentController:**
   - Select MarkerAnchor
   - In Inspector, find AlignmentController script
   - Drag DebugGizmo object to the "Debug Gizmo" input field

The gizmo will now show/hide when marker tracking starts/stops.
