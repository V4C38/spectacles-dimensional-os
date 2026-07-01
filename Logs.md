johannestscharn@MacBookAirM2 spectacles-dimensional-os % clear
































johannestscharn@MacBookAirM2 spectacles-dimensional-os % ./start.sh
Choose the robot stack to run (↑/↓ then Enter):
  ▶ Unitree Go2
    Unitree G1
Discovering robots on the network...
Found robot B42D1000Q4MBH603 at 192.168.1.177
Using Python: /Users/johannestscharn/repositories/spectacles-dimensional-os/../dimos/.venv/bin/python3
Blueprint:    ar_go2
Stack:        Unitree Go2
Equivalent:   dimos run ar-go2
Robot IP:     192.168.1.177
WebSocket:    ws://0.0.0.0:8787 (not listening yet — booting DimOS stack…)
Log level:    DEBUG (quieter: DIMOS_LOG_LEVEL=INFO ./start.sh)
Logs:         stdout + ~/.local/state/dimos/logs/.../main.jsonl (dimos log -f)
Spectacles:   enter 192.168.1.166 in the lens

Ctrl+C to stop.

20:52:35.897[inf][dimos/utils/data.py           ] Using local user data directory at '/Users/johannestscharn/Library/Application Support/dimos'
20:52:35.901[inf][dination/module_coordinator.py] Building the blueprint
20:52:35.954[war][ce/system_configurator/base.py] System configuration changes are recommended/required:

20:52:35.954[war][ce/system_configurator/base.py] - socket buffer optimization for LCM: sudo sysctl -w kern.ipc.maxsockbuf=67108864

- Raise soft file count limit to 65536 for LCM (no sudo required)
20:52:36.033[inf][ce/system_configurator/base.py] System configuration completed.
20:52:36.034[inf][dination/module_coordinator.py] Starting the modules
20:52:36.107[inf][ation/worker_manager_python.py] Worker pool started. n_workers=10
20:52:36.965[inf][/coordination/python_worker.py] Deployed module. module=MovementManager module_id=9 worker_id=9
20:52:37.619[inf][/coordination/python_worker.py] Deployed module. module=PatrollingModule module_id=8 worker_id=8
20:52:37.772[inf][/coordination/python_worker.py] Deployed module. module=WavefrontFrontierExplorer module_id=7 worker_id=7
20:52:37.881[inf][/coordination/python_worker.py] Deployed module. module=ReplanningAStarPlanner module_id=6 worker_id=6
20:52:37.926[inf][et_vis/websocket_vis_module.py] WebSocket visualization module initialized on port 7779, GPS goal tracking enabled
20:52:37.930[inf][/coordination/python_worker.py] Deployed module. module=WebsocketVisModule module_id=2 worker_id=3
20:52:40.004[inf][/coordination/python_worker.py] Deployed module. module=RerunWebSocketServer module_id=1 worker_id=2
20:52:40.007[inf][/coordination/python_worker.py] Deployed module. module=Go2AdapterModule module_id=10 worker_id=2
20:52:40.068[inf][/coordination/python_worker.py] Deployed module. module=CostMapper module_id=5 worker_id=5
20:52:40.241[inf][/coordination/python_worker.py] Deployed module. module=ARBridge module_id=11 worker_id=3
🕒 WebRTC connection        : 🟡 started       (22:52:40)
20:52:40.569[inf][/coordination/python_worker.py] Deployed module. module=VoxelGridMapper module_id=4 worker_id=4
🕒 Lidar Decoder            : 🧊 LibVoxelDecoder (22:52:40)
🕒 Signaling State          : 🟡 have-local-offer (22:52:40)
🕒 ICE Gathering State      : 🟡 gathering     (22:52:40)
🕒 ICE Gathering State      : 🟢 complete      (22:52:40)
🕒 LAN Signaling Method     : 🆕 con_notify (192.168.1.177:9991) (22:52:40)
20:52:41.002[inf][/coordination/python_worker.py] Deployed module. module=RerunBridgeModule module_id=0 worker_id=0
🕒 ICE Connection State     : 🔵 checking      (22:52:41)
🕒 Peer Connection State    : 🔵 connecting    (22:52:41)
🕒 Signaling State          : 🟢 stable        (22:52:41)
🕒 ICE Connection State     : 🟢 completed     (22:52:41)
🕒 Peer Connection State    : 🟢 connected     (22:52:41)
🕒 Data Channel Verification: ✅ OK            (22:52:41)
DisableTrafficSavings: on
🕒 Lidar Decoder            : 🧊 NativeDecoder (22:52:41)
20:52:41.745[inf][/coordination/python_worker.py] Deployed module. module=GO2Connection module_id=3 worker_id=1
20:52:41.814[inf][dination/module_coordinator.py] Transport module=RerunWebSocketServer name=clicked_point original_name=clicked_point topic=/clicked_point#geometry_msgs.PointStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PointStamped.PointStamped
20:52:41.820[inf][dination/module_coordinator.py] Transport module=ReplanningAStarPlanner name=clicked_point original_name=clicked_point topic=/clicked_point#geometry_msgs.PointStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PointStamped.PointStamped
20:52:41.827[inf][dination/module_coordinator.py] Transport module=MovementManager name=clicked_point original_name=clicked_point topic=/clicked_point#geometry_msgs.PointStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PointStamped.PointStamped
20:52:41.829[inf][dination/module_coordinator.py] Transport module=Go2AdapterModule name=clicked_point original_name=clicked_point topic=/clicked_point#geometry_msgs.PointStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PointStamped.PointStamped
20:52:41.831[inf][dination/module_coordinator.py] Transport module=RerunWebSocketServer name=tele_cmd_vel original_name=tele_cmd_vel topic=/tele_cmd_vel#geometry_msgs.Twist transport=LCMTransport type=dimos.msgs.geometry_msgs.Twist.Twist
20:52:41.833[inf][dination/module_coordinator.py] Transport module=WebsocketVisModule name=tele_cmd_vel original_name=tele_cmd_vel topic=/tele_cmd_vel#geometry_msgs.Twist transport=LCMTransport type=dimos.msgs.geometry_msgs.Twist.Twist
20:52:41.834[inf][dination/module_coordinator.py] Transport module=MovementManager name=tele_cmd_vel original_name=tele_cmd_vel topic=/tele_cmd_vel#geometry_msgs.Twist transport=LCMTransport type=dimos.msgs.geometry_msgs.Twist.Twist
20:52:41.836[inf][dination/module_coordinator.py] Transport module=WebsocketVisModule name=odom original_name=odom topic=/odom#geometry_msgs.PoseStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PoseStamped.PoseStamped
20:52:41.837[inf][dination/module_coordinator.py] Transport module=GO2Connection name=odom original_name=odom topic=/odom#geometry_msgs.PoseStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PoseStamped.PoseStamped
20:52:41.838[inf][dination/module_coordinator.py] Transport module=ReplanningAStarPlanner name=odom original_name=odom topic=/odom#geometry_msgs.PoseStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PoseStamped.PoseStamped
20:52:41.841[inf][dination/module_coordinator.py] Transport module=WavefrontFrontierExplorer name=odom original_name=odom topic=/odom#geometry_msgs.PoseStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PoseStamped.PoseStamped
20:52:41.845[inf][dination/module_coordinator.py] Transport module=PatrollingModule name=odom original_name=odom topic=/odom#geometry_msgs.PoseStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PoseStamped.PoseStamped
20:52:41.846[inf][dination/module_coordinator.py] Transport module=Go2AdapterModule name=odom original_name=ar_odom_in topic=/odom#geometry_msgs.PoseStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PoseStamped.PoseStamped
20:52:41.848[inf][dination/module_coordinator.py] Transport module=WebsocketVisModule name=gps_location original_name=gps_location topic=/gps_location transport=pLCMTransport type=dimos.mapping.models.LatLon
20:52:41.849[inf][dination/module_coordinator.py] Transport module=WebsocketVisModule name=path original_name=path topic=/path#nav_msgs.Path transport=LCMTransport type=dimos.msgs.nav_msgs.Path.Path
20:52:41.850[inf][dination/module_coordinator.py] Transport module=ReplanningAStarPlanner name=path original_name=path topic=/path#nav_msgs.Path transport=LCMTransport type=dimos.msgs.nav_msgs.Path.Path
20:52:41.851[inf][dination/module_coordinator.py] Transport module=Go2AdapterModule name=path original_name=ar_path_in topic=/path#nav_msgs.Path transport=LCMTransport type=dimos.msgs.nav_msgs.Path.Path
20:52:41.852[inf][dination/module_coordinator.py] Transport module=WebsocketVisModule name=global_costmap original_name=global_costmap topic=/global_costmap#nav_msgs.OccupancyGrid transport=LCMTransport type=dimos.msgs.nav_msgs.OccupancyGrid.OccupancyGrid
20:52:41.853[inf][dination/module_coordinator.py] Transport module=CostMapper name=global_costmap original_name=global_costmap topic=/global_costmap#nav_msgs.OccupancyGrid transport=LCMTransport type=dimos.msgs.nav_msgs.OccupancyGrid.OccupancyGrid
20:52:41.854[inf][dination/module_coordinator.py] Transport module=ReplanningAStarPlanner name=global_costmap original_name=global_costmap topic=/global_costmap#nav_msgs.OccupancyGrid transport=LCMTransport type=dimos.msgs.nav_msgs.OccupancyGrid.OccupancyGrid
20:52:41.855[inf][dination/module_coordinator.py] Transport module=WavefrontFrontierExplorer name=global_costmap original_name=global_costmap topic=/global_costmap#nav_msgs.OccupancyGrid transport=LCMTransport type=dimos.msgs.nav_msgs.OccupancyGrid.OccupancyGrid
20:52:41.856[inf][dination/module_coordinator.py] Transport module=PatrollingModule name=global_costmap original_name=global_costmap topic=/global_costmap#nav_msgs.OccupancyGrid transport=LCMTransport type=dimos.msgs.nav_msgs.OccupancyGrid.OccupancyGrid
20:52:41.856[inf][dination/module_coordinator.py] Transport module=Go2AdapterModule name=global_costmap original_name=ar_global_costmap_in topic=/global_costmap#nav_msgs.OccupancyGrid transport=LCMTransport type=dimos.msgs.nav_msgs.OccupancyGrid.OccupancyGrid
20:52:41.857[inf][dination/module_coordinator.py] Transport module=WebsocketVisModule name=goal_request original_name=goal_request topic=/goal_request#geometry_msgs.PoseStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PoseStamped.PoseStamped
20:52:41.858[inf][dination/module_coordinator.py] Transport module=ReplanningAStarPlanner name=goal_request original_name=goal_request topic=/goal_request#geometry_msgs.PoseStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PoseStamped.PoseStamped
20:52:41.858[inf][dination/module_coordinator.py] Transport module=WavefrontFrontierExplorer name=goal_request original_name=goal_request topic=/goal_request#geometry_msgs.PoseStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PoseStamped.PoseStamped
20:52:41.859[inf][dination/module_coordinator.py] Transport module=PatrollingModule name=goal_request original_name=goal_request topic=/goal_request#geometry_msgs.PoseStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PoseStamped.PoseStamped
20:52:41.859[inf][dination/module_coordinator.py] Transport module=Go2AdapterModule name=goal_request original_name=goal_request topic=/goal_request#geometry_msgs.PoseStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PoseStamped.PoseStamped
20:52:41.860[inf][dination/module_coordinator.py] Transport module=ARBridge name=goal_request original_name=goal_request topic=/goal_request#geometry_msgs.PoseStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PoseStamped.PoseStamped
20:52:41.861[inf][dination/module_coordinator.py] Transport module=WebsocketVisModule name=gps_goal original_name=gps_goal topic=/gps_goal transport=pLCMTransport type=dimos.mapping.models.LatLon
20:52:41.862[inf][dination/module_coordinator.py] Transport module=WebsocketVisModule name=explore_cmd original_name=explore_cmd topic=/explore_cmd#std_msgs.Bool transport=LCMTransport type=dimos_lcm.std_msgs.Bool.Bool
20:52:41.863[inf][dination/module_coordinator.py] Transport module=WavefrontFrontierExplorer name=explore_cmd original_name=explore_cmd topic=/explore_cmd#std_msgs.Bool transport=LCMTransport type=dimos_lcm.std_msgs.Bool.Bool
20:52:41.864[inf][dination/module_coordinator.py] Transport module=WebsocketVisModule name=stop_explore_cmd original_name=stop_explore_cmd topic=/stop_explore_cmd#std_msgs.Bool transport=LCMTransport type=dimos_lcm.std_msgs.Bool.Bool
20:52:41.864[inf][dination/module_coordinator.py] Transport module=WavefrontFrontierExplorer name=stop_explore_cmd original_name=stop_explore_cmd topic=/stop_explore_cmd#std_msgs.Bool transport=LCMTransport type=dimos_lcm.std_msgs.Bool.Bool
20:52:41.865[inf][dination/module_coordinator.py] Transport module=WebsocketVisModule name=movecmd_stamped original_name=movecmd_stamped topic=/movecmd_stamped#geometry_msgs.TwistStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.TwistStamped.TwistStamped
20:52:41.866[inf][dination/module_coordinator.py] Transport module=GO2Connection name=pointcloud original_name=pointcloud topic=/pointcloud#sensor_msgs.PointCloud2 transport=LCMTransport type=dimos.msgs.sensor_msgs.PointCloud2.PointCloud2
20:52:41.866[inf][dination/module_coordinator.py] Transport module=GO2Connection name=color_image original_name=color_image topic=color_image transport=pSHMTransport type=dimos.msgs.sensor_msgs.Image.Image
20:52:41.867[inf][dination/module_coordinator.py] Transport module=GO2Connection name=camera_info original_name=camera_info topic=/camera_info#sensor_msgs.CameraInfo transport=LCMTransport type=dimos.msgs.sensor_msgs.CameraInfo.CameraInfo
20:52:41.868[inf][dination/module_coordinator.py] Transport module=GO2Connection name=cmd_vel original_name=cmd_vel topic=/cmd_vel#geometry_msgs.Twist transport=LCMTransport type=dimos.msgs.geometry_msgs.Twist.Twist
20:52:41.868[inf][dination/module_coordinator.py] Transport module=MovementManager name=cmd_vel original_name=cmd_vel topic=/cmd_vel#geometry_msgs.Twist transport=LCMTransport type=dimos.msgs.geometry_msgs.Twist.Twist
20:52:41.869[inf][dination/module_coordinator.py] Transport module=Go2AdapterModule name=cmd_vel original_name=cmd_vel topic=/cmd_vel#geometry_msgs.Twist transport=LCMTransport type=dimos.msgs.geometry_msgs.Twist.Twist
20:52:41.870[inf][dination/module_coordinator.py] Transport module=ARBridge name=cmd_vel original_name=cmd_vel topic=/cmd_vel#geometry_msgs.Twist transport=LCMTransport type=dimos.msgs.geometry_msgs.Twist.Twist
20:52:41.870[inf][dination/module_coordinator.py] Transport module=GO2Connection name=lidar original_name=lidar topic=/lidar#sensor_msgs.PointCloud2 transport=LCMTransport type=dimos.msgs.sensor_msgs.PointCloud2.PointCloud2
20:52:41.871[inf][dination/module_coordinator.py] Transport module=VoxelGridMapper name=lidar original_name=lidar topic=/lidar#sensor_msgs.PointCloud2 transport=LCMTransport type=dimos.msgs.sensor_msgs.PointCloud2.PointCloud2
20:52:41.872[inf][dination/module_coordinator.py] Transport module=Go2AdapterModule name=lidar original_name=ar_lidar_in topic=/lidar#sensor_msgs.PointCloud2 transport=LCMTransport type=dimos.msgs.sensor_msgs.PointCloud2.PointCloud2
20:52:41.872[inf][dination/module_coordinator.py] Transport module=VoxelGridMapper name=global_map original_name=global_map topic=/global_map#sensor_msgs.PointCloud2 transport=LCMTransport type=dimos.msgs.sensor_msgs.PointCloud2.PointCloud2
20:52:41.873[inf][dination/module_coordinator.py] Transport module=CostMapper name=global_map original_name=global_map topic=/global_map#sensor_msgs.PointCloud2 transport=LCMTransport type=dimos.msgs.sensor_msgs.PointCloud2.PointCloud2
20:52:41.874[inf][dination/module_coordinator.py] Transport module=CostMapper name=merged_map original_name=merged_map topic=/merged_map#sensor_msgs.PointCloud2 transport=LCMTransport type=dimos.msgs.sensor_msgs.PointCloud2.PointCloud2
20:52:41.875[inf][dination/module_coordinator.py] Transport module=ReplanningAStarPlanner name=odometry original_name=odometry topic=/odometry#nav_msgs.Odometry transport=LCMTransport type=dimos.msgs.nav_msgs.Odometry.Odometry
20:52:41.876[inf][dination/module_coordinator.py] Transport module=ReplanningAStarPlanner name=target original_name=target topic=/target#geometry_msgs.PoseStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PoseStamped.PoseStamped
20:52:41.876[inf][dination/module_coordinator.py] Transport module=ReplanningAStarPlanner name=stop_movement original_name=stop_movement topic=/stop_movement#std_msgs.Bool transport=LCMTransport type=dimos_lcm.std_msgs.Bool.Bool
20:52:41.877[inf][dination/module_coordinator.py] Transport module=WavefrontFrontierExplorer name=stop_movement original_name=stop_movement topic=/stop_movement#std_msgs.Bool transport=LCMTransport type=dimos_lcm.std_msgs.Bool.Bool
20:52:41.878[inf][dination/module_coordinator.py] Transport module=MovementManager name=stop_movement original_name=stop_movement topic=/stop_movement#std_msgs.Bool transport=LCMTransport type=dimos_lcm.std_msgs.Bool.Bool
20:52:41.878[inf][dination/module_coordinator.py] Transport module=Go2AdapterModule name=stop_movement original_name=stop_movement topic=/stop_movement#std_msgs.Bool transport=LCMTransport type=dimos_lcm.std_msgs.Bool.Bool
20:52:41.879[inf][dination/module_coordinator.py] Transport module=ARBridge name=stop_movement original_name=stop_movement topic=/stop_movement#std_msgs.Bool transport=LCMTransport type=dimos_lcm.std_msgs.Bool.Bool
20:52:41.880[inf][dination/module_coordinator.py] Transport module=ReplanningAStarPlanner name=goal_reached original_name=goal_reached topic=/goal_reached#std_msgs.Bool transport=LCMTransport type=dimos_lcm.std_msgs.Bool.Bool
20:52:41.880[inf][dination/module_coordinator.py] Transport module=WavefrontFrontierExplorer name=goal_reached original_name=goal_reached topic=/goal_reached#std_msgs.Bool transport=LCMTransport type=dimos_lcm.std_msgs.Bool.Bool
20:52:41.881[inf][dination/module_coordinator.py] Transport module=PatrollingModule name=goal_reached original_name=goal_reached topic=/goal_reached#std_msgs.Bool transport=LCMTransport type=dimos_lcm.std_msgs.Bool.Bool
20:52:41.882[inf][dination/module_coordinator.py] Transport module=Go2AdapterModule name=goal_reached original_name=ar_goal_reached_in topic=/goal_reached#std_msgs.Bool transport=LCMTransport type=dimos_lcm.std_msgs.Bool.Bool
20:52:41.882[inf][dination/module_coordinator.py] Transport module=ReplanningAStarPlanner name=navigation_state original_name=navigation_state topic=/navigation_state#std_msgs.String transport=LCMTransport type=dimos_lcm.std_msgs.String.String
20:52:41.883[inf][dination/module_coordinator.py] Transport module=Go2AdapterModule name=navigation_state original_name=ar_navigation_state_in topic=/navigation_state#std_msgs.String transport=LCMTransport type=dimos_lcm.std_msgs.String.String
20:52:41.884[inf][dination/module_coordinator.py] Transport module=ReplanningAStarPlanner name=nav_cmd_vel original_name=nav_cmd_vel topic=/nav_cmd_vel#geometry_msgs.Twist transport=LCMTransport type=dimos.msgs.geometry_msgs.Twist.Twist
20:52:41.885[inf][dination/module_coordinator.py] Transport module=MovementManager name=nav_cmd_vel original_name=nav_cmd_vel topic=/nav_cmd_vel#geometry_msgs.Twist transport=LCMTransport type=dimos.msgs.geometry_msgs.Twist.Twist
20:52:41.886[inf][dination/module_coordinator.py] Transport module=ReplanningAStarPlanner name=navigation_costmap original_name=navigation_costmap topic=/navigation_costmap#nav_msgs.OccupancyGrid transport=LCMTransport type=dimos.msgs.nav_msgs.OccupancyGrid.OccupancyGrid
20:52:41.886[inf][dination/module_coordinator.py] Transport module=MovementManager name=goal original_name=goal topic=/goal#geometry_msgs.PointStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PointStamped.PointStamped
20:52:41.887[inf][dination/module_coordinator.py] Transport module=MovementManager name=way_point original_name=way_point topic=/way_point#geometry_msgs.PointStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PointStamped.PointStamped
20:52:41.888[inf][dination/module_coordinator.py] Transport module=Go2AdapterModule name=ar_lidar original_name=ar_lidar topic=/ar_lidar#sensor_msgs.PointCloud2 transport=LCMTransport type=dimos.msgs.sensor_msgs.PointCloud2.PointCloud2
20:52:41.888[inf][dination/module_coordinator.py] Transport module=ARBridge name=ar_lidar original_name=ar_lidar topic=/ar_lidar#sensor_msgs.PointCloud2 transport=LCMTransport type=dimos.msgs.sensor_msgs.PointCloud2.PointCloud2
20:52:41.889[inf][dination/module_coordinator.py] Transport module=Go2AdapterModule name=ar_odom original_name=ar_odom topic=/ar_odom#geometry_msgs.PoseStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PoseStamped.PoseStamped
20:52:41.889[inf][dination/module_coordinator.py] Transport module=ARBridge name=ar_odom original_name=ar_odom topic=/ar_odom#geometry_msgs.PoseStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PoseStamped.PoseStamped
20:52:41.890[inf][dination/module_coordinator.py] Transport module=Go2AdapterModule name=ar_global_costmap original_name=ar_global_costmap topic=/ar_global_costmap#nav_msgs.OccupancyGrid transport=LCMTransport type=dimos.msgs.nav_msgs.OccupancyGrid.OccupancyGrid
20:52:41.890[inf][dination/module_coordinator.py] Transport module=ARBridge name=ar_global_costmap original_name=ar_global_costmap topic=/ar_global_costmap#nav_msgs.OccupancyGrid transport=LCMTransport type=dimos.msgs.nav_msgs.OccupancyGrid.OccupancyGrid
20:52:41.891[inf][dination/module_coordinator.py] Transport module=Go2AdapterModule name=ar_path original_name=ar_path topic=/ar_path#nav_msgs.Path transport=LCMTransport type=dimos.msgs.nav_msgs.Path.Path
20:52:41.891[inf][dination/module_coordinator.py] Transport module=ARBridge name=ar_path original_name=ar_path topic=/ar_path#nav_msgs.Path transport=LCMTransport type=dimos.msgs.nav_msgs.Path.Path
20:52:41.892[inf][dination/module_coordinator.py] Transport module=Go2AdapterModule name=ar_goal_reached original_name=ar_goal_reached topic=/ar_goal_reached#std_msgs.Bool transport=LCMTransport type=dimos_lcm.std_msgs.Bool.Bool
20:52:41.892[inf][dination/module_coordinator.py] Transport module=ARBridge name=ar_goal_reached original_name=ar_goal_reached topic=/ar_goal_reached#std_msgs.Bool transport=LCMTransport type=dimos_lcm.std_msgs.Bool.Bool
20:52:41.893[inf][dination/module_coordinator.py] Transport module=Go2AdapterModule name=ar_navigation_state original_name=ar_navigation_state topic=/ar_navigation_state#std_msgs.String transport=LCMTransport type=dimos_lcm.std_msgs.String.String
20:52:41.894[inf][dination/module_coordinator.py] Transport module=ARBridge name=ar_navigation_state original_name=ar_navigation_state topic=/ar_navigation_state#std_msgs.String transport=LCMTransport type=dimos_lcm.std_msgs.String.String
20:52:41.894[inf][dination/module_coordinator.py] Transport module=Go2AdapterModule name=goal_req original_name=goal_req topic=/goal_req#geometry_msgs.PoseStamped transport=LCMTransport type=dimos.msgs.geometry_msgs.PoseStamped.PoseStamped
20:52:41.895[inf][dination/module_coordinator.py] Transport module=Go2AdapterModule name=cancel_goal_signal original_name=cancel_goal_signal topic=/cancel_goal_signal#std_msgs.Bool transport=LCMTransport type=dimos_lcm.std_msgs.Bool.Bool
20:52:42.982[inf][s-ar/dimos/ar/adapters/base.py] Baseline motion recipe resolved strafe_speed=0.4
20:52:42.984[inf][/visualization/rerun/bridge.py] Rerun bridge starting
20:52:42.992[inf][dimos/mapping/voxels.py       ] VoxelGrid using device: CPU:0
20:52:43.014[inf][os/visualization/rerun/init.py] Rerun gRPC server ready at rerun+http://127.0.0.1:9877/proxy
2026-07-01T20:52:43.032429Z  WARN re_sdk::spawn: Spawning a Rerun Viewer while the `CI` environment variable is set. This is almost certainly unintended and will hang or fail on most CI runners. Consider removing `spawn=True` from this code path.
Video channel: on

    ⚠ The version of the Rerun Viewer available on your PATH does not match the version of your Rerun SDK ⚠

    Rerun does not make any kind of backwards/forwards compatibility guarantee yet: this can lead to (subtle) bugs.

    > Rerun Viewer: v0.32.0-alpha.1 (executable: "dimos-viewer")
    > Rerun SDK: v0.32.0

    You can install an appropriate version of the Rerun Viewer via binary releases:
    * Using `cargo`: `cargo binstall --force rerun-cli@0.32.0` (see https://github.com/cargo-bins/cargo-binstall)
    * Via direct download from our release assets: https://github.com/rerun-io/rerun/releases/0.32.0/
    * Using `pip`: `pip3 install rerun-sdk==0.32.0`

    For more information, refer to our complete install documentation over at:
    https://rerun.io/docs/overview/installing-rerun/viewer
    
20:52:43.126[inf][tion/rerun/websocket_server.py] RerunWebSocketServer: viewer connected from ('127.0.0.1', 49356)
▸ 20:52:43.139[inf][os/ar/bridge/status_service.py] bridge connectivity updated reconnecting=False robot_connected=True streams_active=False
20:52:43.193[deb][dimos/ar/bridge/odom_buffer.py] odom source_ts provenance (assume good; remove log after hardware check) delta_s=-1782938927.671879 receive_mono=235.431286 source_ts=1782939163.103165
20:52:43.194[inf][os/ar/bridge/status_service.py] bridge connectivity updated reconnecting=False robot_connected=True streams_active=True
20:52:43.333[inf][ar/network/websocket_server.py] XR WebSocket server listening host=0.0.0.0 port=8787
20:52:43.334[inf][s-ar/dimos/ar/bridge/module.py] ARBridge started websocket=ws://0.0.0.0:8787
--------------------------------------------------
Bridge ready — ws://0.0.0.0:8787
--------------------------------------------------
20:52:43.694[inf][/visualization/rerun/bridge.py] 
============================================================
Rerun gRPC server running (no viewer opened)

Connect a viewer:
  dimos-viewer --connect rerun+http://0.0.0.0:9877/proxy --ws-url ws://0.0.0.0:3030/ws
  dimos-viewer --connect rerun+http://192.168.1.166:9877/proxy --ws-url ws://192.168.1.166:3030/ws  # en0

  hostname: MacBookAirM2
============================================================

20:52:43.702[inf][/visualization/rerun/bridge.py] bridge listening on LCM
20:52:43.760[inf][/visualization/rerun/bridge.py] Rerun static entity archetypes=['Boxes3D', 'Transform3D'] entity_path=world/tf/base_link
20:52:45.243[deb][tocol/pubsub/impl/shmpubsub.py] SharedMemory PubSub starting (backend=auto)
🕒 Robot Connection Mode    : 📡 STA-L         (22:52:45)
20:52:46.131[inf][dination/module_coordinator.py] graphviz not found, skipping blueprint graph. Install: sudo apt install graphviz
20:52:54.383[inf][ar/network/websocket_server.py] XR client connected remote=('192.168.1.210', 40538)
--------------------------------------------------
XR client connected remote=('192.168.1.210', 40538)
--------------------------------------------------
20:52:54.505[inf][ar/network/websocket_server.py] XR inbound text message type=set_lidar_mode
20:52:54.505[inf][r/dimos/ar/bridge/telemetry.py] LiDAR mode updated mode=off obstacle_max_distance_m=0.6 obstacle_min_distance_m=0.1 obstacle_opaque_distance_m=0.4
20:52:54.506[inf][ar/network/websocket_server.py] XR inbound text message type=set_lidar_mode
20:52:56.021[inf][ar/network/websocket_server.py] XR inbound text message type=registration_command
20:52:56.021[inf][ar/network/websocket_server.py] XR inbound text message type=registration_command
20:52:56.022[inf][ar/network/websocket_server.py] XR inbound text message type=camera_info
20:52:56.022[inf][tion/session/session_frames.py] XR camera intrinsics received device=spectacles resolution=1008x756
20:52:56.022[deb][stration/session/controller.py] tag tracker active updated active=False reason=session_stop
20:52:56.023[deb][stration/session/controller.py] tag tracker active updated active=True reason=baseline_start
20:52:56.024[inf][/registration/session/flows.py] XR registration started mode=april_odom_baseline
20:52:56.238[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=176892 seq=1
20:52:56.291[war][s/ar/world_frame/transforms.py] gravity_level_transform diagnostic: translation=[-0.029 -0.941  1.5  ] up_world=[ 0.07   0.251 -0.965] input_rotation=[[ 0.033  0.997  0.07 ]
 [ 0.967 -0.049  0.251]
 [ 0.254  0.06  -0.965]]
20:52:56.291[war][s/ar/world_frame/transforms.py] gravity_level_transform: input up-axis far from world-up (angle=75.4 deg) — registration input likely malformed; this warning is rate-limited to once per 30 s
20:52:56.292[inf][os/ar/network/ws_send_queue.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:52:58.471[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=154677 seq=4
20:53:01.458[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=144859 seq=7
20:53:01.476[inf][os/ar/network/ws_send_queue.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:53:03.746[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=143946 seq=9
20:53:06.484[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=138514 seq=12
20:53:06.500[inf][os/ar/network/ws_send_queue.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:53:08.712[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=146153 seq=14
20:53:11.662[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=176324 seq=16
20:53:11.680[inf][os/ar/network/ws_send_queue.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:53:11.842[inf][ar/network/websocket_server.py] XR inbound text message type=registration_command
20:53:11.843[inf][ar/network/websocket_server.py] XR inbound text message type=set_lidar_mode
20:53:11.843[inf][ar/network/websocket_server.py] XR inbound text message type=registration_command
20:53:11.843[inf][r/dimos/ar/bridge/telemetry.py] LiDAR mode updated mode=obstacles obstacle_max_distance_m=0.6 obstacle_min_distance_m=0.1 obstacle_opaque_distance_m=0.4
20:53:11.844[inf][ar/network/websocket_server.py] XR inbound text message type=registration_command
20:53:11.845[deb][stration/session/controller.py] tag tracker active updated active=False reason=session_stop
20:53:11.846[inf][stration/session/controller.py] XR registration stopped
20:53:11.846[deb][stration/session/controller.py] tag tracker active updated active=False reason=session_stop
20:53:11.847[deb][stration/session/controller.py] tag tracker active updated active=False reason=session_stop
20:53:13.165[inf][ar/network/websocket_server.py] XR inbound text message type=registration_command
20:53:13.165[inf][ar/network/websocket_server.py] XR inbound text message type=set_lidar_mode
20:53:13.165[inf][ar/network/websocket_server.py] XR inbound text message type=registration_command
20:53:13.166[inf][r/dimos/ar/bridge/telemetry.py] LiDAR mode updated mode=off obstacle_max_distance_m=0.6 obstacle_min_distance_m=0.1 obstacle_opaque_distance_m=0.4
20:53:13.166[inf][ar/network/websocket_server.py] XR inbound text message type=camera_info
20:53:13.167[inf][tion/session/session_frames.py] XR camera intrinsics received device=spectacles resolution=1008x756
20:53:13.167[deb][stration/session/controller.py] tag tracker active updated active=False reason=session_stop
20:53:13.168[deb][stration/session/controller.py] tag tracker active updated active=True reason=baseline_start
20:53:13.168[inf][/registration/session/flows.py] XR registration started mode=april_odom_baseline
20:53:14.218[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=195606 seq=18
▸ 20:53:14.235[inf][os/ar/registration/baseline.py] BaselineCollector awaiting_motion spread_m=0.005
20:53:16.717[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=163987 seq=20
20:53:16.735[inf][os/ar/network/ws_send_queue.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:53:17.125[inf][ar/network/websocket_server.py] XR inbound text message type=registration_command
20:53:17.126[inf][os/ar/registration/baseline.py] BaselineCollector MOVE leg=0
20:53:17.126[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=0.0
20:53:17.191[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_joystick_command publish_mono=269.429119 vx=0.0 vy=0.4 wz=0.0
▸ 20:53:17.193[inf][stration/session/controller.py] XR registration authorize_motion handled
20:53:18.136[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=11.9
20:53:19.175[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=11.5
20:53:19.192[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=165576 seq=22
20:53:19.194[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_joystick_command publish_mono=271.431295 vx=0.0 vy=0.0 wz=0.0
20:53:21.570[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=160931 seq=24
20:53:22.725[inf][os/ar/network/ws_send_queue.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:53:24.805[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=161409 seq=27
20:53:25.824[inf][os/ar/registration/baseline.py] BaselineCollector MOVE leg=1
20:53:25.824[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=0.3
20:53:25.825[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_joystick_command publish_mono=278.062257 vx=0.0 vy=-0.4 wz=0.0
20:53:26.855[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=12.6
20:53:27.474[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=154442 seq=30
20:53:27.893[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=11.6
20:53:28.708[inf][os/ar/network/ws_send_queue.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:53:28.929[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=11.6
20:53:29.822[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=143571 seq=32
20:53:29.967[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=11.6
20:53:30.043[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_joystick_command publish_mono=282.280985 vx=0.0 vy=0.0 wz=0.0
20:53:31.935[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=153980 seq=34
20:53:33.141[inf][os/ar/registration/baseline.py] BaselineCollector MOVE leg=2
20:53:33.142[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=0.6
20:53:33.142[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_joystick_command publish_mono=285.379801 vx=0.0 vy=0.4 wz=0.0
20:53:34.190[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=12.4
20:53:34.294[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=154224 seq=36
20:53:34.308[inf][os/ar/network/ws_send_queue.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:53:35.167[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_joystick_command publish_mono=287.405106 vx=0.0 vy=0.0 wz=0.0
20:53:36.406[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=146808 seq=38
20:53:38.636[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=148934 seq=40
20:53:38.795[inf][/registration/session/flows.py] BaselineCollector DONE — auto-committing registration
20:53:38.796[deb][stration/session/controller.py] tag tracker active updated active=False reason=registration_finish
20:53:38.798[deb][mos/ar/world_frame/registry.py] TF publish_static not supported by current backend — skipping world→odom TF
▸ 20:53:38.799[inf][/registration/session/flows.py] Registration succeeded approximate=False mode=april_odom_baseline quality=0.927
--------------------------------------------------
Registration succeeded mode=april_odom_baseline quality=0.93
--------------------------------------------------
20:53:39.653[inf][mos/ar/tag_tracking/tracker.py] tag_mount_offset diagnostic tag_id=0 measured_base_to_tag=[ 0.1864 -0.0163  0.0746] configured_mount.position=[0.18 0.   0.06] residual=[ 0.0064 -0.0163  0.0146] p_world_tag=[-0.0778 -0.7533  1.6409] p_world_base_from_mount=[-0.1291 -0.8025  1.465 ]
20:53:39.654[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.129, -0.802, 1.465] base_before=[-0.116, -0.817, 1.454] baseline_m=0.0 marker_jump_m=0.023 observation_count=1 solve_method=apriltag_translation solve_quality=0.954 trans_delta_m=0.023 yaw_delta_deg=0.0
20:53:39.655[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1782939219.169099 frame_age_s=0.094 obs_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 robot_speed_ms=0.0 seq=41 source_ts_gap_s=0.035584 straightness=None total_rejections=0 world_residual_m=0.0112
20:53:39.655[inf][os/ar/network/ws_send_queue.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:53:40.854[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=149383 seq=42
20:53:40.873[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.13, -0.812, 1.476] base_before=[-0.129, -0.802, 1.465] baseline_m=0.0 marker_jump_m=0.015 observation_count=1 solve_method=apriltag_translation solve_quality=0.951 trans_delta_m=0.015 yaw_delta_deg=0.0
20:53:40.875[inf][ar/network/websocket_server.py] XR inbound text message type=set_lidar_mode
20:53:40.876[inf][ar/network/websocket_server.py] XR inbound text message type=camera_info
20:53:40.876[inf][r/dimos/ar/bridge/telemetry.py] LiDAR mode updated mode=obstacles obstacle_max_distance_m=0.6 obstacle_min_distance_m=0.1 obstacle_opaque_distance_m=0.4
20:53:40.884[inf][tion/session/session_frames.py] XR camera intrinsics received device=spectacles resolution=1008x756
20:53:40.888[inf][r/dimos/ar/bridge/telemetry.py] LiDAR stream active hz=1.0
20:53:40.888[deb][r/dimos/ar/bridge/telemetry.py] LiDAR payload bytes=5 hz=1.0 points=0
20:53:42.867[inf][ar/network/websocket_server.py] XR inbound text message type=nav_goal
20:53:43.569[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=180104 seq=44
20:53:43.879[inf][ar/network/websocket_server.py] XR inbound text message type=nav_goal
20:53:45.544[inf][ar/network/websocket_server.py] XR inbound text message type=nav_goal
20:53:45.600[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=297.8378
20:53:45.601[inf][imos/ar/navigation/navigate.py] XR navigation goal published odom_goal=[0.332, 0.342, 0.026] odom_goal_yaw_deg=-0.0 world_goal=[0.269, -1.082, 1.688] world_goal_yaw_deg=-62.41
20:53:45.631[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.332, 0.342, 0.026], euler=[90.0, 0.0, 29.9])
20:53:45.632[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
20:53:45.784[inf][nning_a_star/global_planner.py] Found safe goal. x=0.33 y=0.32
20:53:45.788[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
20:53:45.790[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
20:53:45.874[inf][imos/ar/navigation/navigate.py] XR navigation navigating path_waypoints=7
20:53:45.875[inf][os/ar/network/ws_send_queue.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:53:46.525[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=176807 seq=45
20:53:46.545[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[-0.129, -0.797, 1.475] base_before=[-0.129, -0.797, 1.475] baseline_m=0.0 marker_jump_m=0.0 observation_count=1 solve_method=apriltag_translation solve_quality=0.922 trans_delta_m=0.0 yaw_delta_deg=0.0
20:53:46.546[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1782939225.702256 frame_age_s=0.1099 obs_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 robot_speed_ms=0.03 seq=45 source_ts_gap_s=0.015267 straightness=None total_rejections=0 world_residual_m=0.0145
20:53:47.630[inf][anning_a_star/local_planner.py] changed state state=path_following
20:53:49.516[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=165155 seq=46
20:53:49.556[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.101, -0.8, 1.479] base_before=[0.101, -0.8, 1.479] baseline_m=0.0 marker_jump_m=0.0 observation_count=1 solve_method=apriltag_translation solve_quality=0.922 trans_delta_m=0.0 yaw_delta_deg=0.0
20:53:49.559[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1782939228.83551 frame_age_s=0.1008 obs_added=0 regime=cruise rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 robot_speed_ms=0.218 seq=46 source_ts_gap_s=0.112229 straightness=None total_rejections=0 world_residual_m=0.1028
20:53:49.696[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
20:53:49.697[inf][anning_a_star/local_planner.py] changed state state=final_rotation
20:53:50.106[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
20:53:50.107[inf][anning_a_star/local_planner.py] changed state state=arrived
20:53:50.211[inf][anning_a_star/local_planner.py] changed state state=idle
20:53:50.211[inf][nning_a_star/global_planner.py] Arrived at goal.
20:53:50.212[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 20:53:50.526[inf][imos/ar/navigation/navigate.py] XR navigation goal reached
20:53:52.155[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=163910 seq=47
20:53:52.177[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.25, -0.799, 1.568] base_before=[0.25, -0.799, 1.568] baseline_m=0.0 marker_jump_m=0.0 observation_count=1 solve_method=apriltag_translation solve_quality=0.922 trans_delta_m=0.0 yaw_delta_deg=0.0
20:53:52.179[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1782939231.603307 frame_age_s=0.098 obs_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 robot_speed_ms=0.0 seq=47 source_ts_gap_s=0.015862 straightness=None total_rejections=0 world_residual_m=0.3823
20:53:52.180[inf][os/ar/network/ws_send_queue.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:53:54.992[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=161039 seq=48
20:53:55.040[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.29, -0.848, 1.611] base_before=[0.25, -0.799, 1.567] baseline_m=0.0 marker_jump_m=0.077 observation_count=1 solve_method=apriltag_translation solve_quality=0.978 trans_delta_m=0.077 yaw_delta_deg=0.0
20:53:55.042[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1782939234.168702 frame_age_s=0.1222 obs_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 robot_speed_ms=0.0 seq=48 source_ts_gap_s=0.128233 straightness=None total_rejections=0 world_residual_m=0.3238
20:53:55.045[inf][ar/network/websocket_server.py] XR inbound text message type=nav_goal
20:53:57.055[inf][ar/network/websocket_server.py] XR inbound text message type=nav_goal
20:53:57.056[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=309.293804
20:53:57.057[inf][imos/ar/navigation/navigate.py] XR navigation goal published odom_goal=[0.275, -0.907, 0.062] odom_goal_yaw_deg=-180.0 world_goal=[-0.936, -1.095, 1.624] world_goal_yaw_deg=171.25
20:53:57.314[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=175617 seq=49
20:53:57.317[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.275, -0.907, 0.062], euler=[90.0, 0.0, -96.4])
20:53:57.318[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
20:53:57.319[inf][nning_a_star/global_planner.py] Found safe goal. x=0.28 y=-0.93
20:53:57.326[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
20:53:57.328[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
20:53:57.694[inf][imos/ar/navigation/navigate.py] XR navigation navigating path_waypoints=15
20:53:57.695[inf][os/ar/network/ws_send_queue.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:53:59.602[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=181213 seq=50
20:54:00.163[inf][anning_a_star/local_planner.py] changed state state=path_following
20:54:01.767[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=180219 seq=51
20:54:01.794[inf][s/ar/world_frame/refinement.py] Runtime correction applied base_after=[0.099, -0.854, 1.48] base_before=[0.099, -0.854, 1.48] baseline_m=0.0 marker_jump_m=0.0 observation_count=1 solve_method=apriltag_translation solve_quality=0.978 trans_delta_m=0.0 yaw_delta_deg=0.0
20:54:01.796[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1782939241.601838 frame_age_s=0.1068 obs_added=0 regime=cruise rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_up_tilt=0 robot_speed_ms=0.249 seq=51 source_ts_gap_s=0.152678 straightness=None total_rejections=0 world_residual_m=0.1196
20:54:04.243[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=188903 seq=52
20:54:06.552[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=179620 seq=53
20:54:09.023[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=177760 seq=54
20:54:11.213[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=177989 seq=55
20:54:13.370[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=169886 seq=56
20:54:15.701[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=176888 seq=57
20:54:17.910[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=170959 seq=58
20:54:20.374[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=192679 seq=59
20:54:22.884[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=163582 seq=60
20:54:24.671[inf][ar/network/websocket_server.py] XR inbound text message type=emergency_stop
20:54:24.671[inf][s-ar/dimos/ar/bridge/safety.py] XR emergency_stop received
20:54:24.672[inf][imos/ar/navigation/navigate.py] XR emergency_stop handled nav_reset=true
20:54:24.672[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=0.3
20:54:24.673[inf][os/ar/network/ws_send_queue.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:54:25.041[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=160061 seq=61
20:54:25.473[inf][ar/network/websocket_server.py] XR inbound text message type=emergency_stop
20:54:25.474[inf][s-ar/dimos/ar/bridge/safety.py] XR emergency_stop received
20:54:25.474[inf][imos/ar/navigation/navigate.py] XR emergency_stop handled nav_reset=true
20:54:26.517[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=emergency_stop publish_mono=338.754641
20:54:26.518[inf][os/ar/registration/baseline.py] BaselineCollector failed reason=Emergency stop received
20:54:26.519[inf][os/ar/registration/baseline.py] BaselineCollector failed reason=Emergency stop received
20:54:27.391[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=160001 seq=62
20:54:28.487[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
20:54:28.490[inf][anning_a_star/local_planner.py] changed state state=idle
20:54:28.491[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
20:54:29.753[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=163765 seq=63
20:54:31.907[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=162319 seq=64
20:54:32.229[inf][os/ar/network/ws_send_queue.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:54:34.654[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=175638 seq=65
20:54:37.115[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=157885 seq=66
20:54:39.237[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=164679 seq=67
20:54:39.871[inf][ar/network/websocket_server.py] XR inbound text message type=nav_goal
20:54:41.538[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=164629 seq=68
20:54:41.749[inf][ar/network/websocket_server.py] XR inbound text message type=nav_goal
20:54:41.751[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=353.987765
20:54:41.752[inf][imos/ar/navigation/navigate.py] XR navigation goal published odom_goal=[0.106, -0.416, 0.025] odom_goal_yaw_deg=-0.0 world_goal=[-0.439, -1.132, 1.474] world_goal_yaw_deg=-48.63
20:54:41.773[deb][r/dimos/ar/bridge/telemetry.py] LiDAR payload bytes=197 hz=1.0 points=32
20:54:43.524[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.106, -0.416, 0.025], euler=[90.0, -0.0, 43.7])
20:54:43.526[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
20:54:43.526[inf][nning_a_star/global_planner.py] Found safe goal. x=0.08 y=-0.42
20:54:43.529[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
20:54:43.531[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
20:54:43.797[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=164476 seq=69
20:54:45.970[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=164924 seq=70
20:54:46.993[inf][imos/ar/navigation/navigate.py] XR navigation navigating path_waypoints=5
20:54:46.995[inf][os/ar/network/ws_send_queue.py] XR WebSocket outbound backlog coalesce_pending=2 dropped_fifo=0 fifo_depth=0
20:54:48.125[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=163943 seq=71
20:54:50.323[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=164087 seq=72
20:54:50.535[inf][anning_a_star/local_planner.py] changed state state=path_following
20:54:52.502[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=164374 seq=73
20:54:54.741[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=164200 seq=74
20:54:55.783[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
20:54:55.784[inf][anning_a_star/local_planner.py] changed state state=final_rotation
20:54:57.245[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=164992 seq=75
20:54:59.464[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=165527 seq=76
20:55:01.650[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=162924 seq=77
20:55:02.389[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
20:55:02.390[inf][anning_a_star/local_planner.py] changed state state=arrived
20:55:02.493[inf][anning_a_star/local_planner.py] changed state state=idle
20:55:02.496[inf][nning_a_star/global_planner.py] Arrived at goal.
20:55:02.496[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
20:55:03.967[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=157171 seq=78
20:55:06.522[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=159078 seq=79
20:55:08.792[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=161402 seq=80
20:55:11.050[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=201323 seq=81
20:55:13.443[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=162316 seq=82
20:55:15.620[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=164259 seq=83
20:55:17.221[inf][ar/network/websocket_server.py] XR inbound text message type=set_lidar_mode
20:55:17.221[inf][r/dimos/ar/bridge/telemetry.py] LiDAR mode updated mode=full obstacle_max_distance_m=0.6 obstacle_min_distance_m=0.1 obstacle_opaque_distance_m=0.4
20:55:17.801[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=164747 seq=84
20:55:20.369[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=143489 seq=85
20:55:21.855[inf][ar/network/websocket_server.py] XR inbound text message type=set_lidar_mode
20:55:21.857[inf][r/dimos/ar/bridge/telemetry.py] LiDAR mode updated mode=off obstacle_max_distance_m=0.6 obstacle_min_distance_m=0.1 obstacle_opaque_distance_m=0.4
20:55:22.550[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=166311 seq=86
20:55:24.747[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=200028 seq=87
20:55:27.048[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=185797 seq=88
20:55:29.424[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=196324 seq=89
20:55:31.977[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=191407 seq=90
20:55:34.363[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=204899 seq=91
20:55:36.759[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=181409 seq=92
20:55:37.407[inf][ar/network/websocket_server.py] XR inbound text message type=cancel_nav_goal
20:55:37.408[inf][imos/ar/navigation/navigate.py] XR navigation goal cancelled
20:55:37.408[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=0.0
20:55:37.409[inf][os/ar/network/ws_send_queue.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:55:37.409[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=cancel_nav_goal publish_mono=409.645667
20:55:38.888[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=160437 seq=93
20:55:41.034[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=165797 seq=94
20:55:41.339[inf][ar/network/websocket_server.py] XR inbound text message type=nav_goal
20:55:42.435[inf][ar/network/websocket_server.py] XR inbound text message type=nav_goal
20:55:43.267[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=186620 seq=95
20:55:43.269[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=415.505205
20:55:43.269[inf][imos/ar/navigation/navigate.py] XR navigation goal published odom_goal=[0.086, 0.294, 0.028] odom_goal_yaw_deg=-0.0 world_goal=[0.272, -1.129, 1.483] world_goal_yaw_deg=-52.15
20:55:43.270[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.086, 0.294, 0.028], euler=[90.0, 0.0, 40.2])
20:55:43.271[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
20:55:43.272[inf][nning_a_star/global_planner.py] Found safe goal. x=0.08 y=0.28
20:55:43.277[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
20:55:43.278[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
20:55:44.516[inf][anning_a_star/local_planner.py] changed state state=path_following
20:55:45.501[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=161529 seq=96
20:55:45.645[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
20:55:45.647[inf][anning_a_star/local_planner.py] changed state state=final_rotation
20:55:45.647[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
20:55:45.647[inf][anning_a_star/local_planner.py] changed state state=arrived
20:55:45.749[inf][anning_a_star/local_planner.py] changed state state=idle
20:55:45.749[inf][nning_a_star/global_planner.py] Arrived at goal.
20:55:45.750[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
20:55:47.749[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=166151 seq=97
20:55:49.941[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=158457 seq=98
20:55:51.126[inf][os/ar/bridge/status_service.py] bridge connectivity updated reconnecting=True robot_connected=False streams_active=False
20:55:51.574[war][imos/ar/navigation/navigate.py] XR navigation goal stalled stall_reason=no_path
20:55:51.574[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=0.1
20:55:51.575[inf][os/ar/network/ws_send_queue.py] XR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
20:55:51.575[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=cancel_nav_goal publish_mono=423.811305
20:55:51.628[inf][os/ar/bridge/status_service.py] bridge connectivity updated reconnecting=False robot_connected=False streams_active=False
20:55:52.098[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=156202 seq=99
20:55:54.631[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=164308 seq=100
20:55:56.782[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=184731 seq=101
20:55:58.947[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=186556 seq=102
20:56:01.199[inf][ar/network/websocket_server.py] XR camera frame received jpeg_bytes=204073 seq=103
20:56:03.189[inf][s-ar/dimos/ar/bridge/safety.py] XR client disconnect handled nav_reset=true registration_cleared=true
20:56:03.189[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=0.1
20:56:03.190[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=emergency_stop publish_mono=435.426073
20:56:03.190[inf][s-ar/dimos/ar/bridge/module.py] XR bridge last client disconnected lidar_mode_reset=true
▸ 20:56:08.534[inf][os/ar/bridge/status_service.py] bridge connectivity updated reconnecting=False robot_connected=True streams_active=False
▸ 20:56:08.536[inf][imos/ar/navigation/navigate.py] XR navigation goal reached
20:56:08.654[inf][os/ar/bridge/status_service.py] bridge connectivity updated reconnecting=False robot_connected=True streams_active=True
20:56:18.782[inf][os/ar/bridge/status_service.py] bridge connectivity updated reconnecting=True robot_connected=False streams_active=False
20:56:19.289[inf][os/ar/bridge/status_service.py] bridge connectivity updated reconnecting=False robot_connected=False streams_active=False





