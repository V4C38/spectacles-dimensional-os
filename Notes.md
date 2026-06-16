1. Marker alignment at runtime not updating
2. Lag over time 


Bridge Logs:


============================================================
Rerun gRPC server running (no viewer opened)

Connect a viewer:
  dimos-viewer --connect rerun+http://0.0.0.0:9877/proxy --ws-url ws://0.0.0.0:3030/ws
  dimos-viewer --connect rerun+http://192.168.1.166:9877/proxy --ws-url ws://192.168.1.166:3030/ws  # en0

  hostname: MacBookAirM2
============================================================

20:18:00.086[deb][tocol/pubsub/impl/shmpubsub.py] SharedMemory PubSub starting (backend=auto)
20:18:00.109[inf][/visualization/rerun/bridge.py] bridge listening on LCM
20:18:02.409[inf][dination/module_coordinator.py] graphviz not found, skipping blueprint graph. Install: sudo apt install graphviz
20:18:19.773[inf][xr/network/websocket_server.py] XR client connected remote=('192.168.1.210', 44854)
20:18:19.776[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:18:19.905[inf][xr/network/websocket_server.py] XR inbound text message type=get_status
20:18:20.941[inf][xr/network/websocket_server.py] XR inbound text message type=get_status
20:18:21.436[inf][xr/network/websocket_server.py] XR inbound text message type=align_start
20:18:21.453[inf][s-xr/dimos_xr/bridge/assist.py] AssistDriver transition from_=idle msg=Scan the robot tag to estimate its position to=estimating
20:18:21.453[inf][r/dimos_xr/bridge/alignment.py] XR alignment started method=tag
20:18:21.574[inf][xr/network/websocket_server.py] XR inbound text message type=camera_info
20:18:21.575[inf][r/dimos_xr/bridge/alignment.py] XR camera intrinsics received device=spectacles resolution=1008x756
20:18:23.056[inf][s-xr/dimos_xr/bridge/assist.py] AssistDriver transition from_=estimating msg=Robot position estimated — press Continue to start assisted calibration to=awaiting_confirm
20:18:26.059[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:18:29.812[inf][xr/network/websocket_server.py] XR inbound text message type=assist_confirm
20:18:29.815[inf][s-xr/dimos_xr/bridge/assist.py] AssistDriver transition from_=awaiting_confirm msg=Robot moving — leg 1/3 to=move
20:18:31.106[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:18:37.268[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:18:43.283[war][imos_xr/tracking/transforms.py] gravity_level_transform diagnostic: translation=[ 0.435 -0.957 -1.173] up_world=[-0.311 -0.121  0.943] input_rotation=[[-0.565 -0.764 -0.311]
 [ 0.821 -0.558 -0.121]
 [-0.081 -0.324  0.943]]
20:18:43.284[war][imos_xr/tracking/transforms.py] gravity_level_transform: input up-axis far from world-up (angle=97.0 deg) — calibration input likely malformed; this warning is rate-limited to once per 30 s
20:18:43.285[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:18:49.271[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:18:56.398[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:19:00.313[inf][s-xr/dimos_xr/bridge/assist.py] AssistDriver transition from_=move msg=Baseline collection complete to=done
20:19:00.445[inf][r/dimos_xr/bridge/alignment.py] AssistDriver DONE — auto-committing alignment
20:19:00.451[deb][r/dimos_xr/bridge/alignment.py] TF publish_static not supported by current backend (PubSubTF) — skipping world→odom static TF broadcast
20:19:00.453[inf][r/dimos_xr/bridge/alignment.py] Alignment succeeded approximate=False method=tag quality=0.931
20:19:00.489[inf][r/dimos_xr/bridge/telemetry.py] LiDAR stream active binary=True hz=1.0
20:19:00.490[deb][r/dimos_xr/bridge/telemetry.py] LiDAR payload bytes=9005 hz=1.0 points=1500
20:19:01.518[inf][mos_xr/tracking/tag_tracker.py] tag_mount_offset diagnostic tag_id=0 measured_base_to_tag=[ 0.1991 -0.0006  0.0692] configured_mount.position=[0.18 0.   0.06] residual=[ 0.0191 -0.0006  0.0092] p_world_tag=[-0.0313 -0.8349 -1.082 ] p_world_base_from_mount=[ 0.0424 -0.8813 -0.9135]
20:19:01.520[inf][r/dimos_xr/bridge/alignment.py] Runtime correction applied base_after=[0.042, -0.881, -0.914] base_before=[0.05, -0.889, -0.895] baseline_m=0.0 marker_jump_m=0.021 observation_count=1 solve_method=tag_translation solve_quality=0.905 trans_delta_m=0.021 yaw_delta_deg=0.0
20:19:01.521[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=2 dropped_fifo=0 fifo_depth=0
20:19:02.157[inf][xr/network/websocket_server.py] XR inbound text message type=align_stop
20:19:02.158[inf][xr/network/websocket_server.py] XR inbound text message type=get_status
20:19:04.972[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:19:06.029[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:19:13.034[inf][xr/network/websocket_server.py] XR inbound text message type=nav_goal
20:19:13.095[inf][/dimos_xr/bridge/navigation.py] XR navigation goal published odom_goal=[0.246, 0.711, 0.023] odom_goal_yaw_deg=-0.0 world_goal=[-0.623, -1.166, -0.946] world_goal_yaw_deg=113.13
20:19:13.099[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.246, 0.711, 0.023], euler=[90.0, 0.0, 13.4])
20:19:13.102[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
20:19:13.243[inf][nning_a_star/global_planner.py] Found safe goal. x=0.23 y=0.68
20:19:13.252[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
20:19:13.255[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
20:19:13.266[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:19:15.337[inf][anning_a_star/local_planner.py] changed state state=path_following
20:19:17.720[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
20:19:17.720[inf][anning_a_star/local_planner.py] changed state state=final_rotation
20:19:18.030[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
20:19:18.031[inf][anning_a_star/local_planner.py] changed state state=arrived
20:19:18.133[inf][anning_a_star/local_planner.py] changed state state=idle
20:19:18.133[inf][nning_a_star/global_planner.py] Arrived at goal.
20:19:18.134[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
20:19:22.775[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:19:23.792[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:19:24.711[inf][xr/network/websocket_server.py] XR inbound text message type=nav_goal
20:19:24.714[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.025, -0.288, 0.045], euler=[90.0, 0.0, -78.4])
20:19:24.714[inf][/dimos_xr/bridge/navigation.py] XR navigation goal published odom_goal=[0.025, -0.288, 0.045] odom_goal_yaw_deg=0.0 world_goal=[0.4, -1.143, -0.897] world_goal_yaw_deg=21.3
20:19:24.715[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
20:19:24.717[inf][nning_a_star/global_planner.py] Found safe goal. x=0.03 y=-0.32
20:19:24.721[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
20:19:24.724[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
20:19:24.728[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:19:26.699[inf][anning_a_star/local_planner.py] changed state state=path_following
20:19:29.081[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
20:19:29.082[inf][anning_a_star/local_planner.py] changed state state=final_rotation
20:19:29.082[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
20:19:29.082[inf][anning_a_star/local_planner.py] changed state state=arrived
20:19:29.185[inf][anning_a_star/local_planner.py] changed state state=idle
20:19:29.187[inf][nning_a_star/global_planner.py] Arrived at goal.
20:19:29.187[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
20:19:38.849[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:19:40.067[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:19:41.277[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:19:42.385[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:19:43.507[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:19:45.093[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:19:46.258[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:19:47.497[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:19:48.523[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:19:50.242[inf][xr/network/websocket_server.py] XR inbound text message type=nav_goal
20:19:50.246[inf][/dimos_xr/bridge/navigation.py] XR navigation goal published odom_goal=[0.376, 0.256, 0.028] odom_goal_yaw_deg=-0.0 world_goal=[-0.195, -1.16, -1.151] world_goal_yaw_deg=167.16
20:19:50.247[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.376, 0.256, 0.028], euler=[90.0, 0.0, 67.5])
20:19:50.250[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
20:19:50.255[inf][nning_a_star/global_planner.py] Found safe goal. x=0.38 y=0.22
20:19:50.264[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
20:19:50.266[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
20:19:50.279[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:19:52.748[inf][anning_a_star/local_planner.py] changed state state=path_following
20:19:54.821[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
20:19:54.821[inf][anning_a_star/local_planner.py] changed state state=final_rotation
20:19:54.822[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
20:19:54.822[inf][anning_a_star/local_planner.py] changed state state=arrived
20:19:54.922[inf][anning_a_star/local_planner.py] changed state state=idle
20:19:54.923[inf][nning_a_star/global_planner.py] Arrived at goal.
20:19:54.924[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
20:19:59.621[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:20:00.616[deb][r/dimos_xr/bridge/telemetry.py] LiDAR payload bytes=9005 hz=1.0 points=1500
20:20:01.125[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:20:01.928[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:20:02.144[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:20:03.344[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:20:04.648[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:20:05.647[inf][xr/network/websocket_server.py] XR inbound text message type=camera_info
20:20:05.650[inf][r/dimos_xr/bridge/alignment.py] XR camera intrinsics received device=spectacles resolution=3200x2400
20:20:05.650[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:20:06.646[inf][xr/network/websocket_server.py] XR inbound text message type=nav_goal
20:20:06.656[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.430, -0.305, 0.025], euler=[90.0, 0.0, -165.7])
20:20:06.658[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
20:20:06.660[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.48 y=-0.33
20:20:06.665[inf][/dimos_xr/bridge/navigation.py] XR navigation goal published odom_goal=[-0.43, -0.305, 0.025] odom_goal_yaw_deg=-180.0 world_goal=[0.493, -1.164, -0.451] world_goal_yaw_deg=-65.96
20:20:06.667[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
20:20:06.670[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
20:20:09.361[inf][anning_a_star/local_planner.py] changed state state=path_following
20:20:11.422[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
20:20:11.425[inf][anning_a_star/local_planner.py] changed state state=final_rotation
20:20:11.733[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
20:20:11.733[inf][anning_a_star/local_planner.py] changed state state=arrived
20:20:11.835[inf][anning_a_star/local_planner.py] changed state state=idle
20:20:11.837[inf][nning_a_star/global_planner.py] Arrived at goal.
20:20:11.838[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
20:20:11.862[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:20:14.617[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:20:15.886[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:20:16.987[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:20:17.520[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:20:17.958[inf][xr/network/websocket_server.py] XR inbound text message type=nav_goal
20:20:17.966[inf][/dimos_xr/bridge/navigation.py] XR navigation goal published odom_goal=[0.166, -0.216, 0.027] odom_goal_yaw_deg=0.0 world_goal=[0.305, -1.161, -1.023] world_goal_yaw_deg=87.08
20:20:17.967[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.166, -0.216, 0.027], euler=[90.0, 0.0, -12.6])
20:20:17.969[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
20:20:17.971[inf][nning_a_star/global_planner.py] Found safe goal. x=0.13 y=-0.23
20:20:17.980[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
20:20:18.007[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
20:20:20.786[inf][anning_a_star/local_planner.py] changed state state=path_following
20:20:22.775[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
20:20:22.776[inf][anning_a_star/local_planner.py] changed state state=final_rotation
20:20:22.777[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
20:20:22.777[inf][anning_a_star/local_planner.py] changed state state=arrived
20:20:22.879[inf][anning_a_star/local_planner.py] changed state state=idle
20:20:22.881[inf][nning_a_star/global_planner.py] Arrived at goal.
20:20:22.883[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
20:20:22.887[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:20:31.647[inf][mos_xr/tracking/tag_tracker.py] tag_mount_offset diagnostic tag_id=0 measured_base_to_tag=[ 0.1892 -0.4185  0.0826] configured_mount.position=[0.18 0.   0.06] residual=[ 0.0092 -0.4185  0.0226] p_world_tag=[ 0.6045 -0.7914 -1.1579] p_world_base_from_mount=[ 0.6454 -0.8491 -0.9819]
20:20:31.651[inf][r/dimos_xr/bridge/alignment.py] Runtime correction applied base_after=[0.645, -0.849, -0.982] base_before=[0.24, -0.886, -0.883] baseline_m=0.0 marker_jump_m=0.419 observation_count=1 solve_method=tag_translation solve_quality=0.917 trans_delta_m=0.419 yaw_delta_deg=0.0
20:20:31.652[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=2 dropped_fifo=0 fifo_depth=0
20:20:40.458[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:20:41.144[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:20:41.541[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:20:42.513[inf][xr/network/websocket_server.py] XR inbound text message type=nav_goal
20:20:42.574[inf][/dimos_xr/bridge/navigation.py] XR navigation goal published odom_goal=[0.254, 0.727, 0.005] odom_goal_yaw_deg=-0.0 world_goal=[-0.234, -1.147, -1.05] world_goal_yaw_deg=172.15
20:20:42.577[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.254, 0.727, 0.005], euler=[90.0, 0.0, 72.4])
20:20:42.579[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
20:20:42.586[inf][nning_a_star/global_planner.py] Found safe goal. x=0.23 y=0.72
20:20:42.597[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
20:20:42.604[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
20:20:44.250[inf][anning_a_star/local_planner.py] changed state state=path_following
20:20:46.873[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
20:20:46.873[inf][anning_a_star/local_planner.py] changed state state=final_rotation
20:20:46.874[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
20:20:46.875[inf][anning_a_star/local_planner.py] changed state state=arrived
20:20:46.977[inf][anning_a_star/local_planner.py] changed state state=idle
20:20:46.979[inf][nning_a_star/global_planner.py] Arrived at goal.
20:20:46.979[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
20:20:47.030[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:20:59.646[inf][r/dimos_xr/bridge/alignment.py] Runtime correction applied base_after=[-0.684, -0.81, -1.065] base_before=[-0.194, -0.838, -1.074] baseline_m=0.98 marker_jump_m=0.491 observation_count=2 solve_method=tag solve_quality=0.905 trans_delta_m=0.493 yaw_delta_deg=0.8
20:20:59.648[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=2 dropped_fifo=0 fifo_depth=0
20:21:00.797[deb][r/dimos_xr/bridge/telemetry.py] LiDAR payload bytes=9005 hz=1.0 points=1500
20:21:06.667[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:21:07.375[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:21:08.252[inf][xr/network/websocket_server.py] XR inbound text message type=nav_goal
20:21:08.262[inf][/dimos_xr/bridge/navigation.py] XR navigation goal published odom_goal=[0.038, -0.195, -0.032] odom_goal_yaw_deg=180.0 world_goal=[0.22, -1.156, -0.97] world_goal_yaw_deg=-0.96
20:21:08.262[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.038, -0.195, -0.032], euler=[90.0, 0.0, -99.9])
20:21:08.265[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
20:21:08.272[inf][nning_a_star/global_planner.py] Found safe goal. x=0.03 y=-0.23
20:21:08.298[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
20:21:08.354[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
20:21:10.958[inf][anning_a_star/local_planner.py] changed state state=path_following
20:21:13.654[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
20:21:13.655[inf][anning_a_star/local_planner.py] changed state state=final_rotation
20:21:13.656[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
20:21:13.656[inf][anning_a_star/local_planner.py] changed state state=arrived
20:21:13.764[inf][anning_a_star/local_planner.py] changed state state=idle
20:21:13.765[inf][nning_a_star/global_planner.py] Arrived at goal.
20:21:13.771[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
20:21:13.790[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:21:16.815[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:21:18.566[inf][xr/network/websocket_server.py] XR inbound text message type=nav_goal
20:21:18.595[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.140, 0.300, -0.026], euler=[90.0, 0.0, 55.5])
20:21:18.596[inf][/dimos_xr/bridge/navigation.py] XR navigation goal published odom_goal=[0.14, 0.3, -0.026] odom_goal_yaw_deg=0.0 world_goal=[-0.284, -1.149, -0.995] world_goal_yaw_deg=154.46
20:21:18.598[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
20:21:18.600[inf][nning_a_star/global_planner.py] Found safe goal. x=0.13 y=0.28
20:21:18.617[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
20:21:18.653[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
20:21:19.715[inf][r/dimos_xr/bridge/alignment.py] Runtime correction applied base_after=[0.254, -0.892, -1.002] base_before=[0.357, -0.815, -0.925] baseline_m=1.404 marker_jump_m=0.15 observation_count=3 solve_method=tag solve_quality=0.89 trans_delta_m=0.141 yaw_delta_deg=2.89
20:21:19.718[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=2 dropped_fifo=0 fifo_depth=0
20:21:21.157[inf][anning_a_star/local_planner.py] changed state state=path_following
20:21:23.017[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
20:21:23.018[inf][anning_a_star/local_planner.py] changed state state=final_rotation
20:21:23.019[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
20:21:23.019[inf][anning_a_star/local_planner.py] changed state state=arrived
20:21:23.127[inf][anning_a_star/local_planner.py] changed state state=idle
20:21:23.128[inf][nning_a_star/global_planner.py] Arrived at goal.
20:21:23.129[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
20:21:35.211[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:21:36.786[inf][xr/network/websocket_server.py] XR inbound text message type=nav_goal
20:21:36.792[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.284, 0.125, -0.019], euler=[90.0, 0.0, -18.3])
20:21:36.792[inf][/dimos_xr/bridge/navigation.py] XR navigation goal published odom_goal=[0.284, 0.125, -0.019] odom_goal_yaw_deg=-0.0 world_goal=[-0.249, -1.219, -1.216] world_goal_yaw_deg=83.46
20:21:36.794[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
20:21:36.796[inf][nning_a_star/global_planner.py] Found safe goal. x=0.28 y=0.13
20:21:36.801[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
20:21:36.806[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
20:21:36.820[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:21:37.854[inf][anning_a_star/local_planner.py] changed state state=path_following
20:21:39.307[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
20:21:39.308[inf][anning_a_star/local_planner.py] changed state state=final_rotation
20:21:39.308[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
20:21:39.308[inf][anning_a_star/local_planner.py] changed state state=arrived
20:21:39.411[inf][anning_a_star/local_planner.py] changed state state=idle
20:21:39.412[inf][nning_a_star/global_planner.py] Arrived at goal.
20:21:39.413[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
20:21:40.271[inf][r/dimos_xr/bridge/alignment.py] Runtime correction applied base_after=[-0.361, -0.896, -1.132] base_before=[-0.361, -0.896, -1.132] baseline_m=1.404 marker_jump_m=0.0 observation_count=3 solve_method=tag solve_quality=0.89 trans_delta_m=0.0 yaw_delta_deg=0.0
20:21:42.101[inf][xr/network/websocket_server.py] XR inbound text message type=plan_path
20:21:43.496[inf][xr/network/websocket_server.py] XR inbound text message type=nav_goal
20:21:43.528[inf][/dimos_xr/bridge/navigation.py] XR navigation goal published odom_goal=[0.405, 0.08, -0.026] odom_goal_yaw_deg=-0.0 world_goal=[-0.229, -1.226, -1.344] world_goal_yaw_deg=69.72
20:21:43.528[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.405, 0.080, -0.026], euler=[90.0, 0.0, -32.1])
20:21:43.530[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
20:21:43.532[inf][nning_a_star/global_planner.py] Found safe goal. x=0.38 y=0.08
20:21:43.540[inf][xr/network/websocket_server.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:21:43.542[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
20:21:43.554[inf][anning_a_star/local_planner.py] changed state state=path_following
20:21:44.075[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
20:21:44.083[inf][anning_a_star/local_planner.py] changed state state=final_rotation
20:21:44.084[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
20:21:44.084[inf][anning_a_star/local_planner.py] changed state state=arrived
20:21:44.167[inf][anning_a_star/local_planner.py] changed state state=idle
20:21:44.168[inf][nning_a_star/global_planner.py] Arrived at goal.
20:21:44.169[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
20:21:46.362[inf][r/dimos_xr/bridge/alignment.py] Runtime correction applied base_after=[-0.401, -0.891, -1.23] base_before=[-0.318, -0.894, -1.239] baseline_m=1.404 marker_jump_m=0.084 observation_count=4 solve_method=tag solve_quality=0.907 trans_delta_m=0.071 yaw_delta_deg=2.74




Lens studio logs:
I 21:16:57 Lens has been reset
I 21:16:57 Lens has been reset
I 21:17:00 Lens has been reset
I 21:17:02 Project "Project" loaded in 89 ms. Total files loaded: 4, from cache: 1
I 21:17:04 Lens has been reset
I 21:17:04 Lens has been reset
I 21:17:06 Automatic assets directory synchronization is now enabled for "Project"
I 21:17:45 Project "spectacles-dimensional-os" loaded in 6.97 sec. Total files loaded: 642, from cache: 202
I 21:17:47 Starting TypeScript compilation...
I 21:17:50 Lens has been reset
I 21:17:50 Lens has been reset
I 21:17:50 Lens has been reset
I 21:17:53 Automatic assets directory synchronization is now enabled for "spectacles-dimensional-os"
I 21:17:59 Spectacles is trying to connect to Lens Studio wirelessly. Make sure they are awake and on the same network.
I 21:18:00 Spectacles has successfully connected to Lens Studio with a wireless connection.
I 21:18:12 TypeScript compilation succeeded!
I 21:18:13 Lens has been reset
I 21:18:27 [Packages/SpectaclesInteractionKit.lspkg/Core/ConfigurationValidator/ConfigurationValidator.ts:16] SIK Version : 0.17.2
I 21:18:31 [Assets/Scripts/Core/DimosManager.ts:923] DimosManager: enterSetup
I 21:18:31 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 21:18:31 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 21:18:31 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: start
I 21:18:31 [Assets/Scripts/Core/DimosManager.ts:923] DimosManager: enterSetup
I 21:18:31 Sending lens to Spectacles in progress, 9 seconds elapsed
I 21:18:36 The Lens was sent in 14.54 sec
I 21:18:46 [Packages/SpectaclesInteractionKit.lspkg/Core/ConfigurationValidator/ConfigurationValidator.ts:16] SIK Version : 0.17.2
I 21:18:47 The sent Lens has successfully started on Spectacles
I 21:18:48 [Assets/Scripts/Core/DimosManager.ts:923] DimosManager: enterSetup
I 21:18:48 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 21:18:48 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 21:18:48 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: start
I 21:18:48 [Assets/Scripts/Core/DimosManager.ts:923] DimosManager: enterSetup
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must be valid
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must not be valid for setting initial values
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must be valid
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must not be valid for setting initial values
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must be valid
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must not be valid for setting initial values
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must be valid
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must not be valid for setting initial values
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must be valid
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must not be valid for setting initial values
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must be valid
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must not be valid for setting initial values
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must be valid
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must not be valid for setting initial values
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must be valid
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must not be valid for setting initial values
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must be valid
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must not be valid for setting initial values
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must be valid
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must not be valid for setting initial values
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must be valid
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must not be valid for setting initial values
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must be valid
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must not be valid for setting initial values
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must be valid
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must not be valid for setting initial values
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must be valid
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must not be valid for setting initial values
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must be valid
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must not be valid for setting initial values
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must be valid
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must not be valid for setting initial values
I 21:19:35 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must be valid
I 21:19:36 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must not be valid for setting initial values
I 21:19:36 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must be valid
I 21:19:36 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must not be valid for setting initial values
I 21:19:36 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must be valid
I 21:19:36 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must not be valid for setting initial values
I 21:19:36 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must be valid
I 21:19:36 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must not be valid for setting initial values
I 21:19:36 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must be valid
I 21:19:36 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must not be valid for setting initial values
I 21:19:36 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must be valid
I 21:19:36 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must not be valid for setting initial values
I 21:19:36 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must be valid
I 21:19:36 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must not be valid for setting initial values
I 21:19:36 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must be valid
I 21:19:36 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must not be valid for setting initial values
I 21:19:36 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must be valid
I 21:19:36 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must not be valid for setting initial values
I 21:19:36 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must be valid
I 21:19:36 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must not be valid for setting initial values
I 21:19:36 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must be valid
I 21:19:36 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must not be valid for setting initial values
I 21:19:36 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must be valid
I 21:19:36 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must not be valid for setting initial values
I 21:19:36 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must be valid
I 21:19:36 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must not be valid for setting initial values
I 21:19:36 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must be valid
I 21:19:36 [Packages/SpectaclesInteractionKit.lspkg/Utils/logger.ts:21] InteractableManipulation: Interactor must not be valid for setting initial values
I 21:20:01 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: startup step completed
I 21:20:01 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: step start -> connect
I 21:20:01 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: connect attempt 192.168.1.62
I 21:20:01 [Assets/Scripts/Bridge/BridgeClient.ts:216] BridgeClient: connecting to ws://192.168.1.62:8787
I 21:20:04 [Assets/Scripts/Core/DimosManager.ts:923] DimosManager: bridge connection: disconnected
I 21:20:04 [Assets/Scripts/Core/DimosManager.ts:488] DimosManager: checkConnection failed: Error: WebSocket connection error
I 21:20:04 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: connect failed, retrying
I 21:20:04 [Assets/Scripts/Bridge/BridgeClient.ts:266] BridgeClient: socket closed code=1011 reason="Failed to open WebSocket connection"
I 21:20:04 [Assets/Scripts/Core/DimosManager.ts:923] DimosManager: bridge connection: disconnected
I 21:20:06 [Assets/Scripts/Bridge/BridgeClient.ts:216] BridgeClient: connecting to ws://192.168.1.62:8787
I 21:20:06 [Assets/Scripts/Core/DimosManager.ts:923] DimosManager: bridge connection: disconnected
I 21:20:06 [Assets/Scripts/Core/DimosManager.ts:488] DimosManager: checkConnection failed: Error: WebSocket connection error
I 21:20:06 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: connect failed, retrying
I 21:20:06 [Assets/Scripts/Bridge/BridgeClient.ts:266] BridgeClient: socket closed code=1011 reason="Failed to open WebSocket connection"
I 21:20:06 [Assets/Scripts/Core/DimosManager.ts:923] DimosManager: bridge connection: disconnected
I 21:20:08 [Assets/Scripts/Bridge/BridgeClient.ts:216] BridgeClient: connecting to ws://192.168.1.62:8787
I 21:20:10 [Assets/Scripts/Core/DimosManager.ts:923] DimosManager: bridge connection: disconnected
I 21:20:10 [Assets/Scripts/Core/DimosManager.ts:488] DimosManager: checkConnection failed: Error: WebSocket connection error
I 21:20:10 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: connect failed, retrying
I 21:20:10 [Assets/Scripts/Bridge/BridgeClient.ts:266] BridgeClient: socket closed code=1011 reason="Failed to open WebSocket connection"
I 21:20:10 [Assets/Scripts/Core/DimosManager.ts:923] DimosManager: bridge connection: disconnected
I 21:20:12 [Assets/Scripts/Bridge/BridgeClient.ts:216] BridgeClient: connecting to ws://192.168.1.62:8787
I 21:20:13 [Assets/Scripts/Core/DimosManager.ts:923] DimosManager: bridge connection: disconnected
I 21:20:13 [Assets/Scripts/Core/DimosManager.ts:488] DimosManager: checkConnection failed: Error: WebSocket connection error
I 21:20:13 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: connect failed, retrying
I 21:20:13 [Assets/Scripts/Bridge/BridgeClient.ts:266] BridgeClient: socket closed code=1011 reason="Failed to open WebSocket connection"
I 21:20:13 [Assets/Scripts/Core/DimosManager.ts:923] DimosManager: bridge connection: disconnected
I 21:20:15 [Assets/Scripts/Bridge/BridgeClient.ts:216] BridgeClient: connecting to ws://192.168.1.62:8787
I 21:20:15 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: connect attempt 192.168.1.166
I 21:20:15 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: connect failed, retrying
I 21:20:15 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: connect attempt 192.168.1.166
I 21:20:15 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: connect failed, retrying
I 21:20:17 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: connect failed, retrying
I 21:20:17 [Assets/Scripts/Core/DimosManager.ts:923] DimosManager: bridge connection: disconnected
I 21:20:17 [Assets/Scripts/Core/DimosManager.ts:488] DimosManager: checkConnection failed: Error: WebSocket connection error
I 21:20:17 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: connect failed, retrying
I 21:20:17 [Assets/Scripts/Bridge/BridgeClient.ts:266] BridgeClient: socket closed code=1011 reason="Failed to open WebSocket connection"
I 21:20:17 [Assets/Scripts/Core/DimosManager.ts:923] DimosManager: bridge connection: disconnected
I 21:20:19 [Assets/Scripts/Bridge/BridgeClient.ts:216] BridgeClient: connecting to ws://192.168.1.166:8787
I 21:20:19 [Assets/Scripts/Bridge/BridgeClient.ts:242] BridgeClient: connected
I 21:20:19 [Assets/Scripts/Core/DimosManager.ts:923] DimosManager: bridge connection: connected
I 21:20:19 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: connect succeeded
I 21:20:19 [Assets/Scripts/Bridge/BridgeClient.ts:710] BridgeClient: RX bridge_status registered=false robot_connected=true
I 21:20:19 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=false goal_failed=false error_code=-
I 21:20:21 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: connect attempt 192.168.1.166
I 21:20:21 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: connect succeeded
I 21:20:22 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: connect step completed
I 21:20:22 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: step connect -> calibrate
I 21:20:22 [Assets/Scripts/Core/DimosManager.ts:923] DimosManager: setOperatingMode: setup
I 21:20:22 [Assets/Scripts/Bridge/BridgeClient.ts:665] BridgeClient: align_start TX robot=unitree_go2 bytes=99 sent=true
I 21:20:22 [Assets/Scripts/Alignment/AlignmentSession.ts:320] AlignmentSession: align_start{method:tag,assist:true} sent
I 21:20:22 [Assets/Scripts/Alignment/FrameCaptureController.ts:87] FrameCaptureController: mode off -> setup
I 21:20:22 [Assets/Scripts/Alignment/FrameCaptureController.ts:240] FrameCaptureController: camera stream started
I 21:20:22 [Assets/Scripts/Alignment/AlignmentSession.ts:112] AlignmentSession: start method=tag assist=true
I 21:20:22 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: align_status state=detecting method=tag progress=0 "Look at the AprilTag on your robot"
I 21:20:22 [Assets/Scripts/Alignment/FrameCaptureController.ts:428] FrameCaptureController: camera_info sent 1008x756 scale=1.000x1.000
I 21:20:26 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: align_status state=detecting method=tag progress=49 "Tag detected — collecting samples (1)"
I 21:20:28 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: align_status state=detecting method=tag progress=100 "Tag detected — collecting samples (2)"
I 21:20:38 [Assets/Scripts/Bridge/BridgeClient.ts:665] BridgeClient: align_stop TX robot=unitree_go2 bytes=65 sent=true
I 21:20:38 [Assets/Scripts/Alignment/FrameCaptureController.ts:87] FrameCaptureController: mode setup -> off
I 21:20:38 [Assets/Scripts/Alignment/FrameCaptureController.ts:251] FrameCaptureController: camera stream stopped
I 21:20:38 [Assets/Scripts/Alignment/AlignmentSession.ts:141] AlignmentSession: stop (marker)
I 21:20:38 [Assets/Scripts/Core/DimosManager.ts:923] DimosManager: setOperatingMode: manual
I 21:20:38 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: step calibrate -> connect
I 21:21:44 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: connect step completed
I 21:21:44 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: step connect -> calibrate
I 21:21:44 [Assets/Scripts/Core/DimosManager.ts:923] DimosManager: setOperatingMode: setup
I 21:21:44 [Assets/Scripts/Bridge/BridgeClient.ts:665] BridgeClient: align_start TX robot=unitree_go2 bytes=100 sent=true
I 21:21:44 [Assets/Scripts/Alignment/AlignmentSession.ts:320] AlignmentSession: align_start{method:tag,assist:true} sent
I 21:21:44 [Assets/Scripts/Alignment/FrameCaptureController.ts:87] FrameCaptureController: mode off -> setup
I 21:21:44 [Assets/Scripts/Alignment/FrameCaptureController.ts:240] FrameCaptureController: camera stream started
I 21:21:44 [Assets/Scripts/Alignment/AlignmentSession.ts:112] AlignmentSession: start method=tag assist=true
I 21:21:44 [Assets/Scripts/Alignment/FrameCaptureController.ts:428] FrameCaptureController: camera_info sent 1008x756 scale=1.000x1.000
I 21:21:44 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: align_status state=detecting method=tag progress=0 "Look at the AprilTag on your robot"
I 21:21:45 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: align_status state=detecting method=tag progress=49 "Tag detected — collecting samples (1)"
I 21:21:47 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: align_status state=detecting method=tag progress=100 "Tag detected — collecting samples (2)"
I 21:21:56 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: align_status state=detecting method=tag progress=0 "Robot moving — leg 1/3"
I 21:22:15 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: align_status state=detecting method=tag progress=33 "Tag detected — collecting samples (10)"
I 21:22:41 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: align_status state=detecting method=tag progress=66 "Robot moving — leg 3/3 (returning to start)"
I 21:22:50 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: align_status state=detecting method=tag progress=100 "Tag detected — collecting samples (22)"
I 21:22:50 [Assets/Scripts/Bridge/BridgeClient.ts:687] BridgeClient: RX pose #1 pos=(0.12,-0.82,1.13)
I 21:22:50 [Assets/Scripts/Bridge/BridgeClient.ts:710] BridgeClient: RX bridge_status registered=true robot_connected=true
I 21:22:50 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: align_status state=aligned method=tag progress=100 "Alignment successful"
I 21:22:50 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: alignment succeeded (progress=100%)
I 21:22:51 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: finish connect=done calibration=done
I 21:22:52 [Assets/Scripts/Bridge/BridgeClient.ts:665] BridgeClient: align_stop TX robot=unitree_go2 bytes=70 sent=true
I 21:22:52 [Assets/Scripts/Alignment/FrameCaptureController.ts:87] FrameCaptureController: mode setup -> runtime
I 21:22:52 [Assets/Scripts/Alignment/FrameCaptureController.ts:251] FrameCaptureController: camera stream stopped
I 21:22:52 [Assets/Scripts/Alignment/AlignmentSession.ts:141] AlignmentSession: stop (marker)
I 21:22:52 [Assets/Scripts/Core/DimosManager.ts:923] DimosManager: enterRuntime
I 21:22:52 [Assets/Scripts/Core/DimosManager.ts:923] DimosManager: setOperatingMode: manual
I 21:22:52 [Assets/Scripts/Core/DimosManager.ts:923] DimosManager: robotInteractionMode: runtimeRobot
I 21:22:52 [Assets/Scripts/Navigation/NavigationController.ts:284] NavigationController: placement enabled
I 21:22:52 [Assets/Scripts/Navigation/PlacementController.ts:82] PlacementController: start at (12.3, -114.6, 112.8)
I 21:22:52 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-114.6, band=0.5..155.0cm)
I 21:22:57 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-115.3, band=0.5..155.0cm)
I 21:22:57 [Assets/Scripts/Alignment/FrameCaptureController.ts:428] FrameCaptureController: camera_info sent 3200x2400 scale=3.175x3.175
I 21:22:58 [Assets/Scripts/Navigation/NavigationController.ts:593] NavigationController: goal confirmed at (108.1, -109.3, 146.3)
I 21:23:00 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=following_path goal_reached=false goal_failed=false error_code=-
I 21:23:03 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-116.2, band=0.5..155.0cm)
I 21:23:03 [Assets/Scripts/Core/DimosManager.ts:835] DimosManager: perf fps=59.9 frameMs=16.7 msgRxHz=0.0 poseRxHz=0.0 poseApplyHz=0.0
I 21:23:05 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=true goal_failed=false error_code=-
I 21:23:13 Project saved /Users/johannestscharn/Repositories/spectacles-dimensional-os/lens-studio/spectacles-dimensional-os.esproj
I 21:23:19 [Assets/Scripts/Navigation/NavigationController.ts:593] NavigationController: goal confirmed at (69.0, -109.2, 82.1)
I 21:23:19 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=false goal_failed=false error_code=-
I 21:23:19 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=following_path goal_reached=false goal_failed=false error_code=-
I 21:23:20 [Assets/Scripts/Bridge/BridgeClient.ts:687] BridgeClient: RX pose #399 pos=(1.11,-0.82,1.50)
I 21:23:25 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-116.2, band=0.5..155.0cm)
I 21:23:25 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=true goal_failed=false error_code=-
I 21:23:30 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-115.4, band=0.5..155.0cm)
I 21:23:33 [Assets/Scripts/Core/DimosManager.ts:835] DimosManager: perf fps=59.1 frameMs=16.9 msgRxHz=14.2 poseRxHz=12.7 poseApplyHz=10.8
I 21:23:35 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-115.4, band=0.5..155.0cm)
I 21:23:40 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-115.4, band=0.5..155.0cm)
I 21:23:46 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-115.4, band=0.5..155.0cm)
I 21:23:49 [Assets/Scripts/Navigation/NavigationController.ts:593] NavigationController: goal confirmed at (-14.0, -109.9, 99.3)
I 21:23:49 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=false goal_failed=false error_code=-
I 21:23:49 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=following_path goal_reached=false goal_failed=false error_code=-
I 21:23:50 [Assets/Scripts/Bridge/BridgeClient.ts:687] BridgeClient: RX pose #788 pos=(0.59,-0.83,0.85)
I 21:23:51 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-115.8, band=0.5..155.0cm)
I 21:23:52 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=true goal_failed=false error_code=-
I 21:23:56 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-115.3, band=0.5..155.0cm)
I 21:24:02 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-115.3, band=0.5..155.0cm)
I 21:24:03 [Assets/Scripts/Core/DimosManager.ts:835] DimosManager: perf fps=55.9 frameMs=17.9 msgRxHz=14.4 poseRxHz=13.2 poseApplyHz=12.3
I 21:24:08 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-115.3, band=0.5..155.0cm)
I 21:24:14 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-115.3, band=0.5..155.0cm)
I 21:24:15 [Assets/Scripts/Core/DimosManager.ts:923] DimosManager: bridge connection: disconnected
I 21:24:16 [Assets/Scripts/Navigation/PlacementController.ts:98] PlacementController: stop
I 21:24:16 [Assets/Scripts/Navigation/NavigationController.ts:284] NavigationController: placement enabled
I 21:24:16 [Assets/Scripts/Navigation/PlacementController.ts:82] PlacementController: start at (-16.4, -137.3, 96.2)
I 21:24:16 [Assets/Scripts/Bridge/BridgeClient.ts:266] BridgeClient: socket closed code=1011 reason="Connection failure while receiving message"
I 21:24:16 [Assets/Scripts/Core/DimosManager.ts:923] DimosManager: bridge connection: disconnected
I 21:24:16 [Assets/Scripts/Navigation/PlacementController.ts:98] PlacementController: stop
I 21:24:16 [Assets/Scripts/Navigation/NavigationController.ts:284] NavigationController: placement enabled
I 21:24:16 [Assets/Scripts/Navigation/PlacementController.ts:82] PlacementController: start at (-16.4, -137.3, 96.2)
I 21:24:27 [Assets/Scripts/Core/DimosManager.ts:923] DimosManager: setNavigationPlacementEnabled: false
I 21:24:27 [Assets/Scripts/Navigation/NavigationController.ts:296] NavigationController: placement disabled
I 21:24:27 [Assets/Scripts/Navigation/PlacementController.ts:98] PlacementController: stop
I 21:24:28 [Assets/Scripts/Core/DimosManager.ts:923] DimosManager: setOperatingMode: agent
I 21:24:29 [Assets/Scripts/Core/DimosManager.ts:923] DimosManager: setOperatingMode: manual
I 21:24:29 [Assets/Scripts/Core/DimosManager.ts:923] DimosManager: setNavigationPlacementEnabled: true
I 21:24:29 [Assets/Scripts/Navigation/NavigationController.ts:284] NavigationController: placement enabled
I 21:24:29 [Assets/Scripts/Navigation/PlacementController.ts:82] PlacementController: start at (-16.4, -137.3, 96.2)
I 21:24:33 [Assets/Scripts/Core/DimosManager.ts:835] DimosManager: perf fps=35.5 frameMs=28.1 msgRxHz=5.1 poseRxHz=4.7 poseApplyHz=2.5
W 21:25:09 Spectacles has disconnected from Lens Studio.
I 21:31:43 Project saved /Users/johannestscharn/Repositories/spectacles-dimensional-os/lens-studio/spectacles-dimensional-os.esproj
I 21:33:33 Project saved /Users/johannestscharn/Repositories/spectacles-dimensional-os/lens-studio/spectacles-dimensional-os.esproj
I 21:46:05 Importing new asset Assets/Scripts/Setup/AssistPreviewPresentation.ts
I 21:46:05 Starting TypeScript compilation...
I 21:46:05 Asset AssistPreviewPresentation.ts loaded in 645 ms
I 21:46:06 Lens has been reset
I 21:46:08 TypeScript compilation succeeded!
I 21:46:08 Lens has been reset
I 21:46:10 [Packages/SpectaclesInteractionKit.lspkg/Core/ConfigurationValidator/ConfigurationValidator.ts:16] SIK Version : 0.17.2
I 21:46:10 [Assets/Scripts/Core/DimosManager.ts:923] DimosManager: enterSetup
I 21:46:10 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 21:46:10 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 21:46:10 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: start
I 21:46:10 [Assets/Scripts/Core/DimosManager.ts:923] DimosManager: enterSetup
I 21:46:14 Source file was changed, reimporting Assets/Scripts/Core/DimosManager.ts
I 21:46:15 Starting TypeScript compilation...
I 21:46:15 Asset DimosManager.ts loaded in 141 ms
I 21:46:15 Lens has been reset
I 21:46:15 Lens has been reset
I 21:46:16 TypeScript compilation succeeded!
I 21:46:17 Lens has been reset
I 21:46:18 [Packages/SpectaclesInteractionKit.lspkg/Core/ConfigurationValidator/ConfigurationValidator.ts:16] SIK Version : 0.17.2
I 21:46:18 [Assets/Scripts/Core/DimosManager.ts:1002] DimosManager: enterSetup
I 21:46:18 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 21:46:18 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 21:46:18 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: start
I 21:46:18 [Assets/Scripts/Core/DimosManager.ts:1002] DimosManager: enterSetup
I 21:46:23 Source file was changed, reimporting Assets/Scripts/Setup/CalibrationFlow.ts
I 21:46:24 Starting TypeScript compilation...
I 21:46:24 Asset CalibrationFlow.ts loaded in 787 ms
I 21:46:24 Lens has been reset
I 21:46:26 TypeScript compilation succeeded!
W 21:46:26 Lens has been reset more than 10 times in a row
I 21:46:27 Source file was changed, reimporting Assets/Scripts/Robot/RobotMarker.ts
I 21:46:27 Starting TypeScript compilation...
I 21:46:27 Asset RobotMarker.ts loaded in 117 ms
I 21:46:28 [Packages/SpectaclesInteractionKit.lspkg/Core/ConfigurationValidator/ConfigurationValidator.ts:16] SIK Version : 0.17.2
I 21:46:31 [Assets/Scripts/Core/DimosManager.ts:1002] DimosManager: enterSetup
I 21:46:31 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 21:46:31 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 21:46:31 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: start
I 21:46:31 [Assets/Scripts/Core/DimosManager.ts:1002] DimosManager: enterSetup
I 21:46:33 TypeScript compilation succeeded!
I 21:46:34 [Packages/SpectaclesInteractionKit.lspkg/Core/ConfigurationValidator/ConfigurationValidator.ts:16] SIK Version : 0.17.2
I 21:46:35 [Assets/Scripts/Core/DimosManager.ts:1002] DimosManager: enterSetup
I 21:46:35 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 21:46:35 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 21:46:35 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: start
I 21:46:35 [Assets/Scripts/Core/DimosManager.ts:1002] DimosManager: enterSetup
I 21:48:27 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: startup step completed
I 21:48:27 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: step start -> connect
I 21:48:27 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: connect attempt 192.168.1.62
I 21:48:27 [Assets/Scripts/Bridge/BridgeClient.ts:216] BridgeClient: connecting to ws://192.168.1.62:8787
I 21:48:28 [Assets/Scripts/Core/DimosManager.ts:1002] DimosManager: bridge connection: disconnected
I 21:48:28 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: connect step skipped
I 21:48:28 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: step connect -> calibrate
I 21:48:28 [Assets/Scripts/Alignment/AlignmentSession.ts:188] AlignmentSession: beginManualPlacement pos=(2.0,-32.2,-82.3) rot=(0.017,-0.012,0.000,1.000)
I 21:48:28 [Assets/Scripts/Core/DimosManager.ts:1002] DimosManager: robotInteractionMode: manualPlacement
I 21:48:28 [Assets/Scripts/Alignment/AlignmentSession.ts:112] AlignmentSession: start method=manual assist=false
I 21:48:28 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: manual alignment placement started
I 21:48:31 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: manual alignment disabled
I 21:48:31 [Assets/Scripts/Core/DimosManager.ts:1002] DimosManager: robotInteractionMode: hidden
I 21:48:31 [Assets/Scripts/Alignment/AlignmentSession.ts:143] AlignmentSession: stop (manual)
I 21:48:31 [Assets/Scripts/Core/DimosManager.ts:1002] DimosManager: setOperatingMode: setup
I 21:48:31 [Assets/Scripts/Alignment/FrameCaptureController.ts:87] FrameCaptureController: mode off -> setup
I 21:48:31 [Assets/Scripts/Alignment/FrameCaptureController.ts:240] FrameCaptureController: camera stream started
I 21:48:31 [Assets/Scripts/Alignment/AlignmentSession.ts:112] AlignmentSession: start method=tag assist=true
I 21:48:35 [Assets/Scripts/Core/DimosManager.ts:1002] DimosManager: setOperatingMode: manual
I 21:48:35 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: manual alignment enabled
I 21:48:35 [Assets/Scripts/Alignment/FrameCaptureController.ts:87] FrameCaptureController: mode setup -> off
I 21:48:35 [Assets/Scripts/Alignment/FrameCaptureController.ts:251] FrameCaptureController: camera stream stopped
I 21:48:35 [Assets/Scripts/Alignment/AlignmentSession.ts:141] AlignmentSession: stop (marker)
I 21:48:35 [Assets/Scripts/Alignment/AlignmentSession.ts:188] AlignmentSession: beginManualPlacement pos=(2.0,-32.2,-82.3) rot=(0.017,-0.012,0.000,1.000)
I 21:48:35 [Assets/Scripts/Core/DimosManager.ts:1002] DimosManager: robotInteractionMode: manualPlacement
I 21:48:35 [Assets/Scripts/Alignment/AlignmentSession.ts:112] AlignmentSession: start method=manual assist=false
I 21:48:35 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: manual alignment placement started
I 21:48:35 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: manual alignment disabled
I 21:48:35 [Assets/Scripts/Core/DimosManager.ts:1002] DimosManager: robotInteractionMode: hidden
I 21:48:35 [Assets/Scripts/Alignment/AlignmentSession.ts:143] AlignmentSession: stop (manual)
I 21:48:35 [Assets/Scripts/Core/DimosManager.ts:1002] DimosManager: setOperatingMode: setup
I 21:48:35 [Assets/Scripts/Alignment/FrameCaptureController.ts:87] FrameCaptureController: mode off -> setup
I 21:48:35 [Assets/Scripts/Alignment/FrameCaptureController.ts:240] FrameCaptureController: camera stream started
I 21:48:35 [Assets/Scripts/Alignment/AlignmentSession.ts:112] AlignmentSession: start method=tag assist=true
I 21:48:38 [Assets/Scripts/Core/DimosManager.ts:1002] DimosManager: setOperatingMode: manual
I 21:48:39 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: manual alignment enabled
I 21:48:39 [Assets/Scripts/Alignment/FrameCaptureController.ts:87] FrameCaptureController: mode setup -> off
I 21:48:39 [Assets/Scripts/Alignment/FrameCaptureController.ts:251] FrameCaptureController: camera stream stopped
I 21:48:39 [Assets/Scripts/Alignment/AlignmentSession.ts:141] AlignmentSession: stop (marker)
I 21:48:39 [Assets/Scripts/Alignment/AlignmentSession.ts:188] AlignmentSession: beginManualPlacement pos=(2.0,-32.2,-82.3) rot=(0.017,-0.012,0.000,1.000)
I 21:48:39 [Assets/Scripts/Core/DimosManager.ts:1002] DimosManager: robotInteractionMode: manualPlacement
I 21:48:39 [Assets/Scripts/Alignment/AlignmentSession.ts:112] AlignmentSession: start method=manual assist=false
I 21:48:39 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: manual alignment placement started
I 21:48:39 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: manual alignment disabled
I 21:48:39 [Assets/Scripts/Core/DimosManager.ts:1002] DimosManager: robotInteractionMode: hidden
I 21:48:39 [Assets/Scripts/Alignment/AlignmentSession.ts:143] AlignmentSession: stop (manual)
I 21:48:39 [Assets/Scripts/Core/DimosManager.ts:1002] DimosManager: setOperatingMode: setup
I 21:48:39 [Assets/Scripts/Alignment/FrameCaptureController.ts:87] FrameCaptureController: mode off -> setup
I 21:48:39 [Assets/Scripts/Alignment/FrameCaptureController.ts:240] FrameCaptureController: camera stream started
I 21:48:39 [Assets/Scripts/Alignment/AlignmentSession.ts:112] AlignmentSession: start method=tag assist=true
I 21:48:41 [Assets/Scripts/Core/DimosManager.ts:1002] DimosManager: setOperatingMode: manual
I 21:48:41 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: manual alignment enabled
I 21:48:41 [Assets/Scripts/Alignment/FrameCaptureController.ts:87] FrameCaptureController: mode setup -> off
I 21:48:41 [Assets/Scripts/Alignment/FrameCaptureController.ts:251] FrameCaptureController: camera stream stopped
I 21:48:41 [Assets/Scripts/Alignment/AlignmentSession.ts:141] AlignmentSession: stop (marker)
I 21:48:41 [Assets/Scripts/Alignment/AlignmentSession.ts:188] AlignmentSession: beginManualPlacement pos=(2.0,-32.2,-82.3) rot=(0.017,-0.012,0.000,1.000)
I 21:48:41 [Assets/Scripts/Core/DimosManager.ts:1002] DimosManager: robotInteractionMode: manualPlacement
I 21:48:41 [Assets/Scripts/Alignment/AlignmentSession.ts:112] AlignmentSession: start method=manual assist=false
I 21:48:41 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: manual alignment placement started
I 21:48:59 Source file was changed, reimporting Assets/Scripts/Setup/AssistPreviewPresentation.ts
I 21:48:59 Starting TypeScript compilation...
I 21:48:59 Asset AssistPreviewPresentation.ts loaded in 314 ms
I 21:49:01 TypeScript compilation succeeded!
I 21:49:02 Source file was changed, reimporting Assets/Scripts/Setup/AssistPreviewPresentation.ts
I 21:49:02 Starting TypeScript compilation...
I 21:49:02 Asset AssistPreviewPresentation.ts loaded in 96 ms
I 21:49:03 [Packages/SpectaclesInteractionKit.lspkg/Core/ConfigurationValidator/ConfigurationValidator.ts:16] SIK Version : 0.17.2
I 21:49:03 TypeScript compilation succeeded!
I 21:49:04 [Assets/Scripts/Core/DimosManager.ts:1002] DimosManager: enterSetup
I 21:49:04 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 21:49:04 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 21:49:04 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: start
I 21:49:04 [Assets/Scripts/Core/DimosManager.ts:1002] DimosManager: enterSetup
I 21:49:04 [Packages/SpectaclesInteractionKit.lspkg/Core/ConfigurationValidator/ConfigurationValidator.ts:16] SIK Version : 0.17.2
I 21:49:04 [Assets/Scripts/Core/DimosManager.ts:1002] DimosManager: enterSetup
I 21:49:04 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 21:49:04 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 21:49:04 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: start
I 21:49:04 [Assets/Scripts/Core/DimosManager.ts:1002] DimosManager: enterSetup
I 21:49:05 Source file was changed, reimporting Assets/Scripts/Setup/AssistPreviewPresentation.ts
I 21:49:05 Starting TypeScript compilation...
I 21:49:05 Asset AssistPreviewPresentation.ts loaded in 78 ms
I 21:49:06 TypeScript compilation succeeded!
I 21:49:07 [Packages/SpectaclesInteractionKit.lspkg/Core/ConfigurationValidator/ConfigurationValidator.ts:16] SIK Version : 0.17.2
I 21:49:07 [Assets/Scripts/Core/DimosManager.ts:1002] DimosManager: enterSetup
I 21:49:07 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 21:49:07 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 21:49:07 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: start
I 21:49:07 [Assets/Scripts/Core/DimosManager.ts:1002] DimosManager: enterSetup
I 21:50:05 Source file was changed, reimporting Assets/Scripts/Alignment/FrameCaptureController.ts
I 21:50:07 Starting TypeScript compilation...
I 21:50:07 Asset FrameCaptureController.ts loaded in 1.37 sec
I 21:50:10 Source file was changed, reimporting Assets/Scripts/Robot/RobotMarker.ts
I 21:50:10 Asset RobotMarker.ts loaded in 138 ms
I 21:50:13 Source file was changed, reimporting Assets/Scripts/Core/DimosManager.ts
I 21:50:13 Asset DimosManager.ts loaded in 149 ms
I 21:50:15 TypeScript compilation succeeded!
I 21:50:18 [Packages/SpectaclesInteractionKit.lspkg/Core/ConfigurationValidator/ConfigurationValidator.ts:16] SIK Version : 0.17.2
I 21:50:18 [Assets/Scripts/Core/DimosManager.ts:1003] DimosManager: enterSetup
I 21:50:18 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 21:50:18 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 21:50:18 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: start
I 21:50:18 [Assets/Scripts/Core/DimosManager.ts:1003] DimosManager: enterSetup
I 21:51:03 Source file was changed, reimporting Assets/Scripts/Alignment/FrameCaptureController.ts
I 21:51:04 Starting TypeScript compilation...
I 21:51:05 Asset FrameCaptureController.ts loaded in 1.14 sec
I 21:51:06 Project saved /Users/johannestscharn/Repositories/spectacles-dimensional-os/lens-studio/spectacles-dimensional-os.esproj
I 21:51:12 TypeScript compilation succeeded!
I 21:51:16 [Packages/SpectaclesInteractionKit.lspkg/Core/ConfigurationValidator/ConfigurationValidator.ts:16] SIK Version : 0.17.2
I 21:51:18 [Assets/Scripts/Core/DimosManager.ts:1003] DimosManager: enterSetup
I 21:51:18 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 21:51:18 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 21:51:18 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: start
I 21:51:18 [Assets/Scripts/Core/DimosManager.ts:1003] DimosManager: enterSetup
I 21:52:09 Spectacles has successfully connected to Lens Studio with a wireless connection.
W 21:52:36 Spectacles has disconnected from Lens Studio.
I 21:52:45 Spectacles has successfully connected to Lens Studio with a wireless connection.
I 21:53:02 The Lens was sent in 6.49 sec
I 21:53:14 Spectacles has successfully connected to Lens Studio with a wireless connection.
I 21:53:22 The Lens was sent in 2.99 sec
I 21:53:33 Spectacles has successfully connected to Lens Studio with a wireless connection.
I 21:53:54 Spectacles connected to USB
I 21:54:17 Sending lens to Spectacles in progress, 11 seconds elapsed
I 21:54:19 The Lens was sent in 13.93 sec
I 21:54:29 [Packages/SpectaclesInteractionKit.lspkg/Core/ConfigurationValidator/ConfigurationValidator.ts:16] SIK Version : 0.17.2
I 21:54:30 Spectacles disconnected from USB
I 21:54:31 The sent Lens has successfully started on Spectacles
I 21:54:31 [Assets/Scripts/Core/DimosManager.ts:1003] DimosManager: enterSetup
I 21:54:31 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 21:54:31 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 21:54:31 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: start
I 21:54:31 [Assets/Scripts/Core/DimosManager.ts:1003] DimosManager: enterSetup
I 21:54:43 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: startup step completed
I 21:54:43 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: step start -> connect
I 21:54:43 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: connect attempt 192.168.1.166
I 21:54:43 [Assets/Scripts/Bridge/BridgeClient.ts:216] BridgeClient: connecting to ws://192.168.1.166:8787
I 21:54:44 [Assets/Scripts/Bridge/BridgeClient.ts:242] BridgeClient: connected
I 21:54:44 [Assets/Scripts/Core/DimosManager.ts:1003] DimosManager: bridge connection: connected
I 21:54:44 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: connect succeeded
I 21:54:44 [Assets/Scripts/Bridge/BridgeClient.ts:710] BridgeClient: RX bridge_status registered=false robot_connected=true
I 21:54:44 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=false goal_failed=false error_code=-
I 21:54:44 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: connect step completed
I 21:54:44 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: step connect -> calibrate
I 21:54:44 [Assets/Scripts/Core/DimosManager.ts:1003] DimosManager: setOperatingMode: setup
I 21:54:44 [Assets/Scripts/Bridge/BridgeClient.ts:665] BridgeClient: align_start TX robot=unitree_go2 bytes=100 sent=true
I 21:54:44 [Assets/Scripts/Alignment/AlignmentSession.ts:320] AlignmentSession: align_start{method:tag,assist:true} sent
I 21:54:44 [Assets/Scripts/Alignment/FrameCaptureController.ts:88] FrameCaptureController: mode off -> setup
I 21:54:44 [Assets/Scripts/Alignment/FrameCaptureController.ts:243] FrameCaptureController: camera stream started
I 21:54:44 [Assets/Scripts/Alignment/AlignmentSession.ts:112] AlignmentSession: start method=tag assist=true
I 21:54:44 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: align_status state=detecting method=tag progress=0 "Look at the AprilTag on your robot"
I 21:54:44 [Assets/Scripts/Alignment/FrameCaptureController.ts:474] FrameCaptureController: camera_info sent 1008x756 scale=1.000x1.000
I 21:54:45 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: align_status state=detecting method=tag progress=49 "Tag detected — collecting samples (1)"
I 21:54:48 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: align_status state=detecting method=tag progress=100 "Tag detected — collecting samples (2)"
I 21:55:01 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: align_status state=detecting method=tag progress=0 "Robot moving — leg 1/3"
I 21:55:27 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: align_status state=detecting method=tag progress=33 "Tag detected — collecting samples (24)"
I 21:55:34 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: align_status state=detecting method=tag progress=66 "Tag detected — collecting samples (29)"
I 21:55:42 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: align_status state=detecting method=tag progress=100 "Tag detected — collecting samples (34)"
I 21:55:42 [Assets/Scripts/Bridge/BridgeClient.ts:710] BridgeClient: RX bridge_status registered=true robot_connected=true
I 21:55:42 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: align_status state=aligned method=tag progress=100 "Alignment successful"
I 21:55:42 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: alignment succeeded (progress=100%)
I 21:55:43 [Assets/Scripts/Bridge/BridgeClient.ts:687] BridgeClient: RX pose #1 pos=(-0.31,-0.90,1.48)
I 21:55:44 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: finish connect=done calibration=done
I 21:55:44 [Assets/Scripts/Bridge/BridgeClient.ts:665] BridgeClient: align_stop TX robot=unitree_go2 bytes=69 sent=true
I 21:55:44 [Assets/Scripts/Alignment/FrameCaptureController.ts:88] FrameCaptureController: mode setup -> runtime
I 21:55:44 [Assets/Scripts/Alignment/FrameCaptureController.ts:254] FrameCaptureController: camera stream stopped
I 21:55:44 [Assets/Scripts/Alignment/AlignmentSession.ts:141] AlignmentSession: stop (marker)
I 21:55:44 [Assets/Scripts/Core/DimosManager.ts:1003] DimosManager: enterRuntime
I 21:55:44 [Assets/Scripts/Core/DimosManager.ts:1003] DimosManager: setOperatingMode: manual
I 21:55:44 [Assets/Scripts/Core/DimosManager.ts:1003] DimosManager: robotInteractionMode: runtimeRobot
I 21:55:44 [Assets/Scripts/Navigation/NavigationController.ts:284] NavigationController: placement enabled
I 21:55:44 [Assets/Scripts/Navigation/PlacementController.ts:82] PlacementController: start at (-30.7, -123.1, 147.5)
I 21:55:44 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-122.6, band=0.5..155.0cm)
I 21:55:49 [Assets/Scripts/Alignment/FrameCaptureController.ts:435] FrameCaptureController: ImageFrame.timestampMillis unavailable; using still request start time
I 21:55:49 [Assets/Scripts/Alignment/FrameCaptureController.ts:474] FrameCaptureController: camera_info sent 3200x2400 scale=3.175x3.175
I 21:55:50 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-122.6, band=0.5..155.0cm)
I 21:55:51 [Assets/Scripts/Core/DimosManager.ts:915] DimosManager: perf fps=59.9 frameMs=16.7 msgRxHz=0.0 poseRxHz=0.0 poseApplyHz=0.0
I 21:55:56 [Assets/Scripts/Navigation/NavigationController.ts:593] NavigationController: goal confirmed at (-107.0, -117.2, 129.4)
I 21:55:57 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-122.6, band=0.5..155.0cm)
I 21:55:57 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=following_path goal_reached=false goal_failed=false error_code=-
I 21:56:01 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-122.4, band=0.5..155.0cm)
I 21:56:03 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=true goal_failed=false error_code=-
I 21:56:13 [Assets/Scripts/Bridge/BridgeClient.ts:687] BridgeClient: RX pose #376 pos=(-0.09,-0.88,1.32)
I 21:56:13 Project saved /Users/johannestscharn/Repositories/spectacles-dimensional-os/lens-studio/spectacles-dimensional-os.esproj
I 21:56:15 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-121.1, band=0.5..155.0cm)
I 21:56:17 [Assets/Scripts/Navigation/NavigationController.ts:593] NavigationController: goal confirmed at (-72.6, -117.7, 157.1)
I 21:56:18 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=false goal_failed=false error_code=-
I 21:56:20 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=following_path goal_reached=false goal_failed=false error_code=-
I 21:56:21 [Assets/Scripts/Core/DimosManager.ts:915] DimosManager: perf fps=59.2 frameMs=16.9 msgRxHz=13.7 poseRxHz=12.1 poseApplyHz=11.4
I 21:56:28 [Assets/Scripts/Navigation/NavigationController.ts:866] NavigationController: nav lifecycle stale; requesting bridge status resync
I 21:56:29 [Assets/Scripts/Navigation/NavigationController.ts:611] NavigationController: goal cancelled
I 21:56:29 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=false goal_failed=false error_code=-
I 21:56:30 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=true goal_failed=false error_code=-
I 21:56:34 [Assets/Scripts/Navigation/NavigationController.ts:593] NavigationController: goal confirmed at (-79.1, -122.1, 120.8)
I 21:56:39 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=false goal_failed=false error_code=-
I 21:56:39 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=following_path goal_reached=false goal_failed=false error_code=-
I 21:56:43 [Assets/Scripts/Bridge/BridgeClient.ts:687] BridgeClient: RX pose #617 pos=(-0.56,-0.89,1.20)
I 21:56:47 [Assets/Scripts/Navigation/NavigationController.ts:866] NavigationController: nav lifecycle stale; requesting bridge status resync
I 21:56:50 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=true goal_failed=false error_code=-
I 21:56:51 [Assets/Scripts/Core/DimosManager.ts:915] DimosManager: perf fps=58.9 frameMs=17.0 msgRxHz=7.1 poseRxHz=5.5 poseApplyHz=5.1
I 21:56:53 [Assets/Scripts/Bridge/BridgeClient.ts:710] BridgeClient: RX bridge_status registered=true robot_connected=false
I 21:57:11 [Assets/Scripts/Core/DimosManager.ts:915] DimosManager: perf fps=39.9 frameMs=25.1 msgRxHz=0.0 poseRxHz=0.0 poseApplyHz=0.0
W 21:58:08 Spectacles has disconnected from Lens Studio.
I 22:06:53 [Packages/SpectaclesInteractionKit.lspkg/Core/ConfigurationValidator/ConfigurationValidator.ts:16] SIK Version : 0.17.2
I 22:06:54 [Assets/Scripts/Core/DimosManager.ts:1003] DimosManager: enterSetup
I 22:06:54 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 22:06:54 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 22:06:54 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: start
I 22:06:54 [Assets/Scripts/Core/DimosManager.ts:1003] DimosManager: enterSetup
I 22:10:54 Spectacles has successfully connected to Lens Studio with a wireless connection.
I 22:10:56 Spectacles connected to USB
I 22:12:43 Source file was changed, reimporting Assets/Scripts/Core/DimosManager.ts
I 22:12:43 Starting TypeScript compilation...
I 22:12:43 Asset DimosManager.ts loaded in 195 ms
I 22:12:47 TypeScript compilation succeeded!
I 22:12:49 [Packages/SpectaclesInteractionKit.lspkg/Core/ConfigurationValidator/ConfigurationValidator.ts:16] SIK Version : 0.17.2
I 22:12:49 [Assets/Scripts/Core/DimosManager.ts:1015] DimosManager: enterSetup
I 22:12:49 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 22:12:49 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 22:12:49 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: start
I 22:12:49 [Assets/Scripts/Core/DimosManager.ts:1015] DimosManager: enterSetup
I 22:12:52 Source file was changed, reimporting Assets/Scripts/Alignment/FrameCaptureController.ts
I 22:12:52 Starting TypeScript compilation...
I 22:12:52 Asset FrameCaptureController.ts loaded in 119 ms
I 22:12:55 TypeScript compilation succeeded!
I 22:12:56 [Packages/SpectaclesInteractionKit.lspkg/Core/ConfigurationValidator/ConfigurationValidator.ts:16] SIK Version : 0.17.2
I 22:12:56 [Assets/Scripts/Core/DimosManager.ts:1015] DimosManager: enterSetup
I 22:12:56 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 22:12:56 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 22:12:56 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: start
I 22:12:56 [Assets/Scripts/Core/DimosManager.ts:1015] DimosManager: enterSetup
I 22:12:57 Source file was changed, reimporting Assets/Scripts/Alignment/FrameCaptureController.ts
I 22:12:57 Starting TypeScript compilation...
I 22:12:57 Asset FrameCaptureController.ts loaded in 165 ms
I 22:13:00 TypeScript compilation succeeded!
I 22:13:01 [Packages/SpectaclesInteractionKit.lspkg/Core/ConfigurationValidator/ConfigurationValidator.ts:16] SIK Version : 0.17.2
I 22:13:01 [Assets/Scripts/Core/DimosManager.ts:1015] DimosManager: enterSetup
I 22:13:01 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 22:13:01 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 22:13:01 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: start
I 22:13:01 [Assets/Scripts/Core/DimosManager.ts:1015] DimosManager: enterSetup
I 22:13:09 Source file was changed, reimporting Assets/Scripts/Core/DimosManager.ts
I 22:13:09 Starting TypeScript compilation...
I 22:13:09 Asset DimosManager.ts loaded in 97 ms
I 22:13:11 Source file was changed, reimporting Assets/Scripts/Alignment/FrameCaptureController.ts
I 22:13:12 Asset FrameCaptureController.ts loaded in 114 ms
I 22:13:13 TypeScript compilation succeeded!
I 22:13:14 [Packages/SpectaclesInteractionKit.lspkg/Core/ConfigurationValidator/ConfigurationValidator.ts:16] SIK Version : 0.17.2
I 22:13:15 [Assets/Scripts/Core/DimosManager.ts:1011] DimosManager: enterSetup
I 22:13:15 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 22:13:15 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 22:13:15 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: start
I 22:13:15 [Assets/Scripts/Core/DimosManager.ts:1011] DimosManager: enterSetup
I 22:14:41 Source file was changed, reimporting Assets/Scripts/Core/DimosManager.ts
I 22:14:41 Starting TypeScript compilation...
I 22:14:41 Asset DimosManager.ts loaded in 267 ms
I 22:14:43 TypeScript compilation succeeded!
I 22:14:45 [Packages/SpectaclesInteractionKit.lspkg/Core/ConfigurationValidator/ConfigurationValidator.ts:16] SIK Version : 0.17.2
I 22:14:45 [Assets/Scripts/Core/DimosManager.ts:1014] DimosManager: enterSetup
I 22:14:45 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 22:14:45 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 22:14:45 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: start
I 22:14:45 [Assets/Scripts/Core/DimosManager.ts:1014] DimosManager: enterSetup
I 22:15:52 Spectacles disconnected from USB
I 22:16:06 The Lens was sent in 3.55 sec
I 22:16:07 Spectacles connected to USB
I 22:16:09 The Lens was sent in 2.71 sec
I 22:17:43 Project saved /Users/johannestscharn/Repositories/spectacles-dimensional-os/lens-studio/spectacles-dimensional-os.esproj
I 22:18:04 Spectacles disconnected from USB
I 22:18:16 [Packages/SpectaclesInteractionKit.lspkg/Core/ConfigurationValidator/ConfigurationValidator.ts:16] SIK Version : 0.17.2
I 22:18:17 The sent Lens has successfully started on Spectacles
I 22:18:17 [Assets/Scripts/Core/DimosManager.ts:1014] DimosManager: enterSetup
I 22:18:17 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 22:18:18 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 22:18:18 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: start
I 22:18:18 [Assets/Scripts/Core/DimosManager.ts:1014] DimosManager: enterSetup
I 22:18:19 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: startup step completed
I 22:18:19 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: step start -> connect
I 22:18:19 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: connect attempt 192.168.1.166
I 22:18:19 [Assets/Scripts/Bridge/BridgeClient.ts:216] BridgeClient: connecting to ws://192.168.1.166:8787
I 22:18:19 [Assets/Scripts/Bridge/BridgeClient.ts:242] BridgeClient: connected
I 22:18:19 [Assets/Scripts/Core/DimosManager.ts:1014] DimosManager: bridge connection: connected
I 22:18:19 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: connect succeeded
I 22:18:19 [Assets/Scripts/Bridge/BridgeClient.ts:710] BridgeClient: RX bridge_status registered=false robot_connected=true
I 22:18:19 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=false goal_failed=false error_code=-
I 22:18:21 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: connect step completed
I 22:18:21 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: step connect -> calibrate
I 22:18:21 [Assets/Scripts/Core/DimosManager.ts:1014] DimosManager: setOperatingMode: setup
I 22:18:21 [Assets/Scripts/Bridge/BridgeClient.ts:665] BridgeClient: align_start TX robot=unitree_go2 bytes=99 sent=true
I 22:18:21 [Assets/Scripts/Alignment/AlignmentSession.ts:320] AlignmentSession: align_start{method:tag,assist:true} sent
I 22:18:21 [Assets/Scripts/Alignment/FrameCaptureController.ts:102] FrameCaptureController: mode off -> setup
I 22:18:21 [Assets/Scripts/Alignment/FrameCaptureController.ts:258] FrameCaptureController: camera stream started
I 22:18:21 [Assets/Scripts/Alignment/AlignmentSession.ts:112] AlignmentSession: start method=tag assist=true
I 22:18:21 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: align_status state=detecting method=tag progress=0 "Look at the AprilTag on your robot"
I 22:18:21 [Assets/Scripts/Alignment/FrameCaptureController.ts:571] FrameCaptureController: camera_info sent 1008x756 scale=1.000x1.000
I 22:18:21 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: align_status state=detecting method=tag progress=49 "Tag detected — collecting samples (1)"
I 22:18:23 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: align_status state=detecting method=tag progress=100 "Tag detected — collecting samples (2)"
I 22:18:29 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: align_status state=detecting method=tag progress=0 "Robot moving — leg 1/3"
I 22:18:38 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: align_status state=detecting method=tag progress=33 "Robot moving — leg 2/3"
I 22:18:51 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: align_status state=detecting method=tag progress=66 "Robot moving — leg 3/3 (returning to start)"
I 22:19:00 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: align_status state=detecting method=tag progress=100 "Tag detected — collecting samples (27)"
I 22:19:00 [Assets/Scripts/Bridge/BridgeClient.ts:710] BridgeClient: RX bridge_status registered=true robot_connected=true
I 22:19:00 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: align_status state=aligned method=tag progress=100 "Alignment successful"
I 22:19:00 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: alignment succeeded (progress=100%)
I 22:19:00 [Assets/Scripts/Bridge/BridgeClient.ts:687] BridgeClient: RX pose #1 pos=(0.05,-0.89,-0.90)
I 22:19:01 [Assets/Scripts/Core/DimosManager.ts:341] DimosManager: pose_correction transDeltaM=0.021 yawDeltaDeg=0.00 yawCorrected=false solveQuality=0.905 solveMethod=tag_translation
I 22:19:02 [Assets/Scripts/Setup/SetupWizard.ts:504] SetupWizard: finish connect=done calibration=done
I 22:19:02 [Assets/Scripts/Bridge/BridgeClient.ts:665] BridgeClient: align_stop TX robot=unitree_go2 bytes=69 sent=true
I 22:19:02 [Assets/Scripts/Alignment/FrameCaptureController.ts:102] FrameCaptureController: mode setup -> runtime
I 22:19:02 [Assets/Scripts/Alignment/FrameCaptureController.ts:269] FrameCaptureController: camera stream stopped
I 22:19:02 [Assets/Scripts/Alignment/AlignmentSession.ts:141] AlignmentSession: stop (marker)
I 22:19:02 [Assets/Scripts/Core/DimosManager.ts:1014] DimosManager: enterRuntime
I 22:19:02 [Assets/Scripts/Core/DimosManager.ts:1014] DimosManager: setOperatingMode: manual
I 22:19:02 [Assets/Scripts/Core/DimosManager.ts:1014] DimosManager: robotInteractionMode: runtimeRobot
I 22:19:02 [Assets/Scripts/Navigation/NavigationController.ts:284] NavigationController: placement enabled
I 22:19:02 [Assets/Scripts/Navigation/PlacementController.ts:82] PlacementController: start at (4.2, -121.1, -91.4)
I 22:19:02 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-121.1, band=0.5..155.0cm)
I 22:19:03 [Assets/Scripts/Alignment/FrameCaptureController.ts:477] FrameCaptureController: ImageFrame timestamp unavailable; using still request midpoint fallback
I 22:19:03 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1880 headAngularDeg=22.54 headLinearCm=39.11 captureTsSource=midpoint_fallback dropped=true
I 22:19:08 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-121.1, band=0.5..155.0cm)
I 22:19:08 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1763 headAngularDeg=10.28 headLinearCm=4.44 captureTsSource=midpoint_fallback dropped=true
I 22:19:10 [Assets/Scripts/Core/DimosManager.ts:926] DimosManager: perf fps=59.9 frameMs=16.7 msgRxHz=0.0 poseRxHz=0.0 poseApplyHz=0.0
I 22:19:12 [Assets/Scripts/Navigation/NavigationController.ts:593] NavigationController: goal confirmed at (-62.3, -116.6, -94.6)
I 22:19:13 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-121.1, band=0.5..155.0cm)
I 22:19:13 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=following_path goal_reached=false goal_failed=false error_code=-
I 22:19:13 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1796 headAngularDeg=4.51 headLinearCm=4.39 captureTsSource=midpoint_fallback dropped=true
I 22:19:18 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1637 headAngularDeg=25.28 headLinearCm=9.09 captureTsSource=midpoint_fallback dropped=true
I 22:19:18 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=true goal_failed=false error_code=-
I 22:19:23 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1729 headAngularDeg=11.83 headLinearCm=9.26 captureTsSource=midpoint_fallback dropped=true
I 22:19:24 [Assets/Scripts/Navigation/NavigationController.ts:593] NavigationController: goal confirmed at (40.0, -114.3, -89.7)
I 22:19:24 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=false goal_failed=false error_code=-
I 22:19:24 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=following_path goal_reached=false goal_failed=false error_code=-
I 22:19:27 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1763 headAngularDeg=11.07 headLinearCm=8.60 captureTsSource=midpoint_fallback dropped=true
I 22:19:28 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-121.2, band=0.5..155.0cm)
I 22:19:29 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=true goal_failed=false error_code=-
I 22:19:30 [Assets/Scripts/Bridge/BridgeClient.ts:687] BridgeClient: RX pose #402 pos=(0.43,-0.88,-0.92)
I 22:19:32 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1495 headAngularDeg=10.26 headLinearCm=15.94 captureTsSource=midpoint_fallback dropped=true
I 22:19:33 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-121.3, band=0.5..155.0cm)
I 22:19:37 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1671 headAngularDeg=18.11 headLinearCm=32.31 captureTsSource=midpoint_fallback dropped=true
I 22:19:38 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-121.3, band=0.5..155.0cm)
I 22:19:40 [Assets/Scripts/Core/DimosManager.ts:926] DimosManager: perf fps=59.5 frameMs=16.8 msgRxHz=14.7 poseRxHz=13.1 poseApplyHz=12.1
I 22:19:41 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1804 headAngularDeg=11.78 headLinearCm=6.74 captureTsSource=midpoint_fallback dropped=true
I 22:19:45 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-121.3, band=0.5..155.0cm)
I 22:19:46 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1595 headAngularDeg=5.69 headLinearCm=1.73 captureTsSource=midpoint_fallback dropped=true
I 22:19:50 [Assets/Scripts/Navigation/NavigationController.ts:593] NavigationController: goal confirmed at (-19.5, -116.0, -115.1)
I 22:19:50 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=false goal_failed=false error_code=-
I 22:19:50 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=following_path goal_reached=false goal_failed=false error_code=-
I 22:19:51 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1763 headAngularDeg=21.34 headLinearCm=7.30 captureTsSource=midpoint_fallback dropped=true
I 22:19:54 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-121.4, band=0.5..155.0cm)
I 22:19:54 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=true goal_failed=false error_code=-
I 22:19:55 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1779 headAngularDeg=15.65 headLinearCm=4.63 captureTsSource=midpoint_fallback dropped=true
I 22:19:59 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-121.2, band=0.5..155.0cm)
I 22:20:00 [Assets/Scripts/Bridge/BridgeClient.ts:687] BridgeClient: RX pose #802 pos=(-0.14,-0.88,-1.04)
I 22:20:00 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1721 headAngularDeg=8.52 headLinearCm=8.60 captureTsSource=midpoint_fallback dropped=true
I 22:20:04 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-121.1, band=0.5..155.0cm)
I 22:20:05 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1738 headAngularDeg=2.29 headLinearCm=0.49 captureTsSource=midpoint_fallback dropped=false
I 22:20:05 [Assets/Scripts/Alignment/FrameCaptureController.ts:571] FrameCaptureController: camera_info sent 3200x2400 scale=3.175x3.175
I 22:20:06 [Assets/Scripts/Navigation/NavigationController.ts:593] NavigationController: goal confirmed at (49.3, -116.4, -45.1)
I 22:20:06 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=false goal_failed=false error_code=-
I 22:20:06 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=following_path goal_reached=false goal_failed=false error_code=-
I 22:20:10 [Assets/Scripts/Core/DimosManager.ts:926] DimosManager: perf fps=59.3 frameMs=16.9 msgRxHz=15.3 poseRxHz=12.6 poseApplyHz=11.5
I 22:20:10 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-120.9, band=0.5..155.0cm)
I 22:20:11 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1712 headAngularDeg=24.79 headLinearCm=8.50 captureTsSource=midpoint_fallback dropped=true
I 22:20:11 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=true goal_failed=false error_code=-
I 22:20:16 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1771 headAngularDeg=15.25 headLinearCm=3.64 captureTsSource=midpoint_fallback dropped=true
I 22:20:17 [Assets/Scripts/Navigation/NavigationController.ts:593] NavigationController: goal confirmed at (30.5, -116.1, -102.3)
I 22:20:17 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=false goal_failed=false error_code=-
I 22:20:18 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=following_path goal_reached=false goal_failed=false error_code=-
I 22:20:21 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1804 headAngularDeg=5.47 headLinearCm=2.07 captureTsSource=midpoint_fallback dropped=true
I 22:20:22 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-120.8, band=0.5..155.0cm)
I 22:20:22 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=true goal_failed=false error_code=-
I 22:20:26 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=2030 headAngularDeg=11.18 headLinearCm=31.20 captureTsSource=midpoint_fallback dropped=true
I 22:20:30 [Assets/Scripts/Bridge/BridgeClient.ts:687] BridgeClient: RX pose #1150 pos=(0.24,-0.89,-0.88)
I 22:20:30 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1696 headAngularDeg=2.47 headLinearCm=1.63 captureTsSource=midpoint_fallback dropped=false
I 22:20:31 [Assets/Scripts/Core/DimosManager.ts:341] DimosManager: pose_correction transDeltaM=0.419 yawDeltaDeg=0.00 yawCorrected=false solveQuality=0.917 solveMethod=tag_translation
I 22:20:36 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1746 headAngularDeg=75.00 headLinearCm=60.13 captureTsSource=midpoint_fallback dropped=true
I 22:20:36 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-117.9, band=0.5..155.0cm)
I 22:20:40 [Assets/Scripts/Core/DimosManager.ts:926] DimosManager: perf fps=59.3 frameMs=16.9 msgRxHz=13.0 poseRxHz=11.4 poseApplyHz=10.0
I 22:20:41 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1721 headAngularDeg=22.32 headLinearCm=25.80 captureTsSource=midpoint_fallback dropped=true
I 22:20:42 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-117.9, band=0.5..155.0cm)
I 22:20:42 [Assets/Scripts/Navigation/NavigationController.ts:593] NavigationController: goal confirmed at (-23.4, -114.7, -105.0)
I 22:20:42 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=false goal_failed=false error_code=-
I 22:20:42 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=following_path goal_reached=false goal_failed=false error_code=-
I 22:20:46 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1821 headAngularDeg=11.64 headLinearCm=4.58 captureTsSource=midpoint_fallback dropped=true
I 22:20:47 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=true goal_failed=false error_code=-
I 22:20:47 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-117.2, band=0.5..155.0cm)
I 22:20:51 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1829 headAngularDeg=25.85 headLinearCm=22.90 captureTsSource=midpoint_fallback dropped=true
I 22:20:52 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-116.8, band=0.5..155.0cm)
I 22:20:56 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1963 headAngularDeg=1.61 headLinearCm=2.14 captureTsSource=midpoint_fallback dropped=false
I 22:20:58 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-116.8, band=0.5..155.0cm)
I 22:20:59 [Assets/Scripts/Core/DimosManager.ts:341] DimosManager: pose_correction transDeltaM=0.493 yawDeltaDeg=0.80 yawCorrected=true solveQuality=0.905 solveMethod=tag
I 22:21:00 [Assets/Scripts/Bridge/BridgeClient.ts:687] BridgeClient: RX pose #1453 pos=(-0.68,-0.81,-1.06)
I 22:21:04 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-114.0, band=0.5..155.0cm)
I 22:21:04 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1763 headAngularDeg=23.67 headLinearCm=3.87 captureTsSource=midpoint_fallback dropped=true
I 22:21:08 [Assets/Scripts/Navigation/NavigationController.ts:593] NavigationController: goal confirmed at (22.0, -115.6, -97.0)
I 22:21:08 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=false goal_failed=false error_code=-
I 22:21:08 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=following_path goal_reached=false goal_failed=false error_code=-
I 22:21:09 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1704 headAngularDeg=8.48 headLinearCm=2.14 captureTsSource=midpoint_fallback dropped=true
I 22:21:09 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-113.6, band=0.5..155.0cm)
I 22:21:10 [Assets/Scripts/Core/DimosManager.ts:926] DimosManager: perf fps=59.0 frameMs=17.0 msgRxHz=11.3 poseRxHz=9.6 poseApplyHz=6.8
I 22:21:13 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=true goal_failed=false error_code=-
I 22:21:14 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1763 headAngularDeg=22.36 headLinearCm=12.48 captureTsSource=midpoint_fallback dropped=true
I 22:21:16 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-115.3, band=0.5..155.0cm)
I 22:21:18 [Assets/Scripts/Navigation/NavigationController.ts:593] NavigationController: goal confirmed at (-28.4, -114.9, -99.5)
I 22:21:18 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=false goal_failed=false error_code=-
I 22:21:18 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=following_path goal_reached=false goal_failed=false error_code=-
I 22:21:18 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1771 headAngularDeg=2.92 headLinearCm=4.67 captureTsSource=midpoint_fallback dropped=false
I 22:21:19 [Assets/Scripts/Core/DimosManager.ts:341] DimosManager: pose_correction transDeltaM=0.141 yawDeltaDeg=2.88 yawCorrected=true solveQuality=0.890 solveMethod=tag
I 22:21:23 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-122.3, band=0.5..155.0cm)
I 22:21:23 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=true goal_failed=false error_code=-
I 22:21:24 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1779 headAngularDeg=9.03 headLinearCm=4.17 captureTsSource=midpoint_fallback dropped=true
I 22:21:28 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-121.9, band=0.5..155.0cm)
I 22:21:29 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1813 headAngularDeg=18.64 headLinearCm=3.75 captureTsSource=midpoint_fallback dropped=true
I 22:21:31 [Assets/Scripts/Bridge/BridgeClient.ts:687] BridgeClient: RX pose #1769 pos=(-0.39,-0.89,-0.97)
I 22:21:34 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1980 headAngularDeg=38.85 headLinearCm=9.12 captureTsSource=midpoint_fallback dropped=true
I 22:21:34 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-121.9, band=0.5..155.0cm)
I 22:21:36 [Assets/Scripts/Navigation/NavigationController.ts:593] NavigationController: goal confirmed at (-24.9, -121.9, -121.6)
I 22:21:36 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=false goal_failed=false error_code=-
I 22:21:36 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=following_path goal_reached=false goal_failed=false error_code=-
I 22:21:39 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1763 headAngularDeg=1.13 headLinearCm=1.40 captureTsSource=midpoint_fallback dropped=false
I 22:21:39 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=true goal_failed=false error_code=-
I 22:21:40 [Assets/Scripts/Core/DimosManager.ts:926] DimosManager: perf fps=58.1 frameMs=17.2 msgRxHz=12.8 poseRxHz=10.9 poseApplyHz=9.1
I 22:21:40 [Assets/Scripts/Core/DimosManager.ts:341] DimosManager: pose_correction transDeltaM=0.000 yawDeltaDeg=0.00 yawCorrected=true solveQuality=0.890 solveMethod=tag
I 22:21:41 [Assets/Scripts/Lidar/PointCloudRenderer.ts:211] PointCloudRenderer: obstacle filtered all 1500 points (floorWorldY=-122.6, band=0.5..155.0cm)
I 22:21:43 [Assets/Scripts/Navigation/NavigationController.ts:593] NavigationController: goal confirmed at (-22.9, -122.6, -134.4)
I 22:21:43 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=false goal_failed=false error_code=-
I 22:21:43 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=following_path goal_reached=false goal_failed=false error_code=-
I 22:21:44 [Assets/Scripts/Bridge/BridgeClient.ts:720] BridgeClient: RX nav_status state=idle goal_reached=true goal_failed=false error_code=-
I 22:21:45 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1763 headAngularDeg=1.07 headLinearCm=2.45 captureTsSource=midpoint_fallback dropped=false
I 22:21:46 [Assets/Scripts/Core/DimosManager.ts:341] DimosManager: pose_correction transDeltaM=0.071 yawDeltaDeg=2.74 yawCorrected=true solveQuality=0.907 solveMethod=tag
I 22:21:51 [Assets/Scripts/Alignment/FrameCaptureController.ts:534] FrameCaptureController: stillWindow latencyMs=1729 headAngularDeg=26.39 headLinearCm=50.58 captureTsSource=midpoint_fallback dropped=true
W 22:22:34 Spectacles has disconnected from Lens Studio.
