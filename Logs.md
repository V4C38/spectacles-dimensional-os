16:31:26.363[inf][/coordination/python_worker.py] Worker stopping module... module=Go2RobotProfileModule module_id=7 worker_id=8
^C^CTraceback (most recent call last):
  File "/Users/johannestscharn/repositories/dimos/.venv/lib/python3.12/site-packages/dimos/utils/safe_thread_map.py", line 65, in safe_thread_map
    for fut in as_completed(futures):
               ^^^^^^^^^^^^^^^^^^^^^
  File "/Users/johannestscharn/.local/share/uv/python/cpython-3.12.12-macos-aarch64-none/lib/python3.12/concurrent/futures/_base.py", line 243, in as_completed
    waiter.event.wait(wait_timeout)
  File "/Users/johannestscharn/.local/share/uv/python/cpython-3.12.12-macos-aarch64-none/lib/python3.12/threading.py", line 655, in wait
    signaled = self._cond.wait(timeout)
               ^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/johannestscharn/.local/share/uv/python/cpython-3.12.12-macos-aarch64-none/lib/python3.12/threading.py", line 355, in wait
    waiter.acquire()
KeyboardInterrupt

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "<string>", line 12, in <module>
  File "/Users/johannestscharn/repositories/dimos/.venv/lib/python3.12/site-packages/dimos/core/coordination/module_coordinator.py", line 557, in loop
    self.stop()
  File "/Users/johannestscharn/repositories/dimos/.venv/lib/python3.12/site-packages/dimos/core/coordination/module_coordinator.py", line 102, in stop
    safe_thread_map(tuple(self._managers.values()), _stop_manager)
  File "/Users/johannestscharn/repositories/dimos/.venv/lib/python3.12/site-packages/dimos/utils/safe_thread_map.py", line 63, in safe_thread_map
    with ThreadPoolExecutor(max_workers=len(items)) as pool:
         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/johannestscharn/.local/share/uv/python/cpython-3.12.12-macos-aarch64-none/lib/python3.12/concurrent/futures/_base.py", line 647, in __exit__
    self.shutdown(wait=True)
  File "/Users/johannestscharn/.local/share/uv/python/cpython-3.12.12-macos-aarch64-none/lib/python3.12/concurrent/futures/thread.py", line 239, in shutdown
    t.join()
  File "/Users/johannestscharn/.local/share/uv/python/cpython-3.12.12-macos-aarch64-none/lib/python3.12/threading.py", line 1149, in join
    self._wait_for_tstate_lock()
  File "/Users/johannestscharn/.local/share/uv/python/cpython-3.12.12-macos-aarch64-none/lib/python3.12/threading.py", line 1169, in _wait_for_tstate_lock
    if lock.acquire(block, timeout):
       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
KeyboardInterrupt
16:31:27.153[inf][ation/worker_manager_python.py] All workers shut down
^C
/Users/johannestscharn/.local/share/uv/python/cpython-3.12.12-macos-aarch64-none/lib/python3.12/multiprocessing/resource_tracker.py:279: UserWarning: resource_tracker: There appear to be 2 leaked shared_memory objects to clean up at shutdown
  warnings.warn('resource_tracker: There appear to be %d '
johannestscharn@MacBookAirM2 spectacles-dimensional-os % 
johannestscharn@MacBookAirM2 spectacles-dimensional-os % 
johannestscharn@MacBookAirM2 spectacles-dimensional-os % clear

johannestscharn@MacBookAirM2 spectacles-dimensional-os % ./scripts/start.sh
Choose the robot stack to run (↑/↓ then Enter):
  ▶ Unitree Go2
    Unitree G1
Discovering robots on the network...
Found robot B42D1000Q4MBH603 at 192.168.0.102
Using Python: /Users/johannestscharn/repositories/spectacles-dimensional-os/../dimos/.venv/bin/python3
Blueprint:    ar_go2
Stack:        Unitree Go2
Equivalent:   dimos run ar-go2
Robot IP:     192.168.0.102
WebSocket:    ws://0.0.0.0:8787 (not listening yet — booting DimOS stack…)
Log level:    DEBUG (quieter: DIMOS_LOG_LEVEL=INFO ./scripts/start.sh)
Logs:         stdout + ~/.local/state/dimos/logs/.../main.jsonl (dimos log -f)
Spectacles:   enter 192.168.0.101 in the lens

Ctrl+C to stop.

16:32:42.199[inf][dimos/utils/data.py           ] Using local user data directory at '/Users/johannestscharn/Library/Application Support/dimos'
16:32:42.202[inf][dination/module_coordinator.py] Building the blueprint
[clock-sync] NTP query failed ([Errno 8] nodename nor servname provided, or not known); assuming clock is OK
16:33:12.242[war][ce/system_configurator/base.py] System configuration changes are recommended/required:

16:33:12.243[war][ce/system_configurator/base.py] - socket buffer optimization for LCM: sudo sysctl -w kern.ipc.maxsockbuf=67108864

- Raise soft file count limit to 65536 for LCM (no sudo required)
Password:
16:33:16.316[inf][ce/system_configurator/base.py] System configuration completed.
16:33:16.316[inf][dination/module_coordinator.py] Starting the modules
16:33:16.392[inf][ation/worker_manager_python.py] Worker pool started. n_workers=10
16:33:17.050[inf][/coordination/python_worker.py] Deployed module. module=MovementManager module_id=6 worker_id=7
16:33:17.388[inf][/coordination/python_worker.py] Deployed module. module=Go2RobotProfileModule module_id=7 worker_id=8
16:33:17.577[inf][/coordination/python_worker.py] Deployed module. module=PatrollingModule module_id=5 worker_id=6
16:33:17.734[inf][/coordination/python_worker.py] Deployed module. module=ReplanningAStarPlanner module_id=3 worker_id=4
16:33:17.760[inf][/coordination/python_worker.py] Deployed module. module=WavefrontFrontierExplorer module_id=4 worker_id=5
16:33:19.424[inf][/coordination/python_worker.py] Deployed module. module=ARBridge module_id=8 worker_id=1
16:33:19.461[inf][/coordination/python_worker.py] Deployed module. module=CostMapper module_id=2 worker_id=3
🕒 WebRTC connection        : 🟡 started       (18:33:19)
🕒 Lidar Decoder            : 🧊 LibVoxelDecoder (18:33:20)
🕒 Signaling State          : 🟡 have-local-offer (18:33:20)
🕒 ICE Gathering State      : 🟡 gathering     (18:33:20)
🕒 ICE Gathering State      : 🟢 complete      (18:33:20)
16:33:20.047[inf][/coordination/python_worker.py] Deployed module. module=VoxelGridMapper module_id=1 worker_id=2
🕒 LAN Signaling Method     : 🆕 con_notify (192.168.0.102:9991) (18:33:20)
🕒 ICE Connection State     : 🔵 checking      (18:33:20)
🕒 Peer Connection State    : 🔵 connecting    (18:33:20)
🕒 Signaling State          : 🟢 stable        (18:33:20)
🕒 ICE Connection State     : 🟢 completed     (18:33:20)
🕒 Peer Connection State    : 🟢 connected     (18:33:20)
🕒 Data Channel Verification: ✅ OK            (18:33:20)
DisableTrafficSavings: on
🕒 Lidar Decoder            : 🧊 NativeDecoder (18:33:20)
16:33:20.542[inf][/coordination/python_worker.py] Deployed module. module=GO2Connection module_id=0 worker_id=0
16:33:20.598[inf][dination/module_coordinator.py] Transport module=GO2Connection name=pointcloud original_name=pointcloud topic=/pointcloud#sensor_msgs.PointCloud2 transport=LCMTransport type=dimos.msgs.sensor_msgs.PointCloud2.PointCloud2
16:33:20.599[inf][dination/module_coordinator.py] Transport module=GO2Connection name=color_image original_name=color_image topic=color_image transport=pSHMTransport type=dimos.msgs.sensor_msgs.Image.Image
16:33:20.601[inf][dination/module_coordinator.py] Transport module=GO2Connection name=camera_info original_name=camera_info topic=/camera_info#sensor_msgs.CameraInfo transport=LCMTransport type=dimos.msgs.sensor_msgs.CameraInfo.CameraInfo
16:33:20.602[inf][dination/module_coordinator.py] Transport module=GO2Connection name=cmd_vel original_name=cmd_vel topic=/cmd_vel#geometry_msgs.Twist transport=LCMTransport type=dimos.msgs.geometry_msgs.Twist.Twist
16:33:20.604[inf][dination/module_coordinator.py] Transport module=MovementManager name=cmd_vel original_name=cmd_vel topic=/cmd_vel#geometry_msgs.Twist transport=LCMTransport type=dimos.msgs.geometry_msgs.Twist.Twist
16:33:20.606[inf][dination/module_coordinator.py] Transport module=ARBridge name=cmd_vel original_name=cmd_vel topic=/cmd_vel#geometry_msgs.Twist transport=LCMTransport type=dimos.msgs.geometry_msgs.Twist.Twist
16:33:20.607[inf][dination/module_coordinator.py] Transport module=GO2Connection name=odom original_name=odom topic=/odom#geometry_msgs.PoseStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PoseStamped.PoseStamped
16:33:20.608[inf][dination/module_coordinator.py] Transport module=ReplanningAStarPlanner name=odom original_name=odom topic=/odom#geometry_msgs.PoseStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PoseStamped.PoseStamped
16:33:20.610[inf][dination/module_coordinator.py] Transport module=WavefrontFrontierExplorer name=odom original_name=odom topic=/odom#geometry_msgs.PoseStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PoseStamped.PoseStamped
16:33:20.611[inf][dination/module_coordinator.py] Transport module=PatrollingModule name=odom original_name=odom topic=/odom#geometry_msgs.PoseStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PoseStamped.PoseStamped
16:33:20.612[inf][dination/module_coordinator.py] Transport module=ARBridge name=odom original_name=ar_odom topic=/odom#geometry_msgs.PoseStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PoseStamped.PoseStamped
16:33:20.613[inf][dination/module_coordinator.py] Transport module=GO2Connection name=lidar original_name=lidar topic=/lidar#sensor_msgs.PointCloud2 transport=LCMTransport type=dimos.msgs.sensor_msgs.PointCloud2.PointCloud2
16:33:20.614[inf][dination/module_coordinator.py] Transport module=VoxelGridMapper name=lidar original_name=lidar topic=/lidar#sensor_msgs.PointCloud2 transport=LCMTransport type=dimos.msgs.sensor_msgs.PointCloud2.PointCloud2
16:33:20.615[inf][dination/module_coordinator.py] Transport module=ARBridge name=lidar original_name=ar_lidar topic=/lidar#sensor_msgs.PointCloud2 transport=LCMTransport type=dimos.msgs.sensor_msgs.PointCloud2.PointCloud2
16:33:20.616[inf][dination/module_coordinator.py] Transport module=VoxelGridMapper name=global_map original_name=global_map topic=/global_map#sensor_msgs.PointCloud2 transport=LCMTransport type=dimos.msgs.sensor_msgs.PointCloud2.PointCloud2
16:33:20.617[inf][dination/module_coordinator.py] Transport module=CostMapper name=global_map original_name=global_map topic=/global_map#sensor_msgs.PointCloud2 transport=LCMTransport type=dimos.msgs.sensor_msgs.PointCloud2.PointCloud2
16:33:20.618[inf][dination/module_coordinator.py] Transport module=CostMapper name=merged_map original_name=merged_map topic=/merged_map#sensor_msgs.PointCloud2 transport=LCMTransport type=dimos.msgs.sensor_msgs.PointCloud2.PointCloud2
16:33:20.619[inf][dination/module_coordinator.py] Transport module=CostMapper name=global_costmap original_name=global_costmap topic=/global_costmap#nav_msgs.OccupancyGrid transport=LCMTransport type=dimos.msgs.nav_msgs.OccupancyGrid.OccupancyGrid
16:33:20.620[inf][dination/module_coordinator.py] Transport module=ReplanningAStarPlanner name=global_costmap original_name=global_costmap topic=/global_costmap#nav_msgs.OccupancyGrid transport=LCMTransport type=dimos.msgs.nav_msgs.OccupancyGrid.OccupancyGrid
16:33:20.621[inf][dination/module_coordinator.py] Transport module=WavefrontFrontierExplorer name=global_costmap original_name=global_costmap topic=/global_costmap#nav_msgs.OccupancyGrid transport=LCMTransport type=dimos.msgs.nav_msgs.OccupancyGrid.OccupancyGrid
16:33:20.621[inf][dination/module_coordinator.py] Transport module=PatrollingModule name=global_costmap original_name=global_costmap topic=/global_costmap#nav_msgs.OccupancyGrid transport=LCMTransport type=dimos.msgs.nav_msgs.OccupancyGrid.OccupancyGrid
16:33:20.622[inf][dination/module_coordinator.py] Transport module=ARBridge name=global_costmap original_name=ar_global_costmap topic=/global_costmap#nav_msgs.OccupancyGrid transport=LCMTransport type=dimos.msgs.nav_msgs.OccupancyGrid.OccupancyGrid
16:33:20.623[inf][dination/module_coordinator.py] Transport module=ReplanningAStarPlanner name=odometry original_name=odometry topic=/odometry#nav_msgs.Odometry transport=LCMTransport type=dimos.msgs.nav_msgs.Odometry.Odometry
16:33:20.624[inf][dination/module_coordinator.py] Transport module=ReplanningAStarPlanner name=goal_request original_name=goal_request topic=/goal_request#geometry_msgs.PoseStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PoseStamped.PoseStamped
16:33:20.625[inf][dination/module_coordinator.py] Transport module=WavefrontFrontierExplorer name=goal_request original_name=goal_request topic=/goal_request#geometry_msgs.PoseStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PoseStamped.PoseStamped
16:33:20.625[inf][dination/module_coordinator.py] Transport module=PatrollingModule name=goal_request original_name=goal_request topic=/goal_request#geometry_msgs.PoseStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PoseStamped.PoseStamped
16:33:20.626[inf][dination/module_coordinator.py] Transport module=ARBridge name=goal_request original_name=goal_request topic=/goal_request#geometry_msgs.PoseStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PoseStamped.PoseStamped
16:33:20.627[inf][dination/module_coordinator.py] Transport module=ReplanningAStarPlanner name=clicked_point original_name=clicked_point topic=/clicked_point#geometry_msgs.PointStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PointStamped.PointStamped
16:33:20.628[inf][dination/module_coordinator.py] Transport module=MovementManager name=clicked_point original_name=clicked_point topic=/clicked_point#geometry_msgs.PointStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PointStamped.PointStamped
16:33:20.628[inf][dination/module_coordinator.py] Transport module=ReplanningAStarPlanner name=target original_name=target topic=/target#geometry_msgs.PoseStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PoseStamped.PoseStamped
16:33:20.629[inf][dination/module_coordinator.py] Transport module=ReplanningAStarPlanner name=stop_movement original_name=stop_movement topic=/stop_movement#std_msgs.Bool transport=LCMTransport type=dimos_lcm.std_msgs.Bool.Bool
16:33:20.630[inf][dination/module_coordinator.py] Transport module=WavefrontFrontierExplorer name=stop_movement original_name=stop_movement topic=/stop_movement#std_msgs.Bool transport=LCMTransport type=dimos_lcm.std_msgs.Bool.Bool
16:33:20.631[inf][dination/module_coordinator.py] Transport module=MovementManager name=stop_movement original_name=stop_movement topic=/stop_movement#std_msgs.Bool transport=LCMTransport type=dimos_lcm.std_msgs.Bool.Bool
16:33:20.631[inf][dination/module_coordinator.py] Transport module=ARBridge name=stop_movement original_name=stop_movement topic=/stop_movement#std_msgs.Bool transport=LCMTransport type=dimos_lcm.std_msgs.Bool.Bool
16:33:20.632[inf][dination/module_coordinator.py] Transport module=ReplanningAStarPlanner name=goal_reached original_name=goal_reached topic=/goal_reached#std_msgs.Bool transport=LCMTransport type=dimos_lcm.std_msgs.Bool.Bool
16:33:20.632[inf][dination/module_coordinator.py] Transport module=WavefrontFrontierExplorer name=goal_reached original_name=goal_reached topic=/goal_reached#std_msgs.Bool transport=LCMTransport type=dimos_lcm.std_msgs.Bool.Bool
16:33:20.633[inf][dination/module_coordinator.py] Transport module=PatrollingModule name=goal_reached original_name=goal_reached topic=/goal_reached#std_msgs.Bool transport=LCMTransport type=dimos_lcm.std_msgs.Bool.Bool
16:33:20.634[inf][dination/module_coordinator.py] Transport module=ARBridge name=goal_reached original_name=ar_goal_reached topic=/goal_reached#std_msgs.Bool transport=LCMTransport type=dimos_lcm.std_msgs.Bool.Bool
16:33:20.634[inf][dination/module_coordinator.py] Transport module=ReplanningAStarPlanner name=navigation_state original_name=navigation_state topic=/navigation_state#std_msgs.String transport=LCMTransport type=dimos_lcm.std_msgs.String.String
16:33:20.635[inf][dination/module_coordinator.py] Transport module=ARBridge name=navigation_state original_name=ar_navigation_state topic=/navigation_state#std_msgs.String transport=LCMTransport type=dimos_lcm.std_msgs.String.String
16:33:20.636[inf][dination/module_coordinator.py] Transport module=ReplanningAStarPlanner name=nav_cmd_vel original_name=nav_cmd_vel topic=/nav_cmd_vel#geometry_msgs.Twist transport=LCMTransport type=dimos.msgs.geometry_msgs.Twist.Twist
16:33:20.636[inf][dination/module_coordinator.py] Transport module=MovementManager name=nav_cmd_vel original_name=nav_cmd_vel topic=/nav_cmd_vel#geometry_msgs.Twist transport=LCMTransport type=dimos.msgs.geometry_msgs.Twist.Twist
16:33:20.637[inf][dination/module_coordinator.py] Transport module=ReplanningAStarPlanner name=path original_name=path topic=/path#nav_msgs.Path transport=LCMTransport type=dimos.msgs.nav_msgs.Path.Path
16:33:20.637[inf][dination/module_coordinator.py] Transport module=ARBridge name=path original_name=ar_path topic=/path#nav_msgs.Path transport=LCMTransport type=dimos.msgs.nav_msgs.Path.Path
16:33:20.638[inf][dination/module_coordinator.py] Transport module=ReplanningAStarPlanner name=navigation_costmap original_name=navigation_costmap topic=/navigation_costmap#nav_msgs.OccupancyGrid transport=LCMTransport type=dimos.msgs.nav_msgs.OccupancyGrid.OccupancyGrid
16:33:20.639[inf][dination/module_coordinator.py] Transport module=WavefrontFrontierExplorer name=explore_cmd original_name=explore_cmd topic=/explore_cmd#std_msgs.Bool transport=LCMTransport type=dimos_lcm.std_msgs.Bool.Bool
16:33:20.639[inf][dination/module_coordinator.py] Transport module=WavefrontFrontierExplorer name=stop_explore_cmd original_name=stop_explore_cmd topic=/stop_explore_cmd#std_msgs.Bool transport=LCMTransport type=dimos_lcm.std_msgs.Bool.Bool
16:33:20.640[inf][dination/module_coordinator.py] Transport module=MovementManager name=tele_cmd_vel original_name=tele_cmd_vel topic=/tele_cmd_vel#geometry_msgs.Twist transport=LCMTransport type=dimos.msgs.geometry_msgs.Twist.Twist
16:33:20.641[inf][dination/module_coordinator.py] Transport module=MovementManager name=goal original_name=goal topic=/goal#geometry_msgs.PointStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PointStamped.PointStamped
16:33:20.641[inf][dination/module_coordinator.py] Transport module=MovementManager name=way_point original_name=way_point topic=/way_point#geometry_msgs.PointStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PointStamped.PointStamped
16:33:20.642[inf][dination/module_coordinator.py] Transport module=ARBridge name=ar_odometry original_name=ar_odometry topic=/ar_odometry#nav_msgs.Odometry transport=LCMTransport type=dimos.msgs.nav_msgs.Odometry.Odometry
16:33:20.642[inf][dination/module_coordinator.py] Transport module=ARBridge name=goal_point_request original_name=goal_point_request topic=/goal_point_request#geometry_msgs.PointStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PointStamped.PointStamped
16:33:20.643[inf][dination/module_coordinator.py] Transport module=ARBridge name=cancel_goal_signal original_name=cancel_goal_signal topic=/cancel_goal_signal#std_msgs.Bool transport=LCMTransport type=dimos_lcm.std_msgs.Bool.Bool
🕒 Robot Connection Mode    : 📡 STA-L         (18:33:21)
16:33:23.156[inf][dimos/mapping/voxels.py       ] VoxelGrid using device: CPU:0
Video channel: on
▸ 16:33:23.264[inf][os/ar/bridge/status_service.py] bridge connectivity updated reconnecting=False robot_connected=True streams_active=False
16:33:23.267[deb][dimos/ar/bridge/odom_buffer.py] odom source_ts provenance (assume good; remove log after hardware check) receive_mono=523.263542 source_ts=1783874003.209083 wall_age_s=0.05836
16:33:23.267[inf][os/ar/bridge/status_service.py] bridge connectivity updated reconnecting=False robot_connected=True streams_active=True
16:33:23.496[inf][ar/network/websocket_server.py] AR WebSocket server listening host=0.0.0.0 port=8787
16:33:23.496[inf][s-ar/dimos/ar/bridge/module.py] ARBridge started websocket=ws://0.0.0.0:8787
--------------------------------------------------
Bridge ready — ws://0.0.0.0:8787
Spectacles: enter 192.168.0.101 in the lens
--------------------------------------------------
16:33:25.334[deb][tocol/pubsub/impl/shmpubsub.py] SharedMemory PubSub starting (backend=auto)
16:33:36.954[inf][ar/network/websocket_server.py] AR client connected remote=('192.168.0.100', 55542)
--------------------------------------------------
AR client connected remote=('192.168.0.100', 55542)
--------------------------------------------------
16:33:37.069[inf][ar/network/websocket_server.py] AR inbound text message type=set_lidar_mode
16:33:37.069[inf][r/dimos/ar/bridge/telemetry.py] LiDAR mode updated mode=off obstacle_max_distance_m=0.8 obstacle_min_distance_m=0.1 obstacle_opaque_distance_m=0.5
16:33:37.073[inf][ar/network/websocket_server.py] AR inbound text message type=set_lidar_mode
16:33:38.483[inf][ar/network/websocket_server.py] AR inbound text message type=registration_command
16:33:38.485[inf][ar/network/websocket_server.py] AR inbound text message type=registration_command
16:33:38.485[inf][ar/network/websocket_server.py] AR inbound text message type=registration_command
16:33:38.486[deb][stration/session/controller.py] tag tracker active updated active=True reason=april_tag_start
16:33:38.486[inf][/registration/session/flows.py] AR registration started mode=april_tag
16:33:38.732[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:33:38.733[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:33:38.967[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=148889 seq=1
16:33:38.981[inf][tion/session/session_frames.py] registration scan frame observation_count=0 observations_added=0 rejections_distance=0 rejections_reprojection=0 rejections_skew=0 seq=1 source_ts_gap_s=0.0009 tag_detected=False
16:33:38.981[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
16:33:41.065[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=190517 seq=10
16:33:41.079[war][s/ar/world_frame/transforms.py] gravity_level_transform diagnostic: translation=[-0.952 -1.476 -1.016] up_world=[0.57  0.537 0.623] input_rotation=[[ 0.078 -0.818  0.57 ]
 [ 0.719  0.442  0.537]
 [-0.691  0.367  0.623]]
16:33:41.079[war][s/ar/world_frame/transforms.py] gravity_level_transform: input up-axis far from world-up (angle=57.6 deg) — registration input likely malformed; this warning is rate-limited to once per 30 s
16:33:41.080[inf][tion/session/session_frames.py] registration scan frame observation_count=1 observations_added=1 rejections_distance=0 rejections_reprojection=0 rejections_skew=0 seq=10 source_ts_gap_s=0.0133 tag_detected=True
16:33:43.224[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=185806 seq=20
16:33:43.243[inf][tion/session/session_frames.py] registration scan frame observation_count=11 observations_added=1 rejections_distance=0 rejections_reprojection=0 rejections_skew=0 seq=20 source_ts_gap_s=0.0557 tag_detected=True
16:33:44.096[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
16:33:45.415[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=181021 seq=30
16:33:45.431[inf][tion/session/session_frames.py] registration scan frame observation_count=21 observations_added=1 rejections_distance=0 rejections_reprojection=0 rejections_skew=0 seq=30 source_ts_gap_s=0.0034 tag_detected=True
16:33:47.615[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=126689 seq=42
16:33:47.629[inf][tion/session/session_frames.py] registration scan frame observation_count=23 observations_added=0 rejections_distance=0 rejections_reprojection=0 rejections_skew=0 seq=42 source_ts_gap_s=0.0155 tag_detected=False
16:33:49.332[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
16:33:49.636[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=126559 seq=52
16:33:49.651[inf][tion/session/session_frames.py] registration scan frame observation_count=23 observations_added=0 rejections_distance=0 rejections_reprojection=0 rejections_skew=0 seq=52 source_ts_gap_s=0.0292 tag_detected=False
16:33:51.786[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=174925 seq=62
16:33:51.805[inf][tion/session/session_frames.py] registration scan frame observation_count=26 observations_added=1 rejections_distance=0 rejections_reprojection=0 rejections_skew=0 seq=62 source_ts_gap_s=0.0354 tag_detected=True
16:33:53.837[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=176357 seq=72
16:33:53.854[inf][tion/session/session_frames.py] registration scan frame observation_count=32 observations_added=1 rejections_distance=0 rejections_reprojection=0 rejections_skew=0 seq=72 source_ts_gap_s=0.0339 tag_detected=True
16:33:54.503[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
16:33:54.721[inf][/registration/session/flows.py] AprilTag registration aligner commit approximate=True n_obs=24 registration_confidence=0.7046 scale_observable=False yaw_observable=True
16:33:54.724[deb][mos/ar/world_frame/registry.py] TF publish_static not supported by current backend — skipping world→odom TF
16:33:54.724[deb][stration/session/controller.py] tag tracker active updated active=False reason=registration_finish
▸ 16:33:54.724[inf][/registration/session/flows.py] Registration succeeded approximate=True mode=april_tag quality=0.705
--------------------------------------------------
Registration succeeded mode=april_tag quality=0.7
--------------------------------------------------
16:33:54.746[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874034.529671 frame_age_s=0.0886 latest_residual_m=0.0458 observations_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0216 residual_along_track_m=0.0457 residual_cross_track_m=0.0029 residual_vertical_m=0.0013 robot_speed_ms=0.0 seq=76 source_ts_gap_s=0.032718 total_rejections=0 window_centroid_residual_m=0.0458
16:33:58.433[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:33:58.519[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.017, -0.013, -0.009], euler=[90.0, 0.0, 0.9])
16:33:58.519[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:33:58.573[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=558.569399
16:33:58.574[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.017, -0.013, -0.009] odom_goal_yaw_deg=-0.0 world_goal=[-0.873, -1.674, -0.842] world_goal_yaw_deg=89.9
16:33:58.581[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.061
16:33:58.632[inf][nning_a_star/global_planner.py] Found safe goal. x=0.07 y=-0.02
16:33:58.635[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:33:58.636[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:33:58.637[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=3
16:33:58.962[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.271, 0.073, 0.041] odom_goal_yaw_deg=0.0 world_goal=[-0.975, -1.624, -1.205] world_goal_yaw_deg=95.81
16:33:58.964[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.271, 0.073, 0.041], euler=[90.0, 0.0, 6.8])
16:33:58.965[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:33:58.965[inf][anning_a_star/local_planner.py] changed state state=idle
16:33:58.965[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:33:58.966[inf][nning_a_star/global_planner.py] Found safe goal. x=0.22 y=0.03
16:33:58.971[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:33:58.973[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:33:59.267[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.611, 0.161, 0.09] odom_goal_yaw_deg=0.0 world_goal=[-1.077, -1.575, -1.631] world_goal_yaw_deg=104.16
16:33:59.267[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.611, 0.161, 0.090], euler=[90.0, 0.0, 15.1])
16:33:59.268[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:33:59.268[inf][anning_a_star/local_planner.py] changed state state=idle
16:33:59.268[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:33:59.268[inf][nning_a_star/global_planner.py] Found safe goal. x=0.57 y=0.13
16:33:59.272[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:33:59.273[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:33:59.375[inf][anning_a_star/local_planner.py] changed state state=path_following
16:33:59.609[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:33:59.610[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.806, 0.212, 0.111] odom_goal_yaw_deg=0.0 world_goal=[-1.137, -1.554, -1.876] world_goal_yaw_deg=104.02
16:33:59.612[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.806, 0.212, 0.111], euler=[90.0, 0.0, 15.0])
16:33:59.612[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:33:59.612[inf][anning_a_star/local_planner.py] changed state state=idle
16:33:59.613[inf][nning_a_star/global_planner.py] Found safe goal. x=0.77 y=0.18
16:33:59.613[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:33:59.617[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:33:59.618[inf][anning_a_star/local_planner.py] changed state state=path_following
16:33:59.803[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.857, 0.223, 0.116] odom_goal_yaw_deg=0.0 world_goal=[-1.15, -1.549, -1.941] world_goal_yaw_deg=102.43
16:33:59.804[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.857, 0.223, 0.116], euler=[90.0, 0.0, 13.4])
16:33:59.804[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:33:59.805[inf][anning_a_star/local_planner.py] changed state state=idle
16:33:59.805[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:33:59.806[inf][nning_a_star/global_planner.py] Found safe goal. x=0.82 y=0.18
16:33:59.809[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:33:59.811[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:33:59.925[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:33:59.925[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:33:59.956[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=164744 seq=2
16:33:59.971[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874039.762901 frame_age_s=0.1013 latest_residual_m=0.0527 observations_added=1 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0207 residual_along_track_m=0.052 residual_cross_track_m=0.0071 residual_vertical_m=0.0043 robot_speed_ms=0.172 seq=2 source_ts_gap_s=0.016111 total_rejections=0 window_centroid_residual_m=0.0178
16:34:00.435[inf][anning_a_star/local_planner.py] changed state state=path_following
16:34:02.024[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=135783 seq=9
16:34:02.036[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874041.829503 frame_age_s=0.0896 latest_residual_m=0.0489 observations_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.0416 residual_along_track_m=-0.0174 residual_cross_track_m=0.0029 residual_vertical_m=-0.0456 robot_speed_ms=0.404 seq=9 source_ts_gap_s=0.049195 total_rejections=0 window_centroid_residual_m=0.2708
16:34:02.498[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:34:02.498[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:34:02.498[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:34:02.499[inf][anning_a_star/local_planner.py] changed state state=arrived
16:34:02.598[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:02.599[inf][nning_a_star/global_planner.py] Arrived at goal.
16:34:02.599[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:34:02.661[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:34:02.662[inf][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.231
16:34:02.890[inf][mos/ar/tag_tracking/tracker.py] tag_mount_up_axis_check median_up_axis_tilt_deg=7.84 sample_count=10
16:34:03.967[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:34:03.968[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:34:04.037[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874043.362805 frame_age_s=0.3607 latest_residual_m=0.0796 observations_added=0 regime=static rej_distance=1 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0589 residual_along_track_m=0.0218 residual_cross_track_m=0.0015 residual_vertical_m=0.0765 robot_speed_ms=0.0 seq=15 source_ts_gap_s=0.038197 total_rejections=1 window_centroid_residual_m=0.5112
16:34:04.235[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=172746 seq=16
16:34:04.519[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:34:04.520[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=564.516207
16:34:04.520[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.717, 0.167, -0.027] odom_goal_yaw_deg=0.0 world_goal=[-1.083, -1.692, -1.764] world_goal_yaw_deg=102.76
16:34:04.520[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.717, 0.167, -0.027], euler=[90.0, 0.0, 13.7])
16:34:04.521[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:04.521[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.0
16:34:04.522[inf][nning_a_star/global_planner.py] Found safe goal. x=0.67 y=0.13
16:34:04.526[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:04.527[inf][anning_a_star/local_planner.py] changed state state=path_following
16:34:04.527[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
16:34:04.527[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:34:04.528[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:34:04.528[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:34:04.528[inf][anning_a_star/local_planner.py] changed state state=arrived
16:34:04.632[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:04.633[inf][nning_a_star/global_planner.py] Arrived at goal.
16:34:04.633[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:34:04.661[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:34:04.661[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
16:34:04.778[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.900, 0.262, 0.023], euler=[90.0, 0.0, 12.7])
16:34:04.778[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.9, 0.262, 0.023] odom_goal_yaw_deg=0.0 world_goal=[-1.197, -1.642, -1.995] world_goal_yaw_deg=101.74
16:34:04.779[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:04.779[inf][nning_a_star/global_planner.py] Found safe goal. x=0.88 y=0.23
16:34:04.782[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:04.783[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:34:04.784[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=4
16:34:05.233[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.061, 0.285, 0.023], euler=[90.0, 0.0, 8.7])
16:34:05.233[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.061, 0.285, 0.023] odom_goal_yaw_deg=0.0 world_goal=[-1.223, -1.642, -2.196] world_goal_yaw_deg=97.71
16:34:05.233[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:05.234[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:05.234[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:34:05.234[inf][nning_a_star/global_planner.py] Found safe goal. x=1.03 y=0.28
16:34:05.237[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:05.238[inf][anning_a_star/local_planner.py] changed state state=path_following
16:34:05.863[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:34:05.864[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.155, 0.296, 0.139] odom_goal_yaw_deg=0.0 world_goal=[-1.235, -1.526, -2.314] world_goal_yaw_deg=96.81
16:34:05.869[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.155, 0.296, 0.139], euler=[90.0, 0.0, 7.8])
16:34:05.870[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:05.870[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:05.871[inf][nning_a_star/global_planner.py] Found safe goal. x=1.13 y=0.28
16:34:05.871[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:34:05.877[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:05.880[inf][anning_a_star/local_planner.py] changed state state=path_following
16:34:06.101[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874045.92939 frame_age_s=0.0913 latest_residual_m=0.101 observations_added=0 regime=moving rej_distance=1 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0782 residual_along_track_m=-0.038 residual_cross_track_m=0.0398 residual_vertical_m=0.0847 robot_speed_ms=0.167 seq=22 source_ts_gap_s=0.023867 total_rejections=1 window_centroid_residual_m=0.577
16:34:06.264[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=181869 seq=23
16:34:08.151[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:34:08.152[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:34:08.152[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:34:08.152[inf][anning_a_star/local_planner.py] changed state state=arrived
16:34:08.251[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:08.252[inf][nning_a_star/global_planner.py] Arrived at goal.
16:34:08.252[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:34:08.253[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:34:08.253[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.262
16:34:11.606[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:34:11.607[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=571.603514
16:34:11.608[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.949, 0.261, -0.035] odom_goal_yaw_deg=0.0 world_goal=[-1.196, -1.7, -2.055] world_goal_yaw_deg=98.94
16:34:11.608[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.949, 0.261, -0.035], euler=[90.0, 0.0, 9.9])
16:34:11.608[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:11.608[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.0
16:34:11.608[inf][nning_a_star/global_planner.py] Found safe goal. x=0.93 y=0.23
16:34:11.613[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:11.614[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
16:34:11.614[inf][anning_a_star/local_planner.py] changed state state=path_following
16:34:11.614[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:34:11.614[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:34:11.614[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:34:11.615[inf][anning_a_star/local_planner.py] changed state state=arrived
16:34:11.715[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:11.716[inf][nning_a_star/global_planner.py] Arrived at goal.
16:34:11.716[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:34:11.734[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:34:11.734[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
16:34:11.867[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.177, 0.385, 0.018] odom_goal_yaw_deg=0.0 world_goal=[-1.345, -1.647, -2.344] world_goal_yaw_deg=111.23
16:34:11.867[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.177, 0.385, 0.018], euler=[90.0, 0.0, 22.2])
16:34:11.868[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:11.868[inf][nning_a_star/global_planner.py] Found safe goal. x=1.18 y=0.38
16:34:11.871[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:11.872[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:34:11.874[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=5
16:34:12.178[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.387, 0.421, 0.204] odom_goal_yaw_deg=0.0 world_goal=[-1.386, -1.461, -2.607] world_goal_yaw_deg=96.28
16:34:12.178[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.387, 0.421, 0.204], euler=[90.0, 0.0, 7.3])
16:34:12.178[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:12.179[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:12.179[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:34:12.179[war][nning_a_star/global_planner.py] Travelling to goal 0.20965336292605585m away from requested goal.
16:34:12.180[inf][nning_a_star/global_planner.py] Found safe goal. x=1.38 y=0.38
16:34:12.183[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:12.184[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:34:12.503[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.651, 0.477, 0.162] odom_goal_yaw_deg=0.0 world_goal=[-1.45, -1.503, -2.938] world_goal_yaw_deg=103.73
16:34:12.525[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.651, 0.477, 0.162], euler=[90.0, 0.0, 14.7])
16:34:12.526[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:12.526[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:12.526[inf][nning_a_star/global_planner.py] Found safe goal. x=1.63 y=0.48
16:34:12.527[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:34:12.530[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:12.532[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:34:12.891[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:34:12.893[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.982, 0.533, 0.148] odom_goal_yaw_deg=0.0 world_goal=[-1.513, -1.517, -3.353] world_goal_yaw_deg=97.5
16:34:12.893[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.982, 0.533, 0.148], euler=[90.0, 0.0, 8.5])
16:34:12.893[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:12.894[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:12.895[inf][nning_a_star/global_planner.py] Found safe goal. x=1.98 y=0.53
16:34:12.894[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:34:12.904[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:12.907[inf][anning_a_star/local_planner.py] changed state state=path_following
16:34:13.307[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.066, 0.527, 0.145] odom_goal_yaw_deg=-0.0 world_goal=[-1.503, -1.52, -3.457] world_goal_yaw_deg=81.49
16:34:13.307[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.066, 0.527, 0.145], euler=[90.0, -0.0, -7.5])
16:34:13.308[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:13.308[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:13.308[inf][nning_a_star/global_planner.py] Found safe goal. x=2.03 y=0.53
16:34:13.309[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:34:13.313[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:13.315[inf][anning_a_star/local_planner.py] changed state state=path_following
16:34:14.054[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:34:14.054[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:34:14.364[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=184059 seq=27
16:34:14.364[war][tion/session/session_frames.py] AR camera frame dropped: too old frame_age_s=6.961 max_age_s=4.0 seq=27
16:34:14.596[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874054.329205 frame_age_s=0.1117 latest_residual_m=0.1046 observations_added=1 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.1002 residual_along_track_m=-0.0074 residual_cross_track_m=0.0035 residual_vertical_m=0.1043 robot_speed_ms=0.086 seq=28 source_ts_gap_s=0.008041 total_rejections=0 window_centroid_residual_m=0.6784
16:34:16.581[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=178251 seq=35
16:34:16.608[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874056.129168 frame_age_s=0.116 latest_residual_m=0.0982 observations_added=1 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0956 residual_along_track_m=-0.0117 residual_cross_track_m=0.0011 residual_vertical_m=0.0975 robot_speed_ms=0.085 seq=35 source_ts_gap_s=0.037621 total_rejections=0 window_centroid_residual_m=0.476
16:34:18.581[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=172895 seq=42
16:34:18.962[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874058.595781 frame_age_s=0.0886 latest_residual_m=0.7847 observations_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.3383 residual_along_track_m=-0.7804 residual_cross_track_m=0.0598 residual_vertical_m=0.0563 robot_speed_ms=0.472 seq=43 source_ts_gap_s=0.022749 total_rejections=0 window_centroid_residual_m=1.3783
16:34:19.501[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:34:19.502[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:34:19.502[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:34:19.502[inf][anning_a_star/local_planner.py] changed state state=arrived
16:34:19.605[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:19.605[inf][nning_a_star/global_planner.py] Arrived at goal.
16:34:19.606[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
16:34:19.688[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.083
▸ 16:34:19.689[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:34:19.690[inf][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.217
16:34:21.373[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:34:21.374[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=581.370048
16:34:21.374[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.981, 0.619, -0.020], euler=[90.0, 0.0, -7.5])
16:34:21.374[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.981, 0.619, -0.02] odom_goal_yaw_deg=-0.0 world_goal=[-1.621, -1.685, -3.353] world_goal_yaw_deg=81.54
16:34:21.374[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:21.376[inf][nning_a_star/global_planner.py] Found safe goal. x=1.97 y=0.58
16:34:21.380[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:21.381[inf][anning_a_star/local_planner.py] changed state state=path_following
16:34:21.381[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
16:34:21.381[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:34:21.382[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:34:21.382[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:34:21.382[inf][anning_a_star/local_planner.py] changed state state=arrived
16:34:21.487[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:21.487[inf][nning_a_star/global_planner.py] Arrived at goal.
16:34:21.488[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:34:21.489[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:34:21.489[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
16:34:21.800[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.273, 0.533, 0.038] odom_goal_yaw_deg=-0.0 world_goal=[-1.507, -1.627, -3.716] world_goal_yaw_deg=75.06
16:34:21.801[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.273, 0.533, 0.038], euler=[90.0, -0.0, -14.0])
16:34:21.801[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:21.801[inf][nning_a_star/global_planner.py] Found safe goal. x=2.22 y=0.53
16:34:21.804[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:21.806[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:34:21.866[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=5
16:34:22.027[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.624, 0.601, 0.137] odom_goal_yaw_deg=0.0 world_goal=[-1.584, -1.528, -4.157] world_goal_yaw_deg=102.94
16:34:22.073[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.624, 0.601, 0.137], euler=[90.0, 0.0, 13.9])
16:34:22.073[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:22.074[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:22.074[inf][nning_a_star/global_planner.py] Found safe goal. x=2.57 y=0.58
16:34:22.075[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:34:22.078[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:22.082[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:34:22.414[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:34:22.416[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.914, 0.724, 0.165] odom_goal_yaw_deg=0.0 world_goal=[-1.731, -1.5, -4.522] world_goal_yaw_deg=114.94
16:34:22.419[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.914, 0.724, 0.165], euler=[90.0, 0.0, 25.9])
16:34:22.420[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:22.420[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:22.420[inf][nning_a_star/global_planner.py] Found safe goal. x=2.87 y=0.68
16:34:22.421[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:34:22.425[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:22.427[inf][anning_a_star/local_planner.py] changed state state=path_following
16:34:22.721[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.053, 0.828, 0.163] odom_goal_yaw_deg=0.0 world_goal=[-1.859, -1.502, -4.698] world_goal_yaw_deg=125.27
16:34:22.779[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.053, 0.828, 0.163], euler=[90.0, 0.0, 36.3])
16:34:22.780[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:22.780[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:22.781[inf][nning_a_star/global_planner.py] Found safe goal. x=3.02 y=0.83
16:34:22.781[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:34:22.791[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:22.794[inf][anning_a_star/local_planner.py] changed state state=path_following
16:34:23.048[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.125, 1.062, 0.166], euler=[90.0, 0.0, 68.9])
16:34:23.049[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:23.049[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:23.049[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.125, 1.062, 0.166] odom_goal_yaw_deg=0.0 world_goal=[-2.15, -1.499, -4.793] world_goal_yaw_deg=157.9
16:34:23.049[inf][nning_a_star/global_planner.py] Found safe goal. x=3.12 y=1.03
16:34:23.050[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:34:23.056[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:23.061[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:34:23.441[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:34:23.442[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=583.438431
16:34:23.443[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.157, 1.36, 0.177] odom_goal_yaw_deg=0.0 world_goal=[-2.521, -1.488, -4.839] world_goal_yaw_deg=177.53
16:34:23.517[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.157, 1.360, 0.177], euler=[90.0, 0.0, 88.5])
16:34:23.517[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:23.518[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:23.518[inf][nning_a_star/global_planner.py] Found safe goal. x=3.12 y=1.33
16:34:23.519[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:34:23.524[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:23.527[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:34:23.727[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.976, 1.514, 0.19] odom_goal_yaw_deg=-180.0 world_goal=[-2.717, -1.475, -4.616] world_goal_yaw_deg=-126.76
16:34:23.727[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.976, 1.514, 0.190], euler=[90.0, 0.0, 144.2])
16:34:23.727[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:23.727[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:23.728[inf][nning_a_star/global_planner.py] Found safe goal. x=2.97 y=1.48
16:34:23.728[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:34:23.735[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:23.737[inf][anning_a_star/local_planner.py] changed state state=path_following
16:34:24.048[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.754, 1.569, 0.202] odom_goal_yaw_deg=-180.0 world_goal=[-2.791, -1.463, -4.34] world_goal_yaw_deg=-112.49
16:34:24.088[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.754, 1.569, 0.202], euler=[90.0, 0.0, 158.5])
16:34:24.088[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:24.089[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:24.090[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:34:24.090[war][nning_a_star/global_planner.py] Travelling to goal 0.20848559784642937m away from requested goal.
16:34:24.091[inf][nning_a_star/global_planner.py] Found safe goal. x=2.72 y=1.53
16:34:24.101[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:24.103[inf][anning_a_star/local_planner.py] changed state state=path_following
16:34:24.252[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.703, 1.625, 0.207] odom_goal_yaw_deg=-180.0 world_goal=[-2.862, -1.458, -4.277] world_goal_yaw_deg=-133.85
16:34:24.257[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.703, 1.625, 0.207], euler=[90.0, -0.0, 137.1])
16:34:24.258[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:24.258[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:24.259[war][nning_a_star/global_planner.py] Travelling to goal 0.21477819577999055m away from requested goal.
16:34:24.259[inf][nning_a_star/global_planner.py] Found safe goal. x=2.67 y=1.58
16:34:24.259[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:34:24.270[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:24.272[inf][anning_a_star/local_planner.py] changed state state=path_following
16:34:26.634[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:34:26.634[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:34:27.561[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:34:27.561[inf][anning_a_star/local_planner.py] changed state state=arrived
16:34:27.665[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:27.666[inf][nning_a_star/global_planner.py] Arrived at goal.
16:34:27.666[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
16:34:27.717[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.051
▸ 16:34:27.717[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:34:27.718[inf][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.108
16:34:29.809[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:34:29.809[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:34:30.054[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=179052 seq=44
16:34:30.054[war][tion/session/session_frames.py] AR camera frame dropped: too old frame_age_s=10.89 max_age_s=4.0 seq=44
16:34:30.396[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874070.095491 frame_age_s=0.1082 latest_residual_m=0.2762 observations_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.2278 residual_along_track_m=0.0352 residual_cross_track_m=0.2192 residual_vertical_m=0.1643 robot_speed_ms=0.004 seq=45 source_ts_gap_s=0.02504 total_rejections=0 window_centroid_residual_m=3.1007
16:34:30.863[inf][imos/ar/world_frame/aligner.py] alignment_update alpha_scale=1.0 alpha_yaw=1.0 baseline_m=3.0044 confidence=0.4439 max_pair_skew_s=0.0741 mean_ambiguity_ratio=22.1769 method=similarity n_obs=12 n_rejected=3 resid_rms_m=0.0052 s=1.2091 scale_held=False scale_observable=True yaw_deg=89.37 yaw_held=False yaw_observable=True
16:34:30.864[inf][imos/ar/world_frame/aligner.py] refinement_episode_complete baseline_m=3.004 marker_jump_m=0.088 observation_count=12 solve_quality=0.955 trans_delta_m=0.09 yaw_delta_deg=0.35
16:34:30.865[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=2 dropped_fifo=0 fifo_depth=0
16:34:32.757[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:34:32.759[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=592.755272
16:34:32.760[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.761, 1.478, -0.024] odom_goal_yaw_deg=-180.0 world_goal=[-2.584, -1.673, -4.153] world_goal_yaw_deg=-153.28
16:34:32.772[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.761, 1.478, -0.024], euler=[90.0, 0.0, 117.4])
16:34:32.773[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:32.773[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.0
16:34:32.773[inf][nning_a_star/global_planner.py] Found safe goal. x=2.72 y=1.48
16:34:32.777[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:32.778[inf][anning_a_star/local_planner.py] changed state state=path_following
16:34:32.778[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:34:32.778[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
16:34:32.779[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:34:32.779[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:34:32.779[inf][anning_a_star/local_planner.py] changed state state=arrived
16:34:32.881[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:32.881[inf][nning_a_star/global_planner.py] Arrived at goal.
16:34:32.882[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:34:32.929[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:34:32.929[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
16:34:33.184[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.010, 1.763, 0.083], euler=[90.0, -0.0, 39.2])
16:34:33.184[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.01, 1.763, 0.083] odom_goal_yaw_deg=-0.0 world_goal=[-2.926, -1.565, -4.459] world_goal_yaw_deg=128.55
16:34:33.185[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:33.185[inf][nning_a_star/global_planner.py] Found safe goal. x=2.97 y=1.73
16:34:33.189[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:33.190[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:34:33.193[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=5
16:34:33.372[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.265, 1.642, 0.175] odom_goal_yaw_deg=-0.0 world_goal=[-2.776, -1.473, -4.765] world_goal_yaw_deg=52.51
16:34:33.429[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.265, 1.642, 0.175], euler=[90.0, 0.0, -36.9])
16:34:33.430[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:33.430[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:33.431[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:34:33.431[inf][nning_a_star/global_planner.py] Found safe goal. x=3.22 y=1.63
16:34:33.435[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:33.437[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:34:33.706[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.469, 1.443, 0.167] odom_goal_yaw_deg=-0.0 world_goal=[-2.532, -1.481, -5.009] world_goal_yaw_deg=40.91
16:34:33.723[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.469, 1.443, 0.167], euler=[90.0, 0.0, -48.5])
16:34:33.723[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:33.724[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:33.724[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:34:33.725[inf][nning_a_star/global_planner.py] Found safe goal. x=3.42 y=1.43
16:34:33.731[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:33.733[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:34:34.048[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:34:34.049[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.616, 1.295, 0.165] odom_goal_yaw_deg=-0.0 world_goal=[-2.352, -1.483, -5.185] world_goal_yaw_deg=45.55
16:34:34.134[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.616, 1.295, 0.165], euler=[90.0, 0.0, -43.8])
16:34:34.134[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:34.134[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:34.135[inf][nning_a_star/global_planner.py] Found safe goal. x=3.57 y=1.28
16:34:34.135[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:34:34.140[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:34.142[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:34:35.694[inf][anning_a_star/local_planner.py] changed state state=path_following
16:34:39.420[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:34:39.420[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:34:40.654[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:34:40.654[inf][anning_a_star/local_planner.py] changed state state=arrived
16:34:40.756[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:40.757[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.0
16:34:40.757[inf][nning_a_star/global_planner.py] Arrived at goal.
16:34:40.757[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:34:40.758[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:34:40.758[inf][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.178
16:34:49.781[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:34:49.781[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:34:49.873[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=178530 seq=2
16:34:49.902[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874089.595078 frame_age_s=0.1305 latest_residual_m=0.1231 observations_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0999 residual_along_track_m=-0.0758 residual_cross_track_m=0.0244 residual_vertical_m=0.0939 robot_speed_ms=0.0 seq=2 source_ts_gap_s=0.030354 total_rejections=0 window_centroid_residual_m=3.1398
16:34:51.355[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:34:51.356[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=611.352397
16:34:51.356[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.493, 1.137, -0.022], euler=[90.0, 0.0, -32.2])
16:34:51.357[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:51.357[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.493, 1.137, -0.022] odom_goal_yaw_deg=-0.0 world_goal=[-2.162, -1.67, -5.035] world_goal_yaw_deg=57.12
16:34:51.357[inf][nning_a_star/global_planner.py] Found safe goal. x=3.47 y=1.13
16:34:51.357[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.0
16:34:51.360[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:51.361[inf][anning_a_star/local_planner.py] changed state state=path_following
16:34:51.361[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:34:51.361[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:34:51.361[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:34:51.362[inf][anning_a_star/local_planner.py] changed state state=arrived
16:34:51.362[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
16:34:51.466[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:51.467[inf][nning_a_star/global_planner.py] Arrived at goal.
16:34:51.467[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:34:51.587[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:34:51.588[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
16:34:51.594[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.513, 0.798, 0.048] odom_goal_yaw_deg=-0.0 world_goal=[-1.752, -1.6, -5.054] world_goal_yaw_deg=15.93
16:34:51.596[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=2 dropped_fifo=0 fifo_depth=0
16:34:51.598[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.513, 0.798, 0.048], euler=[90.0, 0.0, -73.4])
16:34:51.599[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:51.600[inf][nning_a_star/global_planner.py] Found safe goal. x=3.47 y=0.78
16:34:51.606[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:51.607[inf][anning_a_star/local_planner.py] changed state state=path_following
16:34:51.609[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=6
16:34:51.723[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.527, 0.738, 0.079] odom_goal_yaw_deg=-0.0 world_goal=[-1.679, -1.569, -5.07] world_goal_yaw_deg=15.11
16:34:51.764[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.527, 0.738, 0.079], euler=[90.0, -0.0, -74.3])
16:34:51.765[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:51.765[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:51.765[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:34:51.766[inf][nning_a_star/global_planner.py] Found safe goal. x=3.52 y=0.73
16:34:51.772[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:51.773[inf][anning_a_star/local_planner.py] changed state state=path_following
16:34:51.987[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.895, 0.31, 0.097] odom_goal_yaw_deg=-0.0 world_goal=[-1.157, -1.552, -5.509] world_goal_yaw_deg=37.93
16:34:52.005[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.895, 0.310, 0.097], euler=[90.0, 0.0, -51.4])
16:34:52.005[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:52.006[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:52.006[inf][nning_a_star/global_planner.py] Found safe goal. x=3.88 y=0.28
16:34:52.006[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:34:52.014[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:52.017[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:34:52.052[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=161401 seq=9
16:34:52.100[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874091.861708 frame_age_s=0.0943 latest_residual_m=0.1376 observations_added=1 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.084 residual_along_track_m=-0.0894 residual_cross_track_m=0.0372 residual_vertical_m=0.0977 robot_speed_ms=0.085 seq=9 source_ts_gap_s=0.007093 total_rejections=0 window_centroid_residual_m=2.5268
16:34:52.407[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:34:52.408[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.036, 0.141, 0.083] odom_goal_yaw_deg=-0.0 world_goal=[-0.951, -1.565, -5.678] world_goal_yaw_deg=37.21
16:34:52.408[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.036, 0.141, 0.083], euler=[90.0, 0.0, -52.2])
16:34:52.408[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:52.409[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:52.409[inf][nning_a_star/global_planner.py] Found safe goal. x=4.03 y=0.13
16:34:52.409[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:34:52.418[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:52.422[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:34:52.775[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.378, -0.141, 0.072] odom_goal_yaw_deg=0.0 world_goal=[-0.605, -1.577, -6.087] world_goal_yaw_deg=50.58
16:34:52.898[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.378, -0.141, 0.072], euler=[90.0, 0.0, -38.8])
16:34:52.898[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:52.899[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:52.899[inf][nning_a_star/global_planner.py] Found safe goal. x=4.38 y=-0.17
16:34:52.899[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:34:52.927[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:52.941[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:34:53.153[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.419, -0.158, 0.072] odom_goal_yaw_deg=-0.0 world_goal=[-0.584, -1.576, -6.137] world_goal_yaw_deg=63.61
16:34:53.199[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.419, -0.158, 0.072], euler=[90.0, 0.0, -25.8])
16:34:53.200[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:34:53.201[inf][anning_a_star/local_planner.py] changed state state=idle
16:34:53.201[inf][nning_a_star/global_planner.py] Found safe goal. x=4.38 y=-0.17
16:34:53.201[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:34:53.218[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:34:53.223[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:34:54.470[inf][anning_a_star/local_planner.py] changed state state=path_following
16:35:00.304[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:35:00.305[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=620.301497
16:35:00.306[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.339, -0.009, 0.093] odom_goal_yaw_deg=180.0 world_goal=[-0.765, -1.555, -6.041] world_goal_yaw_deg=-170.47
16:35:00.308[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.339, -0.009, 0.093], euler=[90.0, 0.0, 100.2])
16:35:00.309[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:00.309[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:00.309[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:35:00.309[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.001
16:35:00.310[inf][nning_a_star/global_planner.py] Found safe goal. x=4.33 y=-0.02
16:35:00.315[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:00.316[inf][anning_a_star/local_planner.py] changed state state=path_following
16:35:00.609[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.136, 0.031, 0.099] odom_goal_yaw_deg=180.0 world_goal=[-0.816, -1.549, -5.797] world_goal_yaw_deg=-91.84
16:35:00.707[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.136, 0.031, 0.099], euler=[90.0, 0.0, 178.8])
16:35:00.708[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:00.708[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:00.709[inf][nning_a_star/global_planner.py] Found safe goal. x=4.13 y=0.03
16:35:00.709[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:35:00.714[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:00.715[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:35:01.020[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.055, -0.225, 0.089] odom_goal_yaw_deg=-180.0 world_goal=[-0.508, -1.559, -5.695] world_goal_yaw_deg=-12.1
16:35:01.093[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.055, -0.225, 0.089], euler=[90.0, -0.0, -101.5])
16:35:01.094[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:01.094[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:01.094[inf][nning_a_star/global_planner.py] Found safe goal. x=4.03 y=-0.27
16:35:01.094[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:35:01.099[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:01.100[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:35:01.263[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.159, -0.501, 0.078] odom_goal_yaw_deg=-0.0 world_goal=[-0.173, -1.571, -5.818] world_goal_yaw_deg=16.95
16:35:01.329[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.159, -0.501, 0.078], euler=[90.0, 0.0, -72.4])
16:35:01.330[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:01.330[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:01.331[inf][nning_a_star/global_planner.py] Found safe goal. x=4.13 y=-0.52
16:35:01.332[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:35:01.337[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:01.339[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:35:01.764[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:35:01.765[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.317, -0.553, 0.073] odom_goal_yaw_deg=-0.0 world_goal=[-0.108, -1.576, -6.008] world_goal_yaw_deg=105.64
16:35:01.766[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.317, -0.553, 0.073], euler=[90.0, 0.0, 16.3])
16:35:01.766[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:01.766[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:01.767[inf][nning_a_star/global_planner.py] Found safe goal. x=4.28 y=-0.57
16:35:01.767[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:35:01.771[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:01.773[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:35:02.092[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.535, -0.448, 0.076] odom_goal_yaw_deg=0.0 world_goal=[-0.232, -1.573, -6.273] world_goal_yaw_deg=111.7
16:35:02.167[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.535, -0.448, 0.076], euler=[90.0, 0.0, 22.3])
16:35:02.168[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:02.168[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:02.169[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:35:02.169[inf][nning_a_star/global_planner.py] Found safe goal. x=4.53 y=-0.47
16:35:02.174[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:02.176[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:35:02.533[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=622.528592
16:35:02.534[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.777, -0.326, 0.035] odom_goal_yaw_deg=-0.0 world_goal=[-0.376, -1.614, -6.567] world_goal_yaw_deg=110.42
16:35:02.666[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.777, -0.326, 0.035], euler=[90.0, 0.0, 21.1])
16:35:02.666[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:02.666[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:02.667[inf][nning_a_star/global_planner.py] Found safe goal. x=4.78 y=-0.37
16:35:02.668[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:35:02.674[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:02.675[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:35:02.808[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:35:02.809[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.953, -0.217, 0.07] odom_goal_yaw_deg=-0.0 world_goal=[-0.506, -1.578, -6.782] world_goal_yaw_deg=124.82
16:35:02.846[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.953, -0.217, 0.070], euler=[90.0, 0.0, 35.5])
16:35:02.846[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:02.847[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:02.847[inf][nning_a_star/global_planner.py] Found safe goal. x=4.93 y=-0.22
16:35:02.849[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:35:02.852[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:02.854[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:35:03.202[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.091, -0.056, 0.084] odom_goal_yaw_deg=0.0 world_goal=[-0.698, -1.564, -6.95] world_goal_yaw_deg=133.75
16:35:03.327[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.091, -0.056, 0.084], euler=[90.0, 0.0, 44.4])
16:35:03.327[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:03.328[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:03.328[inf][nning_a_star/global_planner.py] Found safe goal. x=5.08 y=-0.07
16:35:03.330[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:35:03.335[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:03.339[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:35:03.515[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.151, 0.036, 0.088] odom_goal_yaw_deg=0.0 world_goal=[-0.809, -1.56, -7.024] world_goal_yaw_deg=146.23
16:35:03.570[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.151, 0.036, 0.088], euler=[90.0, 0.0, 56.9])
16:35:03.571[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:03.571[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:03.572[inf][nning_a_star/global_planner.py] Found safe goal. x=5.13 y=0.03
16:35:03.572[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:35:03.578[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:03.580[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:35:04.200[inf][anning_a_star/local_planner.py] changed state state=path_following
16:35:05.745[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:35:05.745[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:35:07.393[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:35:07.394[inf][anning_a_star/local_planner.py] changed state state=arrived
16:35:07.497[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:07.497[inf][nning_a_star/global_planner.py] Arrived at goal.
16:35:07.498[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
16:35:07.498[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.0
▸ 16:35:07.499[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:35:07.499[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.254
16:35:09.258[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:35:09.258[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:35:09.412[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=162323 seq=10
16:35:09.412[war][tion/session/session_frames.py] AR camera frame dropped: too old frame_age_s=17.194 max_age_s=4.0 seq=10
16:35:09.607[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874109.361317 frame_age_s=0.095 latest_residual_m=0.1848 observations_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.1188 residual_along_track_m=0.0372 residual_cross_track_m=0.1693 residual_vertical_m=0.0641 robot_speed_ms=0.001 seq=11 source_ts_gap_s=0.004601 total_rejections=0 window_centroid_residual_m=4.4736
16:35:10.311[inf][imos/ar/world_frame/aligner.py] alignment_update alpha_scale=1.0 alpha_yaw=1.0 baseline_m=5.2435 confidence=0.6667 max_pair_skew_s=0.1834 mean_ambiguity_ratio=2.0712 method=similarity n_obs=11 n_rejected=2 resid_rms_m=0.0035 s=1.1948 scale_held=False scale_observable=True yaw_deg=89.34 yaw_held=False yaw_observable=True
16:35:10.312[inf][imos/ar/world_frame/aligner.py] refinement_episode_complete baseline_m=5.244 marker_jump_m=0.133 observation_count=11 solve_quality=0.939 trans_delta_m=0.135 yaw_delta_deg=0.02
16:35:10.313[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=2 dropped_fifo=0 fifo_depth=0
16:35:11.732[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:35:11.733[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=631.729344
16:35:11.735[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.285, -0.005, -0.03] odom_goal_yaw_deg=-0.0 world_goal=[-0.88, -1.674, -7.057] world_goal_yaw_deg=139.98
16:35:11.859[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.285, -0.005, -0.030], euler=[90.0, 0.0, 50.6])
16:35:11.860[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:11.860[inf][nning_a_star/global_planner.py] Found safe goal. x=5.28 y=-0.02
16:35:11.865[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:11.867[inf][anning_a_star/local_planner.py] changed state state=path_following
16:35:11.868[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:35:11.869[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:35:11.869[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:35:11.869[inf][anning_a_star/local_planner.py] changed state state=arrived
16:35:11.935[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
16:35:11.971[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:11.972[inf][nning_a_star/global_planner.py] Arrived at goal.
16:35:11.973[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:35:12.012[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:35:12.012[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
16:35:12.124[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.28, 0.091, 0.02] odom_goal_yaw_deg=180.0 world_goal=[-0.994, -1.624, -7.053] world_goal_yaw_deg=-179.21
16:35:12.151[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.280, 0.091, 0.020], euler=[90.0, 0.0, 91.4])
16:35:12.151[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:12.152[inf][nning_a_star/global_planner.py] Found safe goal. x=5.28 y=0.08
16:35:12.156[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:12.157[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:35:12.158[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=3
16:35:12.382[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.975, 0.345, 0.027] odom_goal_yaw_deg=-180.0 world_goal=[-1.302, -1.617, -6.691] world_goal_yaw_deg=-131.13
16:35:12.552[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.975, 0.345, 0.027], euler=[90.0, 0.0, 139.5])
16:35:12.552[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:12.552[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:12.554[inf][nning_a_star/global_planner.py] Found safe goal. x=4.93 y=0.33
16:35:12.558[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:35:12.563[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:12.564[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:35:12.695[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.142
16:35:12.840[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:35:12.841[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.904, 0.501, 0.059] odom_goal_yaw_deg=-180.0 world_goal=[-1.49, -1.585, -6.609] world_goal_yaw_deg=-130.09
16:35:13.033[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.904, 0.501, 0.059], euler=[90.0, 0.0, 140.6])
16:35:13.034[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:13.034[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:13.035[inf][nning_a_star/global_planner.py] Found safe goal. x=4.88 y=0.48
16:35:13.035[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:35:13.043[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:13.044[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:35:13.150[inf][anning_a_star/local_planner.py] changed state state=path_following
16:35:13.312[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.681, 0.888, 0.157] odom_goal_yaw_deg=-0.0 world_goal=[-1.955, -1.487, -6.348] world_goal_yaw_deg=125.75
16:35:13.312[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.681, 0.888, 0.157], euler=[90.0, 0.0, 36.4])
16:35:13.312[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:13.313[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:13.313[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:35:13.314[inf][nning_a_star/global_planner.py] Found safe goal. x=4.68 y=0.88
16:35:13.327[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:13.331[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:35:13.686[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.475, 0.754, 0.151] odom_goal_yaw_deg=-180.0 world_goal=[-1.798, -1.493, -6.1] world_goal_yaw_deg=-61.34
16:35:13.789[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.475, 0.754, 0.151], euler=[90.0, 0.0, -150.7])
16:35:13.789[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:13.789[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:13.790[inf][nning_a_star/global_planner.py] Found safe goal. x=4.48 y=0.73
16:35:13.791[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:35:13.808[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:13.817[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:35:13.930[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:35:13.931[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=633.926713
16:35:13.931[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.638, 0.268, 0.131] odom_goal_yaw_deg=-0.0 world_goal=[-1.215, -1.513, -6.288] world_goal_yaw_deg=14.11
16:35:13.931[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.638, 0.268, 0.131], euler=[90.0, 0.0, -75.2])
16:35:13.932[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:13.932[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:13.933[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:35:13.933[inf][nning_a_star/global_planner.py] Found safe goal. x=4.63 y=0.23
16:35:13.941[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:13.942[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:35:14.786[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.861, 0.322, 0.119] odom_goal_yaw_deg=-0.0 world_goal=[-1.277, -1.524, -6.555] world_goal_yaw_deg=43.61
16:35:14.858[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.861, 0.322, 0.119], euler=[90.0, 0.0, -45.7])
16:35:14.859[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:14.859[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:14.859[inf][nning_a_star/global_planner.py] Found safe goal. x=4.83 y=0.28
16:35:14.860[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:35:14.865[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:14.867[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:35:15.166[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:35:15.167[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.979, 1.006, 0.16] odom_goal_yaw_deg=-0.0 world_goal=[-2.091, -1.484, -6.705] world_goal_yaw_deg=168.37
16:35:15.220[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.979, 1.006, 0.160], euler=[90.0, 0.0, 79.0])
16:35:15.220[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:15.221[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:15.221[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:35:15.222[inf][nning_a_star/global_planner.py] Found safe goal. x=4.98 y=0.98
16:35:15.238[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:15.242[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:35:15.562[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.113, 1.241, 0.176] odom_goal_yaw_deg=-0.0 world_goal=[-2.371, -1.468, -6.869] world_goal_yaw_deg=66.72
16:35:15.788[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.113, 1.241, 0.176], euler=[90.0, 0.0, -22.6])
16:35:15.788[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:15.789[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:15.789[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:35:15.790[inf][nning_a_star/global_planner.py] Found safe goal. x=5.08 y=1.23
16:35:15.812[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:15.820[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:35:15.855[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.856, 0.51, 0.135] odom_goal_yaw_deg=-180.0 world_goal=[-1.501, -1.509, -6.551] world_goal_yaw_deg=-12.4
16:35:15.910[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.856, 0.510, 0.135], euler=[90.0, 0.0, -101.7])
16:35:15.911[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:15.912[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:15.912[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:35:15.913[inf][nning_a_star/global_planner.py] Found safe goal. x=4.83 y=0.48
16:35:15.922[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:15.923[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:35:16.750[inf][anning_a_star/local_planner.py] changed state state=path_following
16:35:17.094[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:35:17.096[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=637.091694
16:35:17.096[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.793, 0.648, 0.142] odom_goal_yaw_deg=-180.0 world_goal=[-1.666, -1.502, -6.478] world_goal_yaw_deg=-176.62
16:35:17.173[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.793, 0.648, 0.142], euler=[90.0, 0.0, 94.0])
16:35:17.174[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:17.174[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:17.174[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:35:17.175[inf][nning_a_star/global_planner.py] Found safe goal. x=4.78 y=0.63
16:35:17.183[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:17.184[inf][anning_a_star/local_planner.py] changed state state=path_following
16:35:18.631[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:35:18.632[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:35:18.842[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:35:18.842[inf][anning_a_star/local_planner.py] changed state state=arrived
16:35:18.947[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:18.947[inf][nning_a_star/global_planner.py] Arrived at goal.
16:35:18.947[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
16:35:19.065[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.118
▸ 16:35:19.066[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:35:19.067[inf][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.173
16:35:31.705[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:35:31.706[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:35:31.761[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=163200 seq=2
16:35:31.792[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874131.527425 frame_age_s=0.1155 latest_residual_m=1.0857 observations_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.6243 residual_along_track_m=-1.0676 residual_cross_track_m=0.1906 residual_vertical_m=0.0516 robot_speed_ms=0.0 seq=2 source_ts_gap_s=0.032707 total_rejections=0 window_centroid_residual_m=3.424
16:35:35.022[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:35:35.024[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=655.019624
16:35:35.025[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.751, 0.734, -0.022] odom_goal_yaw_deg=180.0 world_goal=[-1.77, -1.666, -6.429] world_goal_yaw_deg=-153.35
16:35:35.204[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.751, 0.734, -0.022], euler=[90.0, 0.0, 117.3])
16:35:35.205[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:35.206[inf][nning_a_star/global_planner.py] Found safe goal. x=4.73 y=0.73
16:35:35.210[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:35.216[inf][anning_a_star/local_planner.py] changed state state=path_following
16:35:35.216[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:35:35.216[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:35:35.217[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:35:35.217[inf][anning_a_star/local_planner.py] changed state state=arrived
16:35:35.267[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.052
16:35:35.268[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
16:35:35.324[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:35.324[inf][nning_a_star/global_planner.py] Arrived at goal.
16:35:35.325[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:35:35.346[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:35:35.347[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
16:35:35.461[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.617, 1.009, 0.032] odom_goal_yaw_deg=-180.0 world_goal=[-2.101, -1.612, -6.272] world_goal_yaw_deg=-158.69
16:35:35.489[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.617, 1.009, 0.032], euler=[90.0, 0.0, 112.0])
16:35:35.489[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:35.490[inf][nning_a_star/global_planner.py] Found safe goal. x=4.58 y=0.98
16:35:35.494[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:35.496[inf][anning_a_star/local_planner.py] changed state state=path_following
16:35:35.499[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=5
16:35:35.795[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.511, 1.309, 0.17] odom_goal_yaw_deg=180.0 world_goal=[-2.46, -1.474, -6.151] world_goal_yaw_deg=-162.51
16:35:35.933[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.511, 1.309, 0.170], euler=[90.0, 0.0, 108.1])
16:35:35.933[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:35.934[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:35.934[inf][nning_a_star/global_planner.py] Found safe goal. x=4.48 y=1.28
16:35:35.934[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:35:35.939[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:35.941[inf][anning_a_star/local_planner.py] changed state state=path_following
16:35:36.148[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:35:36.149[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.463, 1.579, 0.184], euler=[90.0, 0.0, 98.6])
16:35:36.149[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:36.149[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:36.149[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.463, 1.579, 0.184] odom_goal_yaw_deg=-180.0 world_goal=[-2.784, -1.46, -6.097] world_goal_yaw_deg=-172.04
16:35:36.150[inf][nning_a_star/global_planner.py] Found safe goal. x=4.43 y=1.58
16:35:36.150[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:35:36.160[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:36.164[inf][anning_a_star/local_planner.py] changed state state=path_following
16:35:36.370[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.441, 1.701, 0.187] odom_goal_yaw_deg=-180.0 world_goal=[-2.929, -1.457, -6.072] world_goal_yaw_deg=-170.32
16:35:36.493[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.441, 1.701, 0.187], euler=[90.0, 0.0, 100.3])
16:35:36.493[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:36.493[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:36.494[inf][nning_a_star/global_planner.py] Found safe goal. x=4.43 y=1.68
16:35:36.494[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:35:36.501[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:36.505[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:35:37.906[inf][anning_a_star/local_planner.py] changed state state=path_following
16:35:40.964[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:35:40.964[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:35:41.716[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:35:41.717[inf][anning_a_star/local_planner.py] changed state state=arrived
16:35:41.823[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:41.824[inf][nning_a_star/global_planner.py] Arrived at goal.
16:35:41.824[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
16:35:41.840[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.017
▸ 16:35:41.841[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:35:41.841[inf][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.142
16:35:43.541[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:35:43.542[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.503, 1.623, -0.018], euler=[90.0, 0.0, 123.1])
16:35:43.542[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=663.537397
16:35:43.542[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:43.542[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.503, 1.623, -0.018] odom_goal_yaw_deg=180.0 world_goal=[-2.835, -1.662, -6.145] world_goal_yaw_deg=-147.57
16:35:43.543[inf][nning_a_star/global_planner.py] Found safe goal. x=4.48 y=1.58
16:35:43.547[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:43.547[inf][anning_a_star/local_planner.py] changed state state=path_following
16:35:43.547[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:35:43.548[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:35:43.548[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:35:43.548[inf][anning_a_star/local_planner.py] changed state state=arrived
16:35:43.548[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
16:35:43.656[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:43.657[inf][nning_a_star/global_planner.py] Arrived at goal.
16:35:43.657[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:35:43.658[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:35:43.658[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
16:35:43.886[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.383, 1.843, 0.032] odom_goal_yaw_deg=180.0 world_goal=[-3.101, -1.612, -6.005] world_goal_yaw_deg=-157.22
16:35:43.906[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.383, 1.843, 0.032], euler=[90.0, 0.0, 113.4])
16:35:43.906[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:43.906[inf][nning_a_star/global_planner.py] Found safe goal. x=4.38 y=1.83
16:35:43.911[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:43.912[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:35:43.913[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=5
16:35:44.162[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.319, 2.15, 0.195] odom_goal_yaw_deg=-180.0 world_goal=[-3.468, -1.449, -5.932] world_goal_yaw_deg=-158.72
16:35:44.227[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.319, 2.150, 0.195], euler=[90.0, 0.0, 111.9])
16:35:44.228[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:44.228[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:44.229[war][nning_a_star/global_planner.py] Travelling to goal 0.20123048859239964m away from requested goal.
16:35:44.228[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:35:44.229[inf][nning_a_star/global_planner.py] Found safe goal. x=4.28 y=2.13
16:35:44.234[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:44.237[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:35:44.571[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:35:44.573[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.237, 2.453, 0.225] odom_goal_yaw_deg=180.0 world_goal=[-3.831, -1.419, -5.839] world_goal_yaw_deg=-158.06
16:35:44.573[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.237, 2.453, 0.225], euler=[90.0, 0.0, 112.6])
16:35:44.573[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:44.573[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:44.574[war][nning_a_star/global_planner.py] Travelling to goal 0.22689310301345397m away from requested goal.
16:35:44.574[inf][nning_a_star/global_planner.py] Found safe goal. x=4.23 y=2.43
16:35:44.574[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:35:44.580[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:44.582[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:35:44.889[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.195, 2.665, 0.227] odom_goal_yaw_deg=-180.0 world_goal=[-4.085, -1.416, -5.791] world_goal_yaw_deg=-167.07
16:35:44.935[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.195, 2.665, 0.227], euler=[90.0, -0.0, 103.6])
16:35:44.938[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:44.938[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:44.939[war][nning_a_star/global_planner.py] Travelling to goal 0.23168244724791684m away from requested goal.
16:35:44.939[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:35:44.939[inf][nning_a_star/global_planner.py] Found safe goal. x=4.18 y=2.63
16:35:44.945[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:44.947[inf][anning_a_star/local_planner.py] changed state state=path_following
16:35:45.241[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.095, 2.804, 0.228] odom_goal_yaw_deg=-180.0 world_goal=[-4.252, -1.416, -5.674] world_goal_yaw_deg=-147.02
16:35:45.368[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.095, 2.804, 0.228], euler=[90.0, 0.0, 123.6])
16:35:45.369[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:45.369[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:45.369[war][nning_a_star/global_planner.py] Travelling to goal 0.23089745813151827m away from requested goal.
16:35:45.370[inf][nning_a_star/global_planner.py] Found safe goal. x=4.08 y=2.78
16:35:45.370[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:35:45.380[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:45.382[inf][anning_a_star/local_planner.py] changed state state=path_following
16:35:45.596[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:35:45.597[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=665.592669
16:35:45.597[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.995, 2.994, 0.235] odom_goal_yaw_deg=-180.0 world_goal=[-4.48, -1.409, -5.557] world_goal_yaw_deg=-160.62
16:35:45.600[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.995, 2.994, 0.235], euler=[90.0, 0.0, 110.0])
16:35:45.600[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:45.601[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:45.601[war][nning_a_star/global_planner.py] Travelling to goal 0.23622482623992772m away from requested goal.
16:35:45.601[inf][nning_a_star/global_planner.py] Found safe goal. x=3.98 y=2.98
16:35:45.601[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:35:45.607[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:45.610[inf][anning_a_star/local_planner.py] changed state state=path_following
16:35:48.260[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:35:48.261[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:35:48.261[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:35:48.261[inf][anning_a_star/local_planner.py] changed state state=arrived
16:35:48.367[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:48.368[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.0
16:35:48.368[inf][nning_a_star/global_planner.py] Arrived at goal.
16:35:48.368[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:35:48.369[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:35:48.369[inf][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.058
16:35:52.062[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:35:52.062[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:35:52.236[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=160395 seq=8
16:35:52.236[war][tion/session/session_frames.py] AR camera frame dropped: too old frame_age_s=18.981 max_age_s=4.0 seq=8
16:35:52.748[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874152.193647 frame_age_s=0.0989 latest_residual_m=0.3695 observations_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.2309 residual_along_track_m=-0.2423 residual_cross_track_m=0.2053 residual_vertical_m=0.1888 robot_speed_ms=0.0 seq=9 source_ts_gap_s=0.020644 total_rejections=0 window_centroid_residual_m=3.7288
16:35:54.366[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=172944 seq=14
16:35:54.756[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874154.360253 frame_age_s=0.1042 latest_residual_m=0.3695 observations_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.268 residual_along_track_m=-0.2296 residual_cross_track_m=0.2148 residual_vertical_m=0.1942 robot_speed_ms=0.001 seq=15 source_ts_gap_s=0.062961 total_rejections=0 window_centroid_residual_m=3.3746
16:35:55.700[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:35:55.701[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=675.697097
16:35:55.702[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.912, 2.967, -0.027] odom_goal_yaw_deg=-180.0 world_goal=[-4.449, -1.671, -5.457] world_goal_yaw_deg=-145.29
16:35:55.810[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.938, 3.096, 0.013] odom_goal_yaw_deg=-0.0 world_goal=[-4.604, -1.63, -5.491] world_goal_yaw_deg=173.98
16:35:55.878[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.912, 2.967, -0.027], euler=[90.0, 0.0, 125.4])
16:35:55.878[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:55.879[inf][nning_a_star/global_planner.py] Found safe goal. x=3.88 y=2.93
16:35:55.885[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:55.886[inf][anning_a_star/local_planner.py] changed state state=path_following
16:35:55.886[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:35:55.886[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:35:55.887[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:35:55.887[inf][anning_a_star/local_planner.py] changed state state=arrived
16:35:55.937[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.938, 3.096, 0.013], euler=[90.0, 0.0, 84.6])
16:35:55.938[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:55.938[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:55.938[inf][nning_a_star/global_planner.py] Found safe goal. x=3.93 y=3.08
16:35:55.940[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.055
16:35:55.941[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:35:55.941[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
16:35:55.943[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:55.944[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:35:56.474[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=164709 seq=22
16:35:56.481[inf][anning_a_star/local_planner.py] changed state state=path_following
16:35:56.481[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:35:56.481[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:35:57.436[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:35:57.437[inf][anning_a_star/local_planner.py] changed state state=arrived
16:35:57.542[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:57.543[inf][nning_a_star/global_planner.py] Arrived at goal.
16:35:57.543[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:35:57.544[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:35:57.544[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.297
16:35:59.692[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:35:59.693[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=679.688969
16:35:59.694[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.9, 2.954, -0.026] odom_goal_yaw_deg=-180.0 world_goal=[-4.434, -1.67, -5.443] world_goal_yaw_deg=-175.61
16:35:59.838[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.998, 2.585, 0.087] odom_goal_yaw_deg=-0.0 world_goal=[-3.992, -1.557, -5.555] world_goal_yaw_deg=27.73
16:35:59.911[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.900, 2.954, -0.026], euler=[90.0, 0.0, 95.1])
16:35:59.912[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:59.914[inf][nning_a_star/global_planner.py] Found safe goal. x=3.88 y=2.93
16:35:59.922[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:59.924[inf][anning_a_star/local_planner.py] changed state state=path_following
16:35:59.924[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:35:59.924[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:35:59.925[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:35:59.925[inf][anning_a_star/local_planner.py] changed state state=arrived
16:35:59.958[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.998, 2.585, 0.087], euler=[90.0, 0.0, -61.6])
16:35:59.959[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:35:59.959[inf][anning_a_star/local_planner.py] changed state state=idle
16:35:59.959[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:35:59.960[inf][nning_a_star/global_planner.py] Found safe goal. x=3.98 y=2.58
16:35:59.961[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
16:35:59.970[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:35:59.983[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:36:00.357[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.037, 2.349, 0.209] odom_goal_yaw_deg=-0.0 world_goal=[-3.709, -1.435, -5.598] world_goal_yaw_deg=18.37
16:36:00.485[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.037, 2.349, 0.209], euler=[90.0, -0.0, -71.0])
16:36:00.485[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:36:00.486[inf][anning_a_star/local_planner.py] changed state state=idle
16:36:00.487[war][nning_a_star/global_planner.py] Travelling to goal 0.2109234974889811m away from requested goal.
16:36:00.488[inf][nning_a_star/global_planner.py] Found safe goal. x=4.03 y=2.33
16:36:00.506[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:36:00.510[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:36:00.510[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:36:00.510[inf][anning_a_star/local_planner.py] changed state state=idle
16:36:00.617[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.076, 2.284, 0.213] odom_goal_yaw_deg=0.0 world_goal=[-3.631, -1.431, -5.644] world_goal_yaw_deg=27.29
16:36:00.623[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.076, 2.284, 0.213], euler=[90.0, 0.0, -62.1])
16:36:00.623[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:36:00.624[war][nning_a_star/global_planner.py] Travelling to goal 0.2127837856044528m away from requested goal.
16:36:00.624[inf][nning_a_star/global_planner.py] Found safe goal. x=4.08 y=2.28
16:36:00.624[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:36:00.631[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:36:00.635[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:36:02.664[inf][anning_a_star/local_planner.py] changed state state=path_following
16:36:06.074[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:36:06.075[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:36:06.823[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:36:06.825[inf][anning_a_star/local_planner.py] changed state state=arrived
16:36:06.927[inf][anning_a_star/local_planner.py] changed state state=idle
16:36:06.928[inf][nning_a_star/global_planner.py] Arrived at goal.
16:36:06.931[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
16:36:06.931[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.001
▸ 16:36:06.958[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:36:06.959[inf][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.079
16:36:07.055[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:36:07.056[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:36:07.216[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=163169 seq=24
16:36:07.217[war][tion/session/session_frames.py] AR camera frame dropped: too old frame_age_s=10.309 max_age_s=4.0 seq=24
16:36:07.576[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874167.226636 frame_age_s=0.1104 latest_residual_m=0.2992 observations_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.2353 residual_along_track_m=0.2004 residual_cross_track_m=0.1197 residual_vertical_m=0.1872 robot_speed_ms=0.006 seq=25 source_ts_gap_s=0.004274 total_rejections=0 window_centroid_residual_m=1.5242
16:36:09.255[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=176026 seq=31
16:36:09.769[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874169.459924 frame_age_s=0.0907 latest_residual_m=0.2867 observations_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.2244 residual_along_track_m=0.2024 residual_cross_track_m=0.1144 residual_vertical_m=0.1677 robot_speed_ms=0.001 seq=33 source_ts_gap_s=0.008143 total_rejections=0 window_centroid_residual_m=1.1922
16:36:10.507[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
16:36:11.515[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=180134 seq=39
16:36:11.832[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874171.526525 frame_age_s=0.0707 latest_residual_m=0.2831 observations_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.2208 residual_along_track_m=0.1825 residual_cross_track_m=0.1339 residual_vertical_m=0.17 robot_speed_ms=0.0 seq=40 source_ts_gap_s=0.006069 total_rejections=0 window_centroid_residual_m=0.5412
16:36:12.021[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:36:12.023[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=692.01857
16:36:12.023[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.062, 2.223, -0.032] odom_goal_yaw_deg=-0.0 world_goal=[-3.558, -1.676, -5.626] world_goal_yaw_deg=13.38
16:36:12.063[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.062, 2.223, -0.032], euler=[90.0, 0.0, -76.0])
16:36:12.064[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:36:12.066[inf][nning_a_star/global_planner.py] Found safe goal. x=4.03 y=2.18
16:36:12.068[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.004
16:36:12.074[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:36:12.075[inf][anning_a_star/local_planner.py] changed state state=path_following
16:36:12.076[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:36:12.076[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
16:36:12.076[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:36:12.076[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:36:12.076[inf][anning_a_star/local_planner.py] changed state state=arrived
16:36:12.180[inf][anning_a_star/local_planner.py] changed state state=idle
16:36:12.181[inf][nning_a_star/global_planner.py] Arrived at goal.
16:36:12.181[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:36:12.193[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:36:12.194[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
16:36:12.243[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.998, 1.895, 0.035], euler=[90.0, 0.0, -113.0])
16:36:12.243[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.998, 1.895, 0.035] odom_goal_yaw_deg=-180.0 world_goal=[-3.168, -1.609, -5.546] world_goal_yaw_deg=-23.61
16:36:12.243[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:36:12.243[inf][nning_a_star/global_planner.py] Found safe goal. x=3.98 y=1.88
16:36:12.250[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:36:12.252[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:36:12.255[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=5
16:36:12.443[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.988, 1.855, 0.067] odom_goal_yaw_deg=180.0 world_goal=[-3.12, -1.577, -5.533] world_goal_yaw_deg=-24.82
16:36:12.443[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.988, 1.855, 0.067], euler=[90.0, 0.0, -114.2])
16:36:12.444[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:36:12.445[inf][anning_a_star/local_planner.py] changed state state=idle
16:36:12.445[inf][nning_a_star/global_planner.py] Found safe goal. x=3.98 y=1.83
16:36:12.445[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:36:12.455[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:36:12.457[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:36:12.611[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.998, 1.718, 0.167] odom_goal_yaw_deg=0.0 world_goal=[-2.957, -1.477, -5.543] world_goal_yaw_deg=7.82
16:36:12.677[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.998, 1.718, 0.167], euler=[90.0, 0.0, -81.5])
16:36:12.677[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:36:12.677[inf][anning_a_star/local_planner.py] changed state state=idle
16:36:12.678[inf][nning_a_star/global_planner.py] Found safe goal. x=3.98 y=1.68
16:36:12.679[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:36:12.686[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:36:12.690[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:36:13.218[inf][anning_a_star/local_planner.py] changed state state=path_following
16:36:14.501[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:36:14.501[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:36:14.534[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=173812 seq=45
16:36:14.559[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874172.726512 frame_age_s=1.7443 latest_residual_m=0.2785 observations_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=1 residual_along_camera_ray_m=-0.2271 residual_along_track_m=0.1641 residual_cross_track_m=0.1601 residual_vertical_m=0.1581 robot_speed_ms=0.314 seq=45 source_ts_gap_s=0.018353 total_rejections=1 window_centroid_residual_m=0.4582
16:36:15.020[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:36:15.021[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:36:15.755[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:36:15.755[inf][anning_a_star/local_planner.py] changed state state=arrived
16:36:15.862[inf][anning_a_star/local_planner.py] changed state state=idle
16:36:15.865[inf][nning_a_star/global_planner.py] Arrived at goal.
16:36:15.866[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:36:15.897[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:36:15.897[inf][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.17
16:36:16.622[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=181903 seq=52
16:36:16.656[war][s/ar/world_frame/transforms.py] gravity_level_transform: input up-axis far from world-up (angle=15.2 deg) — registration input likely malformed; this warning is rate-limited to once per 30 s
16:36:16.658[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874176.393101 frame_age_s=0.1159 latest_residual_m=0.2435 observations_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.1738 residual_along_track_m=0.195 residual_cross_track_m=0.0208 residual_vertical_m=0.1443 robot_speed_ms=0.035 seq=52 source_ts_gap_s=0.029862 total_rejections=0 window_centroid_residual_m=0.3995
16:36:17.279[inf][imos/ar/world_frame/aligner.py] alignment_update alpha_scale=1.0 alpha_yaw=1.0 baseline_m=4.468 confidence=0.7324 max_pair_skew_s=0.1161 mean_ambiguity_ratio=2.2765 method=similarity n_obs=24 n_rejected=3 resid_rms_m=0.0147 s=1.1805 scale_held=False scale_observable=True yaw_deg=90.48 yaw_held=False yaw_observable=True
16:36:17.280[inf][imos/ar/world_frame/aligner.py] refinement_episode_complete baseline_m=4.468 marker_jump_m=0.149 observation_count=24 solve_quality=0.929 trans_delta_m=0.25 yaw_delta_deg=1.14
16:36:17.280[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=2 dropped_fifo=0 fifo_depth=0
16:36:27.450[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:36:27.453[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=707.448368
16:36:27.454[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.107, 1.647, -0.025] odom_goal_yaw_deg=180.0 world_goal=[-2.698, -1.673, -5.625] world_goal_yaw_deg=-6.2
16:36:27.507[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.107, 1.647, -0.025], euler=[90.0, 0.0, -96.7])
16:36:27.512[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:36:27.513[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.001
16:36:27.514[inf][nning_a_star/global_planner.py] Found safe goal. x=4.08 y=1.63
16:36:27.520[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:36:27.520[inf][anning_a_star/local_planner.py] changed state state=path_following
16:36:27.521[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:36:27.521[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:36:27.521[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
16:36:27.521[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:36:27.521[inf][anning_a_star/local_planner.py] changed state state=arrived
16:36:27.631[inf][anning_a_star/local_planner.py] changed state state=idle
16:36:27.631[inf][nning_a_star/global_planner.py] Arrived at goal.
16:36:27.631[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:36:27.753[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:36:27.753[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
16:36:27.961[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.949, 1.222, 0.104], euler=[90.0, 0.0, -100.9])
16:36:27.962[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:36:27.962[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.949, 1.222, 0.104] odom_goal_yaw_deg=180.0 world_goal=[-2.195, -1.545, -5.443] world_goal_yaw_deg=-10.4
16:36:27.962[inf][nning_a_star/global_planner.py] Found safe goal. x=3.93 y=1.18
16:36:27.969[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:36:27.970[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:36:28.013[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=7
16:36:28.172[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.016, 0.826, 0.136] odom_goal_yaw_deg=-0.0 world_goal=[-1.728, -1.513, -5.526] world_goal_yaw_deg=11.31
16:36:28.172[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.016, 0.826, 0.136], euler=[90.0, 0.0, -79.2])
16:36:28.173[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:36:28.173[inf][anning_a_star/local_planner.py] changed state state=idle
16:36:28.174[inf][nning_a_star/global_planner.py] Found safe goal. x=3.98 y=0.83
16:36:28.173[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:36:28.184[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:36:28.186[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:36:28.482[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:36:28.483[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.053, 0.684, 0.136] odom_goal_yaw_deg=0.0 world_goal=[-1.561, -1.513, -5.57] world_goal_yaw_deg=16.72
16:36:28.560[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.053, 0.684, 0.136], euler=[90.0, 0.0, -73.8])
16:36:28.560[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:36:28.560[inf][anning_a_star/local_planner.py] changed state state=idle
16:36:28.561[inf][nning_a_star/global_planner.py] Found safe goal. x=4.03 y=0.68
16:36:28.561[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:36:28.570[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:36:28.572[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:36:28.994[inf][anning_a_star/local_planner.py] changed state state=path_following
16:36:31.403[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:36:31.403[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:36:32.259[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:36:32.259[inf][anning_a_star/local_planner.py] changed state state=arrived
16:36:32.362[inf][anning_a_star/local_planner.py] changed state state=idle
16:36:32.363[inf][nning_a_star/global_planner.py] Arrived at goal.
16:36:32.363[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:36:32.439[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:36:32.439[inf][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.174
16:36:34.629[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:36:34.630[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:36:34.708[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=163627 seq=2
16:36:34.740[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874194.459363 frame_age_s=0.1431 latest_residual_m=0.1104 observations_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0253 residual_along_track_m=0.0497 residual_cross_track_m=0.0733 residual_vertical_m=0.0659 robot_speed_ms=0.001 seq=2 source_ts_gap_s=0.047485 total_rejections=0 window_centroid_residual_m=1.6835
16:36:35.802[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:36:35.802[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=715.797987
16:36:35.803[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.084, 0.690, -0.023], euler=[90.0, 0.0, -94.6])
16:36:35.803[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.084, 0.69, -0.023] odom_goal_yaw_deg=180.0 world_goal=[-1.568, -1.672, -5.607] world_goal_yaw_deg=-4.14
16:36:35.803[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:36:35.804[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.0
16:36:35.804[inf][nning_a_star/global_planner.py] Found safe goal. x=4.08 y=0.68
16:36:35.808[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:36:35.809[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
16:36:35.809[inf][anning_a_star/local_planner.py] changed state state=path_following
16:36:35.809[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:36:35.810[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:36:35.810[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:36:35.811[inf][anning_a_star/local_planner.py] changed state state=arrived
16:36:35.916[inf][anning_a_star/local_planner.py] changed state state=idle
16:36:35.917[inf][nning_a_star/global_planner.py] Arrived at goal.
16:36:35.917[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:36:35.962[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:36:35.962[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
16:36:36.073[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.377, 0.213, 0.103] odom_goal_yaw_deg=0.0 world_goal=[-1.008, -1.545, -5.958] world_goal_yaw_deg=42.92
16:36:36.132[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.456, 0.186, 0.108] odom_goal_yaw_deg=-0.0 world_goal=[-0.977, -1.54, -6.052] world_goal_yaw_deg=52.55
16:36:36.174[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.377, 0.213, 0.103], euler=[90.0, 0.0, -47.6])
16:36:36.174[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:36:36.175[inf][nning_a_star/global_planner.py] Found safe goal. x=4.38 y=0.18
16:36:36.185[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:36:36.187[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:36:36.188[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.456, 0.186, 0.108], euler=[90.0, 0.0, -37.9])
16:36:36.188[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:36:36.188[inf][anning_a_star/local_planner.py] changed state state=idle
16:36:36.189[inf][nning_a_star/global_planner.py] Found safe goal. x=4.43 y=0.18
16:36:36.189[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:36:36.194[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:36:36.196[inf][anning_a_star/local_planner.py] changed state state=path_following
16:36:36.257[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=8
16:36:36.527[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.688, 0.239, 0.118] odom_goal_yaw_deg=-0.0 world_goal=[-1.041, -1.531, -6.325] world_goal_yaw_deg=111.83
16:36:36.580[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.688, 0.239, 0.118], euler=[90.0, 0.0, 21.3])
16:36:36.580[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:36:36.581[inf][anning_a_star/local_planner.py] changed state state=idle
16:36:36.581[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:36:36.582[inf][nning_a_star/global_planner.py] Found safe goal. x=4.68 y=0.23
16:36:36.589[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:36:36.590[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:36:36.751[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=152295 seq=8
16:36:36.786[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874196.525998 frame_age_s=0.1064 latest_residual_m=0.1075 observations_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0489 residual_along_track_m=0.041 residual_cross_track_m=0.0718 residual_vertical_m=0.0687 robot_speed_ms=0.068 seq=8 source_ts_gap_s=0.022779 total_rejections=0 window_centroid_residual_m=1.7312
16:36:36.787[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.191, 0.283, 0.125] odom_goal_yaw_deg=-0.0 world_goal=[-1.099, -1.523, -6.918] world_goal_yaw_deg=98.94
16:36:36.794[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.191, 0.283, 0.125], euler=[90.0, 0.0, 8.5])
16:36:36.794[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:36:36.794[inf][anning_a_star/local_planner.py] changed state state=idle
16:36:36.794[inf][nning_a_star/global_planner.py] Found safe goal. x=5.18 y=0.28
16:36:36.795[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:36:36.805[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:36:36.812[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:36:37.177[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:36:37.180[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.259, 0.291, 0.125] odom_goal_yaw_deg=-0.0 world_goal=[-1.109, -1.523, -6.999] world_goal_yaw_deg=97.26
16:36:37.227[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.259, 0.291, 0.125], euler=[90.0, 0.0, 6.8])
16:36:37.228[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:36:37.229[inf][anning_a_star/local_planner.py] changed state state=idle
16:36:37.229[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:36:37.230[inf][nning_a_star/global_planner.py] Found safe goal. x=5.23 y=0.28
16:36:37.241[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:36:37.245[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:36:38.432[inf][anning_a_star/local_planner.py] changed state state=path_following
16:36:39.810[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:36:39.810[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:36:39.866[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=163972 seq=14
16:36:39.891[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874198.692609 frame_age_s=1.0806 latest_residual_m=0.1403 observations_added=1 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0856 residual_along_track_m=-0.0046 residual_cross_track_m=0.0824 residual_vertical_m=0.1134 robot_speed_ms=0.176 seq=14 source_ts_gap_s=0.006479 total_rejections=0 window_centroid_residual_m=1.6758
16:36:41.537[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:36:41.538[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=721.533152
16:36:41.538[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.173, 0.114, 0.115], euler=[90.0, 0.0, -121.9])
16:36:41.538[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.173, 0.114, 0.115] odom_goal_yaw_deg=180.0 world_goal=[-0.899, -1.534, -6.898] world_goal_yaw_deg=-31.43
16:36:41.538[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:36:41.538[inf][anning_a_star/local_planner.py] changed state state=idle
16:36:41.539[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.0
16:36:41.539[inf][nning_a_star/global_planner.py] Found safe goal. x=5.13 y=0.08
16:36:41.539[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:36:41.548[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:36:41.551[inf][anning_a_star/local_planner.py] changed state state=path_following
16:36:42.068[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.989, -0.132, 0.107] odom_goal_yaw_deg=-180.0 world_goal=[-0.607, -1.542, -6.684] world_goal_yaw_deg=-40.36
16:36:42.202[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.989, -0.132, 0.107], euler=[90.0, 0.0, -130.8])
16:36:42.203[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:36:42.203[inf][anning_a_star/local_planner.py] changed state state=idle
16:36:42.204[inf][nning_a_star/global_planner.py] Found safe goal. x=4.98 y=-0.17
16:36:42.204[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:36:42.212[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:36:42.217[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:36:42.326[inf][anning_a_star/local_planner.py] changed state state=path_following
16:36:42.513[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.64, -0.612, 0.082] odom_goal_yaw_deg=-180.0 world_goal=[-0.036, -1.566, -6.276] world_goal_yaw_deg=-50.49
16:36:42.721[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.640, -0.612, 0.082], euler=[90.0, 0.0, -141.0])
16:36:42.722[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:36:42.722[inf][anning_a_star/local_planner.py] changed state state=idle
16:36:42.722[inf][nning_a_star/global_planner.py] Found safe goal. x=4.63 y=-0.62
16:36:42.725[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:36:42.732[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:36:42.758[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:36:42.807[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:36:42.809[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.574, -0.769, 0.073] odom_goal_yaw_deg=180.0 world_goal=[0.149, -1.575, -6.2] world_goal_yaw_deg=-16.49
16:36:42.810[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.574, -0.769, 0.073], euler=[90.0, 0.0, -107.0])
16:36:42.811[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:36:42.811[inf][anning_a_star/local_planner.py] changed state state=idle
16:36:42.811[inf][nning_a_star/global_planner.py] Found safe goal. x=4.53 y=-0.77
16:36:42.812[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:36:42.818[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:36:42.819[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:36:43.220[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.622, -1.077, 0.054] odom_goal_yaw_deg=180.0 world_goal=[0.513, -1.595, -6.26] world_goal_yaw_deg=-1.59
16:36:43.224[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.622, -1.077, 0.054], euler=[90.0, 0.0, -92.1])
16:36:43.225[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:36:43.226[inf][anning_a_star/local_planner.py] changed state state=idle
16:36:43.227[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:36:43.228[inf][nning_a_star/global_planner.py] Found safe goal. x=4.58 y=-1.12
16:36:43.237[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:36:43.239[inf][anning_a_star/local_planner.py] changed state state=path_following
16:36:43.522[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.638, -1.088, 0.053] odom_goal_yaw_deg=-180.0 world_goal=[0.525, -1.595, -6.279] world_goal_yaw_deg=-0.36
16:36:43.522[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.638, -1.088, 0.053], euler=[90.0, 0.0, -90.8])
16:36:43.522[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:36:43.523[inf][anning_a_star/local_planner.py] changed state state=idle
16:36:43.523[inf][nning_a_star/global_planner.py] Found safe goal. x=4.63 y=-1.12
16:36:43.526[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:36:43.540[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:36:43.558[inf][anning_a_star/local_planner.py] changed state state=path_following
16:36:45.589[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:36:45.589[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:36:46.551[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:36:46.551[inf][anning_a_star/local_planner.py] changed state state=arrived
16:36:46.657[inf][anning_a_star/local_planner.py] changed state state=idle
16:36:46.658[inf][nning_a_star/global_planner.py] Arrived at goal.
16:36:46.658[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
16:36:46.876[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.218
▸ 16:36:46.877[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:36:46.878[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.262
16:36:47.851[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:36:47.853[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=727.847961
16:36:47.853[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.655, -1.217, -0.029] odom_goal_yaw_deg=-0.0 world_goal=[0.678, -1.678, -6.3] world_goal_yaw_deg=4.49
16:36:48.095[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.655, -1.217, -0.029], euler=[90.0, 0.0, -86.0])
16:36:48.095[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:36:48.096[inf][nning_a_star/global_planner.py] Found safe goal. x=4.63 y=-1.22
16:36:48.101[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:36:48.102[inf][anning_a_star/local_planner.py] changed state state=path_following
16:36:48.102[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:36:48.102[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:36:48.102[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:36:48.102[inf][anning_a_star/local_planner.py] changed state state=arrived
16:36:48.210[inf][anning_a_star/local_planner.py] changed state state=idle
16:36:48.210[inf][nning_a_star/global_planner.py] Arrived at goal.
16:36:48.211[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
16:36:48.291[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
16:36:48.325[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.083, -1.107, 0.034] odom_goal_yaw_deg=-0.0 world_goal=[0.543, -1.614, -6.804] world_goal_yaw_deg=103.76
▸ 16:36:48.365[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:36:48.366[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.5
16:36:48.411[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.083, -1.107, 0.034], euler=[90.0, 0.0, 13.3])
16:36:48.411[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:36:48.413[inf][nning_a_star/global_planner.py] Found safe goal. x=5.08 y=-1.12
16:36:48.422[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:36:48.423[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:36:48.644[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.284, -1.006, 0.054] odom_goal_yaw_deg=-0.0 world_goal=[0.422, -1.594, -7.041] world_goal_yaw_deg=115.92
16:36:48.763[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.538, -0.741, 0.073] odom_goal_yaw_deg=-0.0 world_goal=[0.107, -1.575, -7.338] world_goal_yaw_deg=132.39
16:36:48.796[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.284, -1.006, 0.054], euler=[90.0, 0.0, 25.4])
16:36:48.797[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:36:48.797[inf][anning_a_star/local_planner.py] changed state state=idle
16:36:48.798[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:36:48.798[inf][nning_a_star/global_planner.py] Found safe goal. x=5.28 y=-1.02
16:36:48.805[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:36:48.808[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:36:48.874[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.538, -0.741, 0.073], euler=[90.0, 0.0, 41.9])
16:36:48.875[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:36:48.875[inf][anning_a_star/local_planner.py] changed state state=idle
16:36:48.875[inf][nning_a_star/global_planner.py] Found safe goal. x=5.53 y=-0.77
16:36:48.877[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:36:48.884[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=9
16:36:48.885[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:36:48.887[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:36:49.076[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:36:49.078[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.622, -0.658, 0.077] odom_goal_yaw_deg=-0.0 world_goal=[0.008, -1.572, -7.435] world_goal_yaw_deg=132.59
16:36:49.085[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.622, -0.658, 0.077], euler=[90.0, 0.0, 42.1])
16:36:49.085[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:36:49.086[inf][anning_a_star/local_planner.py] changed state state=idle
16:36:49.086[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:36:49.087[inf][nning_a_star/global_planner.py] Found safe goal. x=5.58 y=-0.67
16:36:49.094[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:36:49.096[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:36:50.052[inf][anning_a_star/local_planner.py] changed state state=path_following
16:36:50.167[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:36:50.168[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:36:50.183[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=159891 seq=23
16:36:50.183[war][tion/session/session_frames.py] AR camera frame dropped: too old frame_age_s=8.522 max_age_s=4.0 seq=23
16:36:50.425[war][s/ar/world_frame/transforms.py] gravity_level_transform: input up-axis far from world-up (angle=15.2 deg) — registration input likely malformed; this warning is rate-limited to once per 30 s
16:36:50.427[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874210.159028 frame_age_s=0.1479 latest_residual_m=2.1701 observations_added=0 regime=moving rej_distance=1 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=1.7025 residual_along_track_m=-1.0977 residual_cross_track_m=1.8691 residual_vertical_m=0.1053 robot_speed_ms=0.139 seq=24 source_ts_gap_s=0.08115 total_rejections=1 window_centroid_residual_m=3.8708
16:36:52.337[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=186561 seq=29
16:36:52.637[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874212.325584 frame_age_s=0.1114 latest_residual_m=0.5297 observations_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.1074 residual_along_track_m=-0.5199 residual_cross_track_m=0.0754 residual_vertical_m=0.0682 robot_speed_ms=0.286 seq=30 source_ts_gap_s=0.115789 total_rejections=0 window_centroid_residual_m=3.5026
16:36:52.815[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:36:52.815[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:36:52.816[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:36:52.816[inf][anning_a_star/local_planner.py] changed state state=arrived
16:36:52.924[inf][anning_a_star/local_planner.py] changed state state=idle
16:36:52.924[inf][nning_a_star/global_planner.py] Arrived at goal.
16:36:52.925[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
16:36:52.957[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.033
▸ 16:36:52.958[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:36:52.958[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.266
16:36:54.291[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:36:54.292[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:36:54.358[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=194097 seq=31
16:36:54.833[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874214.525588 frame_age_s=0.1 latest_residual_m=0.9138 observations_added=0 regime=static rej_distance=1 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.3928 residual_along_track_m=-0.8681 residual_cross_track_m=0.278 residual_vertical_m=0.0651 robot_speed_ms=0.002 seq=33 source_ts_gap_s=0.032105 total_rejections=1 window_centroid_residual_m=3.4333
16:36:57.452[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=192697 seq=39
16:36:57.484[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874217.158806 frame_age_s=0.0897 latest_residual_m=0.914 observations_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.3976 residual_along_track_m=-0.8679 residual_cross_track_m=0.2793 residual_vertical_m=0.0651 robot_speed_ms=0.0 seq=39 source_ts_gap_s=0.004555 total_rejections=0 window_centroid_residual_m=3.4334
16:37:00.861[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:37:00.862[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=740.857834
16:37:00.864[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.512, -0.616, -0.023] odom_goal_yaw_deg=0.0 world_goal=[-0.041, -1.671, -7.306] world_goal_yaw_deg=117.18
16:37:01.013[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.512, -0.616, -0.023], euler=[90.0, 0.0, 26.7])
16:37:01.014[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:01.015[inf][nning_a_star/global_planner.py] Found safe goal. x=5.48 y=-0.62
16:37:01.020[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:01.020[inf][anning_a_star/local_planner.py] changed state state=path_following
16:37:01.021[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:37:01.021[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:37:01.022[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:37:01.022[inf][anning_a_star/local_planner.py] changed state state=arrived
16:37:01.112[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.092
16:37:01.113[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
16:37:01.130[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:01.131[inf][nning_a_star/global_planner.py] Arrived at goal.
16:37:01.131[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:37:01.203[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:37:01.203[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
16:37:01.240[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.735, -0.366, 0.032] odom_goal_yaw_deg=-0.0 world_goal=[-0.337, -1.617, -7.566] world_goal_yaw_deg=136.86
16:37:01.295[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.735, -0.366, 0.032], euler=[90.0, 0.0, 46.4])
16:37:01.296[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:01.297[inf][nning_a_star/global_planner.py] Found safe goal. x=5.73 y=-0.37
16:37:01.303[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:01.305[inf][anning_a_star/local_planner.py] changed state state=path_following
16:37:01.306[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=5
16:37:01.348[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.81, -0.31, 0.048] odom_goal_yaw_deg=-0.0 world_goal=[-0.405, -1.6, -7.655] world_goal_yaw_deg=132.37
16:37:01.435[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.810, -0.310, 0.048], euler=[90.0, 0.0, 41.9])
16:37:01.436[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:01.436[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:01.436[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:01.437[inf][nning_a_star/global_planner.py] Found safe goal. x=5.78 y=-0.32
16:37:01.445[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:01.447[inf][anning_a_star/local_planner.py] changed state state=path_following
16:37:01.751[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[6.096, -0.166, 0.061] odom_goal_yaw_deg=-0.0 world_goal=[-0.578, -1.588, -7.991] world_goal_yaw_deg=116.99
16:37:01.866[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[6.096, -0.166, 0.061], euler=[90.0, 0.0, 26.5])
16:37:01.866[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:01.866[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:01.867[inf][nning_a_star/global_planner.py] Found safe goal. x=6.08 y=-0.17
16:37:01.866[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:01.875[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:01.878[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:37:01.956[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:37:01.957[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[6.181, -0.114, 0.059] odom_goal_yaw_deg=-0.0 world_goal=[-0.639, -1.59, -8.09] world_goal_yaw_deg=119.3
16:37:02.033[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[6.181, -0.114, 0.059], euler=[90.0, 0.0, 28.8])
16:37:02.034[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:02.034[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:02.035[inf][nning_a_star/global_planner.py] Found safe goal. x=6.18 y=-0.12
16:37:02.035[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:02.043[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:02.046[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:37:03.211[inf][anning_a_star/local_planner.py] changed state state=path_following
16:37:04.662[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:37:04.663[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=744.658701
16:37:04.664[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[6.246, -0.27, 0.032] odom_goal_yaw_deg=-0.0 world_goal=[-0.456, -1.617, -8.169] world_goal_yaw_deg=43.1
16:37:04.682[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[6.246, -0.270, 0.032], euler=[90.0, 0.0, -47.4])
16:37:04.683[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:04.683[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:04.683[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:04.684[inf][nning_a_star/global_planner.py] Found safe goal. x=6.23 y=-0.27
16:37:04.691[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:04.693[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:37:04.986[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[6.658, -0.344, 0.04] odom_goal_yaw_deg=-0.0 world_goal=[-0.373, -1.609, -8.656] world_goal_yaw_deg=78.93
16:37:05.101[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[6.658, -0.344, 0.040], euler=[90.0, 0.0, -11.5])
16:37:05.101[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:05.102[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:05.102[inf][nning_a_star/global_planner.py] Found safe goal. x=6.63 y=-0.37
16:37:05.102[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:05.116[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:05.121[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:37:05.418[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[6.741, -0.501, 0.04] odom_goal_yaw_deg=-0.0 world_goal=[-0.189, -1.609, -8.755] world_goal_yaw_deg=20.57
16:37:05.535[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[6.741, -0.501, 0.040], euler=[90.0, 0.0, -69.9])
16:37:05.535[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:05.535[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:05.536[inf][nning_a_star/global_planner.py] Found safe goal. x=6.73 y=-0.52
16:37:05.536[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:05.544[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:05.547[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:37:05.851[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:37:05.853[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[6.642, -0.781, 0.039] odom_goal_yaw_deg=-180.0 world_goal=[0.143, -1.609, -8.641] world_goal_yaw_deg=-21.59
16:37:05.925[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[6.642, -0.781, 0.039], euler=[90.0, 0.0, -112.1])
16:37:05.926[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:05.926[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:05.927[inf][nning_a_star/global_planner.py] Found safe goal. x=6.63 y=-0.82
16:37:05.927[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:05.934[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:05.936[inf][anning_a_star/local_planner.py] changed state state=path_following
16:37:06.140[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[6.574, -0.89, 0.036] odom_goal_yaw_deg=180.0 world_goal=[0.272, -1.612, -8.563] world_goal_yaw_deg=-28.11
16:37:06.336[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[6.574, -0.890, 0.036], euler=[90.0, 0.0, -118.6])
16:37:06.336[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:06.336[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:06.337[inf][nning_a_star/global_planner.py] Found safe goal. x=6.53 y=-0.92
16:37:06.337[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:06.346[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:06.352[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:37:06.413[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.076
16:37:07.543[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:37:07.544[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:37:07.647[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=184476 seq=43
16:37:07.648[war][tion/session/session_frames.py] AR camera frame dropped: too old frame_age_s=8.881 max_age_s=4.0 seq=43
16:37:07.726[inf][anning_a_star/local_planner.py] changed state state=path_following
16:37:07.892[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874227.62527 frame_age_s=0.1235 latest_residual_m=1.8401 observations_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=1.3321 residual_along_track_m=-0.2843 residual_cross_track_m=1.8171 residual_vertical_m=0.057 robot_speed_ms=0.144 seq=44 source_ts_gap_s=0.014519 total_rejections=0 window_centroid_residual_m=3.7809
16:37:09.735[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:37:09.736[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:37:09.759[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=171768 seq=51
16:37:10.184[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874229.825226 frame_age_s=0.1205 latest_residual_m=1.8745 observations_added=0 regime=moving rej_distance=1 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=1.2784 residual_along_track_m=0.2821 residual_cross_track_m=1.8518 residual_vertical_m=0.0711 robot_speed_ms=0.374 seq=52 source_ts_gap_s=0.045433 total_rejections=1 window_centroid_residual_m=4.3824
16:37:10.189[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
16:37:10.254[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:37:10.255[inf][anning_a_star/local_planner.py] changed state state=arrived
16:37:10.355[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:10.355[inf][nning_a_star/global_planner.py] Arrived at goal.
16:37:10.356[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:37:10.372[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:37:10.372[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.28
16:37:10.695[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:37:10.696[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:37:11.945[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=149824 seq=59
16:37:11.962[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:37:11.964[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=751.959381
16:37:11.965[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[6.542, -0.95, -0.013] odom_goal_yaw_deg=-180.0 world_goal=[0.344, -1.662, -8.525] world_goal_yaw_deg=-13.7
16:37:12.048[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[6.542, -0.950, -0.013], euler=[90.0, 0.0, -104.2])
16:37:12.048[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:12.048[inf][nning_a_star/global_planner.py] Found safe goal. x=6.53 y=-0.97
16:37:12.056[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:12.057[inf][anning_a_star/local_planner.py] changed state state=path_following
16:37:12.057[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:37:12.058[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:37:12.058[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:37:12.058[inf][anning_a_star/local_planner.py] changed state state=arrived
16:37:12.102[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.054
16:37:12.104[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
16:37:12.149[inf][imos/ar/world_frame/aligner.py] alignment_update alpha_scale=1.0 alpha_yaw=1.0 baseline_m=6.442 confidence=0.874 max_pair_skew_s=0.0776 mean_ambiguity_ratio=1.8187 method=similarity n_obs=5 n_rejected=1 resid_rms_m=0.0021 s=1.1778 scale_held=False scale_observable=True yaw_deg=92.05 yaw_held=False yaw_observable=True
16:37:12.151[inf][imos/ar/world_frame/aligner.py] refinement_episode_complete baseline_m=6.442 marker_jump_m=0.116 observation_count=5 solve_quality=0.957 trans_delta_m=0.171 yaw_delta_deg=1.57
16:37:12.167[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:12.168[inf][nning_a_star/global_planner.py] Arrived at goal.
16:37:12.168[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:37:12.169[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:37:12.169[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.328
16:37:12.300[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[6.345, -1.223, 0.048] odom_goal_yaw_deg=-180.0 world_goal=[0.613, -1.612, -8.387] world_goal_yaw_deg=-13.13
16:37:12.326[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[6.345, -1.223, 0.048], euler=[90.0, 0.0, -105.2])
16:37:12.326[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:12.326[inf][nning_a_star/global_planner.py] Found safe goal. x=6.33 y=-1.22
16:37:12.336[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:12.337[inf][anning_a_star/local_planner.py] changed state state=path_following
16:37:12.339[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=5
16:37:12.615[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[6.581, -1.583, 0.022] odom_goal_yaw_deg=-0.0 world_goal=[1.027, -1.639, -8.679] world_goal_yaw_deg=35.28
16:37:12.840[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[6.581, -1.583, 0.022], euler=[90.0, 0.0, -56.8])
16:37:12.841[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:12.841[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:12.842[inf][nning_a_star/global_planner.py] Found safe goal. x=6.58 y=-1.62
16:37:12.842[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:12.850[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:12.851[inf][anning_a_star/local_planner.py] changed state state=path_following
16:37:13.221[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:37:13.223[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[6.933, -1.944, 0.024] odom_goal_yaw_deg=-0.0 world_goal=[1.437, -1.637, -9.109] world_goal_yaw_deg=44.83
16:37:13.224[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[6.853, -1.858, 0.025] odom_goal_yaw_deg=-0.0 world_goal=[1.339, -1.636, -9.011] world_goal_yaw_deg=43.47
16:37:13.414[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[6.853, -1.858, 0.025], euler=[90.0, 0.0, -48.6])
16:37:13.415[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:13.416[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:13.416[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:13.417[inf][nning_a_star/global_planner.py] Found safe goal. x=6.83 y=-1.87
16:37:13.425[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:13.427[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[6.933, -1.944, 0.024], euler=[90.0, -0.0, -47.2])
16:37:13.427[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:37:13.427[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:13.428[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:13.428[inf][nning_a_star/global_planner.py] Found safe goal. x=6.93 y=-1.97
16:37:13.428[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:13.437[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:13.439[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:37:13.982[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:37:13.982[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:37:14.057[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=153796 seq=2
16:37:14.081[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874233.725156 frame_age_s=0.0882 latest_residual_m=0.3536 observations_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.0667 residual_along_track_m=-0.3517 residual_cross_track_m=0.0354 residual_vertical_m=0.009 robot_speed_ms=0.511 seq=2 source_ts_gap_s=0.043596 total_rejections=0 window_centroid_residual_m=4.281
16:37:14.174[inf][anning_a_star/local_planner.py] changed state state=path_following
16:37:15.019[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:37:15.020[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:37:16.173[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:37:16.174[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:37:16.174[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:37:16.174[inf][anning_a_star/local_planner.py] changed state state=arrived
16:37:16.278[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=173116 seq=8
16:37:16.282[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:16.282[inf][nning_a_star/global_planner.py] Arrived at goal.
16:37:16.282[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
16:37:16.307[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874235.758412 frame_age_s=0.0848 latest_residual_m=0.9161 observations_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.3038 residual_along_track_m=-0.7775 residual_cross_track_m=0.4845 residual_vertical_m=0.003 robot_speed_ms=0.677 seq=8 source_ts_gap_s=0.013727 total_rejections=0 window_centroid_residual_m=4.9043
▸ 16:37:16.318[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:37:16.318[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.283
16:37:17.244[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:37:17.245[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:37:17.702[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:37:17.704[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=757.698909
16:37:17.705[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[6.936, -1.901, -0.026] odom_goal_yaw_deg=-0.0 world_goal=[1.386, -1.687, -9.111] world_goal_yaw_deg=50.61
16:37:17.805[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
16:37:17.865[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[6.936, -1.901, -0.026], euler=[90.0, 0.0, -41.4])
16:37:17.866[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:17.867[inf][nning_a_star/global_planner.py] Found safe goal. x=6.93 y=-1.93
16:37:17.874[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:17.874[inf][anning_a_star/local_planner.py] changed state state=path_following
16:37:17.874[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:37:17.875[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:37:17.875[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:37:17.875[inf][anning_a_star/local_planner.py] changed state state=arrived
16:37:17.936[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.07
16:37:17.938[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
16:37:17.977[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:17.978[inf][nning_a_star/global_planner.py] Arrived at goal.
16:37:17.978[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:37:18.004[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:37:18.004[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.333
16:37:18.135[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.447, -1.918, 0.048] odom_goal_yaw_deg=-0.0 world_goal=[1.385, -1.612, -9.713] world_goal_yaw_deg=81.39
16:37:18.135[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.447, -1.918, 0.048], euler=[90.0, 0.0, -10.7])
16:37:18.135[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:18.136[inf][nning_a_star/global_planner.py] Found safe goal. x=7.43 y=-1.93
16:37:18.144[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:18.145[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:37:18.148[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=8
16:37:18.335[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=164187 seq=14
16:37:18.367[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874237.958373 frame_age_s=0.157 latest_residual_m=1.1827 observations_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.538 residual_along_track_m=-1.0577 residual_cross_track_m=0.5291 residual_vertical_m=0.0089 robot_speed_ms=0.003 seq=14 source_ts_gap_s=0.033386 total_rejections=0 window_centroid_residual_m=5.2172
16:37:18.773[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:37:18.774[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.613, -1.967, 0.051], euler=[90.0, 0.0, -12.3])
16:37:18.774[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:18.774[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.613, -1.967, 0.051] odom_goal_yaw_deg=0.0 world_goal=[1.435, -1.61, -9.91] world_goal_yaw_deg=79.75
16:37:18.774[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:18.775[inf][nning_a_star/global_planner.py] Found safe goal. x=7.58 y=-1.98
16:37:18.775[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:18.784[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:18.786[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:37:19.143[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.926, -2.064, 0.056] odom_goal_yaw_deg=-0.0 world_goal=[1.536, -1.604, -10.283] world_goal_yaw_deg=75.56
16:37:19.283[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.926, -2.064, 0.056], euler=[90.0, 0.0, -16.5])
16:37:19.284[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:19.285[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:19.285[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:19.285[inf][nning_a_star/global_planner.py] Found safe goal. x=7.93 y=-2.08
16:37:19.297[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:19.299[inf][anning_a_star/local_planner.py] changed state state=path_following
16:37:20.568[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=169863 seq=21
16:37:20.597[war][s/ar/world_frame/transforms.py] gravity_level_transform: input up-axis far from world-up (angle=15.2 deg) — registration input likely malformed; this warning is rate-limited to once per 30 s
16:37:20.604[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874240.291652 frame_age_s=0.0875 latest_residual_m=0.0221 observations_added=0 regime=static rej_distance=0 rej_innovation=1 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.0205 residual_along_track_m=0.0033 residual_cross_track_m=0.0105 residual_vertical_m=-0.0191 robot_speed_ms=0.035 seq=21 source_ts_gap_s=0.076908 total_rejections=1 window_centroid_residual_m=5.0218
16:37:22.921[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=161660 seq=29
16:37:22.943[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874242.558288 frame_age_s=0.0929 latest_residual_m=0.0376 observations_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.0068 residual_along_track_m=-0.0093 residual_cross_track_m=0.0358 residual_vertical_m=-0.007 robot_speed_ms=0.031 seq=29 source_ts_gap_s=0.057645 total_rejections=0 window_centroid_residual_m=4.6518
16:37:23.164[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
16:37:24.633[inf][anning_a_star/local_planner.py] Obstacle detected ahead, stopping local planner.
16:37:24.633[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:24.633[inf][nning_a_star/global_planner.py] Replanning path due to obstacle found.
16:37:24.634[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.0
16:37:24.634[inf][nning_a_star/global_planner.py] Replanning. attempt=0
16:37:24.635[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:24.639[inf][nning_a_star/global_planner.py] Found safe goal. x=8.08 y=-2.18
16:37:24.651[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:24.653[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:37:25.089[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=185116 seq=37
16:37:25.119[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874244.89151 frame_age_s=0.1154 latest_residual_m=0.0452 observations_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.0029 residual_along_track_m=-0.0099 residual_cross_track_m=0.0437 residual_vertical_m=-0.0056 robot_speed_ms=0.102 seq=37 source_ts_gap_s=0.007849 total_rejections=0 window_centroid_residual_m=4.2542
16:37:25.377[inf][anning_a_star/local_planner.py] changed state state=path_following
16:37:26.349[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:37:26.350[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=766.345112
16:37:26.350[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.619, -1.972, 0.289] odom_goal_yaw_deg=-0.0 world_goal=[1.441, -1.371, -9.918] world_goal_yaw_deg=108.22
16:37:26.501[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.619, -1.972, 0.289], euler=[90.0, 0.0, 16.2])
16:37:26.501[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:26.501[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:26.502[war][nning_a_star/global_planner.py] Travelling to goal 0.2926601990045508m away from requested goal.
16:37:26.502[inf][nning_a_star/global_planner.py] Found safe goal. x=7.58 y=-1.98
16:37:26.502[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:26.512[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:26.513[inf][anning_a_star/local_planner.py] changed state state=path_following
16:37:26.745[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.502, -1.640, 0.029], euler=[90.0, 0.0, 46.5])
16:37:26.745[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:26.746[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:26.746[inf][nning_a_star/global_planner.py] Found safe goal. x=7.48 y=-1.67
16:37:26.746[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.502, -1.64, 0.029] odom_goal_yaw_deg=-0.0 world_goal=[1.055, -1.632, -9.766] world_goal_yaw_deg=138.6
16:37:26.746[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:26.753[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:26.755[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:37:27.290[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=176347 seq=46
16:37:27.315[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874247.058146 frame_age_s=0.1206 latest_residual_m=0.4188 observations_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.1327 residual_along_track_m=-0.3985 residual_cross_track_m=0.1284 residual_vertical_m=-0.0109 robot_speed_ms=0.116 seq=46 source_ts_gap_s=0.016949 total_rejections=0 window_centroid_residual_m=4.6367
16:37:27.996[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:37:27.997[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.619, -1.799, 0.03] odom_goal_yaw_deg=-0.0 world_goal=[1.237, -1.631, -9.911] world_goal_yaw_deg=52.34
16:37:28.006[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.619, -1.799, 0.030], euler=[90.0, 0.0, -39.7])
16:37:28.006[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:28.007[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:28.007[inf][nning_a_star/global_planner.py] Found safe goal. x=7.58 y=-1.82
16:37:28.008[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:28.015[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:28.017[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:37:28.232[inf][anning_a_star/local_planner.py] changed state state=path_following
16:37:28.247[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[6.878, -2.239, 0.031] odom_goal_yaw_deg=-180.0 world_goal=[1.787, -1.629, -9.056] world_goal_yaw_deg=-59.91
16:37:28.448[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[6.878, -2.239, 0.031], euler=[90.0, 0.0, -152.0])
16:37:28.449[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:28.449[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:28.449[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:28.450[inf][nning_a_star/global_planner.py] Found safe goal. x=6.88 y=-2.27
16:37:28.458[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:28.460[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:37:28.743[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=768.738294
16:37:28.744[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[6.575, -2.563, 0.028] odom_goal_yaw_deg=-180.0 world_goal=[2.181, -1.633, -8.714] world_goal_yaw_deg=-32.66
16:37:28.804[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[6.575, -2.563, 0.028], euler=[90.0, 0.0, -124.7])
16:37:28.805[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:28.806[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:28.806[inf][nning_a_star/global_planner.py] Found safe goal. x=6.58 y=-2.57
16:37:28.806[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:28.819[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:28.820[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:37:28.948[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.66, -1.949, 0.017] odom_goal_yaw_deg=-0.0 world_goal=[1.412, -1.644, -9.965] world_goal_yaw_deg=119.96
16:37:29.137[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.660, -1.949, 0.017], euler=[90.0, 0.0, 27.9])
16:37:29.137[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:29.137[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:29.138[inf][nning_a_star/global_planner.py] Found safe goal. x=7.63 y=-1.97
16:37:29.138[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:29.149[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:29.153[inf][anning_a_star/local_planner.py] changed state state=path_following
16:37:31.468[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:37:31.469[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:37:31.580[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=185240 seq=47
16:37:31.581[war][tion/session/session_frames.py] AR camera frame dropped: too old frame_age_s=4.098 max_age_s=4.0 seq=47
16:37:31.809[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874251.591412 frame_age_s=0.1149 latest_residual_m=0.1975 observations_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=1 residual_along_camera_ray_m=0.0048 residual_along_track_m=0.0892 residual_cross_track_m=0.1751 residual_vertical_m=-0.0193 robot_speed_ms=0.189 seq=48 source_ts_gap_s=0.071217 total_rejections=1 window_centroid_residual_m=4.2859
16:37:32.003[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:37:32.004[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=771.999073
16:37:32.005[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.636, -1.835, 0.006] odom_goal_yaw_deg=-180.0 world_goal=[1.279, -1.654, -9.932] world_goal_yaw_deg=-167.16
16:37:32.021[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.636, -1.835, 0.006], euler=[90.0, 0.0, 100.8])
16:37:32.021[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:32.021[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:32.022[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.0
16:37:32.022[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:32.023[inf][nning_a_star/global_planner.py] Found safe goal. x=7.63 y=-1.92
16:37:32.032[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:32.034[inf][anning_a_star/local_planner.py] changed state state=path_following
16:37:33.585[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=173739 seq=54
16:37:33.964[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874253.624671 frame_age_s=0.0697 latest_residual_m=0.3519 observations_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.1412 residual_along_track_m=-0.2534 residual_cross_track_m=0.2441 residual_vertical_m=0.0067 robot_speed_ms=0.053 seq=55 source_ts_gap_s=0.052765 total_rejections=0 window_centroid_residual_m=4.5736
16:37:34.501[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:37:34.502[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=774.497107
16:37:34.502[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.481, -1.718, 0.019] odom_goal_yaw_deg=-180.0 world_goal=[1.148, -1.642, -9.745] world_goal_yaw_deg=-146.32
16:37:34.502[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.481, -1.718, 0.019], euler=[90.0, 0.0, 121.6])
16:37:34.504[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:34.504[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:34.504[inf][nning_a_star/global_planner.py] Found safe goal. x=7.48 y=-1.72
16:37:34.505[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:34.511[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:34.513[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:37:35.148[inf][anning_a_star/local_planner.py] changed state state=path_following
16:37:36.047[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:37:36.048[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:37:36.109[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=176859 seq=57
16:37:36.142[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874254.357996 frame_age_s=1.6419 latest_residual_m=0.3671 observations_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.1282 residual_along_track_m=-0.177 residual_cross_track_m=0.3214 residual_vertical_m=-0.0122 robot_speed_ms=0.424 seq=57 source_ts_gap_s=0.033813 total_rejections=0 window_centroid_residual_m=4.5879
16:37:38.286[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=170595 seq=64
16:37:38.334[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874257.924596 frame_age_s=0.0802 latest_residual_m=0.0271 observations_added=1 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.0055 residual_along_track_m=0.0263 residual_cross_track_m=0.0061 residual_vertical_m=0.0023 robot_speed_ms=0.057 seq=64 source_ts_gap_s=0.071485 total_rejections=0 window_centroid_residual_m=3.697
16:37:38.837[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:37:38.839[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=778.834428
16:37:38.840[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.394, -1.555, 0.04] odom_goal_yaw_deg=0.0 world_goal=[0.96, -1.621, -9.636] world_goal_yaw_deg=171.21
16:37:38.844[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
16:37:38.938[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.394, -1.555, 0.040], euler=[90.0, 0.0, 79.2])
16:37:38.938[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:38.938[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:38.938[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:38.939[inf][nning_a_star/global_planner.py] Found safe goal. x=7.38 y=-1.57
16:37:38.948[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.01
16:37:38.952[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:38.955[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:37:39.802[inf][anning_a_star/local_planner.py] changed state state=path_following
16:37:40.364[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=172062 seq=70
16:37:40.387[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874260.191211 frame_age_s=0.0773 latest_residual_m=0.0234 observations_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0034 residual_along_track_m=0.0191 residual_cross_track_m=0.0075 residual_vertical_m=0.0113 robot_speed_ms=0.044 seq=70 source_ts_gap_s=0.006074 total_rejections=0 window_centroid_residual_m=3.5337
16:37:41.797[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:37:41.798[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=781.793321
16:37:41.798[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.340, -1.738, 0.028], euler=[90.0, 0.0, -61.6])
16:37:41.799[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.34, -1.738, 0.028] odom_goal_yaw_deg=-0.0 world_goal=[1.177, -1.633, -9.579] world_goal_yaw_deg=30.42
16:37:41.799[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:41.799[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:41.799[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:41.800[inf][nning_a_star/global_planner.py] Found safe goal. x=7.33 y=-1.77
16:37:41.807[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:41.808[inf][anning_a_star/local_planner.py] changed state state=path_following
16:37:41.962[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.245, -2.131, 0.023] odom_goal_yaw_deg=180.0 world_goal=[1.644, -1.638, -9.484] world_goal_yaw_deg=-5.79
16:37:41.963[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.245, -2.131, 0.023], euler=[90.0, 0.0, -97.8])
16:37:41.963[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:41.964[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:41.964[inf][nning_a_star/global_planner.py] Found safe goal. x=7.23 y=-2.17
16:37:41.964[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:41.973[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:41.975[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:37:42.655[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.399, -1.803, 0.106] odom_goal_yaw_deg=-0.0 world_goal=[1.251, -1.555, -9.652] world_goal_yaw_deg=163.51
16:37:42.695[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=168953 seq=76
16:37:42.729[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874262.157842 frame_age_s=0.0654 latest_residual_m=0.026 observations_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0122 residual_along_track_m=0.0099 residual_cross_track_m=0.0123 residual_vertical_m=0.0206 robot_speed_ms=0.029 seq=76 source_ts_gap_s=0.025381 total_rejections=0 window_centroid_residual_m=3.5347
16:37:42.776[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.399, -1.803, 0.106], euler=[90.0, 0.0, 71.5])
16:37:42.776[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:42.776[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:42.776[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:42.777[inf][nning_a_star/global_planner.py] Found safe goal. x=7.38 y=-1.82
16:37:42.792[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:42.797[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:37:43.640[inf][anning_a_star/local_planner.py] changed state state=path_following
16:37:44.044[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:37:44.045[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=784.040003
16:37:44.046[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.507, -1.714, 0.03] odom_goal_yaw_deg=-0.0 world_goal=[1.142, -1.631, -9.775] world_goal_yaw_deg=129.04
16:37:44.145[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.507, -1.714, 0.030], euler=[90.0, 0.0, 37.0])
16:37:44.145[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:44.145[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:44.145[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:44.146[inf][nning_a_star/global_planner.py] Found safe goal. x=7.48 y=-1.72
16:37:44.155[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:44.157[inf][anning_a_star/local_planner.py] changed state state=path_following
16:37:44.231[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.086
16:37:44.706[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=165888 seq=83
16:37:44.737[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874264.557796 frame_age_s=0.0795 latest_residual_m=0.0154 observations_added=1 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.0069 residual_along_track_m=0.013 residual_cross_track_m=0.0039 residual_vertical_m=-0.0073 robot_speed_ms=0.086 seq=83 source_ts_gap_s=0.015219 total_rejections=0 window_centroid_residual_m=3.3809
16:37:47.982[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:37:47.983[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=787.977953
16:37:47.983[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.383, -1.593, 0.055] odom_goal_yaw_deg=-0.0 world_goal=[1.005, -1.605, -9.624] world_goal_yaw_deg=169.66
16:37:48.169[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.383, -1.593, 0.055], euler=[90.0, -0.0, 77.6])
16:37:48.169[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:48.170[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:48.170[inf][nning_a_star/global_planner.py] Found safe goal. x=7.38 y=-1.62
16:37:48.170[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:48.178[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:48.180[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:37:48.922[inf][anning_a_star/local_planner.py] changed state state=path_following
16:37:49.635[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:37:49.636[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.342, -1.429, 0.077] odom_goal_yaw_deg=-180.0 world_goal=[0.813, -1.584, -9.569] world_goal_yaw_deg=-173.4
16:37:49.684[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.342, -1.429, 0.077], euler=[90.0, 0.0, 94.5])
16:37:49.685[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:49.685[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:49.685[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:49.686[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.001
16:37:49.686[inf][nning_a_star/global_planner.py] Found safe goal. x=7.33 y=-1.47
16:37:49.694[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:49.696[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:37:50.843[inf][anning_a_star/local_planner.py] changed state state=path_following
16:37:52.221[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:37:52.221[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:37:52.251[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:37:52.252[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=792.247012
16:37:52.252[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.174, -1.423, 0.024] odom_goal_yaw_deg=-180.0 world_goal=[0.813, -1.636, -9.371] world_goal_yaw_deg=-91.28
16:37:52.254[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.174, -1.423, 0.024], euler=[90.0, 0.0, 176.7])
16:37:52.255[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:52.255[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:52.256[inf][nning_a_star/global_planner.py] Found safe goal. x=7.13 y=-1.42
16:37:52.256[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:52.262[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:52.263[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:37:52.386[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.246, -1.234, 0.029] odom_goal_yaw_deg=-0.0 world_goal=[0.588, -1.632, -9.447] world_goal_yaw_deg=164.28
16:37:52.588[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.246, -1.234, 0.029], euler=[90.0, 0.0, 72.2])
16:37:52.589[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:52.589[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:52.589[inf][nning_a_star/global_planner.py] Found safe goal. x=7.23 y=-1.27
16:37:52.591[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:52.599[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:52.600[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:37:52.776[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.602, -1.201, 0.018] odom_goal_yaw_deg=0.0 world_goal=[0.534, -1.643, -9.866] world_goal_yaw_deg=98.21
16:37:52.798[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.602, -1.201, 0.018], euler=[90.0, 0.0, 6.2])
16:37:52.799[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:52.799[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:52.799[inf][nning_a_star/global_planner.py] Found safe goal. x=7.58 y=-1.22
16:37:52.800[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:52.807[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:52.808[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:37:53.057[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.869, -1.303, 0.111] odom_goal_yaw_deg=-0.0 world_goal=[0.643, -1.549, -10.183] world_goal_yaw_deg=73.1
16:37:53.253[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.869, -1.303, 0.111], euler=[90.0, 0.0, -19.0])
16:37:53.254[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:53.254[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:53.254[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:53.255[inf][nning_a_star/global_planner.py] Found safe goal. x=7.83 y=-1.32
16:37:53.263[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:53.264[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:37:53.483[inf][anning_a_star/local_planner.py] changed state state=path_following
16:37:53.531[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:37:53.533[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.016, -1.418, 0.114] odom_goal_yaw_deg=0.0 world_goal=[0.772, -1.547, -10.361] world_goal_yaw_deg=55.89
16:37:53.553[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.016, -1.418, 0.114], euler=[90.0, 0.0, -36.2])
16:37:53.553[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:53.554[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:53.554[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:53.557[inf][nning_a_star/global_planner.py] Found safe goal. x=7.88 y=-1.37
16:37:53.565[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:53.567[inf][anning_a_star/local_planner.py] changed state state=path_following
16:37:53.737[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.205, -1.553, 0.103] odom_goal_yaw_deg=-0.0 world_goal=[0.923, -1.558, -10.59] world_goal_yaw_deg=58.11
16:37:53.891[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.205, -1.553, 0.103], euler=[90.0, 0.0, -33.9])
16:37:53.892[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:53.892[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:53.892[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:53.895[war][nning_a_star/global_planner.py] Travelling to goal 0.23279422385009652m away from requested goal.
16:37:53.895[inf][nning_a_star/global_planner.py] Found safe goal. x=8.38 y=-1.67
16:37:53.909[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:53.912[inf][anning_a_star/local_planner.py] changed state state=path_following
16:37:56.011[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:37:56.012[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=796.007113
16:37:56.013[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.363, -1.616, 0.107] odom_goal_yaw_deg=0.0 world_goal=[0.991, -1.554, -10.779] world_goal_yaw_deg=56.7
16:37:56.048[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.363, -1.616, 0.107], euler=[90.0, 0.0, -35.4])
16:37:56.048[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:56.048[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:56.049[inf][nning_a_star/global_planner.py] Found safe goal. x=8.33 y=-1.62
16:37:56.049[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:37:56.050[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.001
16:37:56.057[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:56.062[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:37:56.815[inf][anning_a_star/local_planner.py] changed state state=path_following
16:37:57.349[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:37:57.349[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:37:57.584[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=134615 seq=87
16:37:57.584[war][tion/session/session_frames.py] AR camera frame dropped: too old frame_age_s=11.593 max_age_s=4.0 seq=87
16:37:57.897[war][s/ar/world_frame/transforms.py] gravity_level_transform: input up-axis far from world-up (angle=15.2 deg) — registration input likely malformed; this warning is rate-limited to once per 30 s
16:37:57.901[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874277.590788 frame_age_s=0.1113 latest_residual_m=0.0916 observations_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0259 residual_along_track_m=-0.0774 residual_cross_track_m=0.0263 residual_vertical_m=0.0413 robot_speed_ms=0.011 seq=88 source_ts_gap_s=0.019403 total_rejections=0 window_centroid_residual_m=3.0504
16:37:59.222[inf][anning_a_star/local_planner.py] Obstacle detected ahead, stopping local planner.
16:37:59.222[inf][anning_a_star/local_planner.py] changed state state=idle
16:37:59.223[inf][nning_a_star/global_planner.py] Replanning path due to obstacle found.
16:37:59.223[inf][nning_a_star/global_planner.py] Replanning. attempt=0
16:37:59.223[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:37:59.225[war][nning_a_star/global_planner.py] Travelling to goal 0.20919888162902045m away from requested goal.
16:37:59.225[inf][nning_a_star/global_planner.py] Found safe goal. x=8.48 y=-1.47
16:37:59.235[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:37:59.237[inf][anning_a_star/local_planner.py] changed state state=path_following
16:37:59.841[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=175076 seq=95
16:38:00.235[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874279.824082 frame_age_s=0.1 latest_residual_m=0.0794 observations_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0056 residual_along_track_m=-0.064 residual_cross_track_m=0.0402 residual_vertical_m=0.0245 robot_speed_ms=0.012 seq=96 source_ts_gap_s=0.050218 total_rejections=0 window_centroid_residual_m=2.441
16:38:01.473[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:38:01.473[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:38:01.886[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=171441 seq=99
16:38:02.533[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874282.090667 frame_age_s=0.0805 latest_residual_m=0.0889 observations_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0021 residual_along_track_m=-0.0605 residual_cross_track_m=0.062 residual_vertical_m=0.0198 robot_speed_ms=0.014 seq=101 source_ts_gap_s=0.056676 total_rejections=0 window_centroid_residual_m=2.4467
16:38:03.652[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
16:38:03.942[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=178491 seq=105
16:38:04.587[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874284.123963 frame_age_s=0.1105 latest_residual_m=0.044 observations_added=1 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0112 residual_along_track_m=-0.039 residual_cross_track_m=0.0177 residual_vertical_m=0.01 robot_speed_ms=0.068 seq=107 source_ts_gap_s=0.057633 total_rejections=0 window_centroid_residual_m=2.0471
16:38:05.369[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:38:05.370[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=805.365276
16:38:05.371[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.314, -1.453, 0.112] odom_goal_yaw_deg=-0.0 world_goal=[0.801, -1.548, -10.714] world_goal_yaw_deg=163.34
16:38:05.493[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.314, -1.453, 0.112], euler=[90.0, 0.0, 71.3])
16:38:05.494[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:05.494[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:05.494[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:05.496[inf][nning_a_star/global_planner.py] Found safe goal. x=8.43 y=-1.42
16:38:05.506[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:05.511[inf][anning_a_star/local_planner.py] changed state state=path_following
16:38:05.539[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.045
16:38:05.807[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.088, -1.253, 0.134] odom_goal_yaw_deg=-180.0 world_goal=[0.575, -1.527, -10.439] world_goal_yaw_deg=-124.57
16:38:05.807[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.088, -1.253, 0.134], euler=[90.0, 0.0, 143.4])
16:38:05.807[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:05.808[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:05.811[war][nning_a_star/global_planner.py] Travelling to goal 0.2719890596181928m away from requested goal.
16:38:05.812[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:05.812[inf][nning_a_star/global_planner.py] Found safe goal. x=7.93 y=-1.42
16:38:05.819[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:05.820[inf][anning_a_star/local_planner.py] changed state state=path_following
16:38:06.036[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=182989 seq=112
16:38:06.253[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.122, -1.419, 0.12] odom_goal_yaw_deg=180.0 world_goal=[0.769, -1.541, -10.486] world_goal_yaw_deg=1.92
16:38:06.253[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.122, -1.419, 0.120], euler=[90.0, 0.0, -90.1])
16:38:06.253[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:06.254[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:06.257[war][nning_a_star/global_planner.py] Travelling to goal 0.23023914682140337m away from requested goal.
16:38:06.257[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:06.258[inf][nning_a_star/global_planner.py] Found safe goal. x=7.93 y=-1.42
16:38:06.266[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:06.268[inf][anning_a_star/local_planner.py] changed state state=path_following
16:38:06.784[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874286.590648 frame_age_s=0.083 latest_residual_m=0.054 observations_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=1 residual_along_camera_ray_m=0.0273 residual_along_track_m=-0.0367 residual_cross_track_m=0.0281 residual_vertical_m=-0.0279 robot_speed_ms=0.026 seq=115 source_ts_gap_s=0.14555 total_rejections=1 window_centroid_residual_m=1.8149
16:38:07.004[inf][imos/ar/world_frame/aligner.py] alignment_update alpha_scale=1.0 alpha_yaw=1.0 baseline_m=7.6711 confidence=0.8313 max_pair_skew_s=0.1406 mean_ambiguity_ratio=1.6769 method=similarity n_obs=12 n_rejected=2 resid_rms_m=0.0119 s=1.1536 scale_held=False scale_observable=True yaw_deg=87.91 yaw_held=False yaw_observable=True
16:38:07.005[inf][imos/ar/world_frame/aligner.py] refinement_episode_complete baseline_m=7.671 marker_jump_m=0.131 observation_count=12 solve_quality=0.952 trans_delta_m=0.692 yaw_delta_deg=4.14
16:38:07.006[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:38:07.007[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.237, -1.369, 0.113] odom_goal_yaw_deg=180.0 world_goal=[0.707, -1.538, -10.518] world_goal_yaw_deg=178.24
16:38:07.076[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.237, -1.369, 0.113], euler=[90.0, 0.0, 90.3])
16:38:07.076[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:07.076[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:07.077[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:07.080[war][nning_a_star/global_planner.py] Travelling to goal 0.226969614995991m away from requested goal.
16:38:07.081[inf][nning_a_star/global_planner.py] Found safe goal. x=8.43 y=-1.42
16:38:07.090[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:07.097[inf][anning_a_star/local_planner.py] changed state state=path_following
16:38:07.311[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:38:07.311[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:38:08.031[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:38:08.032[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=808.027456
16:38:08.033[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.172, -1.53, 0.108] odom_goal_yaw_deg=-180.0 world_goal=[0.891, -1.543, -10.436] world_goal_yaw_deg=-55.9
16:38:08.174[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=163744 seq=5
16:38:08.179[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.172, -1.530, 0.108], euler=[90.0, 0.0, -143.8])
16:38:08.179[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:08.180[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:08.185[war][nning_a_star/global_planner.py] Travelling to goal 0.3205320478235426m away from requested goal.
16:38:08.185[inf][nning_a_star/global_planner.py] Found safe goal. x=7.88 y=-1.47
16:38:08.188[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:08.206[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:08.231[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:38:08.529[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.160, -1.704, 0.104], euler=[90.0, 0.0, -85.5])
16:38:08.529[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.16, -1.704, 0.104] odom_goal_yaw_deg=0.0 world_goal=[1.09, -1.548, -10.416] world_goal_yaw_deg=2.37
16:38:08.530[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:08.530[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:08.532[war][nning_a_star/global_planner.py] Travelling to goal 0.3801232677196991m away from requested goal.
16:38:08.532[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:08.532[inf][nning_a_star/global_planner.py] Found safe goal. x=7.88 y=-1.47
16:38:08.540[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:08.542[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:38:08.898[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874288.690594 frame_age_s=0.0881 latest_residual_m=0.023 observations_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=1 residual_along_camera_ray_m=-0.008 residual_along_track_m=0.0134 residual_cross_track_m=0.012 residual_vertical_m=0.0144 robot_speed_ms=0.008 seq=8 source_ts_gap_s=0.036094 total_rejections=1 window_centroid_residual_m=1.0664
16:38:09.143[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:38:09.144[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.216, -1.698, 0.104] odom_goal_yaw_deg=-0.0 world_goal=[1.086, -1.548, -10.481] world_goal_yaw_deg=113.35
16:38:09.188[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.216, -1.698, 0.104], euler=[90.0, 0.0, 25.4])
16:38:09.188[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:09.188[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:09.191[war][nning_a_star/global_planner.py] Travelling to goal 0.3787889904819757m away from requested goal.
16:38:09.191[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:09.191[inf][nning_a_star/global_planner.py] Found safe goal. x=7.98 y=-1.42
16:38:09.198[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:09.200[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:38:09.733[inf][anning_a_star/local_planner.py] changed state state=path_following
16:38:10.181[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=171563 seq=13
16:38:11.097[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874290.857181 frame_age_s=0.0934 latest_residual_m=0.0274 observations_added=1 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0244 residual_along_track_m=0.0071 residual_cross_track_m=0.0044 residual_vertical_m=0.0261 robot_speed_ms=0.052 seq=16 source_ts_gap_s=0.150876 total_rejections=0 window_centroid_residual_m=0.9096
16:38:12.182[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=170700 seq=20
16:38:13.289[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874292.990477 frame_age_s=0.1236 latest_residual_m=0.0164 observations_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0084 residual_along_track_m=-0.0132 residual_cross_track_m=0.0087 residual_vertical_m=0.0044 robot_speed_ms=0.146 seq=25 source_ts_gap_s=0.071228 total_rejections=0 window_centroid_residual_m=0.5999
16:38:14.190[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=164369 seq=29
16:38:14.212[inf][imos/ar/world_frame/aligner.py] alignment_update alpha_scale=1.0 alpha_yaw=1.0 baseline_m=7.6545 confidence=0.8737 max_pair_skew_s=0.1509 mean_ambiguity_ratio=1.6065 method=similarity n_obs=18 n_rejected=3 resid_rms_m=0.008 s=1.2144 scale_held=False scale_observable=True yaw_deg=88.77 yaw_held=False yaw_observable=True
16:38:14.215[inf][imos/ar/world_frame/aligner.py] refinement_episode_complete baseline_m=7.655 marker_jump_m=0.476 observation_count=18 solve_quality=0.946 trans_delta_m=0.486 yaw_delta_deg=0.85
16:38:14.216[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=2 dropped_fifo=0 fifo_depth=0
16:38:15.498[inf][ar/network/websocket_server.py] AR inbound text message type=set_lidar_mode
16:38:15.498[inf][r/dimos/ar/bridge/telemetry.py] LiDAR mode updated mode=obstacles obstacle_max_distance_m=0.8 obstacle_min_distance_m=0.1 obstacle_opaque_distance_m=0.5
16:38:15.767[inf][r/dimos/ar/bridge/telemetry.py] LiDAR stream active hz=1.0
16:38:15.767[deb][r/dimos/ar/bridge/telemetry.py] LiDAR payload bytes=377 hz=1.0 points=62
16:38:16.648[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:38:16.649[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:38:16.708[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=180623 seq=2
16:38:16.738[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874296.457053 frame_age_s=0.107 latest_residual_m=0.0504 observations_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=1 residual_along_camera_ray_m=0.0387 residual_along_track_m=0.0336 residual_cross_track_m=0.025 residual_vertical_m=-0.0281 robot_speed_ms=0.034 seq=2 source_ts_gap_s=0.011806 total_rejections=1 window_centroid_residual_m=0.5124
16:38:17.354[war][imos/ar/navigation/navigate.py] AR navigation goal stalled stall_reason=no_path
16:38:17.354[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=0.0
16:38:17.699[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:38:17.700[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:17.700[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:17.702[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.002
16:38:17.757[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=cancel_nav_goal publish_mono=817.752078
16:38:18.765[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=164405 seq=10
16:38:18.798[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874298.423704 frame_age_s=0.095 latest_residual_m=0.0407 observations_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.0028 residual_along_track_m=0.0384 residual_cross_track_m=0.0089 residual_vertical_m=0.01 robot_speed_ms=0.006 seq=10 source_ts_gap_s=0.001076 total_rejections=0 window_centroid_residual_m=0.3907
16:38:19.518[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:38:19.520[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.062, -1.573, 0.107], euler=[90.0, 0.0, 175.3])
16:38:19.520[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.062, -1.573, 0.107] odom_goal_yaw_deg=180.0 world_goal=[0.932, -1.544, -10.341] world_goal_yaw_deg=-95.98
16:38:19.520[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:19.523[war][nning_a_star/global_planner.py] Travelling to goal 0.23620801674364664m away from requested goal.
16:38:19.523[inf][nning_a_star/global_planner.py] Found safe goal. x=7.88 y=-1.47
16:38:19.530[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:19.532[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:38:19.533[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=7
16:38:19.866[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=819.861186
16:38:19.867[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.859, -1.156, 0.032] odom_goal_yaw_deg=180.0 world_goal=[0.42, -1.619, -10.106] world_goal_yaw_deg=-157.97
16:38:20.010[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.859, -1.156, 0.032], euler=[90.0, 0.0, 113.3])
16:38:20.010[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:20.011[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:20.011[inf][nning_a_star/global_planner.py] Found safe goal. x=7.83 y=-1.12
16:38:20.012[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:20.018[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:20.019[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:38:20.205[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
16:38:20.409[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.951, -1.294, 0.088] odom_goal_yaw_deg=0.0 world_goal=[0.591, -1.563, -10.214] world_goal_yaw_deg=39.77
16:38:20.447[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.951, -1.294, 0.088], euler=[90.0, 0.0, -49.0])
16:38:20.447[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:20.447[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:20.448[inf][nning_a_star/global_planner.py] Found safe goal. x=7.88 y=-1.37
16:38:20.448[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:20.458[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:20.461[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:38:20.812[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=171076 seq=17
16:38:20.859[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874300.490326 frame_age_s=0.1001 latest_residual_m=0.056 observations_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.0126 residual_along_track_m=0.0512 residual_cross_track_m=0.0221 residual_vertical_m=0.005 robot_speed_ms=0.017 seq=17 source_ts_gap_s=0.03747 total_rejections=0 window_centroid_residual_m=0.3226
16:38:20.871[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:38:20.872[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.055, -1.422, 0.11] odom_goal_yaw_deg=-0.0 world_goal=[0.748, -1.541, -10.337] world_goal_yaw_deg=47.59
16:38:20.873[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.055, -1.422, 0.110], euler=[90.0, 0.0, -41.2])
16:38:20.873[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:20.874[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:20.880[war][nning_a_star/global_planner.py] Travelling to goal 0.21094985234417246m away from requested goal.
16:38:20.880[inf][nning_a_star/global_planner.py] Found safe goal. x=7.88 y=-1.42
16:38:20.881[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:20.895[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:20.898[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:38:21.646[inf][anning_a_star/local_planner.py] changed state state=path_following
16:38:21.954[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:38:21.955[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=821.949921
16:38:21.955[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.016, -1.255, 0.086] odom_goal_yaw_deg=-0.0 world_goal=[0.545, -1.565, -10.294] world_goal_yaw_deg=157.72
16:38:22.068[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.016, -1.255, 0.086], euler=[90.0, 0.0, 69.0])
16:38:22.068[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:22.072[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:22.077[inf][nning_a_star/global_planner.py] Found safe goal. x=7.88 y=-1.22
16:38:22.078[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:22.089[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:22.093[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:38:22.412[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.938, -0.904, 0.028], euler=[90.0, 0.0, 92.5])
16:38:22.412[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.938, -0.904, 0.028] odom_goal_yaw_deg=180.0 world_goal=[0.117, -1.623, -10.209] world_goal_yaw_deg=-178.75
16:38:22.413[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:22.413[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:22.413[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:22.414[inf][nning_a_star/global_planner.py] Found safe goal. x=7.93 y=-0.92
16:38:22.423[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:22.424[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:38:22.854[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.088, -0.864, 0.117] odom_goal_yaw_deg=-0.0 world_goal=[0.071, -1.534, -10.391] world_goal_yaw_deg=102.91
16:38:22.912[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.088, -0.864, 0.117], euler=[90.0, 0.0, 14.1])
16:38:22.913[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:22.913[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:22.913[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:22.914[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.001
16:38:22.914[inf][nning_a_star/global_planner.py] Found safe goal. x=8.08 y=-0.87
16:38:22.921[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:22.923[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:38:23.099[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=168822 seq=23
16:38:23.137[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874302.823609 frame_age_s=0.0974 latest_residual_m=0.0737 observations_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0336 residual_along_track_m=0.0214 residual_cross_track_m=0.0438 residual_vertical_m=0.0553 robot_speed_ms=0.029 seq=23 source_ts_gap_s=0.021588 total_rejections=0 window_centroid_residual_m=0.2048
16:38:23.138[inf][anning_a_star/local_planner.py] changed state state=path_following
16:38:23.670[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:38:23.671[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.131, -0.801, 0.149] odom_goal_yaw_deg=-0.0 world_goal=[-0.003, -1.502, -10.446] world_goal_yaw_deg=157.1
16:38:23.705[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.131, -0.801, 0.149], euler=[90.0, 0.0, 68.3])
16:38:23.705[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:23.705[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:23.706[inf][nning_a_star/global_planner.py] Found safe goal. x=8.13 y=-0.82
16:38:23.706[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:23.730[war][nning_a_star/global_planner.py] No path found to the goal. x=8.125 y=-0.825
16:38:23.731[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:38:23.732[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:38:23.733[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=0.2
16:38:25.244[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=158427 seq=30
16:38:25.269[inf][imos/ar/world_frame/aligner.py] alignment_update alpha_scale=1.0 alpha_yaw=1.0 baseline_m=7.6515 confidence=0.8503 max_pair_skew_s=0.1318 mean_ambiguity_ratio=1.6918 method=similarity n_obs=15 n_rejected=2 resid_rms_m=0.0127 s=1.1923 scale_held=False scale_observable=True yaw_deg=102.16 yaw_held=False yaw_observable=True
16:38:25.270[inf][imos/ar/world_frame/aligner.py] refinement_episode_complete baseline_m=7.652 marker_jump_m=0.171 observation_count=15 solve_quality=0.941 trans_delta_m=2.165 yaw_delta_deg=13.39
16:38:25.277[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874305.056922 frame_age_s=0.0944 latest_residual_m=0.0384 observations_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.0174 residual_along_track_m=0.0348 residual_cross_track_m=0.0122 residual_vertical_m=-0.0105 robot_speed_ms=0.0 seq=30 source_ts_gap_s=0.001912 total_rejections=0 window_centroid_residual_m=0.0594
16:38:25.278[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=2 dropped_fifo=0 fifo_depth=0
16:38:26.517[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:38:26.519[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=826.514172
16:38:26.520[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.557, -0.995, -0.023] odom_goal_yaw_deg=-0.0 world_goal=[0.238, -1.674, -9.742] world_goal_yaw_deg=65.15
16:38:26.695[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.557, -0.995, -0.023], euler=[90.0, 0.0, -37.0])
16:38:26.696[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:26.697[inf][nning_a_star/global_planner.py] Found safe goal. x=7.53 y=-1.02
16:38:26.706[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:26.707[inf][anning_a_star/local_planner.py] changed state state=path_following
16:38:26.707[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:38:26.708[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:38:26.708[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:38:26.708[inf][anning_a_star/local_planner.py] changed state state=arrived
16:38:26.776[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
16:38:26.814[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:26.814[inf][nning_a_star/global_planner.py] Arrived at goal.
16:38:26.815[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:38:26.815[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:38:26.816[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
16:38:26.885[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.679, -0.928, 0.027] odom_goal_yaw_deg=0.0 world_goal=[0.129, -1.624, -9.867] world_goal_yaw_deg=110.5
16:38:26.960[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.679, -0.928, 0.027], euler=[90.0, 0.0, 8.3])
16:38:26.961[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:26.962[inf][nning_a_star/global_planner.py] Found safe goal. x=7.68 y=-0.97
16:38:26.968[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:26.970[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:38:26.972[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=3
16:38:27.223[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.882, -1.001, 0.03] odom_goal_yaw_deg=-0.0 world_goal=[0.163, -1.622, -10.122] world_goal_yaw_deg=83.24
16:38:27.317[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.882, -1.001, 0.030], euler=[90.0, 0.0, -18.9])
16:38:27.318[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:27.319[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:27.320[inf][nning_a_star/global_planner.py] Found safe goal. x=7.88 y=-1.02
16:38:27.321[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:27.332[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:27.333[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:38:27.654[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:38:27.654[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:38:27.709[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=170071 seq=2
16:38:27.743[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874307.490176 frame_age_s=0.1421 latest_residual_m=0.05 observations_added=1 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0138 residual_along_track_m=0.0415 residual_cross_track_m=0.0093 residual_vertical_m=0.0263 robot_speed_ms=0.155 seq=2 source_ts_gap_s=0.014423 total_rejections=0 window_centroid_residual_m=0.0908
16:38:27.758[inf][anning_a_star/local_planner.py] changed state state=path_following
16:38:28.407[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:38:28.412[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.013, -1.084, 0.107] odom_goal_yaw_deg=-0.0 world_goal=[0.227, -1.544, -10.296] world_goal_yaw_deg=36.99
16:38:28.472[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.013, -1.084, 0.107], euler=[90.0, 0.0, -65.2])
16:38:28.476[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:28.476[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:28.477[inf][nning_a_star/global_planner.py] Found safe goal. x=7.93 y=-1.02
16:38:28.478[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:28.480[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.004
16:38:28.485[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:28.487[inf][anning_a_star/local_planner.py] changed state state=path_following
16:38:28.907[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=828.90141
16:38:28.907[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.103, -1.232, 0.114], euler=[90.0, 0.0, -64.1])
16:38:28.907[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.103, -1.232, 0.114] odom_goal_yaw_deg=-0.0 world_goal=[0.376, -1.538, -10.438] world_goal_yaw_deg=38.05
16:38:28.908[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:28.908[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:28.912[war][nning_a_star/global_planner.py] Travelling to goal 0.2586687544108523m away from requested goal.
16:38:28.912[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:28.912[inf][nning_a_star/global_planner.py] Found safe goal. x=7.88 y=-1.27
16:38:28.919[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:28.921[inf][anning_a_star/local_planner.py] changed state state=path_following
16:38:29.820[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=168111 seq=9
16:38:29.858[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874309.590141 frame_age_s=0.1305 latest_residual_m=0.0589 observations_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0473 residual_along_track_m=0.0305 residual_cross_track_m=0.0105 residual_vertical_m=0.0492 robot_speed_ms=0.012 seq=9 source_ts_gap_s=0.055767 total_rejections=0 window_centroid_residual_m=0.1306
16:38:29.926[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:38:29.927[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.162, -1.389, 0.113] odom_goal_yaw_deg=180.0 world_goal=[0.545, -1.539, -10.546] world_goal_yaw_deg=1.42
16:38:29.928[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.162, -1.389, 0.113], euler=[90.0, 0.0, -100.7])
16:38:29.928[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:29.928[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:29.933[war][nning_a_star/global_planner.py] Travelling to goal 0.2560850854754133m away from requested goal.
16:38:29.933[inf][nning_a_star/global_planner.py] Found safe goal. x=8.38 y=-1.47
16:38:29.933[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:29.946[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:29.950[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:38:30.353[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.182, -1.413, 0.11] odom_goal_yaw_deg=0.0 world_goal=[0.567, -1.541, -10.575] world_goal_yaw_deg=35.81
16:38:30.400[inf][imos/ar/world_frame/aligner.py] alignment_update alpha_scale=1.0 alpha_yaw=1.0 baseline_m=7.6369 confidence=0.8954 max_pair_skew_s=0.159 mean_ambiguity_ratio=1.6426 method=similarity n_obs=14 n_rejected=3 resid_rms_m=0.0071 s=1.1234 scale_held=False scale_observable=True yaw_deg=104.27 yaw_held=False yaw_observable=True
16:38:30.431[inf][imos/ar/world_frame/aligner.py] refinement_episode_complete baseline_m=7.637 marker_jump_m=0.533 observation_count=14 solve_quality=0.946 trans_delta_m=0.635 yaw_delta_deg=2.11
16:38:30.431[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=2 dropped_fifo=0 fifo_depth=0
16:38:30.436[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.182, -1.413, 0.110], euler=[90.0, 0.0, -66.3])
16:38:30.436[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:30.437[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:30.440[war][nning_a_star/global_planner.py] Travelling to goal 0.23082237389806162m away from requested goal.
16:38:30.437[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:30.441[inf][nning_a_star/global_planner.py] Found safe goal. x=8.38 y=-1.47
16:38:30.451[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:30.453[inf][anning_a_star/local_planner.py] changed state state=path_following
16:38:30.884[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.231, -1.521, 0.111] odom_goal_yaw_deg=0.0 world_goal=[0.641, -1.546, -10.632] world_goal_yaw_deg=37.27
16:38:31.003[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.231, -1.521, 0.111], euler=[90.0, 0.0, -67.0])
16:38:31.003[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:31.004[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:31.004[inf][nning_a_star/global_planner.py] Found safe goal. x=8.23 y=-1.42
16:38:31.005[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:31.013[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:31.015[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:38:31.768[inf][anning_a_star/local_planner.py] Obstacle detected ahead, stopping local planner.
16:38:31.768[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:31.769[inf][nning_a_star/global_planner.py] Replanning path due to obstacle found.
16:38:31.769[inf][nning_a_star/global_planner.py] Replanning. attempt=0
16:38:31.769[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:31.773[war][nning_a_star/global_planner.py] Travelling to goal 0.267573059887874m away from requested goal.
16:38:31.773[inf][nning_a_star/global_planner.py] Found safe goal. x=8.48 y=-1.52
16:38:31.804[war][nning_a_star/global_planner.py] No path found to the goal. x=8.475 y=-1.525
16:38:31.804[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:38:31.874[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:38:31.874[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=0.1
16:38:31.875[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=emergency_stop publish_mono=831.869748
16:38:31.936[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=163808 seq=15
16:38:31.962[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874311.523429 frame_age_s=0.1018 latest_residual_m=0.0655 observations_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0591 residual_along_track_m=0.0219 residual_cross_track_m=0.0282 residual_vertical_m=0.0548 robot_speed_ms=0.018 seq=15 source_ts_gap_s=0.060766 total_rejections=0 window_centroid_residual_m=0.1132
16:38:32.145[inf][imos/ar/world_frame/aligner.py] alignment_update alpha_scale=1.0 alpha_yaw=1.0 baseline_m=7.6369 confidence=0.904 max_pair_skew_s=0.159 mean_ambiguity_ratio=1.6461 method=similarity n_obs=16 n_rejected=5 resid_rms_m=0.007 s=1.0882 scale_held=False scale_observable=True yaw_deg=104.13 yaw_held=False yaw_observable=True
16:38:32.148[inf][imos/ar/world_frame/aligner.py] refinement_episode_complete baseline_m=7.637 marker_jump_m=0.274 observation_count=16 solve_quality=0.946 trans_delta_m=0.275 yaw_delta_deg=0.14
16:38:39.983[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:38:39.984[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=839.979016
16:38:39.985[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.474, -0.948, -0.03] odom_goal_yaw_deg=0.0 world_goal=[0.226, -1.682, -9.657] world_goal_yaw_deg=101.05
16:38:40.110[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.474, -0.948, -0.030], euler=[90.0, 0.0, -3.1])
16:38:40.111[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:40.112[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.0
16:38:40.112[inf][nning_a_star/global_planner.py] Found safe goal. x=7.43 y=-0.97
16:38:40.119[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:40.120[inf][anning_a_star/local_planner.py] changed state state=path_following
16:38:40.120[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:38:40.121[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
16:38:40.122[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:38:40.122[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:38:40.123[inf][anning_a_star/local_planner.py] changed state state=arrived
16:38:40.227[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:40.228[inf][nning_a_star/global_planner.py] Arrived at goal.
16:38:40.228[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:38:40.230[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:38:40.230[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
16:38:40.475[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.795, -0.948, 0.02] odom_goal_yaw_deg=-0.0 world_goal=[0.141, -1.632, -9.996] world_goal_yaw_deg=92.96
16:38:40.540[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.795, -0.948, 0.020], euler=[90.0, 0.0, -11.2])
16:38:40.541[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:40.541[inf][nning_a_star/global_planner.py] Found safe goal. x=7.78 y=-0.97
16:38:40.548[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:40.550[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:38:40.551[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=6
16:38:40.700[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.969, -1.096, 0.039] odom_goal_yaw_deg=-0.0 world_goal=[0.251, -1.613, -10.219] world_goal_yaw_deg=67.65
16:38:40.860[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.969, -1.096, 0.039], euler=[90.0, 0.0, -36.5])
16:38:40.860[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:40.860[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:40.861[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:40.861[inf][nning_a_star/global_planner.py] Found safe goal. x=7.88 y=-1.12
16:38:40.869[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:40.870[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:38:41.079[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:38:41.080[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.09, -1.239, 0.099] odom_goal_yaw_deg=-0.0 world_goal=[0.37, -1.553, -10.385] world_goal_yaw_deg=58.82
16:38:41.081[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.090, -1.239, 0.099], euler=[90.0, 0.0, -45.3])
16:38:41.082[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:41.082[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:41.082[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:41.087[inf][nning_a_star/global_planner.py] Found safe goal. x=7.93 y=-1.22
16:38:41.095[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:41.097[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:38:41.410[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:38:41.410[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:38:41.440[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=163521 seq=2
16:38:41.491[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874321.256563 frame_age_s=0.1337 latest_residual_m=0.0573 observations_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.0243 residual_along_track_m=0.0519 residual_cross_track_m=0.0193 residual_vertical_m=-0.0146 robot_speed_ms=0.027 seq=2 source_ts_gap_s=0.056844 total_rejections=0 window_centroid_residual_m=0.1368
16:38:41.628[inf][anning_a_star/local_planner.py] changed state state=path_following
16:38:41.964[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.158, -1.339, 0.118] odom_goal_yaw_deg=0.0 world_goal=[0.457, -1.534, -10.483] world_goal_yaw_deg=47.16
16:38:42.136[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.158, -1.339, 0.118], euler=[90.0, 0.0, -57.0])
16:38:42.137[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:42.137[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:42.137[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:42.142[war][nning_a_star/global_planner.py] Travelling to goal 0.4046966164700646m away from requested goal.
16:38:42.142[inf][nning_a_star/global_planner.py] Found safe goal. x=7.88 y=-1.07
16:38:42.149[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:42.151[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:38:42.892[inf][anning_a_star/local_planner.py] changed state state=path_following
16:38:43.900[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=162277 seq=9
16:38:43.929[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874323.38985 frame_age_s=0.1139 latest_residual_m=0.0986 observations_added=1 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.042 residual_along_track_m=0.0528 residual_cross_track_m=0.0618 residual_vertical_m=0.0559 robot_speed_ms=0.088 seq=9 source_ts_gap_s=0.01696 total_rejections=0 window_centroid_residual_m=0.149
16:38:46.026[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=164267 seq=16
16:38:46.058[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874325.823127 frame_age_s=0.1031 latest_residual_m=0.09 observations_added=1 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0282 residual_along_track_m=0.0655 residual_cross_track_m=0.0467 residual_vertical_m=0.0403 robot_speed_ms=0.081 seq=16 source_ts_gap_s=0.03938 total_rejections=0 window_centroid_residual_m=0.1627
16:38:47.383[inf][ar/network/websocket_server.py] AR inbound text message type=cancel_nav_goal
16:38:47.384[inf][imos/ar/navigation/navigate.py] AR navigation goal cancelled
16:38:47.384[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=0.1
16:38:47.385[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=cancel_nav_goal publish_mono=847.379468
16:38:47.461[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:38:47.462[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:47.462[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:47.463[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.002
16:38:48.148[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=169810 seq=24
16:38:48.175[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874327.92307 frame_age_s=0.1082 latest_residual_m=0.088 observations_added=1 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0299 residual_along_track_m=0.0565 residual_cross_track_m=0.0544 residual_vertical_m=0.0398 robot_speed_ms=0.116 seq=24 source_ts_gap_s=0.080213 total_rejections=0 window_centroid_residual_m=0.1311
16:38:48.680[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
16:38:49.362[inf][imos/ar/world_frame/aligner.py] alignment_update alpha_scale=1.0 alpha_yaw=1.0 baseline_m=7.5855 confidence=0.8799 max_pair_skew_s=0.1104 mean_ambiguity_ratio=1.4225 method=similarity n_obs=18 n_rejected=4 resid_rms_m=0.0097 s=1.0666 scale_held=False scale_observable=True yaw_deg=101.63 yaw_held=False yaw_observable=True
16:38:49.364[inf][imos/ar/world_frame/aligner.py] refinement_episode_complete baseline_m=7.586 marker_jump_m=0.221 observation_count=18 solve_quality=0.93 trans_delta_m=0.421 yaw_delta_deg=2.5
16:38:50.399[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:38:50.400[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=850.394431
16:38:50.400[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.457, -0.845, -0.029] odom_goal_yaw_deg=0.0 world_goal=[0.109, -1.674, -9.67] world_goal_yaw_deg=74.6
16:38:50.566[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.457, -0.845, -0.029], euler=[90.0, 0.0, -27.0])
16:38:50.566[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:50.568[inf][nning_a_star/global_planner.py] Found safe goal. x=7.43 y=-0.87
16:38:50.576[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:50.581[inf][anning_a_star/local_planner.py] changed state state=path_following
16:38:50.582[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:38:50.582[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:38:50.582[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:38:50.582[inf][anning_a_star/local_planner.py] changed state state=arrived
16:38:50.690[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:50.690[inf][nning_a_star/global_planner.py] Arrived at goal.
16:38:50.691[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
16:38:50.700[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
▸ 16:38:50.771[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:38:50.772[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
16:38:50.809[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.915, -1.114, 0.076] odom_goal_yaw_deg=-0.0 world_goal=[0.292, -1.568, -10.206] world_goal_yaw_deg=59.04
16:38:50.845[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.915, -1.114, 0.076], euler=[90.0, 0.0, -42.6])
16:38:50.845[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:50.927[inf][nning_a_star/global_planner.py] Found safe goal. x=7.88 y=-1.12
16:38:50.935[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:50.937[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:38:50.951[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=7
16:38:51.013[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.985, -1.186, 0.092] odom_goal_yaw_deg=0.0 world_goal=[0.351, -1.552, -10.294] world_goal_yaw_deg=55.37
16:38:51.194[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.985, -1.186, 0.092], euler=[90.0, 0.0, -46.3])
16:38:51.195[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:51.196[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:51.196[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:51.197[inf][nning_a_star/global_planner.py] Found safe goal. x=7.88 y=-1.12
16:38:51.205[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:51.217[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:38:51.217[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.136, -1.314, 0.11] odom_goal_yaw_deg=0.0 world_goal=[0.453, -1.534, -10.48] world_goal_yaw_deg=61.99
16:38:51.313[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.136, -1.314, 0.110], euler=[90.0, 0.0, -39.6])
16:38:51.313[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:51.314[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:51.314[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:51.321[war][nning_a_star/global_planner.py] Travelling to goal 0.27593636169577346m away from requested goal.
16:38:51.321[inf][nning_a_star/global_planner.py] Found safe goal. x=7.93 y=-1.17
16:38:51.336[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:51.367[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:38:51.747[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:38:51.749[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:38:51.869[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=171031 seq=2
16:38:51.899[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874331.589656 frame_age_s=0.1171 latest_residual_m=0.0253 observations_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=1 residual_along_camera_ray_m=-0.0244 residual_along_track_m=-0.0075 residual_cross_track_m=0.0123 residual_vertical_m=0.0208 robot_speed_ms=0.063 seq=2 source_ts_gap_s=0.031356 total_rejections=1 window_centroid_residual_m=0.0955
16:38:52.056[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:38:52.058[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.192, -1.389, 0.109] odom_goal_yaw_deg=-0.0 world_goal=[0.519, -1.535, -10.554] world_goal_yaw_deg=43.73
16:38:52.064[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.192, -1.389, 0.109], euler=[90.0, 0.0, -57.9])
16:38:52.064[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:52.065[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:52.065[inf][nning_a_star/global_planner.py] Found safe goal. x=8.18 y=-1.42
16:38:52.066[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:52.124[war][nning_a_star/global_planner.py] No path found to the goal. x=8.175 y=-1.425
16:38:52.125[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:38:52.126[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:38:52.127[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=0.2
16:38:53.834[inf][imos/ar/world_frame/aligner.py] alignment_update alpha_scale=1.0 alpha_yaw=1.0 baseline_m=7.5855 confidence=0.8837 max_pair_skew_s=0.1104 mean_ambiguity_ratio=11.4789 method=similarity n_obs=21 n_rejected=3 resid_rms_m=0.0081 s=1.0536 scale_held=False scale_observable=True yaw_deg=99.37 yaw_held=False yaw_observable=True
16:38:53.835[inf][imos/ar/world_frame/aligner.py] refinement_episode_complete baseline_m=7.586 marker_jump_m=0.11 observation_count=21 solve_quality=0.925 trans_delta_m=0.324 yaw_delta_deg=2.26
16:38:53.835[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=2 dropped_fifo=0 fifo_depth=0
16:38:54.470[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:38:54.471[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=854.466058
16:38:54.472[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.458, -0.816, -0.015] odom_goal_yaw_deg=-0.0 world_goal=[0.088, -1.673, -9.677] world_goal_yaw_deg=116.94
16:38:54.628[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.458, -0.816, -0.015], euler=[90.0, 0.0, 17.6])
16:38:54.629[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:54.629[inf][nning_a_star/global_planner.py] Found safe goal. x=7.43 y=-0.82
16:38:54.638[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:54.641[inf][anning_a_star/local_planner.py] changed state state=path_following
16:38:54.641[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:38:54.642[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:38:54.642[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:38:54.642[inf][anning_a_star/local_planner.py] changed state state=arrived
16:38:54.694[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.056
16:38:54.698[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
16:38:54.747[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:54.748[inf][nning_a_star/global_planner.py] Arrived at goal.
16:38:54.748[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:38:54.749[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:38:54.749[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.329
16:38:55.009[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.778, -0.653, 0.034] odom_goal_yaw_deg=-0.0 world_goal=[-0.136, -1.623, -9.981] world_goal_yaw_deg=113.55
16:38:55.158[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.021, -0.757, 0.117] odom_goal_yaw_deg=0.0 world_goal=[-0.07, -1.54, -10.251] world_goal_yaw_deg=73.7
16:38:55.192[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.778, -0.653, 0.034], euler=[90.0, 0.0, 14.2])
16:38:55.194[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:55.195[inf][nning_a_star/global_planner.py] Found safe goal. x=7.78 y=-0.67
16:38:55.205[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:55.206[inf][anning_a_star/local_planner.py] changed state state=path_following
16:38:55.329[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.021, -0.757, 0.117], euler=[90.0, 0.0, -25.7])
16:38:55.330[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:55.331[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:55.331[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:55.332[inf][nning_a_star/global_planner.py] Found safe goal. x=7.98 y=-0.77
16:38:55.333[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=5
16:38:55.347[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:55.407[inf][anning_a_star/local_planner.py] changed state state=path_following
16:38:55.622[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:38:55.623[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.2, -0.82, 0.137] odom_goal_yaw_deg=0.0 world_goal=[-0.035, -1.52, -10.448] world_goal_yaw_deg=83.04
16:38:55.845[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.200, -0.820, 0.137], euler=[90.0, 0.0, -16.3])
16:38:55.845[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:55.846[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:55.846[inf][nning_a_star/global_planner.py] Found safe goal. x=8.18 y=-0.77
16:38:55.846[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:55.873[war][nning_a_star/global_planner.py] No path found to the goal. x=8.175 y=-0.775
16:38:55.873[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:38:55.999[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:38:55.999[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=0.3
16:38:56.250[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:38:56.251[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:38:56.252[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.225, -0.848, 0.137] odom_goal_yaw_deg=-0.0 world_goal=[-0.011, -1.52, -10.479] world_goal_yaw_deg=78.67
16:38:56.496[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=164992 seq=2
16:38:56.505[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.225, -0.848, 0.137], euler=[90.0, 0.0, -20.7])
16:38:56.505[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:56.506[inf][nning_a_star/global_planner.py] Found safe goal. x=8.18 y=-0.87
16:38:56.523[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:56.532[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:38:56.543[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874336.12291 frame_age_s=0.1114 latest_residual_m=0.0436 observations_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.0388 residual_along_track_m=0.0187 residual_cross_track_m=0.0257 residual_vertical_m=-0.0298 robot_speed_ms=0.02 seq=2 source_ts_gap_s=0.009964 total_rejections=0 window_centroid_residual_m=0.0775
16:38:56.547[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=856.541544
16:38:56.547[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.237, -1.055, 0.132] odom_goal_yaw_deg=0.0 world_goal=[0.202, -1.526, -10.527] world_goal_yaw_deg=27.0
16:38:56.594[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.237, -1.055, 0.132], euler=[90.0, 0.0, -72.4])
16:38:56.595[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:56.595[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:56.596[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:56.597[inf][nning_a_star/global_planner.py] Found safe goal. x=8.23 y=-1.07
16:38:56.600[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=11
16:38:56.640[war][nning_a_star/global_planner.py] No path found to the goal. x=8.225 y=-1.075
16:38:56.641[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:38:56.642[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:38:56.862[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:38:56.863[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.165, -1.317, 0.122] odom_goal_yaw_deg=-180.0 world_goal=[0.487, -1.535, -10.497] world_goal_yaw_deg=-2.56
16:38:57.100[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.165, -1.317, 0.122], euler=[90.0, 0.0, -101.9])
16:38:57.100[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:57.100[inf][nning_a_star/global_planner.py] Found safe goal. x=8.13 y=-1.32
16:38:57.142[war][nning_a_star/global_planner.py] No path found to the goal. x=8.125 y=-1.325
16:38:57.142[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:38:57.197[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:38:57.197[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=1.7
16:38:57.224[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.077, -1.526, 0.112] odom_goal_yaw_deg=-180.0 world_goal=[0.72, -1.545, -10.442] world_goal_yaw_deg=-30.23
16:38:57.225[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.077, -1.526, 0.112], euler=[90.0, -0.0, -129.6])
16:38:57.225[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:57.230[war][nning_a_star/global_planner.py] Travelling to goal 0.32242542205366415m away from requested goal.
16:38:57.231[inf][nning_a_star/global_planner.py] Found safe goal. x=8.38 y=-1.47
16:38:57.258[war][nning_a_star/global_planner.py] No path found to the goal. x=8.375 y=-1.475
16:38:57.259[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:38:57.319[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:38:57.338[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.084, -1.596, 0.107] odom_goal_yaw_deg=-180.0 world_goal=[0.791, -1.55, -10.461] world_goal_yaw_deg=-13.99
16:38:57.338[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.084, -1.596, 0.107], euler=[90.0, 0.0, -113.4])
16:38:57.338[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:57.343[war][nning_a_star/global_planner.py] Travelling to goal 0.3330812739954088m away from requested goal.
16:38:57.343[inf][nning_a_star/global_planner.py] Found safe goal. x=8.38 y=-1.47
16:38:57.387[war][nning_a_star/global_planner.py] No path found to the goal. x=8.375 y=-1.475
16:38:57.387[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:38:57.407[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:38:57.523[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.166, -1.719, 0.105] odom_goal_yaw_deg=0.0 world_goal=[0.905, -1.553, -10.568] world_goal_yaw_deg=32.02
16:38:57.524[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.141, -1.681, 0.104] odom_goal_yaw_deg=0.0 world_goal=[0.87, -1.553, -10.535] world_goal_yaw_deg=23.97
16:38:57.673[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.166, -1.719, 0.105], euler=[90.0, 0.0, -67.3])
16:38:57.674[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:57.676[war][nning_a_star/global_planner.py] Travelling to goal 0.3373576027206133m away from requested goal.
16:38:57.676[inf][nning_a_star/global_planner.py] Found safe goal. x=8.38 y=-1.47
16:38:57.717[war][nning_a_star/global_planner.py] No path found to the goal. x=8.375 y=-1.475
16:38:57.718[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:38:57.718[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.141, -1.681, 0.104], euler=[90.0, 0.0, -75.4])
16:38:57.718[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:57.723[war][nning_a_star/global_planner.py] Travelling to goal 0.391791444303058m away from requested goal.
16:38:57.723[inf][nning_a_star/global_planner.py] Found safe goal. x=7.83 y=-1.47
16:38:57.736[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:38:57.737[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:38:57.749[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:38:57.754[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:38:57.863[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:38:57.864[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.239, -1.858, 0.103] odom_goal_yaw_deg=0.0 world_goal=[1.037, -1.554, -10.667] world_goal_yaw_deg=35.81
16:38:57.864[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.239, -1.858, 0.103], euler=[90.0, 0.0, -63.6])
16:38:57.865[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:38:57.865[inf][anning_a_star/local_planner.py] changed state state=idle
16:38:57.868[war][nning_a_star/global_planner.py] Travelling to goal 0.3831011657150581m away from requested goal.
16:38:57.868[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:38:57.874[inf][nning_a_star/global_planner.py] Found safe goal. x=8.48 y=-1.57
16:38:57.910[war][nning_a_star/global_planner.py] No path found to the goal. x=8.475 y=-1.575
16:38:57.911[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:38:57.912[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:38:58.770[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=153196 seq=9
16:38:58.796[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874338.389544 frame_age_s=0.1252 latest_residual_m=0.03 observations_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.0234 residual_along_track_m=0.0175 residual_cross_track_m=0.0173 residual_vertical_m=-0.0172 robot_speed_ms=0.001 seq=9 source_ts_gap_s=0.058571 total_rejections=0 window_centroid_residual_m=0.0748
16:39:00.388[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
16:39:00.971[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=173224 seq=15
16:39:01.013[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874340.722803 frame_age_s=0.1476 latest_residual_m=0.0557 observations_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0547 residual_along_track_m=0.0001 residual_cross_track_m=0.011 residual_vertical_m=0.0546 robot_speed_ms=0.0 seq=15 source_ts_gap_s=0.022968 total_rejections=0 window_centroid_residual_m=0.061
16:39:02.752[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:39:02.753[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=862.748117
16:39:02.754[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.458, -0.828, -0.031] odom_goal_yaw_deg=-0.0 world_goal=[0.1, -1.688, -9.679] world_goal_yaw_deg=106.88
16:39:02.967[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.458, -0.828, -0.031], euler=[90.0, 0.0, 7.5])
16:39:02.968[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:39:02.969[inf][nning_a_star/global_planner.py] Found safe goal. x=7.43 y=-0.87
16:39:02.976[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:39:02.976[inf][anning_a_star/local_planner.py] changed state state=path_following
16:39:02.976[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:39:02.977[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:39:02.977[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:39:02.977[inf][anning_a_star/local_planner.py] changed state state=arrived
16:39:02.998[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=165456 seq=22
16:39:03.032[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874342.756105 frame_age_s=0.1191 latest_residual_m=0.0618 observations_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0601 residual_along_track_m=-0.0046 residual_cross_track_m=0.0113 residual_vertical_m=0.0605 robot_speed_ms=0.0 seq=22 source_ts_gap_s=0.057093 total_rejections=0 window_centroid_residual_m=0.0491
16:39:03.034[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.408, -1.252, 0.019] odom_goal_yaw_deg=0.0 world_goal=[0.55, -1.638, -9.7] world_goal_yaw_deg=21.29
16:39:03.083[inf][anning_a_star/local_planner.py] changed state state=idle
16:39:03.084[inf][nning_a_star/global_planner.py] Arrived at goal.
16:39:03.084[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
16:39:03.110[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.142
16:39:03.112[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
16:39:03.116[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.408, -1.252, 0.019], euler=[90.0, 0.0, -78.1])
16:39:03.117[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:39:03.140[inf][nning_a_star/global_planner.py] Found safe goal. x=7.38 y=-1.27
16:39:03.148[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:39:03.149[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
▸ 16:39:03.187[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:39:03.188[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.285
16:39:03.463[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.511, -1.437, 0.019] odom_goal_yaw_deg=0.0 world_goal=[0.724, -1.638, -9.838] world_goal_yaw_deg=42.46
16:39:03.534[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.511, -1.437, 0.019], euler=[90.0, 0.0, -56.9])
16:39:03.534[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:39:03.535[inf][anning_a_star/local_planner.py] changed state state=idle
16:39:03.536[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:39:03.536[inf][nning_a_star/global_planner.py] Found safe goal. x=7.48 y=-1.47
16:39:03.548[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:39:03.550[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:39:03.600[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=10
16:39:05.414[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=155427 seq=28
16:39:05.461[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874344.922759 frame_age_s=0.116 latest_residual_m=0.0962 observations_added=1 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0692 residual_along_track_m=-0.0614 residual_cross_track_m=0.0411 residual_vertical_m=0.0616 robot_speed_ms=0.253 seq=28 source_ts_gap_s=0.006834 total_rejections=0 window_centroid_residual_m=0.1869
16:39:06.101[inf][anning_a_star/local_planner.py] changed state state=path_following
16:39:07.428[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
16:39:07.721[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=197189 seq=35
16:39:07.743[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874347.455901 frame_age_s=0.0973 latest_residual_m=0.4928 observations_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.036 residual_along_track_m=-0.4458 residual_cross_track_m=0.2093 residual_vertical_m=0.0166 robot_speed_ms=0.693 seq=35 source_ts_gap_s=0.014945 total_rejections=0 window_centroid_residual_m=0.263
16:39:09.811[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:39:09.812[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:39:09.812[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:39:09.812[inf][anning_a_star/local_planner.py] changed state state=arrived
16:39:09.919[inf][anning_a_star/local_planner.py] changed state state=idle
16:39:09.919[inf][nning_a_star/global_planner.py] Arrived at goal.
16:39:09.920[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
16:39:10.123[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.204
▸ 16:39:10.125[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:39:10.125[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.311
16:39:13.958[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:39:13.959[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:39:14.213[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=170409 seq=40
16:39:14.248[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874350.589255 frame_age_s=3.3626 latest_residual_m=0.2293 observations_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0858 residual_along_track_m=-0.2276 residual_cross_track_m=0.0249 residual_vertical_m=0.0111 robot_speed_ms=0.0 seq=40 source_ts_gap_s=0.052492 total_rejections=0 window_centroid_residual_m=0.5223
16:39:14.662[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
16:39:15.880[deb][r/dimos/ar/bridge/telemetry.py] LiDAR payload bytes=767 hz=1.0 points=127
16:39:16.445[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=166470 seq=49
16:39:16.477[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874356.222472 frame_age_s=0.1101 latest_residual_m=0.0358 observations_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0044 residual_along_track_m=-0.008 residual_cross_track_m=0.0322 residual_vertical_m=0.0134 robot_speed_ms=0.0 seq=49 source_ts_gap_s=0.015711 total_rejections=0 window_centroid_residual_m=0.4976
16:39:17.233[inf][imos/ar/world_frame/aligner.py] alignment_update alpha_scale=1.0 alpha_yaw=1.0 baseline_m=7.5225 confidence=0.8737 max_pair_skew_s=0.1019 mean_ambiguity_ratio=1.6419 method=similarity n_obs=15 n_rejected=1 resid_rms_m=0.0139 s=1.091 scale_held=False scale_observable=True yaw_deg=97.38 yaw_held=False yaw_observable=True
16:39:17.234[inf][imos/ar/world_frame/aligner.py] refinement_episode_complete baseline_m=7.523 marker_jump_m=0.314 observation_count=15 solve_quality=0.941 trans_delta_m=0.421 yaw_delta_deg=1.98
16:39:17.404[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:39:17.405[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=877.399951
16:39:17.406[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.398, -1.313, -0.034] odom_goal_yaw_deg=-0.0 world_goal=[0.613, -1.68, -9.667] world_goal_yaw_deg=34.68
16:39:17.476[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.398, -1.313, -0.034], euler=[90.0, 0.0, -62.7])
16:39:17.477[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:39:17.478[inf][nning_a_star/global_planner.py] Found safe goal. x=7.38 y=-1.32
16:39:17.478[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.001
16:39:17.485[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:39:17.486[inf][anning_a_star/local_planner.py] changed state state=path_following
16:39:17.487[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:39:17.487[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:39:17.487[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
16:39:17.487[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:39:17.487[inf][anning_a_star/local_planner.py] changed state state=arrived
16:39:17.593[inf][anning_a_star/local_planner.py] changed state state=idle
16:39:17.594[inf][nning_a_star/global_planner.py] Arrived at goal.
16:39:17.594[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:39:17.595[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:39:17.596[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.336
16:39:17.781[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.657, -1.346, 0.021] odom_goal_yaw_deg=-0.0 world_goal=[0.611, -1.625, -9.951] world_goal_yaw_deg=78.33
16:39:17.969[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.657, -1.346, 0.021], euler=[90.0, 0.0, -19.1])
16:39:17.969[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:39:17.970[inf][nning_a_star/global_planner.py] Found safe goal. x=7.63 y=-1.37
16:39:17.977[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:39:17.982[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:39:18.043[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.83, -1.515, 0.065] odom_goal_yaw_deg=0.0 world_goal=[0.77, -1.581, -10.163] world_goal_yaw_deg=55.45
16:39:18.060[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=5
16:39:18.138[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.830, -1.515, 0.065], euler=[90.0, 0.0, -41.9])
16:39:18.140[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:39:18.140[inf][anning_a_star/local_planner.py] changed state state=idle
16:39:18.141[inf][nning_a_star/global_planner.py] Found safe goal. x=7.83 y=-1.47
16:39:18.141[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:39:18.149[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:39:18.151[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:39:18.397[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.012, -1.706, 0.107] odom_goal_yaw_deg=-0.0 world_goal=[0.951, -1.539, -10.386] world_goal_yaw_deg=49.14
16:39:18.542[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.012, -1.706, 0.107], euler=[90.0, 0.0, -48.2])
16:39:18.543[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:39:18.544[inf][anning_a_star/local_planner.py] changed state state=idle
16:39:18.544[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:39:18.547[war][nning_a_star/global_planner.py] Travelling to goal 0.3166118796554985m away from requested goal.
16:39:18.547[inf][nning_a_star/global_planner.py] Found safe goal. x=7.78 y=-1.52
16:39:18.554[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:39:18.573[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:39:18.897[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:39:18.897[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:39:18.898[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.126, -1.852, 0.099] odom_goal_yaw_deg=-0.0 world_goal=[1.094, -1.547, -10.531] world_goal_yaw_deg=48.69
16:39:18.898[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.126, -1.852, 0.099], euler=[90.0, -0.0, -48.7])
16:39:18.898[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:39:18.898[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:39:18.899[inf][anning_a_star/local_planner.py] changed state state=idle
16:39:18.902[war][nning_a_star/global_planner.py] Travelling to goal 0.49045023448230707m away from requested goal.
16:39:18.902[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:39:18.902[inf][nning_a_star/global_planner.py] Found safe goal. x=7.78 y=-1.52
16:39:18.909[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:39:18.911[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:39:19.101[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=160190 seq=2
16:39:19.137[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874358.755776 frame_age_s=0.1246 latest_residual_m=0.0215 observations_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.002 residual_along_track_m=0.0143 residual_cross_track_m=0.0152 residual_vertical_m=0.0053 robot_speed_ms=0.031 seq=2 source_ts_gap_s=0.032326 total_rejections=0 window_centroid_residual_m=0.4722
16:39:19.139[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[8.15, -1.879, 0.093] odom_goal_yaw_deg=-0.0 world_goal=[1.119, -1.553, -10.56] world_goal_yaw_deg=51.03
16:39:19.229[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[8.150, -1.879, 0.093], euler=[90.0, 0.0, -46.4])
16:39:19.229[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:39:19.229[inf][anning_a_star/local_planner.py] changed state state=idle
16:39:19.232[war][nning_a_star/global_planner.py] Travelling to goal 0.4368463685920724m away from requested goal.
16:39:19.233[inf][nning_a_star/global_planner.py] Found safe goal. x=8.53 y=-1.67
16:39:19.233[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:39:19.247[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:39:19.250[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:39:20.396[inf][anning_a_star/local_planner.py] changed state state=path_following
16:39:21.135[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=175418 seq=9
16:39:21.161[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874360.855695 frame_age_s=0.0963 latest_residual_m=0.0164 observations_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0063 residual_along_track_m=0.0118 residual_cross_track_m=0.0087 residual_vertical_m=0.0074 robot_speed_ms=0.064 seq=9 source_ts_gap_s=0.059817 total_rejections=0 window_centroid_residual_m=0.3967
16:39:22.137[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:39:22.138[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:39:22.606[inf][anning_a_star/local_planner.py] Obstacle detected ahead, stopping local planner.
16:39:22.607[inf][anning_a_star/local_planner.py] changed state state=idle
16:39:22.607[inf][nning_a_star/global_planner.py] Replanning path due to obstacle found.
16:39:22.608[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.001
16:39:22.608[inf][nning_a_star/global_planner.py] Replanning. attempt=0
16:39:22.608[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:39:22.613[war][nning_a_star/global_planner.py] Travelling to goal 0.37142846406321983m away from requested goal.
16:39:22.614[inf][nning_a_star/global_planner.py] Found safe goal. x=8.48 y=-1.72
16:39:22.626[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:39:22.628[inf][anning_a_star/local_planner.py] changed state state=path_following
16:39:25.287[inf][anning_a_star/local_planner.py] Obstacle detected ahead, stopping local planner.
16:39:25.288[inf][anning_a_star/local_planner.py] changed state state=idle
16:39:25.288[inf][nning_a_star/global_planner.py] Replanning path due to obstacle found.
16:39:25.289[inf][nning_a_star/global_planner.py] Replanning. attempt=1
16:39:25.289[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:39:25.294[war][nning_a_star/global_planner.py] Travelling to goal 0.48923648097255673m away from requested goal.
16:39:25.294[inf][nning_a_star/global_planner.py] Found safe goal. x=7.83 y=-1.52
16:39:25.328[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:39:25.329[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:39:25.342[war][nning_a_star/global_planner.py] No path found to the goal. x=7.825 y=-1.525
16:39:25.343[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:39:25.347[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=180087 seq=12
16:39:25.377[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:39:25.377[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=0.2
16:39:25.378[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=emergency_stop publish_mono=885.372403
16:39:25.385[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874362.488987 frame_age_s=2.6982 latest_residual_m=0.0286 observations_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0135 residual_along_track_m=-0.0028 residual_cross_track_m=0.0154 residual_vertical_m=0.0239 robot_speed_ms=0.046 seq=12 source_ts_gap_s=0.025361 total_rejections=0 window_centroid_residual_m=0.3922
16:39:25.386[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
16:39:27.359[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=191720 seq=19
16:39:27.394[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874366.855542 frame_age_s=0.0859 latest_residual_m=0.0272 observations_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.0144 residual_along_track_m=-0.0245 residual_cross_track_m=0.0061 residual_vertical_m=-0.0099 robot_speed_ms=0.001 seq=19 source_ts_gap_s=0.072845 total_rejections=0 window_centroid_residual_m=0.3267
16:39:27.862[inf][imos/ar/world_frame/aligner.py] alignment_update alpha_scale=1.0 alpha_yaw=1.0 baseline_m=7.615 confidence=0.8441 max_pair_skew_s=0.0899 mean_ambiguity_ratio=1.9125 method=similarity n_obs=12 n_rejected=1 resid_rms_m=0.0185 s=1.0339 scale_held=False scale_observable=True yaw_deg=99.58 yaw_held=False yaw_observable=True
16:39:27.863[inf][imos/ar/world_frame/aligner.py] refinement_episode_complete baseline_m=7.615 marker_jump_m=0.424 observation_count=12 solve_quality=0.932 trans_delta_m=0.531 yaw_delta_deg=2.2
16:39:29.724[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:39:29.725[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=889.71989
16:39:29.726[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.479, -1.237, -0.018] odom_goal_yaw_deg=-0.0 world_goal=[0.531, -1.674, -9.733] world_goal_yaw_deg=89.57
16:39:29.849[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.479, -1.237, -0.018], euler=[90.0, 0.0, -10.0])
16:39:29.850[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:39:29.850[inf][nning_a_star/global_planner.py] Found safe goal. x=7.48 y=-1.27
16:39:29.859[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:39:29.860[inf][anning_a_star/local_planner.py] changed state state=path_following
16:39:29.860[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:39:29.860[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:39:29.860[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:39:29.861[inf][anning_a_star/local_planner.py] changed state state=arrived
16:39:29.931[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.072
16:39:29.932[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
16:39:29.966[inf][anning_a_star/local_planner.py] changed state state=idle
16:39:29.966[inf][nning_a_star/global_planner.py] Arrived at goal.
16:39:29.967[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:39:29.993[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:39:29.993[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
16:39:30.028[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[7.039, -1.095, 0.066] odom_goal_yaw_deg=-180.0 world_goal=[0.461, -1.59, -9.261] world_goal_yaw_deg=-103.36
16:39:30.051[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[7.039, -1.095, 0.066], euler=[90.0, 0.0, 157.1])
16:39:30.051[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:39:30.053[inf][nning_a_star/global_planner.py] Found safe goal. x=7.03 y=-1.12
16:39:30.063[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:39:30.065[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:39:30.234[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[6.946, -1.078, 0.106] odom_goal_yaw_deg=180.0 world_goal=[0.46, -1.55, -9.163] world_goal_yaw_deg=-98.0
16:39:30.249[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=6
16:39:30.417[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[6.946, -1.078, 0.106], euler=[90.0, 0.0, 162.4])
16:39:30.417[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:39:30.417[inf][anning_a_star/local_planner.py] changed state state=idle
16:39:30.418[inf][nning_a_star/global_planner.py] Found safe goal. x=6.93 y=-1.12
16:39:30.418[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:39:30.425[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:39:30.432[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:39:30.489[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[6.558, -1.017, 0.094] odom_goal_yaw_deg=-180.0 world_goal=[0.464, -1.562, -8.756] world_goal_yaw_deg=-90.36
16:39:30.582[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[6.558, -1.017, 0.094], euler=[90.0, 0.0, 170.1])
16:39:30.583[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:39:30.583[inf][anning_a_star/local_planner.py] changed state state=idle
16:39:30.583[inf][nning_a_star/global_planner.py] Found safe goal. x=6.53 y=-1.02
16:39:30.584[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:39:30.594[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:39:30.597[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:39:30.793[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:39:30.794[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[6.181, -0.939, 0.066] odom_goal_yaw_deg=-180.0 world_goal=[0.45, -1.59, -8.359] world_goal_yaw_deg=-88.06
16:39:30.978[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[6.181, -0.939, 0.066], euler=[90.0, 0.0, 172.4])
16:39:30.979[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:39:30.979[inf][anning_a_star/local_planner.py] changed state state=idle
16:39:30.979[inf][nning_a_star/global_planner.py] Found safe goal. x=6.18 y=-0.97
16:39:30.980[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:39:30.991[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:39:30.993[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:39:31.478[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.991, -0.986, 0.059] odom_goal_yaw_deg=180.0 world_goal=[0.531, -1.597, -8.173] world_goal_yaw_deg=-74.41
16:39:31.604[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.991, -0.986, 0.059], euler=[90.0, 0.0, -174.0])
16:39:31.604[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:39:31.605[inf][anning_a_star/local_planner.py] changed state state=idle
16:39:31.605[inf][nning_a_star/global_planner.py] Found safe goal. x=5.98 y=-1.02
16:39:31.606[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:39:31.637[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:39:31.641[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:39:31.757[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=891.751571
16:39:31.758[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.957, -1.002, 0.059], euler=[90.0, 0.0, -160.5])
16:39:31.758[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:39:31.758[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.957, -1.002, 0.059] odom_goal_yaw_deg=-180.0 world_goal=[0.553, -1.597, -8.142] world_goal_yaw_deg=-60.95
16:39:31.758[inf][anning_a_star/local_planner.py] changed state state=idle
16:39:31.759[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:39:31.760[inf][nning_a_star/global_planner.py] Found safe goal. x=5.93 y=-1.02
16:39:31.787[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:39:31.791[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:39:34.020[inf][anning_a_star/local_planner.py] changed state state=path_following
16:39:37.846[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:39:37.846[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:39:38.169[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:39:38.169[inf][anning_a_star/local_planner.py] changed state state=arrived
16:39:38.274[inf][anning_a_star/local_planner.py] changed state state=idle
16:39:38.274[inf][nning_a_star/global_planner.py] Arrived at goal.
16:39:38.274[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
16:39:38.320[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.046
▸ 16:39:38.321[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:39:38.321[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.251
16:39:40.060[inf][ar/network/websocket_server.py] AR inbound text message type=set_lidar_mode
16:39:40.061[inf][r/dimos/ar/bridge/telemetry.py] LiDAR mode updated mode=full obstacle_max_distance_m=0.8 obstacle_min_distance_m=0.1 obstacle_opaque_distance_m=0.5
16:39:41.221[inf][ar/network/websocket_server.py] AR inbound text message type=set_lidar_mode
16:39:41.221[inf][r/dimos/ar/bridge/telemetry.py] LiDAR mode updated mode=off obstacle_max_distance_m=0.8 obstacle_min_distance_m=0.1 obstacle_opaque_distance_m=0.5
16:39:43.324[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:39:43.326[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=903.3204
16:39:43.327[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.913, -0.915, -0.02] odom_goal_yaw_deg=-180.0 world_goal=[0.471, -1.676, -8.082] world_goal_yaw_deg=-51.42
16:39:43.400[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.913, -0.915, -0.020], euler=[90.0, 0.0, -151.0])
16:39:43.400[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:39:43.401[inf][nning_a_star/global_planner.py] Found safe goal. x=5.88 y=-0.92
16:39:43.407[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:39:43.408[inf][anning_a_star/local_planner.py] changed state state=path_following
16:39:43.409[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:39:43.409[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:39:43.410[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:39:43.410[inf][anning_a_star/local_planner.py] changed state state=arrived
16:39:43.442[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.034
16:39:43.443[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
16:39:43.509[inf][anning_a_star/local_planner.py] changed state state=idle
16:39:43.510[inf][nning_a_star/global_planner.py] Arrived at goal.
16:39:43.511[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:39:43.546[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:39:43.547[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
16:39:43.666[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.353, -1.313, 0.041] odom_goal_yaw_deg=-180.0 world_goal=[0.973, -1.615, -7.58] world_goal_yaw_deg=-46.91
16:39:43.873[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.353, -1.313, 0.041], euler=[90.0, 0.0, -146.5])
16:39:43.873[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:39:43.874[inf][nning_a_star/global_planner.py] Found safe goal. x=5.33 y=-1.32
16:39:43.882[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:39:43.884[inf][anning_a_star/local_planner.py] changed state state=path_following
16:39:43.995[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.005, -1.648, 0.042] odom_goal_yaw_deg=-180.0 world_goal=[1.375, -1.614, -7.282] world_goal_yaw_deg=-36.43
16:39:44.074[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=9
16:39:44.148[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.005, -1.648, 0.042], euler=[90.0, 0.0, -136.0])
16:39:44.149[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:39:44.149[inf][anning_a_star/local_planner.py] changed state state=idle
16:39:44.150[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:39:44.150[inf][nning_a_star/global_planner.py] Found safe goal. x=4.98 y=-1.67
16:39:44.163[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:39:44.210[inf][anning_a_star/local_planner.py] changed state state=path_following
16:39:44.375[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:39:44.377[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.459, -2.225, 0.033] odom_goal_yaw_deg=-180.0 world_goal=[2.058, -1.622, -6.825] world_goal_yaw_deg=-34.12
16:39:44.624[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.459, -2.225, 0.033], euler=[90.0, 0.0, -133.7])
16:39:44.625[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:39:44.625[inf][anning_a_star/local_planner.py] changed state state=idle
16:39:44.625[inf][nning_a_star/global_planner.py] Found safe goal. x=4.43 y=-2.27
16:39:44.626[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:39:44.632[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.818, -2.849, -0.005] odom_goal_yaw_deg=-180.0 world_goal=[2.804, -1.661, -6.279] world_goal_yaw_deg=-36.71
16:39:44.641[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:39:44.683[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:39:44.800[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.818, -2.849, -0.005], euler=[90.0, 0.0, -136.3])
16:39:44.800[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:39:44.801[inf][anning_a_star/local_planner.py] changed state state=idle
16:39:44.801[inf][nning_a_star/global_planner.py] Found safe goal. x=3.77 y=-2.87
16:39:44.802[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:39:44.837[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:39:44.841[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:39:44.982[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.319, -3.303, -0.022], euler=[90.0, 0.0, -137.8])
16:39:44.982[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:39:44.982[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.319, -3.303, -0.022] odom_goal_yaw_deg=-180.0 world_goal=[3.352, -1.678, -5.848] world_goal_yaw_deg=-38.25
16:39:44.982[inf][anning_a_star/local_planner.py] changed state state=idle
16:39:44.983[inf][nning_a_star/global_planner.py] Found safe goal. x=3.27 y=-3.32
16:39:44.983[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:39:45.004[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:39:45.013[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:39:45.947[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:39:45.950[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=905.943955
16:39:45.951[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.141, -3.459, -0.021] odom_goal_yaw_deg=-180.0 world_goal=[3.543, -1.676, -5.693] world_goal_yaw_deg=-40.74
16:39:46.124[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.141, -3.459, -0.021], euler=[90.0, 0.0, -140.3])
16:39:46.125[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:39:46.126[inf][anning_a_star/local_planner.py] changed state state=idle
16:39:46.126[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:39:46.126[inf][nning_a_star/global_planner.py] Found safe goal. x=3.12 y=-3.47
16:39:46.174[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:39:46.190[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:39:47.043[inf][anning_a_star/local_planner.py] changed state state=path_following
16:39:47.945[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:39:47.946[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.353, -3.455, -0.006] odom_goal_yaw_deg=-0.0 world_goal=[3.502, -1.661, -5.909] world_goal_yaw_deg=63.18
16:39:48.031[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.353, -3.455, -0.006], euler=[90.0, 0.0, -36.4])
16:39:48.031[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:39:48.032[inf][anning_a_star/local_planner.py] changed state state=idle
16:39:48.032[inf][nning_a_star/global_planner.py] Found safe goal. x=3.32 y=-3.47
16:39:48.032[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:39:48.068[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:39:48.085[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:39:48.195[inf][anning_a_star/local_planner.py] changed state state=path_following
16:39:48.298[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=908.29258
16:39:48.299[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.12, -3.507, -0.004] odom_goal_yaw_deg=180.0 world_goal=[3.595, -1.66, -5.681] world_goal_yaw_deg=-82.42
16:39:48.535[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.120, -3.507, -0.004], euler=[90.0, 0.0, 178.0])
16:39:48.535[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:39:48.535[inf][anning_a_star/local_planner.py] changed state state=idle
16:39:48.536[inf][nning_a_star/global_planner.py] Found safe goal. x=3.07 y=-3.52
16:39:48.537[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:39:48.558[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:39:48.564[inf][anning_a_star/local_planner.py] changed state state=path_following
16:39:48.687[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.151
16:39:49.941[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:39:49.942[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.101, -3.591, -0.002] odom_goal_yaw_deg=180.0 world_goal=[3.684, -1.657, -5.676] world_goal_yaw_deg=-3.01
16:39:49.968[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.101, -3.591, -0.002], euler=[90.0, 0.0, -102.6])
16:39:49.968[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:39:49.968[inf][anning_a_star/local_planner.py] changed state state=idle
16:39:49.969[inf][nning_a_star/global_planner.py] Found safe goal. x=3.07 y=-3.62
16:39:49.969[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:39:49.993[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:39:49.998[inf][anning_a_star/local_planner.py] changed state state=path_following
16:39:58.062[war][imos/ar/navigation/navigate.py] AR navigation goal stalled stall_reason=no_path
16:39:58.063[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=0.0
16:39:58.063[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=cancel_nav_goal publish_mono=918.057695
16:39:58.244[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:39:58.245[inf][anning_a_star/local_planner.py] changed state state=idle
16:39:58.245[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:39:58.335[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.09
16:40:04.330[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:40:04.330[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:40:04.517[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=143053 seq=2
16:40:04.554[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874404.221502 frame_age_s=0.1097 latest_residual_m=5.1404 observations_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=4.974 residual_along_track_m=-4.5866 residual_cross_track_m=2.3197 residual_vertical_m=0.0781 robot_speed_ms=0.0 seq=2 source_ts_gap_s=0.040255 total_rejections=0 window_centroid_residual_m=5.2881
16:40:04.557[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
16:40:06.925[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=160293 seq=9
16:40:06.946[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874406.454777 frame_age_s=0.0734 latest_residual_m=5.1404 observations_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=5.0296 residual_along_track_m=-4.5869 residual_cross_track_m=2.319 residual_vertical_m=0.0781 robot_speed_ms=0.0 seq=9 source_ts_gap_s=0.00806 total_rejections=0 window_centroid_residual_m=5.2881
16:40:08.140[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:40:08.143[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=928.136826
16:40:08.143[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.922, -3.669, 0.026] odom_goal_yaw_deg=-180.0 world_goal=[3.794, -1.629, -5.507] world_goal_yaw_deg=-41.79
16:40:08.175[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.922, -3.669, 0.026], euler=[90.0, 0.0, -141.4])
16:40:08.176[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:40:08.177[inf][nning_a_star/global_planner.py] Found safe goal. x=2.87 y=-3.67
16:40:08.178[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.001
16:40:08.185[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:40:08.188[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:40:08.189[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=5
16:40:08.527[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.688, -3.782, 0.016] odom_goal_yaw_deg=180.0 world_goal=[3.95, -1.639, -5.288] world_goal_yaw_deg=-50.96
16:40:08.580[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.688, -3.782, 0.016], euler=[90.0, 0.0, -150.5])
16:40:08.580[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:40:08.581[inf][anning_a_star/local_planner.py] changed state state=idle
16:40:08.581[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:40:08.582[inf][nning_a_star/global_planner.py] Found safe goal. x=2.67 y=-3.82
16:40:08.597[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:40:08.600[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:40:10.206[inf][anning_a_star/local_planner.py] changed state state=path_following
16:40:11.860[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:40:11.860[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:40:11.911[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=165442 seq=17
16:40:11.946[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874408.688057 frame_age_s=3.1445 latest_residual_m=0.5291 observations_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.1581 residual_along_track_m=0.4996 residual_cross_track_m=0.1354 residual_vertical_m=-0.1096 robot_speed_ms=0.108 seq=17 source_ts_gap_s=0.07266 total_rejections=0 window_centroid_residual_m=4.8343
16:40:13.216[war][s/ar/world_frame/transforms.py] gravity_level_transform: input up-axis far from world-up (angle=15.7 deg) — registration input likely malformed; this warning is rate-limited to once per 30 s
16:40:13.279[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:40:13.280[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:40:13.280[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:40:13.280[inf][anning_a_star/local_planner.py] changed state state=arrived
16:40:13.385[inf][anning_a_star/local_planner.py] changed state state=idle
16:40:13.385[inf][nning_a_star/global_planner.py] Arrived at goal.
16:40:13.385[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.0
16:40:13.385[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:40:13.386[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:40:13.386[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.291
16:40:14.181[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=157806 seq=25
16:40:14.202[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874413.854628 frame_age_s=0.0746 latest_residual_m=0.5706 observations_added=1 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.0932 residual_along_track_m=0.5375 residual_cross_track_m=0.1334 residual_vertical_m=-0.1373 robot_speed_ms=0.062 seq=25 source_ts_gap_s=0.067245 total_rejections=0 window_centroid_residual_m=4.5219
16:40:15.807[inf][imos/ar/world_frame/aligner.py] alignment_update alpha_scale=1.0 alpha_yaw=1.0 baseline_m=4.7947 confidence=0.8855 max_pair_skew_s=0.0739 mean_ambiguity_ratio=5.3735 method=similarity n_obs=12 n_rejected=3 resid_rms_m=0.0117 s=1.0708 scale_held=False scale_observable=True yaw_deg=100.46 yaw_held=False yaw_observable=True
16:40:15.808[inf][imos/ar/world_frame/aligner.py] refinement_episode_complete baseline_m=4.795 marker_jump_m=0.594 observation_count=12 solve_quality=0.941 trans_delta_m=0.664 yaw_delta_deg=0.88
16:40:15.809[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=2 dropped_fifo=0 fifo_depth=0
16:40:18.273[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:40:18.274[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=938.267987
16:40:18.275[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.685, -3.771, -0.023] odom_goal_yaw_deg=180.0 world_goal=[4.278, -1.675, -4.851] world_goal_yaw_deg=-35.3
16:40:18.278[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.219, -4.217, -0.077] odom_goal_yaw_deg=180.0 world_goal=[4.838, -1.728, -4.447] world_goal_yaw_deg=-34.68
16:40:18.338[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.685, -3.771, -0.023], euler=[90.0, 0.0, -135.8])
16:40:18.339[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:40:18.340[inf][nning_a_star/global_planner.py] Found safe goal. x=2.67 y=-3.77
16:40:18.347[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:40:18.348[inf][anning_a_star/local_planner.py] changed state state=path_following
16:40:18.348[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.219, -4.217, -0.077], euler=[90.0, 0.0, -135.1])
16:40:18.348[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:40:18.349[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:40:18.349[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:40:18.349[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:40:18.349[inf][anning_a_star/local_planner.py] changed state state=arrived
16:40:18.349[inf][anning_a_star/local_planner.py] changed state state=idle
16:40:18.349[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:40:18.350[inf][nning_a_star/global_planner.py] Found safe goal. x=2.17 y=-4.22
16:40:18.358[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:40:18.360[inf][anning_a_star/local_planner.py] changed state state=path_following
16:40:18.572[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.232
16:40:18.574[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=8
16:40:19.102[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.982, -4.569, -0.118] odom_goal_yaw_deg=180.0 world_goal=[5.254, -1.77, -4.266] world_goal_yaw_deg=-23.61
16:40:19.103[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.816, -4.773, -0.129] odom_goal_yaw_deg=-180.0 world_goal=[5.502, -1.781, -4.131] world_goal_yaw_deg=-29.06
16:40:19.210[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.764, -4.858, -0.13] odom_goal_yaw_deg=180.0 world_goal=[5.602, -1.782, -4.092] world_goal_yaw_deg=-21.75
16:40:19.307[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.982, -4.569, -0.118], euler=[90.0, 0.0, -124.1])
16:40:19.307[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:40:19.307[inf][anning_a_star/local_planner.py] changed state state=idle
16:40:19.308[inf][nning_a_star/global_planner.py] Found safe goal. x=1.97 y=-4.57
16:40:19.308[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:40:19.320[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:40:19.322[inf][anning_a_star/local_planner.py] changed state state=path_following
16:40:19.323[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.816, -4.773, -0.129], euler=[90.0, 0.0, -129.5])
16:40:19.323[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:40:19.324[inf][anning_a_star/local_planner.py] changed state state=idle
16:40:19.324[inf][nning_a_star/global_planner.py] Found safe goal. x=1.77 y=-4.77
16:40:19.324[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:40:19.333[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:40:19.337[inf][anning_a_star/local_planner.py] changed state state=path_following
16:40:19.375[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.764, -4.858, -0.130], euler=[90.0, 0.0, -122.2])
16:40:19.376[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:40:19.376[inf][anning_a_star/local_planner.py] changed state state=idle
16:40:19.376[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:40:19.377[inf][nning_a_star/global_planner.py] Found safe goal. x=1.72 y=-4.87
16:40:19.387[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:40:19.399[inf][anning_a_star/local_planner.py] changed state state=path_following
16:40:22.178[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:40:22.178[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:40:22.178[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:40:22.178[inf][anning_a_star/local_planner.py] changed state state=arrived
16:40:22.283[inf][anning_a_star/local_planner.py] changed state state=idle
16:40:22.284[inf][nning_a_star/global_planner.py] Arrived at goal.
16:40:22.284[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:40:22.562[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:40:22.562[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.441
16:40:26.735[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:40:26.737[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=946.730965
16:40:26.737[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.683, -4.875, -0.022] odom_goal_yaw_deg=-180.0 world_goal=[5.635, -1.674, -4.011] world_goal_yaw_deg=-41.72
16:40:26.744[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.683, -4.875, -0.022], euler=[90.0, 0.0, -142.2])
16:40:26.745[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:40:26.745[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.0
16:40:26.746[inf][nning_a_star/global_planner.py] Found safe goal. x=1.67 y=-4.93
16:40:26.758[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:40:26.759[inf][anning_a_star/local_planner.py] changed state state=path_following
16:40:26.759[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
16:40:26.759[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:40:26.760[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:40:26.760[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:40:26.760[inf][anning_a_star/local_planner.py] changed state state=arrived
16:40:26.865[inf][anning_a_star/local_planner.py] changed state state=idle
16:40:26.865[inf][nning_a_star/global_planner.py] Arrived at goal.
16:40:26.866[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
16:40:27.073[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.921, -4.486, -0.034] odom_goal_yaw_deg=0.0 world_goal=[5.179, -1.686, -4.186] world_goal_yaw_deg=165.08
▸ 16:40:27.117[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:40:27.117[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.416
16:40:27.267[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.921, -4.486, -0.034], euler=[90.0, 0.0, 64.6])
16:40:27.268[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:40:27.268[inf][nning_a_star/global_planner.py] Found safe goal. x=1.87 y=-4.53
16:40:27.280[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:40:27.287[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:40:27.378[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.261, -4.292, -0.084] odom_goal_yaw_deg=0.0 world_goal=[4.908, -1.736, -4.505] world_goal_yaw_deg=139.48
16:40:27.416[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.261, -4.292, -0.084], euler=[90.0, 0.0, 39.0])
16:40:27.417[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:40:27.418[inf][anning_a_star/local_planner.py] changed state state=idle
16:40:27.418[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:40:27.419[inf][nning_a_star/global_planner.py] Found safe goal. x=2.22 y=-4.33
16:40:27.440[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:40:27.442[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:40:27.445[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=10
16:40:27.616[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.508, -3.45, 0.293] odom_goal_yaw_deg=0.0 world_goal=[3.974, -1.359, -4.601] world_goal_yaw_deg=-173.67
16:40:27.856[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.508, -3.450, 0.293], euler=[90.0, 0.0, 85.9])
16:40:27.856[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:40:27.857[inf][anning_a_star/local_planner.py] changed state state=idle
16:40:27.857[war][nning_a_star/global_planner.py] Travelling to goal 0.29584943257223295m away from requested goal.
16:40:27.857[inf][nning_a_star/global_planner.py] Found safe goal. x=2.47 y=-3.48
16:40:27.858[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:40:27.874[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:40:27.877[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:40:28.047[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:40:28.048[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.017, -3.101, -0.052] odom_goal_yaw_deg=-0.0 world_goal=[3.508, -1.704, -5.07] world_goal_yaw_deg=157.69
16:40:28.089[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.017, -3.101, -0.052], euler=[90.0, 0.0, 57.2])
16:40:28.089[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:40:28.090[inf][anning_a_star/local_planner.py] changed state state=idle
16:40:28.091[inf][nning_a_star/global_planner.py] Found safe goal. x=2.97 y=-3.13
16:40:28.091[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:40:28.131[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:40:28.138[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:40:28.682[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.124, -2.948, -0.057] odom_goal_yaw_deg=0.0 world_goal=[3.325, -1.709, -5.152] world_goal_yaw_deg=121.31
16:40:28.700[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.124, -2.948, -0.057], euler=[90.0, 0.0, 20.8])
16:40:28.701[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:40:28.701[inf][anning_a_star/local_planner.py] changed state state=idle
16:40:28.701[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:40:28.702[inf][nning_a_star/global_planner.py] Found safe goal. x=3.07 y=-2.98
16:40:28.767[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:40:28.777[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:40:30.248[inf][anning_a_star/local_planner.py] changed state state=path_following
16:40:34.492[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:40:34.494[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:40:34.582[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=164577 seq=2
16:40:34.620[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874434.18753 frame_age_s=0.1156 latest_residual_m=0.4643 observations_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.3843 residual_along_track_m=-0.2741 residual_cross_track_m=0.3522 residual_vertical_m=-0.1281 robot_speed_ms=0.318 seq=2 source_ts_gap_s=0.041708 total_rejections=0 window_centroid_residual_m=4.6846
16:40:35.125[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
16:40:36.202[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:40:36.202[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:40:36.203[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:40:36.203[inf][anning_a_star/local_planner.py] changed state state=arrived
16:40:36.307[inf][anning_a_star/local_planner.py] changed state state=idle
16:40:36.308[inf][nning_a_star/global_planner.py] Arrived at goal.
16:40:36.308[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:40:36.460[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:40:36.460[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.384
16:40:36.461[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.153
16:40:36.762[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=177069 seq=9
16:40:36.789[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874436.387461 frame_age_s=0.121 latest_residual_m=0.6029 observations_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.125 residual_along_track_m=-0.5642 residual_cross_track_m=0.1166 residual_vertical_m=-0.1778 robot_speed_ms=0.513 seq=9 source_ts_gap_s=0.091172 total_rejections=0 window_centroid_residual_m=3.5835
16:40:37.564[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:40:37.565[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:40:38.960[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=179085 seq=17
16:40:38.986[inf][imos/ar/world_frame/aligner.py] alignment_update alpha_scale=1.0 alpha_yaw=1.0 baseline_m=4.571 confidence=0.9051 max_pair_skew_s=0.1077 mean_ambiguity_ratio=1.819 method=similarity n_obs=14 n_rejected=1 resid_rms_m=0.0058 s=1.0874 scale_held=False scale_observable=True yaw_deg=101.59 yaw_held=False yaw_observable=True
16:40:38.987[inf][imos/ar/world_frame/aligner.py] refinement_episode_complete baseline_m=4.571 marker_jump_m=0.094 observation_count=14 solve_quality=0.933 trans_delta_m=0.092 yaw_delta_deg=1.13
16:40:38.994[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874438.720759 frame_age_s=0.0765 latest_residual_m=0.1502 observations_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.1494 residual_along_track_m=0.0191 residual_cross_track_m=0.0118 residual_vertical_m=-0.1486 robot_speed_ms=0.001 seq=17 source_ts_gap_s=0.032724 total_rejections=0 window_centroid_residual_m=3.0187
16:43:01.026[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:43:01.029[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1101.022119
16:43:01.030[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.135, -2.941, -0.024] odom_goal_yaw_deg=-0.0 world_goal=[3.271, -1.674, -5.181] world_goal_yaw_deg=104.17
16:43:01.050[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.135, -2.941, -0.024], euler=[90.0, 0.0, 2.6])
16:43:01.051[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:01.052[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.0
16:43:01.052[inf][nning_a_star/global_planner.py] Found safe goal. x=3.12 y=-2.98
16:43:01.060[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:01.062[inf][anning_a_star/local_planner.py] changed state state=path_following
16:43:01.062[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:43:01.062[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
16:43:01.063[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:43:01.063[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:43:01.063[inf][anning_a_star/local_planner.py] changed state state=arrived
16:43:01.167[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:01.168[inf][nning_a_star/global_planner.py] Arrived at goal.
16:43:01.168[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
16:43:01.196[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.198, -2.93, 0.004] odom_goal_yaw_deg=-0.0 world_goal=[3.246, -1.646, -5.245] world_goal_yaw_deg=104.97
16:43:01.421[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.198, -2.930, 0.004], euler=[90.0, 0.0, 3.4])
16:43:01.421[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:01.422[inf][nning_a_star/global_planner.py] Found safe goal. x=3.17 y=-2.98
▸ 16:43:01.425[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:43:01.426[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.309
16:43:01.432[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:01.433[inf][anning_a_star/local_planner.py] changed state state=path_following
16:43:01.461[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:43:01.461[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:43:01.461[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:43:01.461[inf][anning_a_star/local_planner.py] changed state state=arrived
16:43:01.565[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:01.566[inf][nning_a_star/global_planner.py] Arrived at goal.
16:43:01.567[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
16:43:03.891[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:43:03.893[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1103.885986
16:43:03.893[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.135, -2.941, -0.024] odom_goal_yaw_deg=0.0 world_goal=[3.271, -1.674, -5.181] world_goal_yaw_deg=104.07
16:43:04.102[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.135, -2.941, -0.024], euler=[90.0, 0.0, 2.5])
16:43:04.103[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:04.103[inf][nning_a_star/global_planner.py] Found safe goal. x=3.12 y=-2.98
16:43:04.113[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:04.114[inf][anning_a_star/local_planner.py] changed state state=path_following
16:43:04.114[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:43:04.115[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:43:04.115[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:43:04.115[inf][anning_a_star/local_planner.py] changed state state=arrived
16:43:04.218[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:04.218[inf][nning_a_star/global_planner.py] Arrived at goal.
16:43:04.219[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
16:43:04.241[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.309, -3.027, 0.026] odom_goal_yaw_deg=0.0 world_goal=[3.325, -1.624, -5.385] world_goal_yaw_deg=78.89
16:43:04.251[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
▸ 16:43:04.253[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:43:04.254[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.329
16:43:04.322[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.309, -3.027, 0.026], euler=[90.0, 0.0, -22.7])
16:43:04.322[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:04.327[inf][nning_a_star/global_planner.py] Found safe goal. x=3.27 y=-3.08
16:43:04.335[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:04.337[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:43:04.651[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.475, -2.94, 0.023] odom_goal_yaw_deg=-0.0 world_goal=[3.196, -1.626, -5.543] world_goal_yaw_deg=124.83
16:43:04.827[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.475, -2.940, 0.023], euler=[90.0, 0.0, 23.2])
16:43:04.828[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:04.828[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:04.829[inf][nning_a_star/global_planner.py] Found safe goal. x=3.47 y=-2.98
16:43:04.829[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:04.840[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:04.844[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:43:04.909[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=6
16:43:05.018[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:43:05.020[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.59, -2.478, -0.036] odom_goal_yaw_deg=-0.0 world_goal=[2.679, -1.685, -5.564] world_goal_yaw_deg=-179.92
16:43:05.078[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.590, -2.478, -0.036], euler=[90.0, 0.0, 78.5])
16:43:05.078[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:05.079[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:05.080[inf][nning_a_star/global_planner.py] Found safe goal. x=3.57 y=-2.53
16:43:05.080[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:05.098[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:05.100[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:43:05.359[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.655, -2.223, -0.027] odom_goal_yaw_deg=-0.0 world_goal=[2.392, -1.676, -5.578] world_goal_yaw_deg=174.74
16:43:05.492[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.655, -2.223, -0.027], euler=[90.0, 0.0, 73.1])
16:43:05.493[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:05.494[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:05.494[inf][nning_a_star/global_planner.py] Found safe goal. x=3.62 y=-2.28
16:43:05.496[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:05.504[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:05.509[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:43:05.753[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.682, -2.018, -0.012], euler=[90.0, -0.0, 85.5])
16:43:05.753[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.682, -2.018, -0.012] odom_goal_yaw_deg=-0.0 world_goal=[2.169, -1.661, -5.562] world_goal_yaw_deg=-172.9
16:43:05.753[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:05.754[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:05.756[inf][nning_a_star/global_planner.py] Found safe goal. x=3.52 y=-2.08
16:43:05.757[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:05.766[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:05.768[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:43:06.045[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:43:06.046[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1106.038926
16:43:06.046[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.664, -1.641, 0.031] odom_goal_yaw_deg=180.0 world_goal=[1.771, -1.619, -5.461] world_goal_yaw_deg=-166.65
16:43:06.173[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.664, -1.641, 0.031], euler=[90.0, 0.0, 91.8])
16:43:06.173[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:06.174[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:06.174[inf][nning_a_star/global_planner.py] Found safe goal. x=3.57 y=-1.63
16:43:06.175[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:06.189[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:06.194[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:43:06.250[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.077
16:43:06.478[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.667, -1.278, 0.052] odom_goal_yaw_deg=180.0 world_goal=[1.383, -1.598, -5.384] world_goal_yaw_deg=-168.26
16:43:06.728[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.667, -1.278, 0.052], euler=[90.0, 0.0, 90.2])
16:43:06.729[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:06.729[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:06.730[inf][nning_a_star/global_planner.py] Found safe goal. x=3.62 y=-1.33
16:43:06.730[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:06.765[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:06.769[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:43:07.063[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:43:07.064[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.731, -1.024, 0.055] odom_goal_yaw_deg=-0.0 world_goal=[1.099, -1.594, -5.397] world_goal_yaw_deg=159.95
16:43:07.064[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.731, -1.024, 0.055], euler=[90.0, 0.0, 58.4])
16:43:07.064[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:07.065[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:07.065[inf][nning_a_star/global_planner.py] Found safe goal. x=3.72 y=-1.03
16:43:07.065[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:07.107[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:07.112[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:43:07.201[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.782, -1.222, 0.049] odom_goal_yaw_deg=0.0 world_goal=[1.298, -1.601, -5.495] world_goal_yaw_deg=46.87
16:43:07.357[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.782, -1.222, 0.049], euler=[90.0, 0.0, -54.7])
16:43:07.358[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:07.358[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:07.358[inf][nning_a_star/global_planner.py] Found safe goal. x=3.77 y=-1.23
16:43:07.359[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:07.423[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:07.431[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:43:07.470[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.833, -1.825, 0.008] odom_goal_yaw_deg=0.0 world_goal=[1.93, -1.641, -5.68] world_goal_yaw_deg=16.51
16:43:07.524[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.833, -1.825, 0.008], euler=[90.0, 0.0, -85.1])
16:43:07.524[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:07.527[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:07.531[war][nning_a_star/global_planner.py] Travelling to goal 0.32631964701910554m away from requested goal.
16:43:07.532[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:07.533[inf][nning_a_star/global_planner.py] Found safe goal. x=3.57 y=-1.63
16:43:07.583[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:07.587[inf][anning_a_star/local_planner.py] changed state state=path_following
16:43:07.863[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.713, -2.012, -0.014] odom_goal_yaw_deg=180.0 world_goal=[2.156, -1.664, -5.594] world_goal_yaw_deg=-19.15
16:43:07.947[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.713, -2.012, -0.014], euler=[90.0, 0.0, -120.7])
16:43:07.948[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:07.949[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:07.949[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:07.956[inf][nning_a_star/global_planner.py] Found safe goal. x=3.52 y=-2.08
16:43:07.976[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:07.981[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:43:08.199[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:43:08.200[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1108.193546
16:43:08.201[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.416, -2.068, -0.018] odom_goal_yaw_deg=-180.0 world_goal=[2.28, -1.668, -5.289] world_goal_yaw_deg=-77.26
16:43:08.201[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.416, -2.068, -0.018], euler=[90.0, 0.0, -178.9])
16:43:08.201[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:08.201[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:08.202[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:08.202[inf][nning_a_star/global_planner.py] Found safe goal. x=3.37 y=-2.08
16:43:08.216[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:08.218[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:43:08.526[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.717, -1.869, 0.002] odom_goal_yaw_deg=180.0 world_goal=[2.22, -1.648, -4.502] world_goal_yaw_deg=-89.73
16:43:08.644[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.717, -1.869, 0.002], euler=[90.0, 0.0, 168.7])
16:43:08.644[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:08.645[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:08.646[inf][nning_a_star/global_planner.py] Found safe goal. x=2.67 y=-1.88
16:43:08.647[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:08.656[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:08.658[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:43:08.762[inf][anning_a_star/local_planner.py] changed state state=path_following
16:43:08.877[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.461, -2.102, -0.039] odom_goal_yaw_deg=-180.0 world_goal=[2.524, -1.689, -4.279] world_goal_yaw_deg=-4.84
16:43:08.877[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.461, -2.102, -0.039], euler=[90.0, 0.0, -106.4])
16:43:08.877[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:08.877[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:08.878[inf][nning_a_star/global_planner.py] Found safe goal. x=2.42 y=-2.13
16:43:08.878[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:08.887[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:08.889[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:43:09.746[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:43:09.747[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.311, -2.208, -0.064] odom_goal_yaw_deg=180.0 world_goal=[2.67, -1.713, -4.143] world_goal_yaw_deg=-54.39
16:43:09.917[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.311, -2.208, -0.064], euler=[90.0, 0.0, -156.0])
16:43:09.917[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:09.917[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:09.918[inf][nning_a_star/global_planner.py] Found safe goal. x=2.27 y=-2.23
16:43:09.918[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:09.931[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:09.933[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:43:10.137[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.311, -2.393, -0.09] odom_goal_yaw_deg=-180.0 world_goal=[2.868, -1.74, -4.184] world_goal_yaw_deg=8.55
16:43:10.137[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.311, -2.393, -0.090], euler=[90.0, 0.0, -93.0])
16:43:10.138[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:10.139[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:10.139[inf][nning_a_star/global_planner.py] Found safe goal. x=2.27 y=-2.43
16:43:10.139[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:10.151[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:10.153[inf][anning_a_star/local_planner.py] changed state state=path_following
16:43:10.454[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1110.447019
16:43:10.454[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.711, -2.742, 0.035] odom_goal_yaw_deg=0.0 world_goal=[3.152, -1.615, -4.686] world_goal_yaw_deg=54.98
16:43:10.575[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.711, -2.742, 0.035], euler=[90.0, 0.0, -46.6])
16:43:10.575[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:10.575[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:10.576[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:10.581[war][nning_a_star/global_planner.py] Travelling to goal 0.3000770169174682m away from requested goal.
16:43:10.581[inf][nning_a_star/global_planner.py] Found safe goal. x=2.52 y=-2.98
16:43:10.591[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:10.630[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:43:10.887[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:43:10.888[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.691, -2.76, 0.026] odom_goal_yaw_deg=0.0 world_goal=[3.175, -1.623, -4.668] world_goal_yaw_deg=16.95
16:43:10.898[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.691, -2.760, 0.026], euler=[90.0, 0.0, -84.6])
16:43:10.899[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:10.899[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:10.905[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:10.908[war][nning_a_star/global_planner.py] Travelling to goal 0.27295637266586714m away from requested goal.
16:43:10.909[inf][nning_a_star/global_planner.py] Found safe goal. x=2.52 y=-2.98
16:43:10.918[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:10.921[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:43:12.717[inf][anning_a_star/local_planner.py] changed state state=path_following
16:43:16.345[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:43:16.345[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:43:17.197[inf][anning_a_star/local_planner.py] Obstacle detected ahead, stopping local planner.
16:43:17.198[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:17.198[inf][nning_a_star/global_planner.py] Replanning path due to obstacle found.
16:43:17.199[inf][nning_a_star/global_planner.py] Replanning. attempt=0
16:43:17.199[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
16:43:17.222[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.024
▸ 16:43:17.224[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:43:17.224[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.387
16:43:23.976[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:43:23.978[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1123.971043
16:43:23.979[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.361, -3.152, -0.016] odom_goal_yaw_deg=-180.0 world_goal=[3.665, -1.665, -4.403] world_goal_yaw_deg=-60.83
16:43:24.115[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.467, -3.184, 0.026] odom_goal_yaw_deg=0.0 world_goal=[3.676, -1.623, -4.523] world_goal_yaw_deg=57.49
16:43:24.172[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.361, -3.152, -0.016], euler=[90.0, 0.0, -162.4])
16:43:24.172[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:24.173[inf][nning_a_star/global_planner.py] Found safe goal. x=2.32 y=-3.23
16:43:24.181[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:24.182[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:43:24.365[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.467, -3.184, 0.026], euler=[90.0, 0.0, -44.1])
16:43:24.365[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:24.366[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:24.366[inf][nning_a_star/global_planner.py] Found safe goal. x=2.47 y=-3.23
16:43:24.367[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:24.368[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.196
16:43:24.370[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=2
16:43:24.374[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:24.435[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:43:24.627[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.31, -2.969, 0.034] odom_goal_yaw_deg=-180.0 world_goal=[3.481, -1.615, -4.308] world_goal_yaw_deg=-155.28
16:43:24.689[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.310, -2.969, 0.034], euler=[90.0, 0.0, 103.1])
16:43:24.689[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:24.690[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:24.693[war][nning_a_star/global_planner.py] Travelling to goal 0.20934986521052412m away from requested goal.
16:43:24.693[inf][nning_a_star/global_planner.py] Found safe goal. x=2.17 y=-3.13
16:43:24.694[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:24.702[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:24.761[inf][anning_a_star/local_planner.py] changed state state=path_following
16:43:24.761[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:43:24.762[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:43:24.858[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.084, -2.196, -0.05] odom_goal_yaw_deg=-0.0 world_goal=[2.707, -1.699, -3.899] world_goal_yaw_deg=-171.35
16:43:25.095[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.084, -2.196, -0.050], euler=[90.0, 0.0, 87.1])
16:43:25.096[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:25.097[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:25.097[inf][nning_a_star/global_planner.py] Found safe goal. x=2.07 y=-2.23
16:43:25.098[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:25.115[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:25.117[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:43:25.289[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:43:25.290[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.253, -1.773, 0.052] odom_goal_yaw_deg=-0.0 world_goal=[2.219, -1.597, -3.986] world_goal_yaw_deg=171.87
16:43:25.340[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.253, -1.773, 0.052], euler=[90.0, 0.0, 70.3])
16:43:25.341[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:25.341[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:25.341[inf][nning_a_star/global_planner.py] Found safe goal. x=2.22 y=-1.78
16:43:25.342[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:25.355[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:25.358[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:43:26.311[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:43:26.312[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1126.304981
16:43:26.312[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.166, -1.636, 0.083] odom_goal_yaw_deg=180.0 world_goal=[2.092, -1.566, -3.864] world_goal_yaw_deg=-111.36
16:43:26.526[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.166, -1.636, 0.083], euler=[90.0, 0.0, 147.0])
16:43:26.528[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:26.528[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:26.529[inf][nning_a_star/global_planner.py] Found safe goal. x=2.12 y=-1.68
16:43:26.530[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:26.596[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:26.607[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:43:26.698[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.887, -1.109, 0.085] odom_goal_yaw_deg=-180.0 world_goal=[1.592, -1.565, -3.452] world_goal_yaw_deg=-139.77
16:43:26.698[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.887, -1.109, 0.085], euler=[90.0, 0.0, 118.6])
16:43:26.699[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:26.699[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:26.700[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:26.700[inf][nning_a_star/global_planner.py] Found safe goal. x=1.87 y=-1.13
16:43:26.748[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:26.759[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:43:27.028[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.018, -0.834, 0.09] odom_goal_yaw_deg=-0.0 world_goal=[1.271, -1.56, -3.53] world_goal_yaw_deg=144.29
16:43:27.233[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.018, -0.834, 0.090], euler=[90.0, -0.0, 42.7])
16:43:27.234[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:27.234[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:27.234[inf][nning_a_star/global_planner.py] Found safe goal. x=1.97 y=-0.88
16:43:27.234[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:27.278[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:27.289[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:43:27.396[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:43:27.397[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.248, -0.998, 0.028] odom_goal_yaw_deg=0.0 world_goal=[1.395, -1.621, -3.812] world_goal_yaw_deg=67.3
16:43:27.432[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.248, -0.998, 0.028], euler=[90.0, 0.0, -34.3])
16:43:27.432[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:27.433[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:27.433[inf][nning_a_star/global_planner.py] Found safe goal. x=2.22 y=-1.03
16:43:27.433[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:27.517[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:27.531[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:43:27.714[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.408, -1.153, 0.034] odom_goal_yaw_deg=0.0 world_goal=[1.525, -1.616, -4.016] world_goal_yaw_deg=60.55
16:43:27.897[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.408, -1.153, 0.034], euler=[90.0, 0.0, -41.0])
16:43:27.897[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:27.897[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:27.898[inf][nning_a_star/global_planner.py] Found safe goal. x=2.37 y=-1.18
16:43:27.898[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:27.931[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:27.936[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:43:28.120[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.549, -1.286, 0.038] odom_goal_yaw_deg=-0.0 world_goal=[1.636, -1.612, -4.195] world_goal_yaw_deg=59.36
16:43:28.125[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.549, -1.286, 0.038], euler=[90.0, 0.0, -42.2])
16:43:28.125[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:28.125[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:28.126[inf][nning_a_star/global_planner.py] Found safe goal. x=2.52 y=-1.33
16:43:28.126[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:28.144[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:28.147[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:43:28.620[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:43:28.621[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1128.614233
16:43:28.622[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.62, -1.457, 0.05] odom_goal_yaw_deg=0.0 world_goal=[1.803, -1.6, -4.308] world_goal_yaw_deg=38.35
16:43:28.753[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.620, -1.457, 0.050], euler=[90.0, 0.0, -63.2])
16:43:28.753[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:28.753[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:28.754[inf][nning_a_star/global_planner.py] Found safe goal. x=2.57 y=-1.48
16:43:28.754[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:28.782[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:28.786[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:43:29.051[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.565, -1.453, 0.051] odom_goal_yaw_deg=-180.0 world_goal=[1.81, -1.598, -4.248] world_goal_yaw_deg=-29.85
16:43:29.297[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.565, -1.453, 0.051], euler=[90.0, 0.0, -131.4])
16:43:29.298[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:29.298[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:29.298[inf][nning_a_star/global_planner.py] Found safe goal. x=2.52 y=-1.48
16:43:29.299[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:29.338[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:29.345[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:43:29.458[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.16
16:43:29.663[inf][anning_a_star/local_planner.py] changed state state=path_following
16:43:32.093[inf][anning_a_star/local_planner.py] Obstacle detected ahead, stopping local planner.
16:43:32.093[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:32.094[inf][nning_a_star/global_planner.py] Replanning path due to obstacle found.
16:43:32.094[inf][nning_a_star/global_planner.py] Replanning. attempt=0
16:43:32.094[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:32.095[inf][nning_a_star/global_planner.py] Found safe goal. x=2.52 y=-1.48
16:43:32.114[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:32.122[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:43:32.854[inf][anning_a_star/local_planner.py] changed state state=path_following
16:43:40.183[war][imos/ar/navigation/navigate.py] AR navigation goal stalled stall_reason=no_path
16:43:40.183[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=0.0
16:43:40.184[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=cancel_nav_goal publish_mono=1140.17686
16:43:40.184[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:43:40.185[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:40.185[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.0
16:43:40.185[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:51.653[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:43:51.655[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1151.648397
16:43:51.656[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.381, -1.477, 0.04] odom_goal_yaw_deg=-180.0 world_goal=[1.876, -1.61, -4.058] world_goal_yaw_deg=-62.89
16:43:51.688[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.381, -1.477, 0.040], euler=[90.0, -0.0, -164.5])
16:43:51.689[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:51.690[inf][nning_a_star/global_planner.py] Found safe goal. x=2.37 y=-1.53
16:43:51.691[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.002
16:43:51.698[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:51.700[inf][anning_a_star/local_planner.py] changed state state=path_following
16:43:51.701[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=7
16:43:51.990[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.104, -1.679, 0.088] odom_goal_yaw_deg=-180.0 world_goal=[2.152, -1.561, -3.806] world_goal_yaw_deg=-59.03
16:43:52.173[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.104, -1.679, 0.088], euler=[90.0, 0.0, -160.6])
16:43:52.174[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:52.175[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:52.176[inf][nning_a_star/global_planner.py] Found safe goal. x=2.07 y=-1.73
16:43:52.176[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:52.186[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:52.189[inf][anning_a_star/local_planner.py] changed state state=path_following
16:43:52.504[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.619, -1.002, 0.102], euler=[90.0, 0.0, 129.6])
16:43:52.504[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.619, -1.002, 0.102] odom_goal_yaw_deg=180.0 world_goal=[1.537, -1.548, -3.142] world_goal_yaw_deg=-128.85
16:43:52.505[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:52.505[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:52.506[inf][nning_a_star/global_planner.py] Found safe goal. x=1.57 y=-1.03
16:43:52.506[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:52.611[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:52.613[inf][anning_a_star/local_planner.py] changed state state=path_following
16:43:52.711[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:43:52.713[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.357, -0.386, 0.116] odom_goal_yaw_deg=-0.0 world_goal=[0.937, -1.534, -2.729] world_goal_yaw_deg=-172.82
16:43:52.878[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.357, -0.386, 0.116], euler=[90.0, -0.0, 85.6])
16:43:52.879[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:52.879[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:52.880[inf][nning_a_star/global_planner.py] Found safe goal. x=1.32 y=-0.43
16:43:52.880[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:52.905[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:52.910[inf][anning_a_star/local_planner.py] changed state state=path_following
16:43:53.077[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.561, -0.502, 0.116] odom_goal_yaw_deg=0.0 world_goal=[1.017, -1.533, -2.972] world_goal_yaw_deg=88.74
16:43:53.099[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.561, -0.502, 0.116], euler=[90.0, 0.0, -12.9])
16:43:53.099[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:53.099[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:53.100[inf][nning_a_star/global_planner.py] Found safe goal. x=1.52 y=-0.53
16:43:53.100[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:53.134[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:53.138[inf][anning_a_star/local_planner.py] changed state state=path_following
16:43:53.375[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.376, -0.297, 0.117] odom_goal_yaw_deg=180.0 world_goal=[0.839, -1.533, -2.73] world_goal_yaw_deg=-148.17
16:43:53.531[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.376, -0.297, 0.117], euler=[90.0, 0.0, 110.2])
16:43:53.532[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:53.534[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:53.534[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:53.535[inf][nning_a_star/global_planner.py] Found safe goal. x=1.37 y=-0.33
16:43:53.594[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:53.603[inf][anning_a_star/local_planner.py] changed state state=path_following
16:43:54.265[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:43:54.266[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1154.25931
16:43:54.267[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.329, -0.115, 0.118] odom_goal_yaw_deg=180.0 world_goal=[0.656, -1.532, -2.64] world_goal_yaw_deg=-144.22
16:43:54.341[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.329, -0.115, 0.118], euler=[90.0, 0.0, 114.2])
16:43:54.342[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:43:54.342[inf][anning_a_star/local_planner.py] changed state state=idle
16:43:54.342[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:43:54.343[inf][nning_a_star/global_planner.py] Found safe goal. x=1.32 y=-0.13
16:43:54.403[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:43:54.406[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:43:54.935[inf][anning_a_star/local_planner.py] changed state state=path_following
16:44:02.435[war][imos/ar/navigation/navigate.py] AR navigation goal stalled stall_reason=no_path
16:44:02.436[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=0.0
16:44:02.437[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=cancel_nav_goal publish_mono=1162.429953
16:44:02.567[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:44:02.568[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:02.568[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:02.636[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.069
16:44:15.356[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:44:15.357[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:44:15.481[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=185269 seq=2
16:44:15.508[war][s/ar/world_frame/transforms.py] gravity_level_transform: input up-axis far from world-up (angle=18.3 deg) — registration input likely malformed; this warning is rate-limited to once per 30 s
16:44:15.511[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874655.282624 frame_age_s=0.1182 latest_residual_m=3.204 observations_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=2.9151 residual_along_track_m=-3.1927 residual_cross_track_m=0.2274 residual_vertical_m=-0.1453 robot_speed_ms=0.0 seq=2 source_ts_gap_s=0.014499 total_rejections=0 window_centroid_residual_m=4.6649
16:44:17.482[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=180754 seq=9
16:44:17.508[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874657.115932 frame_age_s=0.0976 latest_residual_m=0.0711 observations_added=0 regime=static rej_distance=1 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0527 residual_along_track_m=-0.0441 residual_cross_track_m=0.0516 residual_vertical_m=0.0211 robot_speed_ms=0.0 seq=9 source_ts_gap_s=0.013034 total_rejections=1 window_centroid_residual_m=0.0711
16:44:40.138[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:44:40.141[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1200.133505
16:44:40.141[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.309, 0.062, 0.067] odom_goal_yaw_deg=180.0 world_goal=[0.471, -1.583, -2.58] world_goal_yaw_deg=-159.66
16:44:40.142[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.309, 0.062, 0.067], euler=[90.0, 0.0, 98.8])
16:44:40.144[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:40.145[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.001
16:44:40.145[inf][nning_a_star/global_planner.py] Found safe goal. x=1.27 y=0.02
16:44:40.159[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:40.162[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:44:40.216[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=9
16:44:40.478[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.621, 0.372, 0.086] odom_goal_yaw_deg=-0.0 world_goal=[0.073, -1.563, -2.844] world_goal_yaw_deg=149.94
16:44:40.645[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.621, 0.372, 0.086], euler=[90.0, 0.0, 48.4])
16:44:40.646[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:40.646[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:40.647[inf][nning_a_star/global_planner.py] Found safe goal. x=1.57 y=0.32
16:44:40.647[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:40.660[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:40.662[inf][anning_a_star/local_planner.py] changed state state=path_following
16:44:40.905[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.073, 0.544, 0.115] odom_goal_yaw_deg=-0.0 world_goal=[-0.21, -1.535, -3.288] world_goal_yaw_deg=120.5
16:44:41.130[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.073, 0.544, 0.115], euler=[90.0, 0.0, 18.9])
16:44:41.132[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:41.133[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:41.134[inf][nning_a_star/global_planner.py] Found safe goal. x=2.02 y=0.52
16:44:41.136[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:41.153[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:41.169[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:44:41.287[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:44:41.288[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.401, 0.55, 0.12] odom_goal_yaw_deg=-0.0 world_goal=[-0.288, -1.53, -3.637] world_goal_yaw_deg=105.97
16:44:41.288[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.401, 0.550, 0.120], euler=[90.0, 0.0, 4.4])
16:44:41.288[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:41.288[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:41.289[inf][nning_a_star/global_planner.py] Found safe goal. x=2.37 y=0.52
16:44:41.289[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:41.320[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:41.322[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:44:41.534[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.906, 1.029, 0.134] odom_goal_yaw_deg=-0.0 world_goal=[-0.908, -1.516, -4.069] world_goal_yaw_deg=143.42
16:44:41.595[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.906, 1.029, 0.134], euler=[90.0, 0.0, 41.8])
16:44:41.595[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:41.596[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:41.596[inf][nning_a_star/global_planner.py] Found safe goal. x=2.87 y=1.02
16:44:41.596[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:41.619[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:41.621[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:44:41.882[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.056, 1.205, 0.142] odom_goal_yaw_deg=-0.0 world_goal=[-1.128, -1.508, -4.19] world_goal_yaw_deg=-171.14
16:44:42.048[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.056, 1.205, 0.142], euler=[90.0, -0.0, 87.3])
16:44:42.049[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:42.049[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:42.050[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:42.050[inf][nning_a_star/global_planner.py] Found safe goal. x=3.02 y=1.17
16:44:42.088[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:42.091[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:44:42.250[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1202.243119
16:44:42.251[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.831, 1.195, 0.144] odom_goal_yaw_deg=180.0 world_goal=[-1.068, -1.506, -3.953] world_goal_yaw_deg=-122.84
16:44:42.288[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.831, 1.195, 0.144], euler=[90.0, 0.0, 135.6])
16:44:42.288[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:42.289[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:42.289[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:42.290[inf][nning_a_star/global_planner.py] Found safe goal. x=2.82 y=1.17
16:44:42.310[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:42.312[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:44:42.843[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:44:42.846[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.754, 1.365, 0.151] odom_goal_yaw_deg=-180.0 world_goal=[-1.233, -1.499, -3.834] world_goal_yaw_deg=-129.71
16:44:42.854[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.754, 1.365, 0.151], euler=[90.0, 0.0, 128.7])
16:44:42.854[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:42.855[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:42.855[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:42.856[inf][nning_a_star/global_planner.py] Found safe goal. x=2.72 y=1.32
16:44:42.895[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:42.902[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:44:43.111[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.894, 1.665, 0.16] odom_goal_yaw_deg=-0.0 world_goal=[-1.583, -1.49, -3.917] world_goal_yaw_deg=169.31
16:44:43.329[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.894, 1.665, 0.160], euler=[90.0, 0.0, 67.7])
16:44:43.329[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:43.329[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:43.330[inf][nning_a_star/global_planner.py] Found safe goal. x=2.87 y=1.62
16:44:43.331[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:43.351[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:43.355[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:44:43.983[inf][anning_a_star/local_planner.py] changed state state=path_following
16:44:44.855[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:44:44.856[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1204.848924
16:44:44.857[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.718, 1.598, 0.161] odom_goal_yaw_deg=-180.0 world_goal=[-1.473, -1.489, -3.745] world_goal_yaw_deg=-76.52
16:44:44.898[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.718, 1.598, 0.161], euler=[90.0, 0.0, -178.1])
16:44:44.898[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:44.899[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:44.899[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:44.900[inf][nning_a_star/global_planner.py] Found safe goal. x=2.67 y=1.57
16:44:44.926[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:44.932[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:44:45.566[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.828, 1.749, 0.167] odom_goal_yaw_deg=-0.0 world_goal=[-1.658, -1.483, -3.829] world_goal_yaw_deg=148.34
16:44:45.798[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.828, 1.749, 0.167], euler=[90.0, -0.0, 46.8])
16:44:45.799[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:45.799[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:45.800[inf][nning_a_star/global_planner.py] Found safe goal. x=2.82 y=1.72
16:44:45.800[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:45.843[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:45.847[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:44:45.857[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:44:45.860[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.691, 1.551, 0.161] odom_goal_yaw_deg=-180.0 world_goal=[-1.417, -1.489, -3.727] world_goal_yaw_deg=-59.27
16:44:45.933[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.134
16:44:45.946[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.691, 1.551, 0.161], euler=[90.0, 0.0, -160.9])
16:44:45.947[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:45.947[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:45.948[inf][nning_a_star/global_planner.py] Found safe goal. x=2.67 y=1.52
16:44:45.952[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:45.998[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:46.007[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:44:46.327[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.57, 1.204, 0.153] odom_goal_yaw_deg=-180.0 world_goal=[-1.02, -1.496, -3.673] world_goal_yaw_deg=2.15
16:44:46.522[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.570, 1.204, 0.153], euler=[90.0, 0.0, -99.4])
16:44:46.522[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:46.523[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:46.523[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:46.524[inf][nning_a_star/global_planner.py] Found safe goal. x=2.52 y=1.17
16:44:46.534[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:46.547[inf][anning_a_star/local_planner.py] changed state state=path_following
16:44:46.647[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.804, 1.285, 0.152] odom_goal_yaw_deg=-0.0 world_goal=[-1.158, -1.498, -3.906] world_goal_yaw_deg=111.45
16:44:46.647[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.804, 1.285, 0.152], euler=[90.0, 0.0, 9.9])
16:44:46.647[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:46.648[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:46.648[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:46.649[inf][nning_a_star/global_planner.py] Found safe goal. x=2.77 y=1.27
16:44:46.727[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:46.730[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:44:47.020[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:44:47.021[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1207.014111
16:44:47.022[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.621, 1.217, 0.155] odom_goal_yaw_deg=180.0 world_goal=[-1.046, -1.495, -3.725] world_goal_yaw_deg=-89.33
16:44:47.181[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.621, 1.217, 0.155], euler=[90.0, 0.0, 169.1])
16:44:47.181[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:47.181[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:47.182[inf][nning_a_star/global_planner.py] Found safe goal. x=2.57 y=1.17
16:44:47.182[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:47.193[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:47.198[inf][anning_a_star/local_planner.py] changed state state=path_following
16:44:47.498[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.464, 1.488, 0.16] odom_goal_yaw_deg=180.0 world_goal=[-1.3, -1.49, -3.499] world_goal_yaw_deg=-136.17
16:44:47.722[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.177, 1.39, 0.153] odom_goal_yaw_deg=-180.0 world_goal=[-1.133, -1.496, -3.215] world_goal_yaw_deg=-55.82
16:44:47.788[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.464, 1.488, 0.160], euler=[90.0, 0.0, 122.2])
16:44:47.788[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:47.789[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:47.789[inf][nning_a_star/global_planner.py] Found safe goal. x=2.42 y=1.47
16:44:47.790[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:47.819[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:47.823[inf][anning_a_star/local_planner.py] changed state state=path_following
16:44:47.838[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.177, 1.390, 0.153], euler=[90.0, 0.0, -157.4])
16:44:47.839[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:47.839[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:47.840[inf][nning_a_star/global_planner.py] Found safe goal. x=2.17 y=1.37
16:44:47.840[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:47.853[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:47.857[inf][anning_a_star/local_planner.py] changed state state=path_following
16:44:48.270[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:44:48.271[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.353, 1.31, 0.153] odom_goal_yaw_deg=-0.0 world_goal=[-1.086, -1.496, -3.419] world_goal_yaw_deg=49.31
16:44:48.540[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.353, 1.310, 0.153], euler=[90.0, 0.0, -52.3])
16:44:48.541[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:48.542[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:48.542[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:48.544[inf][nning_a_star/global_planner.py] Found safe goal. x=2.32 y=1.27
16:44:48.554[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:48.556[inf][anning_a_star/local_planner.py] changed state state=path_following
16:44:48.585[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.295, 1.488, 0.158] odom_goal_yaw_deg=-180.0 world_goal=[-1.264, -1.492, -3.318] world_goal_yaw_deg=-125.97
16:44:48.699[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.295, 1.488, 0.158], euler=[90.0, 0.0, 132.4])
16:44:48.700[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:48.700[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:48.701[inf][nning_a_star/global_planner.py] Found safe goal. x=2.27 y=1.47
16:44:48.703[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:48.718[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:48.721[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:44:49.624[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:44:49.626[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1209.61833
16:44:49.626[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.492, 1.511, 0.16] odom_goal_yaw_deg=-0.0 world_goal=[-1.331, -1.49, -3.524] world_goal_yaw_deg=148.09
16:44:49.817[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.492, 1.511, 0.160], euler=[90.0, 0.0, 46.5])
16:44:49.817[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:49.817[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:49.818[inf][nning_a_star/global_planner.py] Found safe goal. x=2.47 y=1.47
16:44:49.818[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:49.829[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:49.831[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:44:50.032[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.811, 1.328, 0.145] odom_goal_yaw_deg=0.0 world_goal=[-1.205, -1.505, -3.903] world_goal_yaw_deg=68.69
16:44:50.032[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.811, 1.328, 0.145], euler=[90.0, 0.0, -32.9])
16:44:50.033[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:50.033[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:50.033[inf][nning_a_star/global_planner.py] Found safe goal. x=2.77 y=1.32
16:44:50.034[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:50.047[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:50.049[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:44:50.410[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.013, 1.439, 0.147] odom_goal_yaw_deg=-0.0 world_goal=[-1.368, -1.503, -4.094] world_goal_yaw_deg=150.13
16:44:50.550[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.013, 1.439, 0.147], euler=[90.0, 0.0, 48.5])
16:44:50.550[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:50.551[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:50.551[inf][nning_a_star/global_planner.py] Found safe goal. x=2.97 y=1.42
16:44:50.551[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:50.563[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:50.565[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:44:50.815[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:44:50.816[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.818, 1.466, 0.145] odom_goal_yaw_deg=-180.0 world_goal=[-1.354, -1.504, -3.881] world_goal_yaw_deg=-46.1
16:44:50.877[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.818, 1.466, 0.145], euler=[90.0, 0.0, -147.7])
16:44:50.878[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:50.878[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:50.879[inf][nning_a_star/global_planner.py] Found safe goal. x=2.77 y=1.42
16:44:50.879[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:50.889[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:50.891[inf][anning_a_star/local_planner.py] changed state state=path_following
16:44:51.170[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.066, 1.5, 0.151] odom_goal_yaw_deg=0.0 world_goal=[-1.445, -1.499, -4.137] world_goal_yaw_deg=66.09
16:44:51.310[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.066, 1.500, 0.151], euler=[90.0, 0.0, -35.5])
16:44:51.310[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:51.311[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:51.312[inf][nning_a_star/global_planner.py] Found safe goal. x=3.02 y=1.47
16:44:51.317[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:51.329[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.018
16:44:51.332[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:51.346[inf][anning_a_star/local_planner.py] changed state state=path_following
16:44:51.546[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.363, 1.306, 0.161] odom_goal_yaw_deg=-0.0 world_goal=[-1.303, -1.489, -4.496] world_goal_yaw_deg=58.37
16:44:51.800[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.363, 1.306, 0.161], euler=[90.0, 0.0, -43.2])
16:44:51.801[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:51.801[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:51.801[inf][nning_a_star/global_planner.py] Found safe goal. x=3.32 y=1.27
16:44:51.802[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:51.811[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:51.813[inf][anning_a_star/local_planner.py] changed state state=path_following
16:44:52.008[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:44:52.010[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1212.002185
16:44:52.010[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.384, 1.49, 0.167] odom_goal_yaw_deg=-0.0 world_goal=[-1.504, -1.482, -4.478] world_goal_yaw_deg=160.35
16:44:52.036[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.384, 1.490, 0.167], euler=[90.0, 0.0, 58.8])
16:44:52.037[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:52.037[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:52.037[inf][nning_a_star/global_planner.py] Found safe goal. x=3.37 y=1.47
16:44:52.037[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:52.047[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:52.052[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:44:52.305[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.057, 1.584, 0.151] odom_goal_yaw_deg=180.0 world_goal=[-1.532, -1.499, -4.109] world_goal_yaw_deg=-118.76
16:44:52.499[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.057, 1.584, 0.151], euler=[90.0, 0.0, 139.7])
16:44:52.499[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:52.500[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:52.500[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:52.501[inf][nning_a_star/global_planner.py] Found safe goal. x=3.02 y=1.57
16:44:52.512[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:52.515[inf][anning_a_star/local_planner.py] changed state state=path_following
16:44:52.772[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.237, 1.776, 0.169] odom_goal_yaw_deg=-0.0 world_goal=[-1.776, -1.481, -4.259] world_goal_yaw_deg=150.69
16:44:52.821[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.237, 1.776, 0.169], euler=[90.0, 0.0, 49.1])
16:44:52.822[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:52.823[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:52.824[inf][nning_a_star/global_planner.py] Found safe goal. x=3.22 y=1.77
16:44:52.823[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:52.841[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:52.845[inf][anning_a_star/local_planner.py] changed state state=path_following
16:44:53.096[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:44:53.098[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.329, 1.614, 0.167] odom_goal_yaw_deg=0.0 world_goal=[-1.623, -1.483, -4.392] world_goal_yaw_deg=40.83
16:44:53.175[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.329, 1.614, 0.167], euler=[90.0, 0.0, -60.8])
16:44:53.177[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:53.178[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:53.178[inf][nning_a_star/global_planner.py] Found safe goal. x=3.32 y=1.57
16:44:53.179[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:53.190[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:53.192[inf][anning_a_star/local_planner.py] changed state state=path_following
16:44:53.378[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.508, 1.679, 0.168] odom_goal_yaw_deg=-0.0 world_goal=[-1.732, -1.481, -4.569] world_goal_yaw_deg=138.19
16:44:53.420[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.508, 1.679, 0.168], euler=[90.0, 0.0, 36.6])
16:44:53.420[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:53.420[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:53.420[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:53.421[inf][nning_a_star/global_planner.py] Found safe goal. x=3.47 y=1.67
16:44:53.431[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:53.433[inf][anning_a_star/local_planner.py] changed state state=path_following
16:44:53.734[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.651, 1.862, 0.174] odom_goal_yaw_deg=-0.0 world_goal=[-1.958, -1.475, -4.682] world_goal_yaw_deg=143.78
16:44:53.881[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.651, 1.862, 0.174], euler=[90.0, 0.0, 42.2])
16:44:53.882[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:53.882[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:53.883[inf][nning_a_star/global_planner.py] Found safe goal. x=3.62 y=1.82
16:44:53.883[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:53.893[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:53.898[inf][anning_a_star/local_planner.py] changed state state=path_following
16:44:54.109[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:44:54.110[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1214.102571
16:44:54.110[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.813, 2.002, 0.178] odom_goal_yaw_deg=-0.0 world_goal=[-2.143, -1.472, -4.823] world_goal_yaw_deg=155.35
16:44:54.111[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.813, 2.002, 0.178], euler=[90.0, 0.0, 53.8])
16:44:54.111[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:54.112[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:54.113[inf][nning_a_star/global_planner.py] Found safe goal. x=3.77 y=1.97
16:44:54.113[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:54.127[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:54.130[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:44:54.607[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.961, 2.12, 0.181] odom_goal_yaw_deg=-0.0 world_goal=[-2.301, -1.469, -4.955] world_goal_yaw_deg=127.23
16:44:54.624[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.961, 2.120, 0.181], euler=[90.0, 0.0, 25.6])
16:44:54.625[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:54.626[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:54.626[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:54.627[inf][nning_a_star/global_planner.py] Found safe goal. x=3.93 y=2.07
16:44:54.642[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:54.645[inf][anning_a_star/local_planner.py] changed state state=path_following
16:44:55.012[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.01, 2.299, 0.186] odom_goal_yaw_deg=-0.0 world_goal=[-2.502, -1.464, -4.968] world_goal_yaw_deg=-176.72
16:44:55.084[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.010, 2.299, 0.186], euler=[90.0, 0.0, 81.7])
16:44:55.084[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:55.085[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:55.085[inf][nning_a_star/global_planner.py] Found safe goal. x=3.98 y=2.27
16:44:55.088[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:55.172[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:55.178[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:44:55.479[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:44:55.480[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.154, 2.176, 0.182] odom_goal_yaw_deg=0.0 world_goal=[-2.402, -1.468, -5.148] world_goal_yaw_deg=55.81
16:44:55.710[inf][anning_a_star/local_planner.py] changed state state=path_following
16:44:55.734[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.154, 2.176, 0.182], euler=[90.0, 0.0, -45.8])
16:44:55.734[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:55.734[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:55.735[inf][nning_a_star/global_planner.py] Found safe goal. x=4.13 y=2.17
16:44:55.736[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:55.753[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:55.756[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:44:55.813[war][r/dimos/ar/bridge/telemetry.py] odom egress age age_max_s=0.611 age_s=0.07 base_world_y_m=-1.3416 base_world_y_max_m=None base_world_y_min_m=None odom_z_m=0.3082 odom_z_max_m=None odom_z_min_m=None pose_hz_cap=15.0
16:44:55.860[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.226, 1.952, 0.173], euler=[90.0, 0.0, -63.0])
16:44:55.861[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:55.861[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:55.861[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.226, 1.952, 0.173] odom_goal_yaw_deg=0.0 world_goal=[-2.18, -1.477, -5.274] world_goal_yaw_deg=38.59
16:44:55.861[inf][nning_a_star/global_planner.py] Found safe goal. x=4.23 y=1.92
16:44:55.861[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:55.935[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:55.938[inf][anning_a_star/local_planner.py] changed state state=path_following
16:44:56.201[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1216.193991
16:44:56.203[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.319, 1.679, 0.161] odom_goal_yaw_deg=180.0 world_goal=[-1.909, -1.489, -5.433] world_goal_yaw_deg=5.66
16:44:56.364[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.319, 1.679, 0.161], euler=[90.0, 0.0, -95.9])
16:44:56.364[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:56.365[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:56.365[inf][nning_a_star/global_planner.py] Found safe goal. x=4.28 y=1.67
16:44:56.366[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:56.375[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:56.377[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:44:56.447[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.071
16:44:57.215[inf][anning_a_star/local_planner.py] changed state state=path_following
16:44:57.778[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:44:57.779[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.448, 1.818, 0.167] odom_goal_yaw_deg=-0.0 world_goal=[-2.086, -1.483, -5.54] world_goal_yaw_deg=138.41
16:44:57.779[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.448, 1.818, 0.167], euler=[90.0, 0.0, 36.8])
16:44:57.779[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:57.780[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:57.780[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:57.781[inf][nning_a_star/global_planner.py] Found safe goal. x=4.43 y=1.77
16:44:57.796[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:57.799[inf][anning_a_star/local_planner.py] changed state state=path_following
16:44:58.069[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.517, 2.007, 0.176] odom_goal_yaw_deg=-0.0 world_goal=[-2.302, -1.474, -5.572] world_goal_yaw_deg=169.87
16:44:58.250[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.517, 2.007, 0.176], euler=[90.0, 0.0, 68.3])
16:44:58.251[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:58.251[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:58.252[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:58.252[inf][nning_a_star/global_planner.py] Found safe goal. x=4.48 y=1.97
16:44:58.266[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:58.271[inf][anning_a_star/local_planner.py] changed state state=path_following
16:44:58.669[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1218.661375
16:44:58.670[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.487, 2.198, 0.183] odom_goal_yaw_deg=180.0 world_goal=[-2.498, -1.466, -5.499] world_goal_yaw_deg=-157.77
16:44:58.886[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.487, 2.198, 0.183], euler=[90.0, 0.0, 100.6])
16:44:58.886[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:44:58.886[inf][anning_a_star/local_planner.py] changed state state=idle
16:44:58.887[inf][nning_a_star/global_planner.py] Found safe goal. x=4.48 y=2.17
16:44:58.887[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:44:58.901[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:44:58.904[inf][anning_a_star/local_planner.py] changed state state=path_following
16:45:00.022[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:45:00.024[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.318, 2.271, 0.188] odom_goal_yaw_deg=-180.0 world_goal=[-2.539, -1.462, -5.302] world_goal_yaw_deg=-163.32
16:45:00.115[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.318, 2.271, 0.188], euler=[90.0, 0.0, 95.1])
16:45:00.115[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:00.134[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:00.135[inf][nning_a_star/global_planner.py] Found safe goal. x=4.28 y=2.22
16:45:00.135[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:00.149[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:00.155[inf][anning_a_star/local_planner.py] changed state state=path_following
16:45:00.844[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1220.83641
16:45:00.844[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.391, 2.442, 0.195] odom_goal_yaw_deg=-0.0 world_goal=[-2.737, -1.455, -5.343] world_goal_yaw_deg=134.71
16:45:01.026[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.391, 2.442, 0.195], euler=[90.0, -0.0, 33.1])
16:45:01.026[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:01.027[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:01.027[inf][nning_a_star/global_planner.py] Found safe goal. x=4.38 y=2.42
16:45:01.028[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:01.042[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:01.049[inf][anning_a_star/local_planner.py] changed state state=path_following
16:45:01.416[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:45:01.417[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.307, 2.614, 0.199] odom_goal_yaw_deg=180.0 world_goal=[-2.902, -1.45, -5.215] world_goal_yaw_deg=-145.04
16:45:01.602[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.307, 2.614, 0.199], euler=[90.0, 0.0, 113.4])
16:45:01.602[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:01.603[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:01.603[war][nning_a_star/global_planner.py] Travelling to goal 0.20551445885864444m away from requested goal.
16:45:01.603[inf][nning_a_star/global_planner.py] Found safe goal. x=4.28 y=2.57
16:45:01.605[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:01.614[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:01.618[inf][anning_a_star/local_planner.py] changed state state=path_following
16:45:01.664[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.046
16:45:01.784[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.271, 2.815, 0.205] odom_goal_yaw_deg=-180.0 world_goal=[-3.109, -1.444, -5.133] world_goal_yaw_deg=-160.94
16:45:01.823[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.271, 2.815, 0.205], euler=[90.0, -0.0, 97.5])
16:45:01.823[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:01.824[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:01.824[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:01.824[war][nning_a_star/global_planner.py] Travelling to goal 0.21409924030639313m away from requested goal.
16:45:01.825[inf][nning_a_star/global_planner.py] Found safe goal. x=4.23 y=2.77
16:45:01.837[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:01.841[inf][anning_a_star/local_planner.py] changed state state=path_following
16:45:02.056[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.369, 3.184, 0.211] odom_goal_yaw_deg=0.0 world_goal=[-3.523, -1.439, -5.157] world_goal_yaw_deg=169.7
16:45:02.258[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.369, 3.184, 0.211], euler=[90.0, 0.0, 68.1])
16:45:02.258[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:02.258[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:02.259[war][nning_a_star/global_planner.py] Travelling to goal 0.21563669702563182m away from requested goal.
16:45:02.259[inf][nning_a_star/global_planner.py] Found safe goal. x=4.33 y=3.17
16:45:02.259[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:02.316[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:02.369[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:02.809[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:45:02.810[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.522, 3.076, 0.214] odom_goal_yaw_deg=-0.0 world_goal=[-3.442, -1.436, -5.343] world_goal_yaw_deg=36.49
16:45:02.907[inf][anning_a_star/local_planner.py] changed state state=path_following
16:45:02.948[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.522, 3.076, 0.214], euler=[90.0, 0.0, -65.1])
16:45:02.948[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:02.949[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:02.949[war][nning_a_star/global_planner.py] Travelling to goal 0.2187951827534196m away from requested goal.
16:45:02.949[inf][nning_a_star/global_planner.py] Found safe goal. x=4.48 y=3.07
16:45:02.950[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:02.961[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:02.977[inf][anning_a_star/local_planner.py] changed state state=path_following
16:45:03.585[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1223.57766
16:45:03.586[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.651, 3.213, 0.219] odom_goal_yaw_deg=-0.0 world_goal=[-3.615, -1.431, -5.452] world_goal_yaw_deg=-177.13
16:45:03.633[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.651, 3.213, 0.219], euler=[90.0, 0.0, 81.3])
16:45:03.633[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:03.634[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:03.634[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:03.634[war][nning_a_star/global_planner.py] Travelling to goal 0.2238890766886788m away from requested goal.
16:45:03.635[inf][nning_a_star/global_planner.py] Found safe goal. x=4.63 y=3.17
16:45:03.645[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:03.647[inf][anning_a_star/local_planner.py] changed state state=path_following
16:45:04.054[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:45:04.055[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.718, 3.385, 0.226] odom_goal_yaw_deg=-0.0 world_goal=[-3.814, -1.423, -5.485] world_goal_yaw_deg=176.5
16:45:04.238[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.718, 3.385, 0.226], euler=[90.0, 0.0, 74.9])
16:45:04.239[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:04.239[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:04.239[war][nning_a_star/global_planner.py] Travelling to goal 0.23073044227226347m away from requested goal.
16:45:04.240[inf][nning_a_star/global_planner.py] Found safe goal. x=4.68 y=3.37
16:45:04.240[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:04.267[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:04.269[inf][anning_a_star/local_planner.py] changed state state=path_following
16:45:04.903[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.726, 3.573, 0.235] odom_goal_yaw_deg=-180.0 world_goal=[-4.015, -1.415, -5.452] world_goal_yaw_deg=-141.82
16:45:04.936[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.726, 3.573, 0.235], euler=[90.0, 0.0, 116.6])
16:45:04.937[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:04.937[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:04.938[war][nning_a_star/global_planner.py] Travelling to goal 0.2394770853934164m away from requested goal.
16:45:04.938[inf][nning_a_star/global_planner.py] Found safe goal. x=4.73 y=3.52
16:45:04.938[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:04.950[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:04.956[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:05.264[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:45:05.265[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.593, 3.702, 0.234] odom_goal_yaw_deg=180.0 world_goal=[-4.124, -1.416, -5.283] world_goal_yaw_deg=-126.06
16:45:05.478[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.593, 3.702, 0.234], euler=[90.0, 0.0, 132.3])
16:45:05.478[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:05.479[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:05.479[war][nning_a_star/global_planner.py] Travelling to goal 0.2359806936701011m away from requested goal.
16:45:05.479[inf][nning_a_star/global_planner.py] Found safe goal. x=4.58 y=3.68
16:45:05.480[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:05.493[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:05.496[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:05.768[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1225.760263
16:45:05.769[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.495, 3.857, 0.238] odom_goal_yaw_deg=180.0 world_goal=[-4.268, -1.412, -5.144] world_goal_yaw_deg=-138.27
16:45:05.786[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.495, 3.857, 0.238], euler=[90.0, 0.0, 120.1])
16:45:05.786[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:05.787[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:05.787[war][nning_a_star/global_planner.py] Travelling to goal 0.24076685618820048m away from requested goal.
16:45:05.787[inf][nning_a_star/global_planner.py] Found safe goal. x=4.48 y=3.83
16:45:05.788[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:05.817[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:05.820[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:06.230[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.683, 3.874, 0.245] odom_goal_yaw_deg=0.0 world_goal=[-4.326, -1.405, -5.341] world_goal_yaw_deg=88.94
16:45:06.292[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.683, 3.874, 0.245], euler=[90.0, 0.0, -12.7])
16:45:06.293[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:06.293[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:06.294[war][nning_a_star/global_planner.py] Travelling to goal 0.2498058977484011m away from requested goal.
16:45:06.294[inf][nning_a_star/global_planner.py] Found safe goal. x=4.68 y=3.83
16:45:06.298[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:06.331[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:06.334[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:06.583[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:45:06.585[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.823, 3.721, 0.243] odom_goal_yaw_deg=-0.0 world_goal=[-4.194, -1.407, -5.524] world_goal_yaw_deg=61.59
16:45:06.777[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.823, 3.721, 0.243], euler=[90.0, 0.0, -40.0])
16:45:06.777[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:06.778[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:06.779[war][nning_a_star/global_planner.py] Travelling to goal 0.2516235466076974m away from requested goal.
16:45:06.780[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:06.781[inf][nning_a_star/global_planner.py] Found safe goal. x=4.78 y=3.68
16:45:06.792[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:06.795[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:06.847[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.07
16:45:06.899[inf][anning_a_star/local_planner.py] changed state state=path_following
16:45:07.993[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:45:07.994[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1227.986724
16:45:07.995[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.844, 3.908, 0.253] odom_goal_yaw_deg=-0.0 world_goal=[-4.398, -1.397, -5.505] world_goal_yaw_deg=-175.27
16:45:08.221[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.844, 3.908, 0.253], euler=[90.0, -0.0, 83.1])
16:45:08.221[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:08.221[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:08.223[war][nning_a_star/global_planner.py] Travelling to goal 0.2559988992235878m away from requested goal.
16:45:08.222[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:08.223[inf][nning_a_star/global_planner.py] Found safe goal. x=4.83 y=3.88
16:45:08.237[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:08.241[inf][anning_a_star/local_planner.py] changed state state=path_following
16:45:08.731[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.801, 4.091, 0.266] odom_goal_yaw_deg=180.0 world_goal=[-4.583, -1.384, -5.419] world_goal_yaw_deg=-130.75
16:45:08.864[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.801, 4.091, 0.266], euler=[90.0, 0.0, 127.7])
16:45:08.865[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:08.865[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:08.865[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:08.866[war][nning_a_star/global_planner.py] Travelling to goal 0.26776314944767204m away from requested goal.
16:45:08.866[inf][nning_a_star/global_planner.py] Found safe goal. x=4.78 y=4.08
16:45:08.881[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:08.883[inf][anning_a_star/local_planner.py] changed state state=path_following
16:45:09.268[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:45:09.269[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.767, 4.276, 0.281] odom_goal_yaw_deg=180.0 world_goal=[-4.773, -1.369, -5.342] world_goal_yaw_deg=-165.68
16:45:09.500[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.767, 4.276, 0.281], euler=[90.0, 0.0, 92.7])
16:45:09.502[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:09.502[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:09.502[war][nning_a_star/global_planner.py] Travelling to goal 0.28393599093420935m away from requested goal.
16:45:09.503[inf][nning_a_star/global_planner.py] Found safe goal. x=4.73 y=4.28
16:45:09.503[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:09.517[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:09.522[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:09.724[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.648, 4.417, 0.285] odom_goal_yaw_deg=-180.0 world_goal=[-4.897, -1.365, -5.185] world_goal_yaw_deg=-121.53
16:45:09.724[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.648, 4.417, 0.285], euler=[90.0, 0.0, 136.9])
16:45:09.725[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:09.726[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:09.726[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:09.726[war][nning_a_star/global_planner.py] Travelling to goal 0.2886844559364866m away from requested goal.
16:45:09.727[inf][nning_a_star/global_planner.py] Found safe goal. x=4.63 y=4.38
16:45:09.742[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:09.744[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:10.335[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:45:10.336[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1230.328226
16:45:10.336[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.543, 4.575, 0.291], euler=[90.0, 0.0, 126.9])
16:45:10.336[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.543, 4.575, 0.291] odom_goal_yaw_deg=-180.0 world_goal=[-5.043, -1.358, -5.038] world_goal_yaw_deg=-131.56
16:45:10.336[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:10.336[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:10.337[war][nning_a_star/global_planner.py] Travelling to goal 0.29606946755705793m away from requested goal.
16:45:10.337[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:10.337[inf][nning_a_star/global_planner.py] Found safe goal. x=4.53 y=4.53
16:45:10.351[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:10.354[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:10.756[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.557, 4.759, 0.307] odom_goal_yaw_deg=-0.0 world_goal=[-5.242, -1.343, -5.013] world_goal_yaw_deg=-169.84
16:45:10.858[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.557, 4.759, 0.307], euler=[90.0, 0.0, 88.6])
16:45:10.859[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:10.860[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:10.861[war][nning_a_star/global_planner.py] Travelling to goal 0.3102950978007313m away from requested goal.
16:45:10.861[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:10.861[inf][nning_a_star/global_planner.py] Found safe goal. x=4.53 y=4.73
16:45:10.893[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:10.898[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:11.427[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:45:11.429[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.725, 4.834, 0.314] odom_goal_yaw_deg=-0.0 world_goal=[-5.358, -1.335, -5.176] world_goal_yaw_deg=108.14
16:45:11.532[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.725, 4.834, 0.314], euler=[90.0, 0.0, 6.5])
16:45:11.533[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:11.533[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:11.534[war][nning_a_star/global_planner.py] Travelling to goal 0.3144182818868716m away from requested goal.
16:45:11.534[inf][nning_a_star/global_planner.py] Found safe goal. x=4.73 y=4.83
16:45:11.534[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:11.580[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:11.587[inf][anning_a_star/local_planner.py] changed state state=path_following
16:45:11.933[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.796, 5.008, 0.323] odom_goal_yaw_deg=180.0 world_goal=[-5.559, -1.326, -5.214] world_goal_yaw_deg=-157.78
16:45:12.143[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.796, 5.008, 0.323], euler=[90.0, 0.0, 100.6])
16:45:12.144[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:12.145[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:12.145[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:12.146[war][nning_a_star/global_planner.py] Travelling to goal 0.3255569170868879m away from requested goal.
16:45:12.147[inf][nning_a_star/global_planner.py] Found safe goal. x=4.78 y=4.98
16:45:12.203[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:12.218[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:12.244[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.029
16:45:12.327[inf][anning_a_star/local_planner.py] changed state state=path_following
16:45:12.443[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:45:12.444[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1232.436755
16:45:12.445[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.812, 5.192, 0.328], euler=[90.0, 0.0, 92.8])
16:45:12.445[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:12.445[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:12.445[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.812, 5.192, 0.328] odom_goal_yaw_deg=-180.0 world_goal=[-5.758, -1.322, -5.19] world_goal_yaw_deg=-165.64
16:45:12.446[war][nning_a_star/global_planner.py] Travelling to goal 0.3301810074153774m away from requested goal.
16:45:12.446[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:12.453[inf][nning_a_star/global_planner.py] Found safe goal. x=4.78 y=5.18
16:45:12.470[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:12.473[inf][anning_a_star/local_planner.py] changed state state=path_following
16:45:14.015[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:45:14.016[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.908, 5.245, 0.328] odom_goal_yaw_deg=-0.0 world_goal=[-5.836, -1.321, -5.281] world_goal_yaw_deg=119.74
16:45:14.124[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.908, 5.245, 0.328], euler=[90.0, -0.0, 18.1])
16:45:14.124[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:14.125[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:14.125[war][nning_a_star/global_planner.py] Travelling to goal 0.3304944194543303m away from requested goal.
16:45:14.125[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:14.125[inf][nning_a_star/global_planner.py] Found safe goal. x=4.88 y=5.23
16:45:14.144[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:14.149[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:14.990[inf][anning_a_star/local_planner.py] changed state state=path_following
16:45:17.861[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:45:17.865[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:45:19.762[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:45:19.763[inf][anning_a_star/local_planner.py] changed state state=arrived
16:45:19.872[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:19.872[inf][nning_a_star/global_planner.py] Arrived at goal.
16:45:19.873[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
16:45:19.980[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.107
▸ 16:45:19.989[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:45:19.990[inf][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.064
16:45:36.741[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:45:36.742[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1256.73457
16:45:36.743[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.896, 5.175, -0.035] odom_goal_yaw_deg=-0.0 world_goal=[-5.759, -1.684, -5.284] world_goal_yaw_deg=123.87
16:45:36.743[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.896, 5.175, -0.035], euler=[90.0, 0.0, 22.3])
16:45:36.743[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:36.744[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.0
16:45:36.744[inf][nning_a_star/global_planner.py] Found safe goal. x=4.88 y=5.13
16:45:36.753[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:36.753[inf][anning_a_star/local_planner.py] changed state state=path_following
16:45:36.754[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:45:36.754[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
16:45:36.754[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:45:36.754[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:45:36.754[inf][anning_a_star/local_planner.py] changed state state=arrived
16:45:36.864[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:36.865[inf][nning_a_star/global_planner.py] Arrived at goal.
16:45:36.865[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
16:45:36.894[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.925, 5.255, -0.003] odom_goal_yaw_deg=-0.0 world_goal=[-5.851, -1.653, -5.297] world_goal_yaw_deg=162.7
▸ 16:45:37.106[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:45:37.106[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.3
16:45:37.181[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.925, 5.255, -0.003], euler=[90.0, 0.0, 61.1])
16:45:37.181[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:37.182[inf][nning_a_star/global_planner.py] Found safe goal. x=4.88 y=5.23
16:45:37.193[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:37.195[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:37.491[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.89, 5.281, 0.013] odom_goal_yaw_deg=-180.0 world_goal=[-5.871, -1.636, -5.254] world_goal_yaw_deg=-155.89
16:45:37.758[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.890, 5.281, 0.013], euler=[90.0, 0.0, 102.5])
16:45:37.758[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:37.759[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:37.759[inf][nning_a_star/global_planner.py] Found safe goal. x=4.88 y=5.28
16:45:37.759[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:37.769[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:37.770[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:37.883[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:45:37.885[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.02, 5.435, 0.017] odom_goal_yaw_deg=0.0 world_goal=[-6.063, -1.633, -5.358] world_goal_yaw_deg=-174.96
16:45:37.937[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=3
16:45:37.985[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.020, 5.435, 0.017], euler=[90.0, 0.0, 83.4])
16:45:37.985[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:38.029[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:38.030[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:38.031[inf][nning_a_star/global_planner.py] Found safe goal. x=4.98 y=5.43
16:45:38.041[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:38.043[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:38.209[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.931, 5.705, 0.168] odom_goal_yaw_deg=180.0 world_goal=[-6.331, -1.482, -5.205] world_goal_yaw_deg=-131.97
16:45:38.462[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.931, 5.705, 0.168], euler=[90.0, 0.0, 126.4])
16:45:38.463[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:38.463[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:38.463[inf][nning_a_star/global_planner.py] Found safe goal. x=4.93 y=5.68
16:45:38.464[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:38.474[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:38.476[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:38.666[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.855, 6.093, 0.244] odom_goal_yaw_deg=180.0 world_goal=[-6.727, -1.405, -5.039] world_goal_yaw_deg=-141.32
16:45:38.746[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.855, 6.093, 0.244], euler=[90.0, 0.0, 117.1])
16:45:38.747[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:38.747[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:38.748[war][nning_a_star/global_planner.py] Travelling to goal 0.2467274170000969m away from requested goal.
16:45:38.748[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:38.748[inf][nning_a_star/global_planner.py] Found safe goal. x=4.83 y=6.08
16:45:38.836[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:38.839[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:38.962[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:45:38.963[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1258.955625
16:45:38.964[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.59, 6.354, 0.268] odom_goal_yaw_deg=180.0 world_goal=[-6.948, -1.382, -4.7] world_goal_yaw_deg=-111.28
16:45:39.277[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.492, 6.72, 0.29] odom_goal_yaw_deg=180.0 world_goal=[-7.317, -1.359, -4.515] world_goal_yaw_deg=-153.93
16:45:39.285[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.590, 6.354, 0.268], euler=[90.0, 0.0, 147.1])
16:45:39.285[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:39.286[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:39.286[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:39.286[war][nning_a_star/global_planner.py] Travelling to goal 0.2698249174250343m away from requested goal.
16:45:39.287[inf][nning_a_star/global_planner.py] Found safe goal. x=4.58 y=6.33
16:45:39.298[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:39.301[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:39.458[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.492, 6.720, 0.290], euler=[90.0, 0.0, 104.5])
16:45:39.458[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:39.459[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:39.459[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:39.460[war][nning_a_star/global_planner.py] Travelling to goal 0.2944011876909227m away from requested goal.
16:45:39.460[inf][nning_a_star/global_planner.py] Found safe goal. x=4.48 y=6.68
16:45:39.488[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:39.562[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:39.653[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.341, 6.906, 0.281] odom_goal_yaw_deg=180.0 world_goal=[-7.482, -1.369, -4.314] world_goal_yaw_deg=-123.96
16:45:39.709[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.341, 6.906, 0.281], euler=[90.0, 0.0, 134.4])
16:45:39.709[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:39.710[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:39.710[war][nning_a_star/global_planner.py] Travelling to goal 0.2827519210042092m away from requested goal.
16:45:39.710[inf][nning_a_star/global_planner.py] Found safe goal. x=4.33 y=6.88
16:45:39.711[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:39.745[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:39.751[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:39.972[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:45:39.974[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.151, 7.061, 0.267] odom_goal_yaw_deg=180.0 world_goal=[-7.605, -1.383, -4.078] world_goal_yaw_deg=-108.95
16:45:40.167[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.151, 7.061, 0.267], euler=[90.0, 0.0, 149.5])
16:45:40.167[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:40.168[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:40.168[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:40.169[war][nning_a_star/global_planner.py] Travelling to goal 0.27065250056549484m away from requested goal.
16:45:40.169[inf][nning_a_star/global_planner.py] Found safe goal. x=4.13 y=7.03
16:45:40.237[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:40.325[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.968, 7.229, 0.262] odom_goal_yaw_deg=180.0 world_goal=[-7.745, -1.388, -3.846] world_goal_yaw_deg=-116.56
16:45:40.401[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.968, 7.229, 0.262], euler=[90.0, 0.0, 141.8])
16:45:40.402[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:40.402[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:40.403[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:40.404[war][nning_a_star/global_planner.py] Travelling to goal 0.2653193800451461m away from requested goal.
16:45:40.404[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:40.404[inf][nning_a_star/global_planner.py] Found safe goal. x=3.93 y=7.23
16:45:40.438[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:40.443[inf][anning_a_star/local_planner.py] changed state state=path_following
16:45:40.712[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.999, 7.581, 0.256] odom_goal_yaw_deg=-0.0 world_goal=[-8.125, -1.394, -3.802] world_goal_yaw_deg=-170.99
16:45:40.956[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.999, 7.581, 0.256], euler=[90.0, 0.0, 87.4])
16:45:40.956[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:40.957[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:40.957[war][nning_a_star/global_planner.py] Travelling to goal 0.256674829927804m away from requested goal.
16:45:40.957[inf][nning_a_star/global_planner.py] Found safe goal. x=3.98 y=7.58
16:45:40.958[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:41.022[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:41.052[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:41.149[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:45:41.151[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1261.143744
16:45:41.152[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.935, 7.914, 0.253] odom_goal_yaw_deg=-180.0 world_goal=[-8.466, -1.396, -3.661] world_goal_yaw_deg=-150.81
16:45:41.153[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.955, 7.88, 0.254] odom_goal_yaw_deg=180.0 world_goal=[-8.435, -1.396, -3.691] world_goal_yaw_deg=-157.9
16:45:41.175[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.955, 7.880, 0.254], euler=[90.0, 0.0, 100.5])
16:45:41.217[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:41.218[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:41.219[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:41.220[war][nning_a_star/global_planner.py] Travelling to goal 0.2554805981408465m away from requested goal.
16:45:41.220[inf][nning_a_star/global_planner.py] Found safe goal. x=3.93 y=7.88
16:45:41.285[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:41.291[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.935, 7.914, 0.253], euler=[90.0, 0.0, 107.6])
16:45:41.291[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:41.292[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:41.292[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:41.293[war][nning_a_star/global_planner.py] Travelling to goal 0.25654902317050216m away from requested goal.
16:45:41.293[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:41.293[inf][nning_a_star/global_planner.py] Found safe goal. x=3.93 y=7.88
16:45:41.355[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:41.372[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:42.640[inf][anning_a_star/local_planner.py] changed state state=path_following
16:45:46.266[inf][anning_a_star/local_planner.py] Obstacle detected ahead, stopping local planner.
16:45:46.267[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:46.267[inf][nning_a_star/global_planner.py] Replanning path due to obstacle found.
16:45:46.267[inf][nning_a_star/global_planner.py] Replanning. attempt=0
16:45:46.267[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:46.268[war][nning_a_star/global_planner.py] Travelling to goal 0.25654902317050216m away from requested goal.
16:45:46.268[inf][nning_a_star/global_planner.py] Found safe goal. x=3.93 y=7.88
16:45:46.347[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:46.360[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:46.383[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.116
16:45:48.034[inf][anning_a_star/local_planner.py] changed state state=path_following
16:45:50.161[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:45:50.162[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1270.154404
16:45:50.163[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.97, 7.897, 0.238] odom_goal_yaw_deg=0.0 world_goal=[-8.456, -1.412, -3.702] world_goal_yaw_deg=99.97
16:45:50.384[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.970, 7.897, 0.238], euler=[90.0, 0.0, -1.6])
16:45:50.385[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:50.385[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:50.386[war][nning_a_star/global_planner.py] Travelling to goal 0.2427469464655542m away from requested goal.
16:45:50.386[inf][nning_a_star/global_planner.py] Found safe goal. x=3.93 y=7.88
16:45:50.387[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:50.443[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:50.447[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:51.817[inf][anning_a_star/local_planner.py] changed state state=path_following
16:45:52.009[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:45:52.010[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.946, 7.904, 0.234] odom_goal_yaw_deg=-0.0 world_goal=[-8.459, -1.415, -3.675] world_goal_yaw_deg=154.83
16:45:52.120[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.946, 7.904, 0.234], euler=[90.0, 0.0, 53.2])
16:45:52.121[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:52.121[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:52.122[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:52.122[war][nning_a_star/global_planner.py] Travelling to goal 0.2369735792179607m away from requested goal.
16:45:52.122[inf][nning_a_star/global_planner.py] Found safe goal. x=3.93 y=7.88
16:45:52.166[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:52.200[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.079
16:45:52.212[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:52.746[inf][anning_a_star/local_planner.py] changed state state=path_following
16:45:53.553[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:45:53.555[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1273.547053
16:45:53.555[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.821, 8.062, 0.229] odom_goal_yaw_deg=180.0 world_goal=[-8.599, -1.42, -3.508] world_goal_yaw_deg=-121.0
16:45:53.628[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.821, 8.062, 0.229], euler=[90.0, 0.0, 137.4])
16:45:53.628[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:53.629[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:53.629[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:53.629[war][nning_a_star/global_planner.py] Travelling to goal 0.2367845789759773m away from requested goal.
16:45:53.630[inf][nning_a_star/global_planner.py] Found safe goal. x=3.77 y=8.03
16:45:53.653[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:53.657[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:54.559[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:45:54.561[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.626, 8.056, 0.231] odom_goal_yaw_deg=-180.0 world_goal=[-8.551, -1.419, -3.301] world_goal_yaw_deg=-72.03
16:45:54.640[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.626, 8.056, 0.231], euler=[90.0, 0.0, -173.6])
16:45:54.640[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:54.640[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:54.641[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:54.641[war][nning_a_star/global_planner.py] Travelling to goal 0.23316930528110588m away from requested goal.
16:45:54.642[inf][nning_a_star/global_planner.py] Found safe goal. x=3.62 y=8.03
16:45:54.686[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:54.690[inf][anning_a_star/local_planner.py] changed state state=path_following
16:45:54.814[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.469, 8.272, 0.245] odom_goal_yaw_deg=180.0 world_goal=[-8.747, -1.404, -3.087] world_goal_yaw_deg=-144.04
16:45:55.002[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.469, 8.272, 0.245], euler=[90.0, 0.0, 114.4])
16:45:55.002[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:55.003[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:55.003[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:55.004[war][nning_a_star/global_planner.py] Travelling to goal 0.2539311687143076m away from requested goal.
16:45:55.005[inf][nning_a_star/global_planner.py] Found safe goal. x=3.42 y=8.23
16:45:55.055[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:55.059[inf][anning_a_star/local_planner.py] changed state state=path_following
16:45:55.418[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.611, 8.109, 0.235] odom_goal_yaw_deg=-180.0 world_goal=[-8.604, -1.415, -3.274] world_goal_yaw_deg=3.17
16:45:55.418[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.611, 8.109, 0.235], euler=[90.0, 0.0, -98.4])
16:45:55.419[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:55.419[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:55.419[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:55.420[war][nning_a_star/global_planner.py] Travelling to goal 0.23995778546679578m away from requested goal.
16:45:55.448[inf][nning_a_star/global_planner.py] Found safe goal. x=3.57 y=8.08
16:45:55.483[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:55.488[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:55.673[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:45:55.674[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1275.66662
16:45:55.675[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.751, 7.789, 0.226] odom_goal_yaw_deg=-0.0 world_goal=[-8.293, -1.424, -3.493] world_goal_yaw_deg=14.99
16:45:55.902[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.751, 7.789, 0.226], euler=[90.0, 0.0, -86.6])
16:45:55.903[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:55.904[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:55.904[war][nning_a_star/global_planner.py] Travelling to goal 0.22762684160729518m away from requested goal.
16:45:55.904[inf][nning_a_star/global_planner.py] Found safe goal. x=3.72 y=7.78
16:45:55.905[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:55.959[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:55.963[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:56.562[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.661, 7.627, 0.219] odom_goal_yaw_deg=0.0 world_goal=[-8.101, -1.431, -3.432] world_goal_yaw_deg=14.29
16:45:56.700[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.661, 7.627, 0.219], euler=[90.0, 0.0, -87.3])
16:45:56.700[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:56.701[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:56.701[war][nning_a_star/global_planner.py] Travelling to goal 0.22201124139146863m away from requested goal.
16:45:56.702[inf][nning_a_star/global_planner.py] Found safe goal. x=3.62 y=7.63
16:45:56.702[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:56.754[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:56.762[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:56.999[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:45:57.000[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.651, 7.821, 0.225] odom_goal_yaw_deg=-0.0 world_goal=[-8.306, -1.425, -3.379] world_goal_yaw_deg=174.05
16:45:57.263[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.712, 8.27, 0.235] odom_goal_yaw_deg=-0.0 world_goal=[-8.798, -1.415, -3.346] world_goal_yaw_deg=-169.36
16:45:57.287[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.651, 7.821, 0.225], euler=[90.0, 0.0, 72.5])
16:45:57.288[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:57.288[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:57.288[war][nning_a_star/global_planner.py] Travelling to goal 0.23095271131460401m away from requested goal.
16:45:57.288[inf][nning_a_star/global_planner.py] Found safe goal. x=3.62 y=7.78
16:45:57.289[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:57.322[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:57.327[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:57.441[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.712, 8.270, 0.235], euler=[90.0, -0.0, 89.0])
16:45:57.442[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:57.442[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:57.443[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:57.444[war][nning_a_star/global_planner.py] Travelling to goal 0.24193948666879345m away from requested goal.
16:45:57.444[inf][nning_a_star/global_planner.py] Found safe goal. x=3.67 y=8.23
16:45:57.484[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:57.493[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:57.519[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.231
16:45:57.708[inf][anning_a_star/local_planner.py] changed state state=path_following
16:45:57.802[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1277.793861
16:45:57.802[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.687, 8.481, 0.236] odom_goal_yaw_deg=180.0 world_goal=[-9.016, -1.414, -3.274] world_goal_yaw_deg=-166.15
16:45:57.879[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.687, 8.481, 0.236], euler=[90.0, 0.0, 92.3])
16:45:57.880[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:57.880[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:57.881[war][nning_a_star/global_planner.py] Travelling to goal 0.23636459218775027m away from requested goal.
16:45:57.881[inf][nning_a_star/global_planner.py] Found safe goal. x=3.67 y=8.48
16:45:57.882[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:57.930[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:57.935[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:58.029[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:45:58.030[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.644, 8.759, 0.246] odom_goal_yaw_deg=180.0 world_goal=[-9.303, -1.404, -3.167] world_goal_yaw_deg=-165.34
16:45:58.264[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.644, 8.759, 0.246], euler=[90.0, 0.0, 93.1])
16:45:58.264[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:58.264[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:58.265[war][nning_a_star/global_planner.py] Travelling to goal 0.24911747963756226m away from requested goal.
16:45:58.264[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:58.265[inf][nning_a_star/global_planner.py] Found safe goal. x=3.62 y=8.73
16:45:58.310[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:58.315[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:45:58.848[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.457, 8.778, 0.251] odom_goal_yaw_deg=180.0 world_goal=[-9.282, -1.398, -2.963] world_goal_yaw_deg=-103.19
16:45:59.144[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.457, 8.778, 0.251], euler=[90.0, 0.0, 155.2])
16:45:59.145[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:59.145[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:59.146[war][nning_a_star/global_planner.py] Travelling to goal 0.2532301376424013m away from requested goal.
16:45:59.147[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:59.147[inf][nning_a_star/global_planner.py] Found safe goal. x=3.42 y=8.78
16:45:59.190[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:59.196[inf][anning_a_star/local_planner.py] changed state state=path_following
16:45:59.256[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:45:59.257[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.364, 8.966, 0.258] odom_goal_yaw_deg=180.0 world_goal=[-9.463, -1.392, -2.824] world_goal_yaw_deg=-140.82
16:45:59.408[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.364, 8.966, 0.258], euler=[90.0, 0.0, 117.6])
16:45:59.412[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:59.412[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:59.413[war][nning_a_star/global_planner.py] Travelling to goal 0.2639651464108095m away from requested goal.
16:45:59.413[inf][nning_a_star/global_planner.py] Found safe goal. x=3.32 y=8.93
16:45:59.415[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:59.464[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:45:59.469[inf][anning_a_star/local_planner.py] changed state state=path_following
16:45:59.763[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.189, 9.024, 0.255] odom_goal_yaw_deg=180.0 world_goal=[-9.486, -1.394, -2.624] world_goal_yaw_deg=-95.43
16:45:59.989[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.189, 9.024, 0.255], euler=[90.0, 0.0, 163.0])
16:45:59.989[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:45:59.989[inf][anning_a_star/local_planner.py] changed state state=idle
16:45:59.990[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:45:59.990[war][nning_a_star/global_planner.py] Travelling to goal 0.2603848847680584m away from requested goal.
16:45:59.990[inf][nning_a_star/global_planner.py] Found safe goal. x=3.17 y=8.98
16:46:00.094[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:46:00.099[inf][anning_a_star/local_planner.py] changed state state=path_following
16:46:00.146[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1280.137811
16:46:00.146[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.091, 9.051, 0.255] odom_goal_yaw_deg=180.0 world_goal=[-9.494, -1.395, -2.515] world_goal_yaw_deg=-98.38
16:46:00.202[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.091, 9.051, 0.255], euler=[90.0, 0.0, 160.0])
16:46:00.203[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:46:00.203[inf][anning_a_star/local_planner.py] changed state state=idle
16:46:00.248[war][nning_a_star/global_planner.py] Travelling to goal 0.25643228797433376m away from requested goal.
16:46:00.249[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:46:00.249[inf][nning_a_star/global_planner.py] Found safe goal. x=3.07 y=9.03
16:46:00.273[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:46:00.278[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:46:00.382[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:46:00.383[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.962, 9.094, 0.256] odom_goal_yaw_deg=180.0 world_goal=[-9.511, -1.393, -2.368] world_goal_yaw_deg=-100.99
16:46:00.630[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.962, 9.094, 0.256], euler=[90.0, 0.0, 157.4])
16:46:00.630[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:46:00.631[inf][anning_a_star/local_planner.py] changed state state=idle
16:46:00.632[war][nning_a_star/global_planner.py] Travelling to goal 0.25968162290455915m away from requested goal.
16:46:00.632[inf][nning_a_star/global_planner.py] Found safe goal. x=2.92 y=9.08
16:46:00.633[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:46:00.659[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:46:00.664[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:46:00.990[inf][anning_a_star/local_planner.py] changed state state=path_following
16:46:09.031[war][imos/ar/navigation/navigate.py] AR navigation goal stalled stall_reason=no_path
16:46:09.033[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=0.0
16:46:09.033[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:46:09.034[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:46:09.034[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=cancel_nav_goal publish_mono=1289.025878
16:46:09.034[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:46:09.034[inf][anning_a_star/local_planner.py] changed state state=arrived
16:46:09.057[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:46:09.058[inf][anning_a_star/local_planner.py] changed state state=idle
16:46:09.058[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.0
16:46:09.058[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:46:17.787[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:46:17.789[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:46:17.981[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=176884 seq=10
16:46:17.981[war][tion/session/session_frames.py] AR camera frame dropped: too old frame_age_s=120.346 max_age_s=4.0 seq=10
16:46:18.207[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874778.013146 frame_age_s=0.0991 latest_residual_m=10.3237 observations_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=10.2297 residual_along_track_m=1.0799 residual_cross_track_m=10.267 residual_vertical_m=0.0342 robot_speed_ms=0.0 seq=11 source_ts_gap_s=0.029062 total_rejections=0 window_centroid_residual_m=10.3237
16:46:25.620[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:46:25.622[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1305.614321
16:46:25.623[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.898, 9.121, 0.059] odom_goal_yaw_deg=-180.0 world_goal=[-9.526, -1.591, -2.293] world_goal_yaw_deg=-97.77
16:46:25.845[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.898, 9.121, 0.059], euler=[90.0, 0.0, 160.6])
16:46:25.846[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:46:25.847[inf][nning_a_star/global_planner.py] Found safe goal. x=2.87 y=9.08
16:46:25.864[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:46:25.871[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:46:25.918[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.072
16:46:25.992[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=3
16:46:26.172[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.723, 9.202, 0.013] odom_goal_yaw_deg=180.0 world_goal=[-9.574, -1.636, -2.089] world_goal_yaw_deg=-99.11
16:46:26.379[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.528, 9.323, 0.045] odom_goal_yaw_deg=180.0 world_goal=[-9.66, -1.605, -1.855] world_goal_yaw_deg=-111.56
16:46:26.504[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.723, 9.202, 0.013], euler=[90.0, 0.0, 159.3])
16:46:26.505[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:46:26.505[inf][anning_a_star/local_planner.py] changed state state=idle
16:46:26.506[inf][nning_a_star/global_planner.py] Found safe goal. x=2.67 y=9.23
16:46:26.507[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:46:26.521[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:46:26.523[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:46:26.617[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.528, 9.323, 0.045], euler=[90.0, 0.0, 146.8])
16:46:26.617[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:46:26.617[inf][anning_a_star/local_planner.py] changed state state=idle
16:46:26.618[inf][nning_a_star/global_planner.py] Found safe goal. x=2.52 y=9.33
16:46:26.618[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:46:26.637[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:46:26.639[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:46:27.229[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:46:27.231[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.401, 9.542, 0.101] odom_goal_yaw_deg=180.0 world_goal=[-9.866, -1.549, -1.672] world_goal_yaw_deg=-115.86
16:46:27.483[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.401, 9.542, 0.101], euler=[90.0, 0.0, 142.6])
16:46:27.483[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:46:27.483[inf][anning_a_star/local_planner.py] changed state state=idle
16:46:27.484[inf][nning_a_star/global_planner.py] Found safe goal. x=2.37 y=9.53
16:46:27.484[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:46:27.500[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:46:27.502[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:46:27.593[inf][anning_a_star/local_planner.py] changed state state=path_following
16:46:27.749[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1307.741118
16:46:27.750[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.814, 10.405, 0.272] odom_goal_yaw_deg=-180.0 world_goal=[-10.657, -1.378, -0.858] world_goal_yaw_deg=-126.79
16:46:27.787[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.814, 10.405, 0.272], euler=[90.0, 0.0, 131.6])
16:46:27.788[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:46:27.788[inf][anning_a_star/local_planner.py] changed state state=idle
16:46:27.789[war][nning_a_star/global_planner.py] Travelling to goal 0.276563419340998m away from requested goal.
16:46:27.789[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:46:27.789[inf][nning_a_star/global_planner.py] Found safe goal. x=1.77 y=10.38
16:46:27.833[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:46:27.836[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:46:27.971[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.646, 11.715, 0.341] odom_goal_yaw_deg=-180.0 world_goal=[-11.797, -1.308, 0.672] world_goal_yaw_deg=-127.77
16:46:28.313[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:46:28.314[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.122, 12.411, 0.37] odom_goal_yaw_deg=180.0 world_goal=[-12.424, -1.28, 1.383] world_goal_yaw_deg=-144.12
16:46:28.336[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.646, 11.715, 0.341], euler=[90.0, 0.0, 130.6])
16:46:28.336[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:46:28.337[inf][anning_a_star/local_planner.py] changed state state=idle
16:46:28.337[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:46:28.338[war][nning_a_star/global_planner.py] Travelling to goal 0.3442926778449571m away from requested goal.
16:46:28.338[inf][nning_a_star/global_planner.py] Found safe goal. x=0.62 y=11.68
16:46:28.576[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:46:28.611[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:46:28.612[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.122, 12.411, 0.370], euler=[90.0, 0.0, 114.3])
16:46:28.613[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:46:28.613[inf][anning_a_star/local_planner.py] changed state state=idle
16:46:28.614[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:46:28.688[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:46:28.695[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:46:28.761[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.305, 12.046, 0.364] odom_goal_yaw_deg=-180.0 world_goal=[-12.075, -1.286, 1.108] world_goal_yaw_deg=-8.28
16:46:28.762[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.305, 12.046, 0.364], euler=[90.0, 0.0, -109.9])
16:46:28.763[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:46:28.764[inf][anning_a_star/local_planner.py] changed state state=idle
16:46:28.765[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:46:28.765[war][nning_a_star/global_planner.py] Travelling to goal 0.3657267695860927m away from requested goal.
16:46:28.766[inf][nning_a_star/global_planner.py] Found safe goal. x=0.27 y=12.03
16:46:29.020[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.883, 11.273, 0.336] odom_goal_yaw_deg=-0.0 world_goal=[-11.378, -1.313, 0.324] world_goal_yaw_deg=34.33
16:46:29.342[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:46:29.378[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.883, 11.273, 0.336], euler=[90.0, 0.0, -67.3])
16:46:29.378[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:46:29.379[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:46:29.400[inf][anning_a_star/local_planner.py] changed state state=idle
16:46:29.402[war][nning_a_star/global_planner.py] Travelling to goal 0.3400348184685909m away from requested goal.
16:46:29.403[inf][nning_a_star/global_planner.py] Found safe goal. x=0.87 y=11.23
16:46:29.413[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:46:29.765[war][nning_a_star/global_planner.py] No path found to the goal. x=0.875 y=11.225
16:46:29.773[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:46:29.777[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:46:29.778[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=0.0
16:46:29.781[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=emergency_stop publish_mono=1309.772591
16:46:29.990[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:46:29.993[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.816, 11.226, 0.343] odom_goal_yaw_deg=-180.0 world_goal=[-11.314, -1.307, 0.384] world_goal_yaw_deg=-30.36
16:46:30.003[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.816, 11.226, 0.343], euler=[90.0, 0.0, -131.9])
16:46:30.003[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:46:30.005[war][nning_a_star/global_planner.py] Travelling to goal 0.3453038338212292m away from requested goal.
16:46:30.006[inf][nning_a_star/global_planner.py] Found safe goal. x=0.77 y=11.23
16:46:30.067[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:46:30.078[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:46:30.090[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=39
16:46:30.091[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.813, 11.247, 0.343] odom_goal_yaw_deg=180.0 world_goal=[-11.335, -1.307, 0.392] world_goal_yaw_deg=-104.34
16:46:30.092[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.813, 11.247, 0.343], euler=[90.0, 0.0, 154.1])
16:46:30.092[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:46:30.092[inf][anning_a_star/local_planner.py] changed state state=idle
16:46:30.093[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:46:30.094[war][nning_a_star/global_planner.py] Travelling to goal 0.3455391844306008m away from requested goal.
16:46:30.094[inf][nning_a_star/global_planner.py] Found safe goal. x=0.77 y=11.23
16:46:30.131[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:46:30.175[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:46:33.325[inf][anning_a_star/local_planner.py] changed state state=path_following
16:46:38.350[war][imos/ar/navigation/navigate.py] AR navigation goal stalled stall_reason=no_path
16:46:38.352[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=0.1
16:46:38.353[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=cancel_nav_goal publish_mono=1318.344789
16:46:38.366[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:46:38.368[inf][anning_a_star/local_planner.py] changed state state=idle
16:46:38.368[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:46:38.368[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.001
16:47:01.790[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:47:01.803[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1341.794515
16:47:01.804[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.875, 11.063, 0.342] odom_goal_yaw_deg=-180.0 world_goal=[-11.153, -1.307, 0.286] world_goal_yaw_deg=-15.25
16:47:01.803[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.875, 11.063, 0.342], euler=[90.0, 0.0, -116.8])
16:47:01.805[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:47:01.806[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.001
16:47:01.806[war][nning_a_star/global_planner.py] Travelling to goal 0.3481580205487774m away from requested goal.
16:47:01.807[inf][nning_a_star/global_planner.py] Found safe goal. x=0.82 y=11.03
16:47:01.861[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:47:01.874[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:47:01.878[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=29
16:47:02.200[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.125, 10.729, 0.312], euler=[90.0, 0.0, -51.7])
16:47:02.199[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.125, 10.729, 0.312] odom_goal_yaw_deg=0.0 world_goal=[-10.852, -1.338, -0.054] world_goal_yaw_deg=49.9
16:47:02.200[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:47:02.200[inf][anning_a_star/local_planner.py] changed state state=idle
16:47:02.201[war][nning_a_star/global_planner.py] Travelling to goal 0.311608972376658m away from requested goal.
16:47:02.202[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:47:02.202[inf][nning_a_star/global_planner.py] Found safe goal. x=1.12 y=10.73
16:47:02.276[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:47:02.284[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:47:02.577[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.562, 10.355, 0.339] odom_goal_yaw_deg=-0.0 world_goal=[-10.549, -1.311, -0.601] world_goal_yaw_deg=54.85
16:47:02.604[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.562, 10.355, 0.339], euler=[90.0, -0.0, -46.7])
16:47:02.605[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:47:02.605[inf][anning_a_star/local_planner.py] changed state state=idle
16:47:02.605[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:47:02.606[war][nning_a_star/global_planner.py] Travelling to goal 0.3422696677593894m away from requested goal.
16:47:02.607[inf][nning_a_star/global_planner.py] Found safe goal. x=1.52 y=10.33
16:47:02.668[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:47:02.672[inf][anning_a_star/local_planner.py] changed state state=path_following
16:47:02.850[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:47:02.852[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.881, 10.031, 0.298] odom_goal_yaw_deg=0.0 world_goal=[-10.272, -1.352, -1.011] world_goal_yaw_deg=64.28
16:47:02.852[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.881, 10.031, 0.298], euler=[90.0, 0.0, -37.3])
16:47:02.852[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:47:02.852[inf][anning_a_star/local_planner.py] changed state state=idle
16:47:02.853[war][nning_a_star/global_planner.py] Travelling to goal 0.29791139499841174m away from requested goal.
16:47:02.853[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:47:02.854[inf][nning_a_star/global_planner.py] Found safe goal. x=1.87 y=10.03
16:47:02.868[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:47:02.884[inf][anning_a_star/local_planner.py] changed state state=path_following
16:47:04.971[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:47:04.973[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:47:07.675[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:47:07.678[inf][anning_a_star/local_planner.py] changed state state=arrived
16:47:07.778[inf][anning_a_star/local_planner.py] changed state state=idle
16:47:07.778[inf][nning_a_star/global_planner.py] Arrived at goal.
16:47:07.778[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.001
16:47:07.779[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:47:07.782[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:47:07.783[inf][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.005
16:48:00.373[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:48:00.386[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1400.377988
16:48:00.388[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.863, 10.022, -0.032] odom_goal_yaw_deg=-0.0 world_goal=[-10.259, -1.681, -0.994] world_goal_yaw_deg=47.62
16:48:00.467[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.863, 10.022, -0.032], euler=[90.0, 0.0, -54.0])
16:48:00.480[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:00.483[inf][nning_a_star/global_planner.py] Found safe goal. x=1.82 y=9.98
16:48:00.486[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.004
16:48:00.539[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:00.541[inf][anning_a_star/local_planner.py] changed state state=path_following
16:48:00.542[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:48:00.543[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:48:00.543[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:48:00.543[inf][anning_a_star/local_planner.py] changed state state=arrived
16:48:00.606[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
16:48:00.645[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:00.647[inf][nning_a_star/global_planner.py] Arrived at goal.
16:48:00.647[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:48:00.689[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:48:00.690[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
16:48:00.736[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.576, 9.527, 0.324] odom_goal_yaw_deg=-180.0 world_goal=[-9.669, -1.326, -0.797] world_goal_yaw_deg=-21.59
16:48:00.738[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.576, 9.527, 0.324], euler=[90.0, 0.0, -123.2])
16:48:00.739[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:00.739[war][nning_a_star/global_planner.py] Travelling to goal 0.3237597011251078m away from requested goal.
16:48:00.740[inf][nning_a_star/global_planner.py] Found safe goal. x=1.57 y=9.53
16:48:00.755[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:00.760[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:48:00.762[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=7
16:48:00.873[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.46, 9.51, 0.332] odom_goal_yaw_deg=-180.0 world_goal=[-9.626, -1.318, -0.677] world_goal_yaw_deg=-41.93
16:48:00.873[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.460, 9.510, 0.332], euler=[90.0, 0.0, -143.5])
16:48:00.874[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:00.874[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:00.875[war][nning_a_star/global_planner.py] Travelling to goal 0.3355287782004729m away from requested goal.
16:48:00.875[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:48:00.876[inf][nning_a_star/global_planner.py] Found safe goal. x=1.42 y=9.48
16:48:00.890[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:00.892[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:48:01.082[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.236, 9.516, 0.329], euler=[90.0, 0.0, -179.5])
16:48:01.082[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.236, 9.516, 0.329] odom_goal_yaw_deg=180.0 world_goal=[-9.584, -1.321, -0.437] world_goal_yaw_deg=-77.9
16:48:01.083[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:01.083[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:01.083[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:48:01.085[war][nning_a_star/global_planner.py] Travelling to goal 0.3319614913323158m away from requested goal.
16:48:01.085[inf][nning_a_star/global_planner.py] Found safe goal. x=1.22 y=9.48
16:48:01.097[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:01.103[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:48:02.540[inf][anning_a_star/local_planner.py] changed state state=path_following
16:48:04.714[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:48:04.716[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:48:04.716[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:48:04.717[inf][anning_a_star/local_planner.py] changed state state=arrived
16:48:04.777[inf][nning_a_star/global_planner.py] Close enough to goal. Accepting as arrived.
16:48:04.778[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
16:48:04.779[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:04.779[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
▸ 16:48:04.941[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:48:04.941[inf][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.15
16:48:10.684[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:48:10.686[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1410.677989
16:48:10.688[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.31, 9.396, -0.028] odom_goal_yaw_deg=180.0 world_goal=[-9.471, -1.678, -0.542] world_goal_yaw_deg=-74.7
16:48:10.690[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.310, 9.396, -0.028], euler=[90.0, 0.0, -176.3])
16:48:10.690[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:10.691[inf][nning_a_star/global_planner.py] Found safe goal. x=1.28 y=9.38
16:48:10.692[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.001
16:48:10.706[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:10.707[inf][anning_a_star/local_planner.py] changed state state=path_following
16:48:10.707[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:48:10.707[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
16:48:10.708[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:48:10.708[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:48:10.708[inf][anning_a_star/local_planner.py] changed state state=arrived
16:48:10.812[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:10.813[inf][nning_a_star/global_planner.py] Arrived at goal.
16:48:10.813[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:48:10.814[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:48:10.815[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
16:48:10.946[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.793, 9.565, 0.243], euler=[90.0, 0.0, 163.3])
16:48:10.946[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:10.946[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.793, 9.565, 0.243] odom_goal_yaw_deg=180.0 world_goal=[-9.539, -1.407, 0.047] world_goal_yaw_deg=-95.14
16:48:10.947[war][nning_a_star/global_planner.py] Travelling to goal 0.24658648861214746m away from requested goal.
16:48:10.947[inf][nning_a_star/global_planner.py] Found safe goal. x=0.78 y=9.53
16:48:10.962[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:10.966[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:48:10.971[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=8
16:48:11.093[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.753, 9.591, 0.278] odom_goal_yaw_deg=180.0 world_goal=[-9.558, -1.372, 0.094] world_goal_yaw_deg=-99.27
16:48:11.233[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.753, 9.591, 0.278], euler=[90.0, 0.0, 159.1])
16:48:11.234[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:11.234[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:11.235[war][nning_a_star/global_planner.py] Travelling to goal 0.279540424466871m away from requested goal.
16:48:11.235[inf][nning_a_star/global_planner.py] Found safe goal. x=0.73 y=9.58
16:48:11.236[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:48:11.292[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:11.301[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:48:11.510[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.615, 9.654, 0.322] odom_goal_yaw_deg=180.0 world_goal=[-9.594, -1.328, 0.255] world_goal_yaw_deg=-100.43
16:48:11.510[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.615, 9.654, 0.322], euler=[90.0, 0.0, 158.0])
16:48:11.511[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:11.512[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:11.513[war][nning_a_star/global_planner.py] Travelling to goal 0.3259763392688588m away from requested goal.
16:48:11.514[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:48:11.514[inf][nning_a_star/global_planner.py] Found safe goal. x=0.58 y=9.63
16:48:11.532[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:11.535[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:48:12.268[inf][anning_a_star/local_planner.py] changed state state=path_following
16:48:14.870[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:48:14.870[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:48:15.283[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:48:15.283[inf][anning_a_star/local_planner.py] changed state state=arrived
16:48:15.388[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:15.388[inf][nning_a_star/global_planner.py] Arrived at goal.
16:48:15.389[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:48:15.390[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:48:15.391[inf][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.139
16:48:16.100[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:48:16.101[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:48:16.310[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=144839 seq=18
16:48:16.311[war][tion/session/session_frames.py] AR camera frame dropped: too old frame_age_s=116.524 max_age_s=4.0 seq=18
16:48:16.571[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874896.310531 frame_age_s=0.0857 latest_residual_m=10.8687 observations_added=0 regime=static rej_distance=0 rej_innovation=1 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=10.7963 residual_along_track_m=-7.5887 residual_cross_track_m=7.7807 residual_vertical_m=0.0221 robot_speed_ms=0.0 seq=19 source_ts_gap_s=0.001724 total_rejections=1 window_centroid_residual_m=10.8687
16:48:16.864[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
16:48:18.521[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=173308 seq=24
16:48:18.829[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874898.577169 frame_age_s=0.1079 latest_residual_m=0.9099 observations_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0146 residual_along_track_m=0.7884 residual_cross_track_m=0.3823 residual_vertical_m=0.2453 robot_speed_ms=0.001 seq=25 source_ts_gap_s=0.00433 total_rejections=0 window_centroid_residual_m=0.9077
16:48:20.533[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=169428 seq=30
16:48:20.878[war][s/ar/world_frame/transforms.py] gravity_level_transform: input up-axis far from world-up (angle=15.6 deg) — registration input likely malformed; this warning is rate-limited to once per 30 s
16:48:20.880[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874900.577116 frame_age_s=0.0794 latest_residual_m=0.9019 observations_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.093 residual_along_track_m=0.7747 residual_cross_track_m=0.372 residual_vertical_m=0.2736 robot_speed_ms=0.0 seq=31 source_ts_gap_s=0.039681 total_rejections=0 window_centroid_residual_m=0.9048
16:48:25.836[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
16:48:25.843[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles max_capture_distance_m=1.3981 resolution=1008x756
16:48:25.913[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=180979 seq=35
16:48:25.938[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783874902.410366 frame_age_s=3.3668 latest_residual_m=0.894 observations_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.2319 residual_along_track_m=0.7835 residual_cross_track_m=0.3612 residual_vertical_m=0.2342 robot_speed_ms=0.0 seq=35 source_ts_gap_s=0.067307 total_rejections=0 window_centroid_residual_m=0.9034
16:48:27.660[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:48:27.663[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1427.654502
16:48:27.663[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.483, 9.568, -0.028], euler=[90.0, 0.0, 143.3])
16:48:27.664[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.483, 9.568, -0.028] odom_goal_yaw_deg=180.0 world_goal=[-9.475, -1.678, 0.377] world_goal_yaw_deg=-115.08
16:48:27.664[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:27.666[inf][nning_a_star/global_planner.py] Found safe goal. x=0.48 y=9.53
16:48:27.678[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.013
16:48:27.691[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:27.701[inf][anning_a_star/local_planner.py] changed state state=path_following
16:48:27.702[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
16:48:27.702[inf][anning_a_star/local_planner.py] changed state state=final_rotation
16:48:27.702[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
16:48:27.702[inf][anning_a_star/local_planner.py] changed state state=arrived
16:48:27.710[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
16:48:27.805[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:27.806[inf][nning_a_star/global_planner.py] Arrived at goal.
16:48:27.806[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 16:48:27.808[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
16:48:27.808[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
16:48:27.932[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.038, 9.584, 0.165] odom_goal_yaw_deg=180.0 world_goal=[-9.394, -1.485, 0.854] world_goal_yaw_deg=-82.28
16:48:27.932[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.038, 9.584, 0.165], euler=[90.0, 0.0, 176.1])
16:48:27.933[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:27.934[inf][nning_a_star/global_planner.py] Found safe goal. x=0.03 y=9.58
16:48:27.952[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:27.954[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:48:27.956[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=7
16:48:28.326[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.621, 9.622, 0.348] odom_goal_yaw_deg=180.0 world_goal=[-9.29, -1.302, 1.565] world_goal_yaw_deg=-86.45
16:48:28.444[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.621, 9.622, 0.348], euler=[90.0, 0.0, 172.0])
16:48:28.445[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:28.446[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:28.446[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:48:28.451[war][nning_a_star/global_planner.py] Travelling to goal 0.40791145730525225m away from requested goal.
16:48:28.451[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.77 y=9.48
16:48:28.509[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:28.516[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:48:28.734[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:48:28.735[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-1.306, 9.444, 0.35] odom_goal_yaw_deg=180.0 world_goal=[-8.951, -1.299, 2.256] world_goal_yaw_deg=-54.13
16:48:28.738[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-1.306, 9.444, 0.350], euler=[90.0, 0.0, -155.7])
16:48:28.738[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:28.738[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:28.739[war][nning_a_star/global_planner.py] Travelling to goal 0.3514606883514871m away from requested goal.
16:48:28.739[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:48:28.739[inf][nning_a_star/global_planner.py] Found safe goal. x=-1.32 y=9.43
16:48:28.774[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:28.783[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:48:28.968[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-1.894, 9.245, 0.346] odom_goal_yaw_deg=-180.0 world_goal=[-8.611, -1.304, 2.838] world_goal_yaw_deg=-63.68
16:48:28.968[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-1.894, 9.245, 0.346], euler=[90.0, 0.0, -165.3])
16:48:28.969[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:28.969[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:28.970[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:48:28.970[war][nning_a_star/global_planner.py] Travelling to goal 0.3481319632165046m away from requested goal.
16:48:28.971[inf][nning_a_star/global_planner.py] Found safe goal. x=-1.92 y=9.23
16:48:29.015[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:29.024[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:48:29.251[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-2.809, 9.103, 0.365] odom_goal_yaw_deg=-180.0 world_goal=[-8.26, -1.285, 3.782] world_goal_yaw_deg=-68.62
16:48:29.322[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-2.809, 9.103, 0.365], euler=[90.0, 0.0, -170.2])
16:48:29.323[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:29.324[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:29.324[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:48:29.505[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:29.519[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:48:29.673[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1429.664509
16:48:29.674[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-3.13, 9.045, 0.397] odom_goal_yaw_deg=-180.0 world_goal=[-8.127, -1.253, 4.112] world_goal_yaw_deg=-70.06
16:48:29.674[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-3.130, 9.045, 0.397], euler=[90.0, 0.0, -171.7])
16:48:29.674[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:29.675[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:29.675[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:48:29.790[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:29.795[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:48:30.177[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:48:30.178[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-3.464, 8.805, 0.385] odom_goal_yaw_deg=-180.0 world_goal=[-7.799, -1.265, 4.414] world_goal_yaw_deg=-66.85
16:48:30.180[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-3.464, 8.805, 0.385], euler=[90.0, 0.0, -168.4])
16:48:30.181[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:30.182[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:30.182[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:48:30.465[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-2.55, 8.566, 0.35] odom_goal_yaw_deg=-0.0 world_goal=[-7.745, -1.299, 3.389] world_goal_yaw_deg=90.95
16:48:30.518[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:30.531[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-2.550, 8.566, 0.350], euler=[90.0, 0.0, -10.6])
16:48:30.532[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:48:30.533[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:30.534[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:30.534[war][nning_a_star/global_planner.py] Travelling to goal 0.35370579754954445m away from requested goal.
16:48:30.534[inf][nning_a_star/global_planner.py] Found safe goal. x=-2.57 y=8.53
16:48:30.535[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:48:30.567[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:30.577[inf][anning_a_star/local_planner.py] changed state state=path_following
16:48:30.806[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-1.866, 8.594, 0.352], euler=[90.0, 0.0, -61.7])
16:48:30.807[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:30.807[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-1.866, 8.594, 0.352] odom_goal_yaw_deg=-0.0 world_goal=[-7.923, -1.297, 2.667] world_goal_yaw_deg=39.84
16:48:30.807[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:30.808[war][nning_a_star/global_planner.py] Travelling to goal 0.3530986460575029m away from requested goal.
16:48:30.808[inf][nning_a_star/global_planner.py] Found safe goal. x=-1.87 y=8.58
16:48:30.808[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:48:30.853[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:30.860[inf][anning_a_star/local_planner.py] changed state state=path_following
16:48:31.194[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:48:31.196[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-2.840, 7.737, 0.336], euler=[90.0, 0.0, -133.8])
16:48:31.196[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-2.84, 7.737, 0.336] odom_goal_yaw_deg=-180.0 world_goal=[-6.798, -1.314, 3.516] world_goal_yaw_deg=-32.17
16:48:31.196[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:31.197[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:31.197[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:48:31.537[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:31.563[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-4.038, 6.684, 0.284] odom_goal_yaw_deg=-180.0 world_goal=[-5.415, -1.366, 4.563] world_goal_yaw_deg=-31.68
16:48:31.568[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:48:31.568[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-4.038, 6.684, 0.284], euler=[90.0, 0.0, -133.3])
16:48:31.569[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:31.570[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:31.570[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:48:31.602[war][nning_a_star/global_planner.py] No path found to the goal. x=-4.038 y=6.684
16:48:31.602[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:48:31.604[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:48:31.604[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=0.0
16:48:32.311[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:48:32.316[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-4.136, 6.516, 0.299], euler=[90.0, 0.0, -130.0])
16:48:32.317[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1432.308029
16:48:32.317[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-4.136, 6.516, 0.299] odom_goal_yaw_deg=-180.0 world_goal=[-5.214, -1.351, 4.63] world_goal_yaw_deg=-28.41
16:48:32.317[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:32.363[war][nning_a_star/global_planner.py] No path found to the goal. x=-4.136 y=6.516
16:48:32.363[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:48:32.364[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:48:32.504[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-4.094, 6.420, 0.300], euler=[90.0, 0.0, -94.3])
16:48:32.504[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-4.094, 6.42, 0.3] odom_goal_yaw_deg=-180.0 world_goal=[-5.121, -1.35, 4.565] world_goal_yaw_deg=7.3
16:48:32.504[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:32.530[war][nning_a_star/global_planner.py] No path found to the goal. x=-4.094 y=6.42
16:48:32.530[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:48:32.531[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:48:32.715[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-4.273, 6.237, 0.324] odom_goal_yaw_deg=-180.0 world_goal=[-4.887, -1.326, 4.715] world_goal_yaw_deg=-24.78
16:48:32.755[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-4.273, 6.237, 0.324], euler=[90.0, -0.0, -126.4])
16:48:32.756[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:32.760[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.004
16:48:32.780[war][nning_a_star/global_planner.py] No path found to the goal. x=-4.273 y=6.237
16:48:32.780[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:48:32.782[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:48:32.782[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=2.5
16:48:32.894[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-4.278, 6.208, 0.323] odom_goal_yaw_deg=-180.0 world_goal=[-4.855, -1.327, 4.715] world_goal_yaw_deg=-22.77
16:48:32.895[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-4.278, 6.208, 0.323], euler=[90.0, 0.0, -124.4])
16:48:32.895[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:32.922[war][nning_a_star/global_planner.py] No path found to the goal. x=-4.278 y=6.208
16:48:32.922[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:48:32.923[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:48:34.332[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:48:34.334[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1434.324874
16:48:34.334[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-4.106, 6.327, 0.307], euler=[90.0, 0.0, -53.3])
16:48:34.334[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:34.334[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-4.106, 6.327, 0.307] odom_goal_yaw_deg=-0.0 world_goal=[-5.019, -1.343, 4.557] world_goal_yaw_deg=48.26
16:48:34.365[war][nning_a_star/global_planner.py] No path found to the goal. x=-4.106 y=6.327
16:48:34.365[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:48:34.366[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:48:34.366[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=1.3
16:48:34.633[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-3.175, 7.04, 0.296] odom_goal_yaw_deg=-0.0 world_goal=[-5.983, -1.354, 3.721] world_goal_yaw_deg=118.01
16:48:34.633[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-3.175, 7.040, 0.296], euler=[90.0, 0.0, 16.4])
16:48:34.633[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:35.026[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:35.037[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.824, 8.954, 0.348] odom_goal_yaw_deg=-0.0 world_goal=[-8.535, -1.301, 1.635] world_goal_yaw_deg=143.26
16:48:35.041[inf][anning_a_star/local_planner.py] changed state state=path_following
16:48:35.082[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.824, 8.954, 0.348], euler=[90.0, 0.0, 41.7])
16:48:35.083[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:35.084[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:35.084[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:48:35.085[war][nning_a_star/global_planner.py] Travelling to goal 0.3496838450455831m away from requested goal.
16:48:35.085[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.82 y=8.93
16:48:35.102[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=52
16:48:35.110[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:35.113[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:48:35.284[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.027, 9.441, 0.056], euler=[90.0, 0.0, 34.9])
16:48:35.284[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.027, 9.441, 0.056] odom_goal_yaw_deg=-0.0 world_goal=[-9.239, -1.594, 0.835] world_goal_yaw_deg=136.52
16:48:35.284[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:35.286[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:35.286[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:48:35.287[inf][nning_a_star/global_planner.py] Found safe goal. x=0.03 y=9.43
16:48:35.368[war][nning_a_star/global_planner.py] No path found to the goal. x=0.025 y=9.425
16:48:35.368[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:48:35.370[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:48:35.370[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=1.0
16:48:35.490[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:48:35.493[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.006, 9.65, 0.018] odom_goal_yaw_deg=180.0 world_goal=[-9.457, -1.632, 0.903] world_goal_yaw_deg=-164.44
16:48:35.493[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.006, 9.650, 0.018], euler=[90.0, 0.0, 94.0])
16:48:35.493[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:35.496[inf][nning_a_star/global_planner.py] Found safe goal. x=0.03 y=9.58
16:48:35.509[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:35.510[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:48:35.512[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=4
16:48:35.777[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.736, 9.463, 0.36] odom_goal_yaw_deg=-180.0 world_goal=[-9.096, -1.289, 1.653] world_goal_yaw_deg=-71.59
16:48:35.856[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.736, 9.463, 0.360], euler=[90.0, 0.0, -173.2])
16:48:35.857[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:35.858[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:35.858[war][nning_a_star/global_planner.py] Travelling to goal 0.36445195035102174m away from requested goal.
16:48:35.859[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:48:35.859[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.77 y=9.43
16:48:35.919[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:35.923[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:48:36.198[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-1.464, 9.434, 0.344] odom_goal_yaw_deg=-180.0 world_goal=[-8.906, -1.305, 2.422] world_goal_yaw_deg=-76.12
16:48:36.198[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-1.464, 9.434, 0.344], euler=[90.0, 0.0, -177.7])
16:48:36.199[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:36.199[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:36.200[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:48:36.201[war][nning_a_star/global_planner.py] Travelling to goal 0.34475290764163835m away from requested goal.
16:48:36.201[inf][nning_a_star/global_planner.py] Found safe goal. x=-1.47 y=9.43
16:48:36.300[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:36.304[inf][anning_a_star/local_planner.py] changed state state=path_following
16:48:36.482[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1436.47321
16:48:36.483[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-2.193, 9.566, 0.343] odom_goal_yaw_deg=180.0 world_goal=[-8.888, -1.307, 3.227] world_goal_yaw_deg=-90.5
16:48:36.524[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-2.193, 9.566, 0.343], euler=[90.0, 0.0, 167.9])
16:48:36.525[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:36.526[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:36.526[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:48:36.527[war][nning_a_star/global_planner.py] Travelling to goal 0.3466180336892973m away from requested goal.
16:48:36.527[inf][nning_a_star/global_planner.py] Found safe goal. x=-2.22 y=9.53
16:48:36.808[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:48:36.809[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-2.415, 9.573, 0.337] odom_goal_yaw_deg=180.0 world_goal=[-8.847, -1.313, 3.464] world_goal_yaw_deg=-78.9
16:48:36.877[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:36.883[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-2.415, 9.573, 0.337], euler=[90.0, 0.0, 179.5])
16:48:36.883[inf][anning_a_star/local_planner.py] changed state state=path_following
16:48:36.883[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:36.884[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:36.885[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:48:36.885[war][nning_a_star/global_planner.py] Travelling to goal 0.34032471054838764m away from requested goal.
16:48:36.886[inf][nning_a_star/global_planner.py] Found safe goal. x=-2.42 y=9.53
16:48:36.992[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:36.997[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:48:37.262[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-2.620, 9.600, 0.339], euler=[90.0, 0.0, 171.5])
16:48:37.262[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:37.263[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:37.263[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-2.62, 9.6, 0.339] odom_goal_yaw_deg=180.0 world_goal=[-8.83, -1.31, 3.689] world_goal_yaw_deg=-86.95
16:48:37.263[war][nning_a_star/global_planner.py] Travelling to goal 0.34027786706698127m away from requested goal.
16:48:37.263[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:48:37.264[inf][nning_a_star/global_planner.py] Found safe goal. x=-2.62 y=9.58
16:48:37.340[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:37.352[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:48:37.562[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-2.695, 9.617, 0.34] odom_goal_yaw_deg=180.0 world_goal=[-8.833, -1.309, 3.773] world_goal_yaw_deg=-87.86
16:48:37.734[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-2.695, 9.617, 0.340], euler=[90.0, 0.0, 170.6])
16:48:37.736[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:37.737[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:37.737[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:48:37.740[war][nning_a_star/global_planner.py] Travelling to goal 0.34429728513226676m away from requested goal.
16:48:37.740[inf][nning_a_star/global_planner.py] Found safe goal. x=-2.72 y=9.58
16:48:37.776[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.039
16:48:37.919[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:37.925[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:48:39.023[inf][anning_a_star/local_planner.py] changed state state=path_following
16:48:46.451[war][imos/ar/navigation/navigate.py] AR navigation goal stalled stall_reason=no_path
16:48:46.453[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=0.1
16:48:46.454[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=cancel_nav_goal publish_mono=1446.445746
16:48:46.455[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:48:46.456[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:46.457[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:48:46.457[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.001
16:48:50.752[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:48:50.753[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1450.744474
16:48:50.754[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-2.862, 9.513, 0.354], euler=[90.0, 0.0, -152.6])
16:48:50.754[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:50.754[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-2.862, 9.513, 0.354] odom_goal_yaw_deg=-180.0 world_goal=[-8.685, -1.295, 3.928] world_goal_yaw_deg=-51.02
16:48:50.755[war][nning_a_star/global_planner.py] Travelling to goal 0.35660636414700786m away from requested goal.
16:48:50.755[inf][nning_a_star/global_planner.py] Found safe goal. x=-2.88 y=9.48
16:48:50.799[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:50.803[inf][anning_a_star/local_planner.py] changed state state=path_following
16:48:50.808[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=18
16:48:51.114[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-3.519, 9.32, 0.293] odom_goal_yaw_deg=-180.0 world_goal=[-8.335, -1.357, 4.586] world_goal_yaw_deg=-70.67
16:48:51.115[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-3.519, 9.320, 0.293], euler=[90.0, 0.0, -172.3])
16:48:51.115[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:51.116[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:51.116[war][nning_a_star/global_planner.py] Travelling to goal 0.29612056216279253m away from requested goal.
16:48:51.116[inf][nning_a_star/global_planner.py] Found safe goal. x=-3.53 y=9.28
16:48:51.116[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:48:51.157[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:51.168[inf][anning_a_star/local_planner.py] changed state state=path_following
16:48:51.455[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-3.915, 9.425, 0.282] odom_goal_yaw_deg=180.0 world_goal=[-8.361, -1.368, 5.031] world_goal_yaw_deg=-92.03
16:48:51.490[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-3.915, 9.425, 0.282], euler=[90.0, 0.0, 166.4])
16:48:51.491[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:51.491[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:51.492[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:48:51.492[war][nning_a_star/global_planner.py] Travelling to goal 0.282227548279577m away from requested goal.
16:48:51.493[inf][nning_a_star/global_planner.py] Found safe goal. x=-3.93 y=9.43
16:48:51.504[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.013
16:48:51.601[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:51.609[inf][anning_a_star/local_planner.py] changed state state=path_following
16:48:51.837[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:48:51.839[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-4.447, 9.424, 0.276] odom_goal_yaw_deg=180.0 world_goal=[-8.244, -1.374, 5.597] world_goal_yaw_deg=-79.46
16:48:51.841[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-4.447, 9.424, 0.276], euler=[90.0, 0.0, 178.9])
16:48:51.841[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:51.842[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:51.842[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:48:51.843[war][nning_a_star/global_planner.py] Travelling to goal 0.2813740354609633m away from requested goal.
16:48:51.843[inf][nning_a_star/global_planner.py] Found safe goal. x=-4.48 y=9.38
16:48:51.939[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:51.952[inf][anning_a_star/local_planner.py] changed state state=path_following
16:48:52.005[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-4.55, 9.435, 0.275] odom_goal_yaw_deg=180.0 world_goal=[-8.233, -1.375, 5.709] world_goal_yaw_deg=-83.24
16:48:52.006[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-4.550, 9.435, 0.275], euler=[90.0, 0.0, 175.2])
16:48:52.006[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:52.006[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:52.007[war][nning_a_star/global_planner.py] Travelling to goal 0.27640669918370814m away from requested goal.
16:48:52.007[inf][nning_a_star/global_planner.py] Found safe goal. x=-4.58 y=9.43
16:48:52.007[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:48:52.135[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:52.260[inf][anning_a_star/local_planner.py] changed state state=path_following
16:48:57.911[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:48:57.912[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1457.903419
16:48:57.913[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-4.735, 9.445, 0.265], euler=[90.0, 0.0, -170.6])
16:48:57.913[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:57.913[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:57.913[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-4.735, 9.445, 0.265] odom_goal_yaw_deg=-180.0 world_goal=[-8.204, -1.384, 5.908] world_goal_yaw_deg=-69.01
16:48:57.914[war][nning_a_star/global_planner.py] Travelling to goal 0.26925126557027673m away from requested goal.
16:48:57.914[inf][nning_a_star/global_planner.py] Found safe goal. x=-4.78 y=9.43
16:48:57.914[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:48:57.914[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.001
16:48:57.995[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:58.003[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:48:58.408[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-5.221, 9.13, 0.268] odom_goal_yaw_deg=-180.0 world_goal=[-7.762, -1.382, 6.357] world_goal_yaw_deg=-45.39
16:48:58.409[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-5.221, 9.130, 0.268], euler=[90.0, 0.0, -147.0])
16:48:58.409[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:58.409[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:58.410[war][nning_a_star/global_planner.py] Travelling to goal 0.26767325507513046m away from requested goal.
16:48:58.410[inf][nning_a_star/global_planner.py] Found safe goal. x=-5.22 y=9.13
16:48:58.411[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:48:58.450[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:58.458[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:48:59.728[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:48:59.730[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-5.251, 8.932, 0.268] odom_goal_yaw_deg=180.0 world_goal=[-7.544, -1.382, 6.346] world_goal_yaw_deg=-9.67
16:48:59.816[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-5.251, 8.932, 0.268], euler=[90.0, 0.0, -111.3])
16:48:59.817[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:48:59.817[inf][anning_a_star/local_planner.py] changed state state=idle
16:48:59.818[war][nning_a_star/global_planner.py] Travelling to goal 0.26904182861818826m away from requested goal.
16:48:59.818[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:48:59.818[inf][nning_a_star/global_planner.py] Found safe goal. x=-5.27 y=8.93
16:48:59.969[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:48:59.990[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:49:00.035[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1460.026316
16:49:00.039[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-5.115, 8.465, 0.274], euler=[90.0, 0.0, -83.6])
16:49:00.039[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:00.040[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-5.115, 8.465, 0.274] odom_goal_yaw_deg=0.0 world_goal=[-7.077, -1.376, 6.1] world_goal_yaw_deg=17.96
16:49:00.041[inf][anning_a_star/local_planner.py] changed state state=idle
16:49:00.042[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:49:00.043[war][nning_a_star/global_planner.py] Travelling to goal 0.2766950111210498m away from requested goal.
16:49:00.044[inf][nning_a_star/global_planner.py] Found safe goal. x=-5.12 y=8.43
16:49:00.104[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:49:00.108[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:49:00.391[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-5.152, 8.2, 0.278] odom_goal_yaw_deg=-180.0 world_goal=[-6.787, -1.371, 6.08] world_goal_yaw_deg=3.23
16:49:00.420[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-5.152, 8.200, 0.278], euler=[90.0, -0.0, -98.4])
16:49:00.420[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:00.421[inf][anning_a_star/local_planner.py] changed state state=idle
16:49:00.422[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:49:00.422[war][nning_a_star/global_planner.py] Travelling to goal 0.2805041237735765m away from requested goal.
16:49:00.423[inf][nning_a_star/global_planner.py] Found safe goal. x=-5.17 y=8.18
16:49:00.459[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:49:00.465[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:49:00.810[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:49:00.814[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-5.36, 7.674, 0.302] odom_goal_yaw_deg=-180.0 world_goal=[-6.181, -1.347, 6.187] world_goal_yaw_deg=-60.67
16:49:00.946[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-5.360, 7.674, 0.302], euler=[90.0, 0.0, -162.3])
16:49:00.946[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:00.947[inf][anning_a_star/local_planner.py] changed state state=idle
16:49:00.956[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:49:00.980[war][nning_a_star/global_planner.py] Travelling to goal 0.30662715522513234m away from requested goal.
16:49:00.982[inf][nning_a_star/global_planner.py] Found safe goal. x=-5.37 y=7.63
16:49:01.047[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:49:01.052[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:49:01.259[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-5.56, 7.586, 0.341] odom_goal_yaw_deg=-180.0 world_goal=[-6.043, -1.309, 6.381] world_goal_yaw_deg=-35.38
16:49:01.259[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-5.560, 7.586, 0.341], euler=[90.0, 0.0, -137.0])
16:49:01.260[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:01.261[inf][anning_a_star/local_planner.py] changed state state=idle
16:49:01.261[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:49:01.262[war][nning_a_star/global_planner.py] Travelling to goal 0.34102490829730875m away from requested goal.
16:49:01.262[inf][nning_a_star/global_planner.py] Found safe goal. x=-5.57 y=7.58
16:49:01.354[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:49:01.359[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:49:01.681[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-5.662, 7.021, 0.327] odom_goal_yaw_deg=-180.0 world_goal=[-5.418, -1.323, 6.366] world_goal_yaw_deg=-7.47
16:49:01.721[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-5.662, 7.021, 0.327], euler=[90.0, 0.0, -109.1])
16:49:01.722[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:01.722[inf][anning_a_star/local_planner.py] changed state state=idle
16:49:01.723[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:49:01.723[war][nning_a_star/global_planner.py] Travelling to goal 0.3299705389352919m away from requested goal.
16:49:01.724[inf][nning_a_star/global_planner.py] Found safe goal. x=-5.67 y=6.98
16:49:01.826[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:49:01.835[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:49:01.977[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:49:01.979[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-5.629, 6.712, 0.311] odom_goal_yaw_deg=0.0 world_goal=[-5.097, -1.339, 6.263] world_goal_yaw_deg=15.21
16:49:02.096[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-5.629, 6.712, 0.311], euler=[90.0, 0.0, -86.4])
16:49:02.097[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:02.098[inf][anning_a_star/local_planner.py] changed state state=idle
16:49:02.098[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:49:02.099[war][nning_a_star/global_planner.py] Travelling to goal 0.31650026069460324m away from requested goal.
16:49:02.103[inf][nning_a_star/global_planner.py] Found safe goal. x=-5.67 y=6.68
16:49:02.184[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:49:02.218[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:49:02.290[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1462.281629
16:49:02.291[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-5.586, 6.256, 0.302] odom_goal_yaw_deg=0.0 world_goal=[-4.621, -1.348, 6.118] world_goal_yaw_deg=13.91
16:49:02.291[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-5.586, 6.256, 0.302], euler=[90.0, 0.0, -87.7])
16:49:02.292[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:02.293[inf][anning_a_star/local_planner.py] changed state state=idle
16:49:02.293[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:49:02.409[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:49:02.417[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:49:02.636[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-5.454, 6.077, 0.311] odom_goal_yaw_deg=0.0 world_goal=[-4.459, -1.339, 5.938] world_goal_yaw_deg=54.98
16:49:02.636[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-5.454, 6.077, 0.311], euler=[90.0, 0.0, -46.6])
16:49:02.637[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:02.638[inf][anning_a_star/local_planner.py] changed state state=idle
16:49:02.638[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:49:02.774[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:49:02.786[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:49:03.071[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:49:03.158[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-5.365, 5.831, 0.264] odom_goal_yaw_deg=-0.0 world_goal=[-4.216, -1.386, 5.79] world_goal_yaw_deg=24.76
16:49:03.205[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-5.365, 5.831, 0.264], euler=[90.0, 0.0, -76.8])
16:49:03.206[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:03.206[inf][anning_a_star/local_planner.py] changed state state=idle
16:49:03.207[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.001
16:49:03.207[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:49:03.372[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-5.666, 5.68, 0.283] odom_goal_yaw_deg=-180.0 world_goal=[-3.99, -1.367, 6.077] world_goal_yaw_deg=-49.39
16:49:03.461[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:49:03.479[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:49:03.480[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-5.666, 5.680, 0.283], euler=[90.0, 0.0, -151.0])
16:49:03.483[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:03.484[inf][anning_a_star/local_planner.py] changed state state=idle
16:49:03.485[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:49:03.661[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:49:03.669[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:49:03.693[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-6.085, 5.532, 0.277] odom_goal_yaw_deg=-180.0 world_goal=[-3.74, -1.372, 6.491] world_goal_yaw_deg=-53.61
16:49:03.693[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-6.085, 5.532, 0.277], euler=[90.0, 0.0, -155.2])
16:49:03.694[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:03.694[inf][anning_a_star/local_planner.py] changed state state=idle
16:49:03.695[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:49:03.808[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:49:03.818[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:49:04.073[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-6.930, 5.396, 0.343], euler=[90.0, 0.0, -175.1])
16:49:04.073[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-6.93, 5.396, 0.343] odom_goal_yaw_deg=180.0 world_goal=[-3.41, -1.306, 7.362] world_goal_yaw_deg=-73.56
16:49:04.073[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:04.073[inf][anning_a_star/local_planner.py] changed state state=idle
16:49:04.074[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:49:04.226[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
16:49:04.279[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
16:49:04.427[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:49:04.429[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1464.420387
16:49:04.430[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-7.333, 5.568, 0.362] odom_goal_yaw_deg=180.0 world_goal=[-3.506, -1.288, 7.829] world_goal_yaw_deg=-111.5
16:49:04.477[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-7.333, 5.568, 0.362], euler=[90.0, 0.0, 146.9])
16:49:04.478[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:04.479[inf][anning_a_star/local_planner.py] changed state state=idle
16:49:04.479[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
16:49:04.544[war][nning_a_star/global_planner.py] No path found to the goal. x=-7.333 y=5.568
16:49:04.544[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:49:04.565[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:49:04.566[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=0.1
16:49:04.689[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-7.436, 5.597, 0.361] odom_goal_yaw_deg=-180.0 world_goal=[-3.514, -1.289, 7.945] world_goal_yaw_deg=-104.82
16:49:04.710[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-7.436, 5.597, 0.361], euler=[90.0, 0.0, 153.6])
16:49:04.710[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:04.743[war][nning_a_star/global_planner.py] No path found to the goal. x=-7.436 y=5.597
16:49:04.744[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:49:04.745[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:49:04.955[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-8.046, 5.534, 0.209] odom_goal_yaw_deg=-180.0 world_goal=[-3.314, -1.441, 8.581] world_goal_yaw_deg=-77.84
16:49:04.966[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-8.046, 5.534, 0.209], euler=[90.0, 0.0, -179.4])
16:49:04.966[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:05.001[war][nning_a_star/global_planner.py] No path found to the goal. x=-8.046 y=5.534
16:49:05.001[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:49:05.002[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:49:05.114[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-8.087, 5.531, 0.197], euler=[90.0, 0.0, -175.8])
16:49:05.114[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:05.114[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-8.087, 5.531, 0.197] odom_goal_yaw_deg=-180.0 world_goal=[-3.301, -1.453, 8.624] world_goal_yaw_deg=-74.19
16:49:05.141[war][nning_a_star/global_planner.py] No path found to the goal. x=-8.087 y=5.531
16:49:05.142[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:49:05.143[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:49:05.313[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-8.141, 5.555, 0.181] odom_goal_yaw_deg=180.0 world_goal=[-3.315, -1.468, 8.687] world_goal_yaw_deg=-88.98
16:49:05.537[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:49:05.540[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-8.673, 5.584, 0.141] odom_goal_yaw_deg=-180.0 world_goal=[-3.231, -1.509, 9.26] world_goal_yaw_deg=-83.86
16:49:05.559[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-8.141, 5.555, 0.181], euler=[90.0, 0.0, 169.4])
16:49:05.559[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:05.637[war][nning_a_star/global_planner.py] No path found to the goal. x=-8.141 y=5.555
16:49:05.638[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:49:05.638[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-8.673, 5.584, 0.141], euler=[90.0, 0.0, 174.5])
16:49:05.639[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:05.677[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:49:05.677[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=3.6
16:49:05.679[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:49:05.684[war][nning_a_star/global_planner.py] No path found to the goal. x=-8.673 y=5.584
16:49:05.812[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-8.772, 5.57, 0.147] odom_goal_yaw_deg=-180.0 world_goal=[-3.194, -1.503, 9.362] world_goal_yaw_deg=-72.61
16:49:05.812[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-8.772, 5.570, 0.147], euler=[90.0, 0.0, -174.2])
16:49:05.812[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:05.863[war][nning_a_star/global_planner.py] No path found to the goal. x=-8.772 y=5.57
16:49:05.863[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:49:05.864[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:49:06.009[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-8.697, 5.530, 0.142], euler=[90.0, -0.0, -107.7])
16:49:06.009[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:06.011[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-8.697, 5.53, 0.142] odom_goal_yaw_deg=-180.0 world_goal=[-3.168, -1.508, 9.273] world_goal_yaw_deg=-6.1
16:49:06.039[war][nning_a_star/global_planner.py] No path found to the goal. x=-8.697 y=5.53
16:49:06.040[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:49:06.041[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:49:06.258[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-8.487, 5.365, 0.143] odom_goal_yaw_deg=0.0 world_goal=[-3.038, -1.506, 9.014] world_goal_yaw_deg=54.06
16:49:06.266[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-8.487, 5.365, 0.143], euler=[90.0, 0.0, -47.5])
16:49:06.267[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:06.302[war][nning_a_star/global_planner.py] No path found to the goal. x=-8.487 y=5.365
16:49:06.303[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:49:06.304[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:49:06.510[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=1466.500722
16:49:06.510[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-8.27, 5.134, 0.14] odom_goal_yaw_deg=0.0 world_goal=[-2.839, -1.51, 8.732] world_goal_yaw_deg=51.91
16:49:06.685[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-8.270, 5.134, 0.140], euler=[90.0, 0.0, -49.7])
16:49:06.685[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:06.769[war][nning_a_star/global_planner.py] No path found to the goal. x=-8.27 y=5.134
16:49:06.770[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:49:06.779[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:49:06.779[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=3.6
16:49:06.788[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:49:06.790[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-7.384, 4.634, 0.165], euler=[90.0, 0.0, -35.8])
16:49:06.790[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-7.384, 4.634, 0.165] odom_goal_yaw_deg=-0.0 world_goal=[-2.499, -1.484, 7.679] world_goal_yaw_deg=65.75
16:49:06.790[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:06.828[war][nning_a_star/global_planner.py] No path found to the goal. x=-7.384 y=4.634
16:49:06.828[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:49:06.829[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:49:06.955[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-7.355, 4.543, 0.153], euler=[90.0, 0.0, -48.2])
16:49:06.955[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-7.349, 4.509, 0.149] odom_goal_yaw_deg=-0.0 world_goal=[-2.374, -1.501, 7.615] world_goal_yaw_deg=47.45
16:49:06.956[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:06.956[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-7.355, 4.543, 0.153] odom_goal_yaw_deg=0.0 world_goal=[-2.409, -1.497, 7.628] world_goal_yaw_deg=53.43
16:49:06.987[war][nning_a_star/global_planner.py] No path found to the goal. x=-7.355 y=4.543
16:49:06.988[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:49:06.989[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-7.349, 4.509, 0.149], euler=[90.0, 0.0, -54.1])
16:49:06.990[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:06.990[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:49:06.992[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:49:07.043[war][nning_a_star/global_planner.py] No path found to the goal. x=-7.349 y=4.509
16:49:07.376[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-7.306, 4.141, 0.108] odom_goal_yaw_deg=-0.0 world_goal=[-1.992, -1.541, 7.488] world_goal_yaw_deg=32.66
16:49:07.546[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-7.306, 4.141, 0.108], euler=[90.0, 0.0, -68.9])
16:49:07.546[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:07.611[war][nning_a_star/global_planner.py] No path found to the goal. x=-7.306 y=4.141
16:49:07.612[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:49:07.621[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:49:07.639[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-7.494, 4.136, 0.107] odom_goal_yaw_deg=180.0 world_goal=[-1.946, -1.543, 7.688] world_goal_yaw_deg=-89.83
16:49:07.646[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-7.494, 4.136, 0.107], euler=[90.0, 0.0, 168.6])
16:49:07.646[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:07.723[war][nning_a_star/global_planner.py] No path found to the goal. x=-7.494 y=4.136
16:49:07.723[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:49:07.724[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:49:07.843[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:49:07.845[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-7.568, 4.129, 0.108], euler=[90.0, 0.0, 177.1])
16:49:07.845[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-7.568, 4.129, 0.108] odom_goal_yaw_deg=-180.0 world_goal=[-1.922, -1.542, 7.765] world_goal_yaw_deg=-81.27
16:49:07.846[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:07.846[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-7.538, 4.136, 0.108] odom_goal_yaw_deg=180.0 world_goal=[-1.936, -1.542, 7.734] world_goal_yaw_deg=-87.16
16:49:07.881[war][nning_a_star/global_planner.py] No path found to the goal. x=-7.568 y=4.129
16:49:07.881[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:49:07.882[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-7.538, 4.136, 0.108], euler=[90.0, 0.0, 171.2])
16:49:07.882[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:07.883[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:49:07.884[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=4.5
16:49:07.885[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:49:07.914[war][nning_a_star/global_planner.py] No path found to the goal. x=-7.538 y=4.136
16:49:08.006[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-7.613, 4.137, 0.108], euler=[90.0, 0.0, 179.6])
16:49:08.006[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-7.613, 4.137, 0.108] odom_goal_yaw_deg=180.0 world_goal=[-1.92, -1.541, 7.815] world_goal_yaw_deg=-78.85
16:49:08.006[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:08.047[war][nning_a_star/global_planner.py] No path found to the goal. x=-7.613 y=4.137
16:49:08.063[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:49:08.068[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:49:08.202[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-7.645, 4.178, 0.109] odom_goal_yaw_deg=180.0 world_goal=[-1.958, -1.54, 7.858] world_goal_yaw_deg=-112.56
16:49:08.205[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-7.645, 4.178, 0.109], euler=[90.0, 0.0, 145.8])
16:49:08.206[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:08.235[war][nning_a_star/global_planner.py] No path found to the goal. x=-7.645 y=4.178
16:49:08.235[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:49:08.236[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:49:08.237[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.002
16:49:08.378[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-7.722, 4.178, 0.111] odom_goal_yaw_deg=180.0 world_goal=[-1.94, -1.538, 7.94] world_goal_yaw_deg=-91.62
16:49:08.569[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-7.722, 4.178, 0.111], euler=[90.0, 0.0, 166.8])
16:49:08.569[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:08.615[war][nning_a_star/global_planner.py] No path found to the goal. x=-7.722 y=4.178
16:49:08.616[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:49:08.644[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:49:08.646[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=emergency_stop publish_mono=1468.636746
16:49:08.663[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-8.084, 4.349, 0.117] odom_goal_yaw_deg=180.0 world_goal=[-2.044, -1.533, 8.363] world_goal_yaw_deg=-112.72
16:49:08.676[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-8.084, 4.349, 0.117], euler=[90.0, 0.0, 145.7])
16:49:08.677[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:08.751[war][nning_a_star/global_planner.py] No path found to the goal. x=-8.084 y=4.349
16:49:08.751[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:49:08.753[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:49:08.868[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:49:08.871[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-8.111, 4.398, 0.119], euler=[90.0, 0.0, 137.3])
16:49:08.871[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:08.871[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-8.144, 4.497, 0.117] odom_goal_yaw_deg=-180.0 world_goal=[-2.188, -1.533, 8.458] world_goal_yaw_deg=-136.21
16:49:08.872[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-8.111, 4.398, 0.119] odom_goal_yaw_deg=180.0 world_goal=[-2.09, -1.531, 8.401] world_goal_yaw_deg=-121.06
16:49:08.901[war][nning_a_star/global_planner.py] No path found to the goal. x=-8.111 y=4.398
16:49:08.901[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:49:08.902[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-8.144, 4.497, 0.117], euler=[90.0, 0.0, 122.2])
16:49:08.902[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:08.902[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:49:08.903[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=4.9
16:49:08.903[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:49:08.931[war][nning_a_star/global_planner.py] No path found to the goal. x=-8.144 y=4.497
16:49:08.956[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-8.172, 4.679, 0.117] odom_goal_yaw_deg=180.0 world_goal=[-2.376, -1.533, 8.528] world_goal_yaw_deg=-153.14
16:49:08.977[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-8.172, 4.679, 0.117], euler=[90.0, 0.0, 105.3])
16:49:08.978[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:09.013[war][nning_a_star/global_planner.py] No path found to the goal. x=-8.172 y=4.679
16:49:09.014[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:49:09.015[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:49:09.142[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-8.232, 4.798, 0.122], euler=[90.0, 0.0, 111.8])
16:49:09.142[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:09.142[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-8.232, 4.798, 0.122] odom_goal_yaw_deg=180.0 world_goal=[-2.489, -1.527, 8.619] world_goal_yaw_deg=-146.66
16:49:09.177[war][nning_a_star/global_planner.py] No path found to the goal. x=-8.232 y=4.798
16:49:09.178[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:49:09.181[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:49:09.317[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-8.373, 4.9, 0.128] odom_goal_yaw_deg=180.0 world_goal=[-2.568, -1.522, 8.79] world_goal_yaw_deg=-125.02
16:49:09.317[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-8.373, 4.900, 0.128], euler=[90.0, 0.0, 133.4])
16:49:09.317[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:09.388[war][nning_a_star/global_planner.py] No path found to the goal. x=-8.373 y=4.9
16:49:09.389[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:49:09.391[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:49:09.572[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-8.609, 5.046, 0.13] odom_goal_yaw_deg=180.0 world_goal=[-2.672, -1.519, 9.074] world_goal_yaw_deg=-109.23
16:49:09.686[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-8.609, 5.046, 0.130], euler=[90.0, 0.0, 149.2])
16:49:09.687[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:09.798[war][nning_a_star/global_planner.py] No path found to the goal. x=-8.609 y=5.046
16:49:09.798[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:49:09.799[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:49:09.929[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
16:49:09.931[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-8.909, 4.907, 0.128] odom_goal_yaw_deg=-180.0 world_goal=[-2.457, -1.522, 9.363] world_goal_yaw_deg=-58.46
16:49:09.931[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-8.909, 4.907, 0.128], euler=[90.0, 0.0, -160.0])
16:49:09.931[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:09.968[war][nning_a_star/global_planner.py] No path found to the goal. x=-8.909 y=4.907
16:49:09.968[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:49:09.970[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:49:09.970[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=4.7
16:49:10.218[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-9.113, 4.945, 0.129] odom_goal_yaw_deg=180.0 world_goal=[-2.454, -1.521, 9.589] world_goal_yaw_deg=-84.01
16:49:10.218[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-9.113, 4.945, 0.129], euler=[90.0, 0.0, 174.4])
16:49:10.219[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
16:49:10.251[war][nning_a_star/global_planner.py] No path found to the goal. x=-9.113 y=4.945
16:49:10.251[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
16:49:10.298[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
16:49:15.400[inf][s-ar/dimos/ar/bridge/safety.py] AR client disconnect handled nav_reset=true registration_cleared=true
16:49:15.401[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=0.4
16:49:15.401[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=emergency_stop publish_mono=1475.392608
16:49:15.402[inf][s-ar/dimos/ar/bridge/module.py] dimos-ar bridge last client disconnected lidar_mode_reset=true
16:49:33.571[inf][os/ar/bridge/status_service.py] bridge connectivity updated reconnecting=True robot_connected=False streams_active=False
16:49:34.082[inf][os/ar/bridge/status_service.py] bridge connectivity updated reconnecting=False robot_connected=False streams_active=False
🕒 Signaling State          : ⚫ closed        (18:49:52)
🕒 ICE Connection State     : ⚫ closed        (18:49:52)
🕒 Peer Connection State    : ⚫ closed        (18:49:52)
ERROR:root:Error in callback <function UnitreeWebRTCConnection.raw_video_stream.<locals>.accept_track at 0x13787aa20>: 
Exception in thread Thread-5 (publish_camera_info):
Traceback (most recent call last):
  File "/Users/johannestscharn/.local/share/uv/python/cpython-3.12.12-macos-aarch64-none/lib/python3.12/threading.py", line 1075, in _bootstrap_inner
    self.run()
  File "/Users/johannestscharn/.local/share/uv/python/cpython-3.12.12-macos-aarch64-none/lib/python3.12/threading.py", line 1012, in run
    self._target(*self._args, **self._kwargs)
  File "/Users/johannestscharn/repositories/dimos/.venv/lib/python3.12/site-packages/dimos/robot/unitree/go2/connection.py", line 338, in publish_camera_info
    self.camera_info.publish(self.camera_info_static)
  File "/Users/johannestscharn/repositories/dimos/.venv/lib/python3.12/site-packages/dimos/core/stream.py", line 178, in publish
    self._transport.broadcast(self, msg)
  File "/Users/johannestscharn/repositories/dimos/.venv/lib/python3.12/site-packages/dimos/core/transport.py", line 134, in broadcast
    self.lcm.publish(self.topic, msg)
  File "/Users/johannestscharn/repositories/dimos/.venv/lib/python3.12/site-packages/dimos/protocol/pubsub/encoders.py", line 70, in publish
    super().publish(topic, encoded_message)  # type: ignore[misc]
    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/johannestscharn/repositories/dimos/.venv/lib/python3.12/site-packages/dimos/protocol/pubsub/impl/lcmpubsub.py", line 92, in publish
    self.l.publish(topic_str, message)
OSError: [Errno 51] Network is unreachable

