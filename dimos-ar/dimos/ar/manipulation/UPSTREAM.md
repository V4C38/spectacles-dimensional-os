# Local integration boundary

The pinned DimOS revision owns IK, path planning, trajectory generation,
execution and physical feedback. AR calls those implementations without editing
upstream source. Two missing facilities prevent further local deletion:

- **OpenYAM collision assets:** the pinned canonical asset has visual meshes but
  no collision elements. `collision_model.py` derives collision elements from
  those visuals and excludes only the opposing finger pair from self collision.
  Remove it when an installed model supplies verified collision geometry; keep
  obstacle and finger/environment rejection contracts.
- **Public generated-plan registration:** isolated workers use DimOS planning
  factories and return native generated plans. Installing a checked result for
  exact-ID execution requires the module's private `_last_plan` field. A public
  replacement must preserve the exact plan, start-state checks and authoritative
  scene identity before this bridge can be removed.

These are future opportunities, not requirements for this cleanup. The installed
revision and current control/stop guarantees remain unchanged.
