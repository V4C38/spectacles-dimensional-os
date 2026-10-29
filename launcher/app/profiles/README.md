# OpenYAM bench default

`openyam.json` supplies the calibration for new OpenYAM profiles in the launcher.
Saved user profiles remain independent copies; changing the default does not
overwrite an existing profile.

Print AprilTag **36h11, ID 0** at **70 mm overall**, including the white border.
Its black square must measure **56 mm**. Place it flat, face up, with its center
**120 mm to the right of the arm axis**, measured center to center. The tag center
and arm base datum share the same height. In the reference bench setup, both are
20 mm above the bench top; do not add that 20 mm to the tag's relative height.

Arm coordinates are +X forward, +Y left, +Z up. Align the tag's printed right
direction with arm +X and its printed top with arm +Y. The resulting tag pose
relative to the arm is position `[0, -0.120, 0]` meters and quaternion
`[0, 0, 0, 1]` in XYZW order. The stationary arm base defines the odometry origin.

This layout follows the `workspace-config/openyam_bench.json` calibration in
`dimos-openyam-coordinator-agentic`. Its measured tag yaw is about -0.4944 degrees;
the reusable default uses zero yaw for a square-aligned tag. If reusing that exact
measured placement without realigning the printed tag, set the profile's yaw to
-0.4944 degrees. Measure and adjust a saved profile when your placement differs.
