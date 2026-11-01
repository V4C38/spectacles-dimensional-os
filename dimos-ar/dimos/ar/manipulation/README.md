# Optional arm manipulation

The `openyam-ar-planner` blueprint composes installed DimOS hardware, planning,
control, and model APIs with narrow repository-owned AR RPC adapters. Importing
the ordinary ARModule does not load arm planning dependencies. Install the
`dimos-ar[manipulation]` extra in a compatible DimOS environment to use this
blueprint. Upstream DimOS source is not modified.

## Shared state and motion authority

ARModule validates the connected client against the per-robot replication
coordinator before forwarding a command. It injects an authority epoch, lease,
coordinator revision, target revision, and monotonic deadline. The native runtime
checks that envelope again before admitting work and after asynchronous planning
or evaluation. Independent revocation RPCs retain tombstones even when they beat
the first queued command to the native process.

Selected arm editing uses the shared `manipulation_planning` lease. A generated
plan belongs to the robot and identifies its group and exact target revision.
Releasing editing can preserve an in-flight plan for the unchanged target.
Target changes, source disconnect, expiry, or reference invalidation retire old
pending results. Another client can acquire authority and execute the same
reviewed plan. Preview and Execute acquire transient authority and retain it
until their native result is reconciled.

Autonomous accepted execution continues after editing authority is released or
the reviewing client disconnects. It remains a robot operation independently of
client ownership. Another Execute cannot replay the plan while native executor
feedback still reports its previous IDLE state. IDLE, UNCERTAIN, and FAULT are
not completion confirmations for an acknowledged operation. Explicit Stop stays
available to retire motion.

Unselected dragging uses `manipulation_following` authority and a separate native
following token. Only that token's source can update it. Newer targets replace
queued targets; stale timestamps, sequence numbers, authority, and feedback are
rejected. Following uses the installed bounded Cartesian IK controller and does
not have the checked planner's world-collision guarantee. The default target
watchdog is 500 ms. Release, disconnect, or authority revocation clears native
following. A failed clear retires the token and attempts native cancellation and
emergency stop; one failed task cannot skip other task clears.

Stop and cancellation retire delayed work. Emergency stop independently attempts
following clear, executor cancellation, and the hardware stop adapter even when
one provider fails. Resume requires confirmed stopping and fresh feedback; no
old target or trajectory is restored.

## Frames and extensibility

`ManipulationConfig` describes planning groups, following tasks, and the transform
between native planning `world` and wire `odom`. The stationary OpenYAM blueprint
supplies an explicit base pose. Tag mounts remain relative to that base. Host
basis conversion happens once. The native model supplies joint topology and
visual bounds; ClientCore forward kinematics is presentation only and cannot
authorize motion.

`ManipulationBackend`, `ARManipulationSpec`, and the replication authority adapter
keep native robot details outside the client interaction lifecycle. Additional
native arms need a compatible backend configuration, model, and capability
composition. Mobile or humanoid manipulation needs an explicit combined-motion
policy rather than assuming independent arm and base ownership.

## Validation

Python tests cover codecs, frames, model description, shared checked plans,
following ownership, native authority fences, late results, duplicate execution,
stop fanout, and feedback uncertainty. ClientCore tests exercise delayed replies
and gesture cancellation; browser fixtures exercise presentation and transport.
These software tests do not establish physical release latency, collision
behavior, AprilTag registration quality, or hardware stopping distance. Run the
repository's complete CI script before committing or pushing changes.
