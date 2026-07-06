07:21:42.608[inf][ar/network/websocket_server.py] AR WebSocket server listening host=0.0.0.0 port=8787
07:21:42.608[inf][s-ar/dimos/ar/bridge/module.py] ARBridge started websocket=ws://0.0.0.0:8787
--------------------------------------------------
Bridge ready — ws://0.0.0.0:8787
--------------------------------------------------
07:21:43.113[inf][os/ar/bridge/status_service.py] bridge connectivity updated reconnecting=False robot_connected=True streams_active=False
07:21:47.297[inf][os/ar/bridge/status_service.py] bridge connectivity updated reconnecting=False robot_connected=True streams_active=True
07:21:47.379[deb][tocol/pubsub/impl/shmpubsub.py] SharedMemory PubSub starting (backend=auto)
07:21:54.248[inf][ar/network/websocket_server.py] AR client connected remote=('192.168.1.210', 39546)
--------------------------------------------------
AR client connected remote=('192.168.1.210', 39546)
--------------------------------------------------
07:21:54.389[inf][ar/network/websocket_server.py] AR inbound text message type=set_lidar_mode
07:21:54.391[inf][r/dimos/ar/bridge/telemetry.py] LiDAR mode updated mode=off obstacle_max_distance_m=0.8 obstacle_min_distance_m=0.1 obstacle_opaque_distance_m=0.5
07:21:54.391[inf][ar/network/websocket_server.py] AR inbound text message type=set_lidar_mode
07:21:55.903[inf][ar/network/websocket_server.py] AR inbound text message type=registration_command
07:21:55.903[inf][ar/network/websocket_server.py] AR inbound text message type=registration_command
07:21:55.904[deb][stration/session/controller.py] tag tracker active updated active=False reason=session_stop
07:21:55.905[deb][stration/session/controller.py] tag tracker active updated active=True reason=april_tag_start
07:21:55.905[inf][/registration/session/flows.py] AR registration started mode=april_tag
07:21:55.935[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
07:21:55.936[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles resolution=1008x756
07:21:56.099[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=117421 seq=1
07:21:56.136[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
07:21:58.134[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=114872 seq=3
07:21:58.191[war][s/ar/world_frame/transforms.py] gravity_level_transform diagnostic: translation=[ 0.063 -0.95  -1.095] up_world=[0.047 0.162 0.986] input_rotation=[[-0.323 -0.945  0.047]
 [ 0.936 -0.312  0.162]
 [-0.138  0.096  0.986]]
07:21:58.193[war][s/ar/world_frame/transforms.py] gravity_level_transform: input up-axis far from world-up (angle=80.7 deg) — registration input likely malformed; this warning is rate-limited to once per 30 s
07:22:00.197[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=114042 seq=5
07:22:02.034[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
07:22:02.969[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=114012 seq=8
07:22:04.073[inf][/registration/session/flows.py] AprilTag registration stability gate passed — auto-committing
07:22:04.074[deb][stration/session/controller.py] tag tracker active updated active=False reason=registration_finish
07:22:04.086[deb][mos/ar/world_frame/registry.py] TF publish_static not supported by current backend — skipping world→odom TF
▸ 07:22:04.086[inf][/registration/session/flows.py] Registration succeeded approximate=False mode=april_tag quality=0.915
--------------------------------------------------
Registration succeeded mode=april_tag quality=0.92
--------------------------------------------------
07:22:04.103[inf][r/dimos/ar/bridge/telemetry.py] odom egress age age_max_s=0.002 age_s=0.002 base_world_y_m=-0.8591 base_world_y_max_m=None base_world_y_min_m=None odom_z_m=0.3146 odom_z_max_m=None odom_z_min_m=None pose_hz_cap=30.0
07:22:05.042[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=114323 seq=10
07:22:05.059[inf][mos/ar/tag_tracking/tracker.py] tag_mount_offset diagnostic tag_id=0 measured_base_to_tag=[ 0.1456 -0.0012  0.0893] configured_mount.position=[0.18 0.   0.06] residual=[-0.0344 -0.0012  0.0293] p_world_tag=[ 0.0066 -0.7702 -1.059 ] p_world_base_from_mount=[ 0.0767 -0.8297 -0.893 ]
07:22:05.061[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.077, -0.859, -0.893] base_before=[0.064, -0.859, -0.925] baseline_m=0.0 marker_jump_m=0.034 observation_count=1 solve_method=apriltag_translation solve_quality=0.89 trans_delta_m=0.034 yaw_delta_deg=0.0
07:22:05.062[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322524.700858 frame_age_s=0.0874 obs_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0185 residual_along_track_m=0.0022 residual_cross_track_m=0.0009 residual_vertical_m=0.023 robot_speed_ms=0.001 seq=10 source_ts_gap_s=0.016075 straightness=None total_rejections=0 world_residual_m=0.0232
07:22:05.789[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
07:22:05.790[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles resolution=1008x756
07:22:07.306[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=106131 seq=12
07:22:07.322[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.077, -0.859, -0.888] base_before=[0.077, -0.859, -0.888] baseline_m=0.0 marker_jump_m=0.0 observation_count=2 solve_method=apriltag_translation solve_quality=0.928 trans_delta_m=0.0 yaw_delta_deg=0.0
07:22:07.324[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322526.934123 frame_age_s=0.1012 obs_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0186 residual_along_track_m=0.0028 residual_cross_track_m=0.0003 residual_vertical_m=0.0271 robot_speed_ms=0.001 seq=12 source_ts_gap_s=0.067565 straightness=None total_rejections=0 world_residual_m=0.0272
07:22:07.325[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
07:22:08.523[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
07:22:08.602[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.002, 0.006, -0.015], euler=[90.0, 0.0, 1.6])
07:22:08.604[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
07:22:08.651[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=115274.731735
07:22:08.652[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.002, 0.006, -0.015] odom_goal_yaw_deg=-0.0 world_goal=[0.078, -1.189, -0.888] world_goal_yaw_deg=112.1
07:22:08.657[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.053
07:22:08.718[inf][nning_a_star/global_planner.py] Found safe goal. x=0.08 y=-0.02
07:22:08.725[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
07:22:08.730[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
07:22:08.731[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=3
07:22:08.821[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.078, -0.859, -0.888] base_before=[0.078, -0.859, -0.888] baseline_m=0.0 marker_jump_m=0.0 observation_count=2 solve_method=apriltag_translation solve_quality=0.928 trans_delta_m=0.0 yaw_delta_deg=0.0
07:22:08.913[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.157, 0.296, 0.035] odom_goal_yaw_deg=-0.0 world_goal=[-0.249, -1.139, -0.931] world_goal_yaw_deg=164.24
07:22:08.914[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.157, 0.296, 0.035], euler=[90.0, 0.0, 53.8])
07:22:08.914[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
07:22:08.915[inf][anning_a_star/local_planner.py] changed state state=idle
07:22:08.915[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
07:22:08.916[inf][nning_a_star/global_planner.py] Found safe goal. x=0.13 y=0.28
07:22:08.918[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
07:22:08.919[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
07:22:09.124[inf][r/dimos/ar/bridge/telemetry.py] odom egress age age_max_s=0.029 age_s=0.002 base_world_y_m=-0.8586 base_world_y_max_m=None base_world_y_min_m=None odom_z_m=0.315 odom_z_max_m=None odom_z_min_m=None pose_hz_cap=30.0
07:22:09.280[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.234, 0.481, 0.034] odom_goal_yaw_deg=-0.0 world_goal=[-0.449, -1.139, -0.939] world_goal_yaw_deg=170.77
07:22:09.280[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.234, 0.481, 0.034], euler=[90.0, 0.0, 60.3])
07:22:09.281[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
07:22:09.281[inf][anning_a_star/local_planner.py] changed state state=idle
07:22:09.282[inf][nning_a_star/global_planner.py] Found safe goal. x=0.23 y=0.48
07:22:09.283[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
07:22:09.287[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
07:22:09.290[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
07:22:10.128[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=141665 seq=14
07:22:10.154[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.055, -0.859, -0.898] base_before=[0.055, -0.861, -0.898] baseline_m=0.0 marker_jump_m=0.002 observation_count=2 solve_method=apriltag_translation solve_quality=0.928 trans_delta_m=0.002 yaw_delta_deg=0.0
07:22:10.155[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322529.933701 frame_age_s=0.0922 obs_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0237 residual_along_track_m=-0.021 residual_cross_track_m=0.0081 residual_vertical_m=0.0271 robot_speed_ms=0.043 seq=14 source_ts_gap_s=0.03332 straightness=None total_rejections=0 world_residual_m=0.0352
07:22:10.326[inf][anning_a_star/local_planner.py] changed state state=path_following
07:22:11.425[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.001, -0.859, -0.91] base_before=[0.001, -0.876, -0.91] baseline_m=0.0 marker_jump_m=0.017 observation_count=2 solve_method=apriltag_translation solve_quality=0.928 trans_delta_m=0.017 yaw_delta_deg=0.0
07:22:11.571[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
07:22:11.571[inf][anning_a_star/local_planner.py] changed state state=final_rotation
07:22:11.572[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
07:22:11.572[inf][anning_a_star/local_planner.py] changed state state=arrived
07:22:11.673[inf][anning_a_star/local_planner.py] changed state state=idle
07:22:11.676[inf][nning_a_star/global_planner.py] Arrived at goal.
07:22:11.677[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 07:22:11.745[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
07:22:11.746[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.288
07:22:12.228[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=132595 seq=16
07:22:12.243[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322531.833987 frame_age_s=0.0798 obs_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0368 residual_along_track_m=-0.4428 residual_cross_track_m=0.0159 residual_vertical_m=0.0271 robot_speed_ms=0.008 seq=16 source_ts_gap_s=0.049803 straightness=None total_rejections=0 world_residual_m=0.4439
07:22:13.141[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.366, -0.859, -0.923] base_before=[-0.366, -0.855, -0.923] baseline_m=0.0 marker_jump_m=0.004 observation_count=2 solve_method=apriltag_translation solve_quality=0.928 trans_delta_m=0.004 yaw_delta_deg=0.0
07:22:13.146[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
07:22:14.146[inf][r/dimos/ar/bridge/telemetry.py] odom egress age age_max_s=0.037 age_s=0.005 base_world_y_m=-0.8591 base_world_y_max_m=None base_world_y_min_m=None odom_z_m=0.3085 odom_z_max_m=None odom_z_min_m=None pose_hz_cap=30.0
07:22:14.157[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.366, -0.859, -0.923] base_before=[-0.366, -0.859, -0.923] baseline_m=0.0 marker_jump_m=0.0 observation_count=2 solve_method=apriltag_translation solve_quality=0.928 trans_delta_m=0.0 yaw_delta_deg=0.0
07:22:14.900[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=124154 seq=19
07:22:14.919[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322534.733905 frame_age_s=0.1035 obs_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0064 residual_along_track_m=-0.3443 residual_cross_track_m=0.0162 residual_vertical_m=0.0246 robot_speed_ms=0.001 seq=19 source_ts_gap_s=0.008327 straightness=0.0001 total_rejections=0 world_residual_m=0.3455
07:22:16.442[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.452, -0.859, -0.945] base_before=[-0.44, -0.859, -0.932] baseline_m=0.0 marker_jump_m=0.018 observation_count=2 solve_method=apriltag_translation solve_quality=0.923 trans_delta_m=0.018 yaw_delta_deg=0.0
07:22:16.866[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
07:22:16.868[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=115282.949194
07:22:16.868[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.186, 0.407, -0.022] odom_goal_yaw_deg=-0.0 world_goal=[-0.45, -1.189, -0.942] world_goal_yaw_deg=178.72
07:22:16.869[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.186, 0.407, -0.022], euler=[90.0, 0.0, 68.3])
07:22:16.872[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
07:22:16.874[inf][nning_a_star/global_planner.py] Found safe goal. x=0.18 y=0.37
07:22:16.874[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.002
07:22:16.878[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
07:22:16.880[inf][anning_a_star/local_planner.py] changed state state=path_following
07:22:16.881[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
07:22:16.881[inf][anning_a_star/local_planner.py] changed state state=final_rotation
07:22:16.881[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
07:22:16.882[inf][anning_a_star/local_planner.py] changed state state=arrived
07:22:16.882[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
07:22:16.983[inf][anning_a_star/local_planner.py] changed state state=idle
07:22:16.984[inf][nning_a_star/global_planner.py] Arrived at goal.
07:22:16.985[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 07:22:16.986[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
07:22:16.986[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
07:22:17.718[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=121840 seq=21
07:22:17.730[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.452, -0.859, -0.945] base_before=[-0.452, -0.859, -0.945] baseline_m=0.0 marker_jump_m=0.0 observation_count=2 solve_method=apriltag_translation solve_quality=0.923 trans_delta_m=0.0 yaw_delta_deg=0.0
07:22:17.732[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322537.033849 frame_age_s=0.0924 obs_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.082 residual_along_track_m=-0.2635 residual_cross_track_m=0.0171 residual_vertical_m=0.0154 robot_speed_ms=0.0 seq=21 source_ts_gap_s=0.030227 straightness=0.0002 total_rejections=0 world_residual_m=0.2645
07:22:17.735[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.418, -0.047, 0.028], euler=[90.0, 0.0, -58.4])
07:22:17.736[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.418, -0.047, 0.028] odom_goal_yaw_deg=0.0 world_goal=[-0.106, -1.139, -1.319] world_goal_yaw_deg=52.11
07:22:17.736[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
07:22:17.736[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.247, -0.163, 0.028] odom_goal_yaw_deg=-180.0 world_goal=[0.063, -1.139, -1.199] world_goal_yaw_deg=-28.71
07:22:17.736[inf][nning_a_star/global_planner.py] Found safe goal. x=0.38 y=-0.08
07:22:17.739[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
07:22:17.741[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.247, -0.163, 0.028], euler=[90.0, 0.0, -139.2])
07:22:17.741[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
07:22:17.742[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
07:22:17.742[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
07:22:17.742[inf][anning_a_star/local_planner.py] changed state state=idle
07:22:17.743[inf][nning_a_star/global_planner.py] Found safe goal. x=0.23 y=-0.18
07:22:17.743[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=7
07:22:17.745[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
07:22:17.747[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
07:22:19.161[inf][r/dimos/ar/bridge/telemetry.py] odom egress age age_max_s=0.032 age_s=0.002 base_world_y_m=-0.8553 base_world_y_max_m=None base_world_y_min_m=None odom_z_m=0.3123 odom_z_max_m=None odom_z_min_m=None pose_hz_cap=30.0
07:22:19.420[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=115285.501648
07:22:19.421[inf][imos/ar/navigation/navigate.py] AR navigation goal redispatched after world-frame correction odom_goal=[0.299, -0.122, 0.028]
07:22:19.422[inf][s/ar/world_frame/refinement.py] registration_yaw_bias_deg registration_yaw_bias_deg=-3.59 registration_yaw_deg=110.47 runtime_yaw_deg=106.88
07:22:19.423[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.412, -0.859, -0.939] base_before=[-0.452, -0.859, -0.945] baseline_m=0.57 marker_jump_m=0.04 observation_count=4 solve_method=apriltag_full solve_quality=0.925 trans_delta_m=0.049 yaw_delta_deg=3.59
07:22:19.432[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=2 dropped_fifo=0 fifo_depth=0
07:22:19.433[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.299, -0.122, 0.028], euler=[90.0, 0.0, -135.6])
07:22:19.434[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
07:22:19.435[inf][anning_a_star/local_planner.py] changed state state=idle
07:22:19.436[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
07:22:19.436[inf][nning_a_star/global_planner.py] Found safe goal. x=0.28 y=-0.13
07:22:19.440[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
07:22:19.441[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
07:22:19.784[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=118700 seq=23
07:22:19.807[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322539.56711 frame_age_s=0.1153 obs_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.06 residual_along_track_m=0.0959 residual_cross_track_m=0.173 residual_vertical_m=0.0154 robot_speed_ms=0.038 seq=23 source_ts_gap_s=0.064621 straightness=0.0002 total_rejections=0 world_residual_m=0.1984
07:22:20.769[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.401, -0.859, -0.94] base_before=[-0.361, -0.862, -0.947] baseline_m=0.0 marker_jump_m=0.041 observation_count=2 solve_method=apriltag_translation solve_quality=0.923 trans_delta_m=0.041 yaw_delta_deg=0.0
07:22:20.888[inf][anning_a_star/local_planner.py] changed state state=path_following
07:22:22.216[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
07:22:22.216[inf][anning_a_star/local_planner.py] changed state state=final_rotation
07:22:22.908[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=108798 seq=26
07:22:22.936[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.02, -0.859, -1.123] base_before=[0.02, -0.857, -1.123] baseline_m=0.57 marker_jump_m=0.002 observation_count=4 solve_method=apriltag_full solve_quality=0.925 trans_delta_m=0.002 yaw_delta_deg=0.0
07:22:22.939[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322542.633696 frame_age_s=0.1061 obs_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0976 residual_along_track_m=-0.2632 residual_cross_track_m=0.1223 residual_vertical_m=0.0154 robot_speed_ms=0.047 seq=26 source_ts_gap_s=0.035915 straightness=0.0002 total_rejections=0 world_residual_m=0.2907
07:22:23.248[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
07:22:23.249[inf][anning_a_star/local_planner.py] changed state state=arrived
07:22:23.352[inf][anning_a_star/local_planner.py] changed state state=idle
07:22:23.353[inf][nning_a_star/global_planner.py] Arrived at goal.
07:22:23.353[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.0
07:22:23.353[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 07:22:23.355[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
07:22:23.355[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.282
07:22:24.187[inf][r/dimos/ar/bridge/telemetry.py] odom egress age age_max_s=0.038 age_s=0.002 base_world_y_m=-0.8581 base_world_y_max_m=None base_world_y_min_m=None odom_z_m=0.3078 odom_z_max_m=None odom_z_min_m=None pose_hz_cap=30.0
07:22:24.518[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.015, -0.859, -1.117] base_before=[-0.015, -0.858, -1.117] baseline_m=0.0 marker_jump_m=0.001 observation_count=2 solve_method=apriltag_translation solve_quality=0.923 trans_delta_m=0.001 yaw_delta_deg=0.0
07:22:24.519[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
07:22:25.242[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=104948 seq=29
07:22:25.270[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322545.066958 frame_age_s=0.0953 obs_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0838 residual_along_track_m=-0.13 residual_cross_track_m=0.2261 residual_vertical_m=0.0154 robot_speed_ms=0.005 seq=29 source_ts_gap_s=0.004185 straightness=0.0002 total_rejections=0 world_residual_m=0.2612
07:22:26.636[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.014, -0.859, -1.249] base_before=[-0.02, -0.859, -1.119] baseline_m=0.0 marker_jump_m=0.131 observation_count=1 solve_method=apriltag_translation solve_quality=0.935 trans_delta_m=0.131 yaw_delta_deg=0.0
07:22:28.058[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=111628 seq=31
07:22:28.082[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.017, -0.859, -1.246] base_before=[-0.016, -0.859, -1.249] baseline_m=0.001 marker_jump_m=0.004 observation_count=2 solve_method=apriltag_translation solve_quality=0.947 trans_delta_m=0.004 yaw_delta_deg=0.0
07:22:28.085[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322547.733549 frame_age_s=0.1185 obs_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.1242 residual_along_track_m=-0.0709 residual_cross_track_m=0.2421 residual_vertical_m=0.0174 robot_speed_ms=0.0 seq=31 source_ts_gap_s=0.004409 straightness=0.0009 total_rejections=0 world_residual_m=0.2529
07:22:29.191[inf][r/dimos/ar/bridge/telemetry.py] odom egress age age_max_s=0.248 age_s=0.001 base_world_y_m=-0.8591 base_world_y_max_m=None base_world_y_min_m=None odom_z_m=0.3073 odom_z_max_m=None odom_z_min_m=None pose_hz_cap=30.0
07:22:29.574[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.017, -0.859, -1.249] base_before=[-0.017, -0.859, -1.246] baseline_m=0.002 marker_jump_m=0.003 observation_count=3 solve_method=apriltag_translation solve_quality=0.944 trans_delta_m=0.003 yaw_delta_deg=0.0
07:22:29.574[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
07:22:31.202[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=107127 seq=33
07:22:31.212[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.017, -0.859, -1.249] base_before=[-0.017, -0.859, -1.249] baseline_m=0.002 marker_jump_m=0.0 observation_count=3 solve_method=apriltag_translation solve_quality=0.944 trans_delta_m=0.0 yaw_delta_deg=0.0
07:22:31.214[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322550.633476 frame_age_s=0.1005 obs_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.1282 residual_along_track_m=-0.0596 residual_cross_track_m=0.2135 residual_vertical_m=0.0175 robot_speed_ms=0.0 seq=33 source_ts_gap_s=0.047984 straightness=None total_rejections=0 world_residual_m=0.2224
07:22:31.363[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
07:22:31.367[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=115297.448238
07:22:31.368[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.242, -0.058, -0.023] odom_goal_yaw_deg=-180.0 world_goal=[-0.017, -1.189, -1.249] world_goal_yaw_deg=-10.77
07:22:31.368[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.242, -0.058, -0.023], euler=[90.0, 0.0, -117.7])
07:22:31.371[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
07:22:31.372[inf][nning_a_star/global_planner.py] Found safe goal. x=0.23 y=-0.08
07:22:31.373[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.002
07:22:31.375[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
07:22:31.377[inf][anning_a_star/local_planner.py] changed state state=path_following
07:22:31.377[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
07:22:31.378[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
07:22:31.378[inf][anning_a_star/local_planner.py] changed state state=final_rotation
07:22:31.378[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
07:22:31.379[inf][anning_a_star/local_planner.py] changed state state=arrived
07:22:31.481[inf][anning_a_star/local_planner.py] changed state state=idle
07:22:31.481[inf][nning_a_star/global_planner.py] Arrived at goal.
07:22:31.482[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 07:22:31.484[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
07:22:31.484[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
07:22:32.027[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.124, 0.144, 0.027] odom_goal_yaw_deg=-180.0 world_goal=[-0.176, -1.139, -1.078] world_goal_yaw_deg=-147.35
07:22:32.029[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.124, 0.144, 0.027], euler=[90.0, 0.0, 105.8])
07:22:32.031[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
07:22:32.032[inf][nning_a_star/global_planner.py] Found safe goal. x=0.08 y=0.12
07:22:32.036[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
07:22:32.039[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
07:22:32.043[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=4
07:22:32.162[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.041, 0.257, 0.027], euler=[90.0, 0.0, 167.7])
07:22:32.162[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.041, 0.257, 0.027] odom_goal_yaw_deg=180.0 world_goal=[-0.236, -1.139, -0.887] world_goal_yaw_deg=-85.41
07:22:32.163[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
07:22:32.163[inf][anning_a_star/local_planner.py] changed state state=idle
07:22:32.164[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.07 y=0.22
07:22:32.164[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
07:22:32.168[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
07:22:32.171[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
07:22:33.080[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
07:22:33.082[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.204, 0.115, 0.029], euler=[90.0, 0.0, -134.3])
07:22:33.082[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
07:22:33.082[inf][anning_a_star/local_planner.py] changed state state=idle
07:22:33.082[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.204, 0.115, 0.029] odom_goal_yaw_deg=-180.0 world_goal=[-0.053, -1.137, -0.773] world_goal_yaw_deg=-27.39
07:22:33.083[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.22 y=0.07
07:22:33.083[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
07:22:33.083[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.095, -0.096, 0.04] odom_goal_yaw_deg=-0.0 world_goal=[0.117, -1.126, -0.938] world_goal_yaw_deg=48.79
07:22:33.086[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
07:22:33.088[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.095, -0.096, 0.040], euler=[90.0, 0.0, -58.1])
07:22:33.089[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
07:22:33.089[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
07:22:33.089[inf][anning_a_star/local_planner.py] changed state state=idle
07:22:33.090[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.12 y=-0.13
07:22:33.090[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
07:22:33.093[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
07:22:33.095[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
07:22:33.446[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=129160 seq=35
07:22:33.465[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.004, -0.859, -1.236] base_before=[-0.004, -0.857, -1.236] baseline_m=0.002 marker_jump_m=0.002 observation_count=3 solve_method=apriltag_translation solve_quality=0.944 trans_delta_m=0.002 yaw_delta_deg=0.0
07:22:33.467[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322553.166452 frame_age_s=0.0986 obs_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.1317 residual_along_track_m=0.1261 residual_cross_track_m=0.1756 residual_vertical_m=0.0175 robot_speed_ms=0.036 seq=35 source_ts_gap_s=0.030641 straightness=None total_rejections=0 world_residual_m=0.2169
07:22:33.926[inf][anning_a_star/local_planner.py] changed state state=path_following
07:22:34.138[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
07:22:34.142[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=115300.223846
07:22:34.143[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.143, 0.103, 0.028], euler=[90.0, 0.0, 128.7])
07:22:34.143[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.143, 0.103, 0.028] odom_goal_yaw_deg=-180.0 world_goal=[-0.059, -1.141, -0.834] world_goal_yaw_deg=-124.4
07:22:34.143[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
07:22:34.144[inf][anning_a_star/local_planner.py] changed state state=idle
07:22:34.146[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.17 y=0.07
07:22:34.146[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
07:22:34.150[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
07:22:34.152[inf][anning_a_star/local_planner.py] changed state state=path_following
07:22:34.227[inf][r/dimos/ar/bridge/telemetry.py] odom egress age age_max_s=0.039 age_s=0.009 base_world_y_m=-0.8615 base_world_y_max_m=None base_world_y_min_m=None odom_z_m=0.3068 odom_z_max_m=None odom_z_min_m=None pose_hz_cap=30.0
07:22:34.507[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.203, 0.302, 0.028] odom_goal_yaw_deg=-180.0 world_goal=[-0.231, -1.142, -0.719] world_goal_yaw_deg=-151.29
07:22:34.509[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.203, 0.302, 0.028], euler=[90.0, 0.0, 101.8])
07:22:34.510[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
07:22:34.511[inf][anning_a_star/local_planner.py] changed state state=idle
07:22:34.512[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.22 y=0.27
07:22:34.513[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
07:22:34.516[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
07:22:34.518[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
07:22:34.771[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.208, 0.342, 0.017] odom_goal_yaw_deg=-180.0 world_goal=[-0.269, -1.154, -0.703] world_goal_yaw_deg=-147.95
07:22:34.772[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.208, 0.342, 0.017], euler=[90.0, 0.0, 105.2])
07:22:34.773[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
07:22:34.773[inf][anning_a_star/local_planner.py] changed state state=idle
07:22:34.775[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.22 y=0.32
07:22:34.775[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
07:22:34.779[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
07:22:34.782[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
07:22:35.255[inf][imos/ar/navigation/navigate.py] AR navigation goal redispatched after world-frame correction odom_goal=[-0.095, 0.384, 0.007]
07:22:35.256[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.058, -0.859, -1.072] base_before=[0.033, -0.868, -1.119] baseline_m=0.804 marker_jump_m=0.054 observation_count=7 solve_method=apriltag_full solve_quality=0.933 trans_delta_m=0.067 yaw_delta_deg=7.89
07:22:35.256[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.095, 0.384, 0.007], euler=[90.0, 0.0, 97.3])
07:22:35.257[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
07:22:35.257[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=2 dropped_fifo=0 fifo_depth=0
07:22:35.257[inf][anning_a_star/local_planner.py] changed state state=idle
07:22:35.258[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
07:22:35.258[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.12 y=0.37
07:22:35.264[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
07:22:35.268[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
07:22:36.507[inf][anning_a_star/local_planner.py] changed state state=path_following
07:22:36.599[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=145247 seq=38
07:22:36.622[inf][mos/ar/tag_tracking/tracker.py] tag_mount_offset diagnostic tag_id=0 measured_base_to_tag=[0.1692 0.0309 0.0827] configured_mount.position=[0.18 0.   0.06] residual=[-0.0108  0.0309  0.0227] p_world_tag=[ 0.1623 -0.7704 -1.2158] p_world_base_from_mount=[-0.0172 -0.8313 -1.2246]
07:22:36.624[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.057, -0.859, -1.144] base_before=[0.067, -0.856, -1.113] baseline_m=0.002 marker_jump_m=0.033 observation_count=3 solve_method=apriltag_translation solve_quality=0.944 trans_delta_m=0.033 yaw_delta_deg=0.0
07:22:36.626[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322555.932682 frame_age_s=0.089 obs_added=0 regime=cruise rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0589 residual_along_track_m=0.1929 residual_cross_track_m=0.0337 residual_vertical_m=0.0175 robot_speed_ms=0.061 seq=38 source_ts_gap_s=0.004824 straightness=None total_rejections=0 world_residual_m=0.1966
07:22:36.626[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
07:22:36.629[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=115302.710589
07:22:36.629[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.207, 0.580, 0.045], euler=[90.0, 0.0, 101.4])
07:22:36.630[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
07:22:36.630[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.207, 0.58, 0.045] odom_goal_yaw_deg=-180.0 world_goal=[-0.41, -1.119, -0.55] world_goal_yaw_deg=-143.81
07:22:36.631[inf][anning_a_star/local_planner.py] changed state state=idle
07:22:36.633[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.002
07:22:36.633[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
07:22:36.634[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.22 y=0.57
07:22:36.639[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
07:22:36.642[inf][anning_a_star/local_planner.py] changed state state=path_following
07:22:36.815[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.205, 0.72, 0.05] odom_goal_yaw_deg=-0.0 world_goal=[-0.539, -1.114, -0.493] world_goal_yaw_deg=-159.43
07:22:36.827[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.205, 0.720, 0.050], euler=[90.0, 0.0, 85.8])
07:22:36.828[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
07:22:36.828[inf][anning_a_star/local_planner.py] changed state state=idle
07:22:36.829[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.22 y=0.67
07:22:36.829[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
07:22:36.833[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
07:22:36.836[inf][anning_a_star/local_planner.py] changed state state=path_following
07:22:38.330[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.252, -0.859, -0.945] base_before=[-0.252, -0.866, -0.945] baseline_m=0.002 marker_jump_m=0.007 observation_count=3 solve_method=apriltag_translation solve_quality=0.944 trans_delta_m=0.007 yaw_delta_deg=0.0
07:22:38.810[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
07:22:38.811[inf][anning_a_star/local_planner.py] changed state state=final_rotation
07:22:39.215[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=145082 seq=41
07:22:39.241[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322558.866582 frame_age_s=0.0871 obs_added=0 regime=cruise rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=0.2647 residual_along_track_m=-0.5112 residual_cross_track_m=0.1126 residual_vertical_m=0.0175 robot_speed_ms=0.249 seq=41 source_ts_gap_s=0.08919 straightness=None total_rejections=0 world_residual_m=0.5237
07:22:39.380[inf][r/dimos/ar/bridge/telemetry.py] odom egress age age_max_s=0.042 age_s=0.001 base_world_y_m=-0.8603 base_world_y_max_m=None base_world_y_min_m=None odom_z_m=0.3082 odom_z_max_m=None odom_z_min_m=None pose_hz_cap=30.0
07:22:39.641[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
07:22:39.644[inf][anning_a_star/local_planner.py] changed state state=arrived
07:22:39.742[inf][anning_a_star/local_planner.py] changed state state=idle
07:22:39.748[inf][nning_a_star/global_planner.py] Arrived at goal.
07:22:39.748[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 07:22:39.762[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
07:22:39.763[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.274
07:22:39.958[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.506, -0.859, -0.573] base_before=[-0.516, -0.86, -0.604] baseline_m=0.804 marker_jump_m=0.033 observation_count=7 solve_method=apriltag_full solve_quality=0.933 trans_delta_m=0.033 yaw_delta_deg=0.0
07:22:40.933[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
07:22:41.924[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=151424 seq=44
07:22:41.940[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.517, -0.859, -0.594] base_before=[-0.517, -0.859, -0.594] baseline_m=0.002 marker_jump_m=0.0 observation_count=3 solve_method=apriltag_translation solve_quality=0.944 trans_delta_m=0.0 yaw_delta_deg=0.0
07:22:41.942[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322561.499469 frame_age_s=0.0939 obs_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=0.326 residual_along_track_m=-0.5988 residual_cross_track_m=0.1057 residual_vertical_m=0.0175 robot_speed_ms=0.0 seq=44 source_ts_gap_s=0.023282 straightness=None total_rejections=0 world_residual_m=0.6083
07:22:43.214[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.518, -0.859, -0.594] base_before=[-0.518, -0.859, -0.594] baseline_m=0.002 marker_jump_m=0.0 observation_count=3 solve_method=apriltag_translation solve_quality=0.944 trans_delta_m=0.0 yaw_delta_deg=0.0
07:22:44.411[inf][r/dimos/ar/bridge/telemetry.py] odom egress age age_max_s=0.049 age_s=0.037 base_world_y_m=-0.8591 base_world_y_max_m=None base_world_y_min_m=None odom_z_m=0.3062 odom_z_max_m=None odom_z_min_m=None pose_hz_cap=30.0
07:22:44.522[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=134846 seq=46
07:22:44.545[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.593, -0.859, -0.472] base_before=[-0.517, -0.859, -0.594] baseline_m=0.0 marker_jump_m=0.143 observation_count=1 solve_method=apriltag_translation solve_quality=0.946 trans_delta_m=0.143 yaw_delta_deg=0.0
07:22:44.549[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322564.266432 frame_age_s=0.117 obs_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=0.3554 residual_along_track_m=-0.6422 residual_cross_track_m=0.1329 residual_vertical_m=0.0155 robot_speed_ms=0.0 seq=46 source_ts_gap_s=0.011922 straightness=None total_rejections=0 world_residual_m=0.656
07:22:46.152[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.591, -0.859, -0.469] base_before=[-0.593, -0.859, -0.472] baseline_m=0.0 marker_jump_m=0.004 observation_count=2 solve_method=apriltag_translation solve_quality=0.922 trans_delta_m=0.004 yaw_delta_deg=0.0
07:22:46.153[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
07:22:47.555[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
07:22:47.557[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=115313.638524
07:22:47.558[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.122, 0.658, -0.024] odom_goal_yaw_deg=-180.0 world_goal=[-0.592, -1.189, -0.469] world_goal_yaw_deg=-141.3
07:22:47.558[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.122, 0.658, -0.024], euler=[90.0, 0.0, 103.9])
07:22:47.559[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
07:22:47.559[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.0
07:22:47.559[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.12 y=0.62
07:22:47.562[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
07:22:47.562[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
07:22:47.562[inf][anning_a_star/local_planner.py] changed state state=path_following
07:22:47.563[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
07:22:47.563[inf][anning_a_star/local_planner.py] changed state state=final_rotation
07:22:47.563[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
07:22:47.564[inf][anning_a_star/local_planner.py] changed state state=arrived
07:22:47.667[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=134936 seq=48
07:22:47.668[inf][anning_a_star/local_planner.py] changed state state=idle
07:22:47.668[inf][nning_a_star/global_planner.py] Arrived at goal.
07:22:47.669[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 07:22:47.671[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
07:22:47.672[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
07:22:47.685[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.591, -0.859, -0.469] base_before=[-0.592, -0.859, -0.469] baseline_m=0.0 marker_jump_m=0.001 observation_count=3 solve_method=apriltag_translation solve_quality=0.921 trans_delta_m=0.001 yaw_delta_deg=0.0
07:22:47.690[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322567.433016 frame_age_s=0.0913 obs_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=0.2606 residual_along_track_m=-0.5134 residual_cross_track_m=0.109 residual_vertical_m=0.0146 robot_speed_ms=0.0 seq=48 source_ts_gap_s=0.017242 straightness=None total_rejections=0 world_residual_m=0.5251
07:22:48.052[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.086, 0.205, 0.026] odom_goal_yaw_deg=-180.0 world_goal=[-0.194, -1.139, -0.692] world_goal_yaw_deg=24.17
07:22:48.054[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.086, 0.205, 0.026], euler=[90.0, 0.0, -90.6])
07:22:48.055[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
07:22:48.057[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.12 y=0.17
07:22:48.065[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
07:22:48.068[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
07:22:48.072[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=7
07:22:48.369[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.081, -0.058, 0.038], euler=[90.0, -0.0, -88.0])
07:22:48.370[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
07:22:48.369[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.081, -0.058, 0.038] odom_goal_yaw_deg=-0.0 world_goal=[0.043, -1.127, -0.806] world_goal_yaw_deg=26.77
07:22:48.370[inf][anning_a_star/local_planner.py] changed state state=idle
07:22:48.370[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
07:22:48.371[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.12 y=-0.08
07:22:48.374[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
07:22:48.376[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
07:22:48.674[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
07:22:48.675[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.087, -0.163, 0.056] odom_goal_yaw_deg=-0.0 world_goal=[0.14, -1.109, -0.844] world_goal_yaw_deg=25.36
07:22:48.676[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.087, -0.163, 0.056], euler=[90.0, 0.0, -89.4])
07:22:48.676[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
07:22:48.677[inf][anning_a_star/local_planner.py] changed state state=idle
07:22:48.677[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.12 y=-0.18
07:22:48.678[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
07:22:48.682[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
07:22:48.686[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
07:22:49.060[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.59, -0.859, -0.444] base_before=[-0.593, -0.853, -0.452] baseline_m=0.065 marker_jump_m=0.01 observation_count=3 solve_method=apriltag_translation solve_quality=0.907 trans_delta_m=0.01 yaw_delta_deg=0.0
07:22:49.433[inf][r/dimos/ar/bridge/telemetry.py] odom egress age age_max_s=0.037 age_s=0.001 base_world_y_m=-0.8601 base_world_y_max_m=None base_world_y_min_m=None odom_z_m=0.3111 odom_z_max_m=None odom_z_min_m=None pose_hz_cap=30.0
07:22:50.378[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=150373 seq=50
07:22:50.400[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.6, -0.859, -0.437] base_before=[-0.6, -0.864, -0.437] baseline_m=0.065 marker_jump_m=0.005 observation_count=3 solve_method=apriltag_translation solve_quality=0.907 trans_delta_m=0.005 yaw_delta_deg=0.0
07:22:50.406[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322569.801765 frame_age_s=0.1032 obs_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=0.1843 residual_along_track_m=0.0142 residual_cross_track_m=0.5044 residual_vertical_m=0.0149 robot_speed_ms=0.014 seq=50 source_ts_gap_s=0.098648 straightness=None total_rejections=0 world_residual_m=0.5048
07:22:50.667[inf][anning_a_star/local_planner.py] changed state state=path_following
07:22:51.359[inf][s/ar/world_frame/refinement.py] yaw_gate_failed baseline_m=0.317 baseline_min_m=0.4 failed_conditions=['baseline'] observation_count=5 straightness=0.18 straightness_max=0.2
07:22:51.362[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
07:22:52.292[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=115318.373787
07:22:52.292[inf][imos/ar/navigation/navigate.py] AR navigation goal redispatched after world-frame correction odom_goal=[-0.183, -0.162, 0.055]
07:22:52.293[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.513, -0.859, -0.763] base_before=[-0.491, -0.865, -0.727] baseline_m=0.64 marker_jump_m=0.043 observation_count=6 solve_method=apriltag_full solve_quality=0.923 trans_delta_m=0.087 yaw_delta_deg=5.72
07:22:52.320[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.183, -0.162, 0.055], euler=[90.0, 0.0, -95.1])
07:22:52.321[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
07:22:52.321[inf][anning_a_star/local_planner.py] changed state state=idle
07:22:52.322[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.22 y=-0.17
07:22:52.323[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
07:22:52.326[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
07:22:52.331[inf][anning_a_star/local_planner.py] changed state state=path_following
07:22:53.171[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=111946 seq=53
07:22:53.187[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322572.832865 frame_age_s=0.0877 obs_added=1 regime=cruise rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0604 residual_along_track_m=-0.0672 residual_cross_track_m=0.081 residual_vertical_m=0.0092 robot_speed_ms=0.285 seq=53 source_ts_gap_s=0.029383 straightness=0.1526 total_rejections=0 world_residual_m=0.1057
07:22:54.439[inf][r/dimos/ar/bridge/telemetry.py] odom egress age age_max_s=0.038 age_s=0.002 base_world_y_m=-0.858 base_world_y_max_m=None base_world_y_min_m=None odom_z_m=0.304 odom_z_max_m=None odom_z_min_m=None pose_hz_cap=30.0
07:22:54.487[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
07:22:54.488[inf][anning_a_star/local_planner.py] changed state state=final_rotation
07:22:54.616[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.115, -0.859, -0.926] base_before=[-0.115, -0.859, -0.926] baseline_m=0.859 marker_jump_m=0.0 observation_count=7 solve_method=apriltag_full solve_quality=0.932 trans_delta_m=0.0 yaw_delta_deg=0.0
07:22:55.458[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=110906 seq=56
07:22:55.476[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322575.199469 frame_age_s=0.1018 obs_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=0.0763 residual_along_track_m=-0.3533 residual_cross_track_m=0.1872 residual_vertical_m=0.0092 robot_speed_ms=0.045 seq=56 source_ts_gap_s=0.000874 straightness=0.1526 total_rejections=0 world_residual_m=0.3999
07:22:55.834[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
07:22:55.835[inf][anning_a_star/local_planner.py] changed state state=arrived
07:22:55.937[inf][anning_a_star/local_planner.py] changed state state=idle
07:22:55.939[inf][nning_a_star/global_planner.py] Arrived at goal.
07:22:55.939[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
07:22:55.944[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.006
▸ 07:22:55.946[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
07:22:55.948[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.28
07:22:56.165[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.06, -0.859, -0.908] base_before=[0.083, -0.873, -0.915] baseline_m=0.574 marker_jump_m=0.028 observation_count=3 solve_method=apriltag_translation solve_quality=0.951 trans_delta_m=0.028 yaw_delta_deg=0.0
07:22:56.886[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
07:22:57.666[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=109277 seq=59
07:22:57.677[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.056, -0.859, -0.909] base_before=[0.056, -0.859, -0.909] baseline_m=0.574 marker_jump_m=0.0 observation_count=3 solve_method=apriltag_translation solve_quality=0.951 trans_delta_m=0.0 yaw_delta_deg=0.0
07:22:57.681[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322577.466073 frame_age_s=0.0906 obs_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=0.0804 residual_along_track_m=-0.3932 residual_cross_track_m=0.0455 residual_vertical_m=0.0092 robot_speed_ms=0.0 seq=59 source_ts_gap_s=0.075343 straightness=0.1526 total_rejections=0 world_residual_m=0.3959
07:22:59.038[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.056, -0.859, -0.909] base_before=[0.056, -0.859, -0.909] baseline_m=0.574 marker_jump_m=0.0 observation_count=3 solve_method=apriltag_translation solve_quality=0.951 trans_delta_m=0.0 yaw_delta_deg=0.0
07:22:59.473[inf][r/dimos/ar/bridge/telemetry.py] odom egress age age_max_s=0.039 age_s=0.021 base_world_y_m=-0.8591 base_world_y_max_m=None base_world_y_min_m=None odom_z_m=0.3032 odom_z_max_m=None odom_z_min_m=None pose_hz_cap=30.0
07:23:00.237[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=108636 seq=61
07:23:00.253[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.056, -0.859, -0.909] base_before=[0.056, -0.859, -0.909] baseline_m=0.574 marker_jump_m=0.0 observation_count=3 solve_method=apriltag_translation solve_quality=0.951 trans_delta_m=0.0 yaw_delta_deg=0.0
07:23:00.259[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322580.099333 frame_age_s=0.0887 obs_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=0.1437 residual_along_track_m=-0.3931 residual_cross_track_m=0.0467 residual_vertical_m=0.0092 robot_speed_ms=0.0 seq=61 source_ts_gap_s=0.017651 straightness=0.1526 total_rejections=0 world_residual_m=0.396
07:23:01.774[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.056, -0.859, -0.91] base_before=[0.056, -0.859, -0.91] baseline_m=0.574 marker_jump_m=0.0 observation_count=3 solve_method=apriltag_translation solve_quality=0.951 trans_delta_m=0.0 yaw_delta_deg=0.0
07:23:03.136[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=109285 seq=63
07:23:03.149[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.056, -0.859, -0.91] base_before=[0.056, -0.859, -0.91] baseline_m=0.574 marker_jump_m=0.0 observation_count=3 solve_method=apriltag_translation solve_quality=0.951 trans_delta_m=0.0 yaw_delta_deg=0.0
07:23:03.153[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322582.799262 frame_age_s=0.0953 obs_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=0.1534 residual_along_track_m=-0.3929 residual_cross_track_m=0.0476 residual_vertical_m=0.0092 robot_speed_ms=0.0 seq=63 source_ts_gap_s=0.026744 straightness=0.1526 total_rejections=0 world_residual_m=0.3959
07:23:03.154[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
07:23:04.506[inf][r/dimos/ar/bridge/telemetry.py] odom egress age age_max_s=0.055 age_s=0.001 base_world_y_m=-0.8591 base_world_y_max_m=None base_world_y_min_m=None odom_z_m=0.3033 odom_z_max_m=None odom_z_min_m=None pose_hz_cap=30.0
07:23:04.628[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.056, -0.859, -0.909] base_before=[0.056, -0.859, -0.909] baseline_m=0.574 marker_jump_m=0.0 observation_count=3 solve_method=apriltag_translation solve_quality=0.951 trans_delta_m=0.0 yaw_delta_deg=0.0
07:23:05.274[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
07:23:05.276[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=115331.357999
07:23:05.277[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.053, -0.096, -0.027] odom_goal_yaw_deg=-180.0 world_goal=[0.056, -1.189, -0.91] world_goal_yaw_deg=6.76
07:23:05.278[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.053, -0.096, -0.027], euler=[90.0, 0.0, -110.7])
07:23:05.280[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
07:23:05.283[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.07 y=-0.12
07:23:05.283[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.003
07:23:05.289[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
07:23:05.295[inf][anning_a_star/local_planner.py] changed state state=path_following
07:23:05.295[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
07:23:05.296[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
07:23:05.297[inf][anning_a_star/local_planner.py] changed state state=final_rotation
07:23:05.297[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
07:23:05.297[inf][anning_a_star/local_planner.py] changed state state=arrived
07:23:05.398[inf][anning_a_star/local_planner.py] changed state state=idle
07:23:05.399[inf][nning_a_star/global_planner.py] Arrived at goal.
07:23:05.399[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 07:23:05.401[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
07:23:05.401[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
07:23:05.443[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.317, 0.060, 0.023], euler=[90.0, 0.0, 140.1])
07:23:05.444[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.317, 0.06, 0.023] odom_goal_yaw_deg=-180.0 world_goal=[0.039, -1.139, -0.604] world_goal_yaw_deg=-102.41
07:23:05.444[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
07:23:05.445[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.32 y=0.03
07:23:05.450[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
07:23:05.452[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
07:23:05.454[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=4
07:23:05.644[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=133923 seq=65
07:23:05.677[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.056, -0.859, -0.91] base_before=[0.056, -0.859, -0.91] baseline_m=0.574 marker_jump_m=0.0 observation_count=3 solve_method=apriltag_translation solve_quality=0.951 trans_delta_m=0.0 yaw_delta_deg=0.0
07:23:05.684[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322585.46547 frame_age_s=0.1105 obs_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=0.0677 residual_along_track_m=-0.3929 residual_cross_track_m=0.0482 residual_vertical_m=0.0092 robot_speed_ms=0.004 seq=65 source_ts_gap_s=0.041045 straightness=0.1526 total_rejections=0 world_residual_m=0.3959
07:23:05.704[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.262, 0.099, 0.023], euler=[90.0, 0.0, 55.0])
07:23:05.704[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.262, 0.099, 0.023] odom_goal_yaw_deg=0.0 world_goal=[-0.021, -1.139, -0.634] world_goal_yaw_deg=172.44
07:23:05.704[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
07:23:05.705[inf][anning_a_star/local_planner.py] changed state state=idle
07:23:05.705[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.27 y=0.08
07:23:05.706[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
07:23:05.709[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
07:23:05.711[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
07:23:07.097[inf][mos/ar/tag_tracking/tracker.py] tag_mount_offset diagnostic tag_id=0 measured_base_to_tag=[0.2311 0.0746 0.0839] configured_mount.position=[0.18 0.   0.06] residual=[0.0511 0.0746 0.0239] p_world_tag=[ 0.2102 -0.7741 -0.7662] p_world_base_from_mount=[ 0.1367 -0.8343 -0.9304]
07:23:07.103[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.206, 0.171, 0.024], euler=[90.0, 0.0, 55.0])
07:23:07.104[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
07:23:07.104[inf][imos/ar/navigation/navigate.py] AR navigation goal redispatched after world-frame correction odom_goal=[-0.206, 0.171, 0.024]
07:23:07.104[inf][anning_a_star/local_planner.py] changed state state=idle
07:23:07.104[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.137, -0.859, -0.93] base_before=[0.048, -0.858, -0.947] baseline_m=0.0 marker_jump_m=0.091 observation_count=1 solve_method=apriltag_translation solve_quality=0.974 trans_delta_m=0.091 yaw_delta_deg=0.0
07:23:07.105[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.22 y=0.13
07:23:07.106[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
07:23:07.108[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
07:23:07.110[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
07:23:07.732[inf][anning_a_star/local_planner.py] changed state state=path_following
07:23:07.972[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=130706 seq=67
07:23:07.986[inf][s/ar/world_frame/refinement.py] yaw_gate_failed baseline_m=0.154 baseline_min_m=0.4 failed_conditions=['baseline'] observation_count=2 straightness=0.0 straightness_max=0.2
07:23:07.996[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322587.632468 frame_age_s=0.107 obs_added=1 regime=cruise rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=0.1211 residual_along_track_m=0.2411 residual_cross_track_m=0.3388 residual_vertical_m=0.0098 robot_speed_ms=0.067 seq=67 source_ts_gap_s=0.01586 straightness=0.0 total_rejections=0 world_residual_m=0.416
07:23:08.253[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
07:23:08.253[inf][anning_a_star/local_planner.py] changed state state=final_rotation
07:23:09.195[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.097, -0.859, -0.777] base_before=[0.1, -0.855, -0.781] baseline_m=0.261 marker_jump_m=0.006 observation_count=3 solve_method=apriltag_translation solve_quality=0.963 trans_delta_m=0.006 yaw_delta_deg=0.0
07:23:09.195[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
07:23:09.498[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
07:23:09.498[inf][anning_a_star/local_planner.py] changed state state=arrived
07:23:09.556[inf][r/dimos/ar/bridge/telemetry.py] odom egress age age_max_s=0.044 age_s=0.001 base_world_y_m=-0.8646 base_world_y_max_m=None base_world_y_min_m=None odom_z_m=0.3048 odom_z_max_m=None odom_z_min_m=None pose_hz_cap=30.0
07:23:09.600[inf][anning_a_star/local_planner.py] changed state state=idle
07:23:09.600[inf][nning_a_star/global_planner.py] Arrived at goal.
07:23:09.601[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 07:23:09.602[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
07:23:09.603[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.295
07:23:11.092[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=133708 seq=70
07:23:11.112[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.104, -0.859, -0.766] base_before=[0.105, -0.858, -0.77] baseline_m=0.163 marker_jump_m=0.005 observation_count=3 solve_method=apriltag_translation solve_quality=0.947 trans_delta_m=0.005 yaw_delta_deg=0.0
07:23:11.116[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322590.399056 frame_age_s=0.0803 obs_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=0.1318 residual_along_track_m=0.2986 residual_cross_track_m=0.1019 residual_vertical_m=0.0122 robot_speed_ms=0.002 seq=70 source_ts_gap_s=0.046232 straightness=0.4488 total_rejections=0 world_residual_m=0.3158
07:23:12.243[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.112, -0.859, -0.762] base_before=[0.105, -0.859, -0.765] baseline_m=0.018 marker_jump_m=0.007 observation_count=3 solve_method=apriltag_translation solve_quality=0.937 trans_delta_m=0.007 yaw_delta_deg=0.0
07:23:13.378[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=110225 seq=72
07:23:13.397[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.111, -0.859, -0.766] base_before=[0.112, -0.859, -0.762] baseline_m=0.004 marker_jump_m=0.004 observation_count=3 solve_method=apriltag_translation solve_quality=0.914 trans_delta_m=0.004 yaw_delta_deg=0.0
07:23:13.407[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322592.865658 frame_age_s=0.1198 obs_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=0.1209 residual_along_track_m=0.2756 residual_cross_track_m=0.0948 residual_vertical_m=0.013 robot_speed_ms=0.0 seq=72 source_ts_gap_s=0.001693 straightness=0.4155 total_rejections=0 world_residual_m=0.2917
07:23:14.614[inf][r/dimos/ar/bridge/telemetry.py] odom egress age age_max_s=0.047 age_s=0.002 base_world_y_m=-0.8589 base_world_y_max_m=None base_world_y_min_m=None odom_z_m=0.3073 odom_z_max_m=None odom_z_min_m=None pose_hz_cap=30.0
07:23:14.752[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.113, -0.859, -0.764] base_before=[0.111, -0.859, -0.766] baseline_m=0.001 marker_jump_m=0.002 observation_count=3 solve_method=apriltag_translation solve_quality=0.934 trans_delta_m=0.002 yaw_delta_deg=0.0
07:23:14.753[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
07:23:16.155[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=110340 seq=74
07:23:16.179[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.114, -0.859, -0.765] base_before=[0.113, -0.859, -0.764] baseline_m=0.001 marker_jump_m=0.001 observation_count=3 solve_method=apriltag_translation solve_quality=0.946 trans_delta_m=0.001 yaw_delta_deg=0.0
07:23:16.208[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322595.765586 frame_age_s=0.1018 obs_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=0.1035 residual_along_track_m=0.2542 residual_cross_track_m=0.0865 residual_vertical_m=0.014 robot_speed_ms=0.0 seq=74 source_ts_gap_s=0.017685 straightness=0.3991 total_rejections=0 world_residual_m=0.2689
07:23:17.562[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.113, -0.859, -0.767] base_before=[0.114, -0.859, -0.765] baseline_m=0.001 marker_jump_m=0.002 observation_count=3 solve_method=apriltag_translation solve_quality=0.965 trans_delta_m=0.002 yaw_delta_deg=0.0
07:23:19.288[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=110241 seq=76
07:23:19.306[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.113, -0.859, -0.768] base_before=[0.113, -0.859, -0.767] baseline_m=0.001 marker_jump_m=0.001 observation_count=3 solve_method=apriltag_translation solve_quality=0.962 trans_delta_m=0.001 yaw_delta_deg=0.0
07:23:19.311[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322598.765502 frame_age_s=0.1091 obs_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=0.0871 residual_along_track_m=0.234 residual_cross_track_m=0.0755 residual_vertical_m=0.0142 robot_speed_ms=0.0 seq=76 source_ts_gap_s=0.021479 straightness=0.6211 total_rejections=0 world_residual_m=0.2463
07:23:19.665[inf][r/dimos/ar/bridge/telemetry.py] odom egress age age_max_s=0.044 age_s=0.021 base_world_y_m=-0.859 base_world_y_max_m=None base_world_y_min_m=None odom_z_m=0.3074 odom_z_max_m=None odom_z_min_m=None pose_hz_cap=30.0
07:23:20.733[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.114, -0.859, -0.767] base_before=[0.113, -0.859, -0.768] baseline_m=0.0 marker_jump_m=0.001 observation_count=3 solve_method=apriltag_translation solve_quality=0.937 trans_delta_m=0.001 yaw_delta_deg=0.0
07:23:20.734[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
07:23:22.076[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=129916 seq=78
07:23:22.096[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.116, -0.859, -0.765] base_before=[0.114, -0.859, -0.767] baseline_m=0.0 marker_jump_m=0.002 observation_count=3 solve_method=apriltag_translation solve_quality=0.903 trans_delta_m=0.002 yaw_delta_deg=0.0
07:23:22.104[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322601.765419 frame_age_s=0.0829 obs_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=0.0735 residual_along_track_m=0.2189 residual_cross_track_m=0.0711 residual_vertical_m=0.015 robot_speed_ms=0.0 seq=78 source_ts_gap_s=0.004287 straightness=None total_rejections=0 world_residual_m=0.2307
07:23:23.463[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.114, -0.859, -0.769] base_before=[0.116, -0.859, -0.765] baseline_m=0.0 marker_jump_m=0.005 observation_count=3 solve_method=apriltag_translation solve_quality=0.906 trans_delta_m=0.005 yaw_delta_deg=0.0
07:23:24.746[inf][r/dimos/ar/bridge/telemetry.py] odom egress age age_max_s=0.036 age_s=0.007 base_world_y_m=-0.859 base_world_y_max_m=None base_world_y_min_m=None odom_z_m=0.3075 odom_z_max_m=None odom_z_min_m=None pose_hz_cap=30.0
07:23:24.851[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=131644 seq=80
07:23:24.882[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.112, -0.859, -0.772] base_before=[0.114, -0.859, -0.769] baseline_m=0.0 marker_jump_m=0.003 observation_count=3 solve_method=apriltag_translation solve_quality=0.92 trans_delta_m=0.003 yaw_delta_deg=0.0
07:23:24.890[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322604.565346 frame_age_s=0.1065 obs_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=0.0592 residual_along_track_m=0.2025 residual_cross_track_m=0.0583 residual_vertical_m=0.015 robot_speed_ms=0.001 seq=80 source_ts_gap_s=0.028434 straightness=None total_rejections=0 world_residual_m=0.2112
07:23:26.181[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.111, -0.859, -0.773] base_before=[0.113, -0.859, -0.772] baseline_m=0.0 marker_jump_m=0.002 observation_count=3 solve_method=apriltag_translation solve_quality=0.946 trans_delta_m=0.002 yaw_delta_deg=0.0
07:23:26.182[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
07:23:27.627[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=132152 seq=82
07:23:27.669[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.113, -0.859, -0.772] base_before=[0.112, -0.859, -0.773] baseline_m=0.0 marker_jump_m=0.002 observation_count=3 solve_method=apriltag_translation solve_quality=0.928 trans_delta_m=0.002 yaw_delta_deg=0.0
07:23:27.687[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322607.298606 frame_age_s=0.0964 obs_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=0.0516 residual_along_track_m=0.1899 residual_cross_track_m=0.0534 residual_vertical_m=0.015 robot_speed_ms=0.0 seq=82 source_ts_gap_s=0.045511 straightness=None total_rejections=0 world_residual_m=0.1979
07:23:29.218[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.113, -0.859, -0.771] base_before=[0.113, -0.859, -0.772] baseline_m=0.0 marker_jump_m=0.0 observation_count=3 solve_method=apriltag_translation solve_quality=0.919 trans_delta_m=0.0 yaw_delta_deg=0.0
07:23:29.826[inf][r/dimos/ar/bridge/telemetry.py] odom egress age age_max_s=0.039 age_s=0.028 base_world_y_m=-0.859 base_world_y_max_m=None base_world_y_min_m=None odom_z_m=0.3076 odom_z_max_m=None odom_z_min_m=None pose_hz_cap=30.0
07:23:29.947[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
07:23:30.513[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=130697 seq=84
07:23:30.565[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.113, -0.859, -0.771] base_before=[0.113, -0.859, -0.771] baseline_m=0.0 marker_jump_m=0.0 observation_count=3 solve_method=apriltag_translation solve_quality=0.919 trans_delta_m=0.0 yaw_delta_deg=0.0
07:23:30.579[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322610.231863 frame_age_s=0.1036 obs_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=1 residual_along_camera_ray_m=0.0278 residual_along_track_m=0.1842 residual_cross_track_m=0.0509 residual_vertical_m=0.0152 robot_speed_ms=0.0 seq=84 source_ts_gap_s=0.002801 straightness=None total_rejections=1 world_residual_m=0.1917
07:23:31.041[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
07:23:32.212[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
07:23:32.348[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.115, -0.859, -0.767] base_before=[0.113, -0.859, -0.771] baseline_m=0.0 marker_jump_m=0.005 observation_count=3 solve_method=apriltag_translation solve_quality=0.932 trans_delta_m=0.005 yaw_delta_deg=0.0
07:23:32.349[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
07:23:33.587[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
07:23:33.590[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=115359.67214
07:23:33.591[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.197, 0.811, 0.053] odom_goal_yaw_deg=180.0 world_goal=[-0.569, -1.114, -0.33] world_goal_yaw_deg=-51.7
07:23:33.593[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.197, 0.811, 0.053], euler=[90.0, 0.0, -169.1])
07:23:33.594[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
07:23:33.595[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.001
07:23:33.595[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.22 y=0.78
07:23:33.601[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
07:23:33.604[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
07:23:33.611[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=12
07:23:33.696[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=139131 seq=86
07:23:33.716[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.117, -0.859, -0.765] base_before=[0.115, -0.859, -0.767] baseline_m=0.0 marker_jump_m=0.003 observation_count=3 solve_method=apriltag_translation solve_quality=0.934 trans_delta_m=0.003 yaw_delta_deg=0.0
07:23:33.730[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322613.398446 frame_age_s=0.1029 obs_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=0.0171 residual_along_track_m=0.1764 residual_cross_track_m=0.0528 residual_vertical_m=0.0167 robot_speed_ms=0.0 seq=86 source_ts_gap_s=0.016861 straightness=None total_rejections=0 world_residual_m=0.1849
07:23:34.435[inf][anning_a_star/local_planner.py] changed state state=path_following
07:23:34.834[inf][r/dimos/ar/bridge/telemetry.py] odom egress age age_max_s=0.036 age_s=0.016 base_world_y_m=-0.8616 base_world_y_max_m=None base_world_y_min_m=None odom_z_m=0.305 odom_z_max_m=None odom_z_min_m=None pose_hz_cap=30.0
07:23:35.228[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.055, -0.859, -0.77] base_before=[0.059, -0.859, -0.766] baseline_m=0.08 marker_jump_m=0.006 observation_count=3 solve_method=apriltag_translation solve_quality=0.942 trans_delta_m=0.006 yaw_delta_deg=0.0
07:23:37.014[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=141294 seq=88
07:23:37.043[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=115363.125358
07:23:37.044[inf][imos/ar/navigation/navigate.py] AR navigation goal redispatched after world-frame correction odom_goal=[-0.299, 0.762, 0.05]
07:23:37.045[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.436, -0.859, -0.741] base_before=[-0.413, -0.862, -0.69] baseline_m=0.512 marker_jump_m=0.056 observation_count=7 solve_method=apriltag_full solve_quality=0.935 trans_delta_m=0.024 yaw_delta_deg=8.86
07:23:37.076[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.299, 0.762, 0.050], euler=[90.0, 0.0, -160.3])
07:23:37.097[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322616.265034 frame_age_s=0.0932 obs_added=1 regime=cruise rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0232 residual_along_track_m=-0.3301 residual_cross_track_m=0.1472 residual_vertical_m=0.0158 robot_speed_ms=0.311 seq=88 source_ts_gap_s=0.035475 straightness=0.1356 total_rejections=0 world_residual_m=0.3618
07:23:37.098[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
07:23:37.103[inf][anning_a_star/local_planner.py] changed state state=idle
07:23:37.104[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.32 y=0.73
07:23:37.105[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
07:23:37.108[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
07:23:37.115[inf][anning_a_star/local_planner.py] changed state state=path_following
07:23:37.325[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
07:23:37.325[inf][anning_a_star/local_planner.py] changed state state=final_rotation
07:23:38.211[inf][mos/ar/tag_tracking/tracker.py] tag_mount_offset diagnostic tag_id=0 measured_base_to_tag=[0.1515 0.002  0.0979] configured_mount.position=[0.18 0.   0.06] residual=[-0.0285  0.002   0.0379] p_world_tag=[-0.0607 -0.7652 -0.7307] p_world_base_from_mount=[ 0.1218 -0.8169 -0.7358]
07:23:38.215[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.655, -0.859, -0.422] base_before=[-0.624, -0.855, -0.427] baseline_m=0.512 marker_jump_m=0.031 observation_count=3 solve_method=apriltag_translation solve_quality=0.934 trans_delta_m=0.031 yaw_delta_deg=0.0
07:23:38.216[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
07:23:38.256[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
07:23:38.256[inf][anning_a_star/local_planner.py] changed state state=arrived
07:23:38.356[inf][anning_a_star/local_planner.py] changed state state=idle
07:23:38.356[inf][nning_a_star/global_planner.py] Arrived at goal.
07:23:38.357[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 07:23:38.384[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
07:23:38.385[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.277
07:23:39.838[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=130785 seq=91
07:23:39.843[inf][r/dimos/ar/bridge/telemetry.py] odom egress age age_max_s=0.063 age_s=0.004 base_world_y_m=-0.8603 base_world_y_max_m=None base_world_y_min_m=None odom_z_m=0.3026 odom_z_max_m=None odom_z_min_m=None pose_hz_cap=30.0
07:23:39.861[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.71, -0.859, -0.403] base_before=[-0.71, -0.86, -0.403] baseline_m=0.681 marker_jump_m=0.001 observation_count=3 solve_method=apriltag_translation solve_quality=0.955 trans_delta_m=0.001 yaw_delta_deg=0.0
07:23:39.873[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322619.364958 frame_age_s=0.1007 obs_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=1 residual_along_camera_ray_m=0.1842 residual_along_track_m=-0.1465 residual_cross_track_m=0.7007 residual_vertical_m=0.0149 robot_speed_ms=0.001 seq=91 source_ts_gap_s=0.017058 straightness=0.3718 total_rejections=1 world_residual_m=0.716
07:23:41.212[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.75, -0.859, -0.38] base_before=[-0.71, -0.859, -0.404] baseline_m=0.392 marker_jump_m=0.047 observation_count=3 solve_method=apriltag_translation solve_quality=0.948 trans_delta_m=0.047 yaw_delta_deg=0.0
07:23:42.833[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=134362 seq=93
07:23:42.848[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.758, -0.859, -0.364] base_before=[-0.75, -0.859, -0.38] baseline_m=0.002 marker_jump_m=0.018 observation_count=3 solve_method=apriltag_translation solve_quality=0.953 trans_delta_m=0.018 yaw_delta_deg=0.0
07:23:42.862[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322622.264876 frame_age_s=0.1078 obs_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=0.1741 residual_along_track_m=-0.1616 residual_cross_track_m=0.7185 residual_vertical_m=0.014 robot_speed_ms=0.0 seq=93 source_ts_gap_s=0.013941 straightness=0.3313 total_rejections=0 world_residual_m=0.7366
07:23:43.397[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
07:23:44.185[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.758, -0.859, -0.364] base_before=[-0.758, -0.859, -0.364] baseline_m=0.002 marker_jump_m=0.0 observation_count=3 solve_method=apriltag_translation solve_quality=0.953 trans_delta_m=0.0 yaw_delta_deg=0.0
07:23:44.196[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
07:23:44.420[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
07:23:44.888[inf][r/dimos/ar/bridge/telemetry.py] odom egress age age_max_s=0.062 age_s=0.001 base_world_y_m=-0.859 base_world_y_max_m=None base_world_y_min_m=None odom_z_m=0.3029 odom_z_max_m=None odom_z_min_m=None pose_hz_cap=30.0
07:23:45.611[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=99069 seq=95
07:23:45.627[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.757, -0.859, -0.364] base_before=[-0.757, -0.859, -0.364] baseline_m=0.002 marker_jump_m=0.0 observation_count=3 solve_method=apriltag_translation solve_quality=0.953 trans_delta_m=0.0 yaw_delta_deg=0.0
07:23:45.656[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783322625.298132 frame_age_s=0.1152 obs_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 residual_along_camera_ray_m=0.0596 residual_along_track_m=-0.1629 residual_cross_track_m=0.7175 residual_vertical_m=0.014 robot_speed_ms=0.0 seq=95 source_ts_gap_s=0.024775 straightness=0.3313 total_rejections=0 world_residual_m=0.7359
07:23:45.656[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
07:23:46.947[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
07:23:47.001[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.757, -0.859, -0.365] base_before=[-0.757, -0.859, -0.365] baseline_m=0.002 marker_jump_m=0.0 observation_count=3 solve_method=apriltag_translation solve_quality=0.953 trans_delta_m=0.0 yaw_delta_deg=0.0
^C07:25:07.279[inf][dination/module_coordinator.py] Stopping module... module=ARBridge
07:25:07.295[deb][stration/session/controller.py] tag tracker active updated active=False reason=session_stop
07:25:07.299[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=0.0
07:25:07.335[inf][dination/module_coordinator.py] Module stopped. module=ARBridge
07:25:07.335[inf][dination/module_coordinator.py] Stopping module... module=Go2RobotProfileModule
07:25:07.340[inf][dination/module_coordinator.py] Module stopped. module=Go2RobotProfileModule
07:25:07.340[inf][dination/module_coordinator.py] Stopping module... module=MovementManager
07:25:07.355[inf][dination/module_coordinator.py] Module stopped. module=MovementManager
07:25:07.355[inf][dination/module_coordinator.py] Stopping module... module=PatrollingModule
07:25:07.406[inf][dination/module_coordinator.py] Module stopped. module=PatrollingModule
07:25:07.407[inf][dination/module_coordinator.py] Stopping module... module=WavefrontFrontierExplorer
07:25:07.422[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.185, 0.778, 0.303], euler=[-2.4, 2.4, -179.9])
07:25:07.423[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
07:25:07.428[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.004
07:25:07.429[war][nning_a_star/global_planner.py] Travelling to goal 0.3056182373801024m away from requested goal.
07:25:07.429[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.22 y=0.78
07:25:07.438[inf][dination/module_coordinator.py] Module stopped. module=WavefrontFrontierExplorer
07:25:07.438[inf][dination/module_coordinator.py] Stopping module... module=ReplanningAStarPlanner
07:25:07.439[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
07:25:07.440[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False