# Shortened session log (300 lines)

Unitree Go2 AR session `2026-07-03` — registration, navigation, and errors only.

| Category | Lines kept |
|----------|------------|
| Errors/warnings | 12 |
| Registration | 61 |
| Session end (pinned) | 20 |
| Navigation (sampled) | 207 / 2921 |

---

16:33:02.066[inf][os/ar/bridge/status_service.] bridge connectivity updated  reconnecting=False robot_connected=True streams_active=False
16:33:02.067[inf][os/ar/bridge/status_service.] bridge connectivity updated  reconnecting=False robot_connected=True streams_active=True
16:33:34.692[inf][os/ar/network/websocket_serv] XR inbound text message  type=registration_command
16:33:34.692[inf][os/ar/network/websocket_serv] XR inbound text message  type=registration_command  [×N more same burst]
16:33:34.693[deb][os/ar/registration/session/c] tag tracker active updated  active=False reason=session_stop
16:33:34.694[deb][os/ar/registration/session/c] tag tracker active updated  active=True reason=baseline_start
16:33:34.694[inf][os/ar/registration/session/f] XR registration started  mode=april_odom_baseline
16:33:34.736[inf][os/ar/registration/session/s] XR camera intrinsics received  device=spectacles resolution=1008x756
16:33:38.048[inf][os/ar/registration/baseline.] BaselineCollector awaiting_motion  spread_m=0.011
16:33:40.793[inf][os/ar/registration/baseline.] BaselineCollector MOVE leg=0
16:33:40.853[inf][os/ar/registration/session/c] XR registration authorize_motion handled
16:33:52.212[inf][os/ar/registration/baseline.] BaselineCollector MOVE leg=1
16:34:03.880[inf][os/ar/registration/baseline.] BaselineCollector MOVE leg=2
16:34:13.102[inf][os/ar/registration/session/f] BaselineCollector DONE — auto-committing registration
16:34:13.102[deb][os/ar/registration/session/c] tag tracker active updated  active=False reason=registration_finish
16:34:13.105[inf][os/ar/registration/session/f] Registration succeeded  approximate=False mode=april_odom_baseline quality=0.944
16:34:20.851[inf][navigation/replanning_a_star] Got new goal  goal=PoseStamped(pos=[0.126, -0.055, -0.016], euler=[90.0, 0.0, 17.6])
16:34:20.853[inf][navigation/replanning_a_star] Cancelling goal.  arrived=False but_will_try_again=True
16:34:20.905[inf][os/ar/navigation/navigate.py] XR navigation goal published  odom_goal=[0.126, -0.055, -0.016] odom_goal_yaw_deg=0 world_goal=[-0.348, -1.146, 1.184] world_goal_yaw_deg=-83.37
16:34:20.962[inf][navigation/replanning_a_star] Found safe goal.  x=0.12 y=-0.08
16:34:20.965[inf][navigation/replanning_a_star] Found path 1.1x robot width.
16:34:20.966[inf][navigation/replanning_a_star] changed state  state=path_following
16:34:20.969[inf][navigation/replanning_a_star] Reached goal position, starting final rotation
16:34:20.969[inf][navigation/replanning_a_star] changed state  state=final_rotation
16:34:20.969[inf][navigation/replanning_a_star] Final rotation complete, goal reached
16:34:20.969[inf][navigation/replanning_a_star] changed state  state=arrived
16:34:21.068[inf][navigation/replanning_a_star] changed state  state=idle
16:34:21.069[inf][navigation/replanning_a_star] Arrived at goal.
16:34:21.070[inf][navigation/replanning_a_star] Cancelling goal.  arrived=True but_will_try_again=False
16:34:21.125[inf][os/ar/navigation/navigate.py] XR navigation goal reached
16:34:25.159[inf][os/ar/navigation/navigate.py] XR navigation goal published  odom_goal=[0.129, -0.054, -0.016] odom_goal_yaw_deg=0 world_goal=[-0.347, -1.147, 1.188] world_goal_yaw_deg=-83.38
16:34:25.160[inf][navigation/replanning_a_star] Got new goal  goal=PoseStamped(pos=[0.129, -0.054, -0.016], euler=[90.0, 0.0, 17.6])
16:34:25.161[inf][navigation/replanning_a_star] Cancelling goal.  arrived=False but_will_try_again=True
16:34:25.161[inf][navigation/replanning_a_star] Found safe goal.  x=0.12 y=-0.08
16:34:25.164[inf][navigation/replanning_a_star] Found path 1.1x robot width.
16:34:25.165[inf][navigation/replanning_a_star] changed state  state=path_following
16:34:25.166[inf][navigation/replanning_a_star] Reached goal position, starting final rotation
16:34:25.166[inf][navigation/replanning_a_star] changed state  state=final_rotation
16:34:25.166[inf][navigation/replanning_a_star] Final rotation complete, goal reached
16:34:25.167[inf][navigation/replanning_a_star] changed state  state=arrived
16:34:25.271[inf][navigation/replanning_a_star] changed state  state=idle
16:34:25.271[inf][navigation/replanning_a_star] Arrived at goal.
16:34:25.271[inf][navigation/replanning_a_star] Cancelling goal.  arrived=True but_will_try_again=False
16:34:25.302[inf][os/ar/navigation/navigate.py] XR navigation goal reached
16:34:29.599[inf][navigation/replanning_a_star] Got new goal  goal=PoseStamped(pos=[0.124, -0.072, -0.024], euler=[90.0, 0.0, 17.6])
16:34:29.599[inf][os/ar/navigation/navigate.py] XR navigation goal published  odom_goal=[0.124, -0.072, -0.024] odom_goal_yaw_deg=-0 world_goal=[-0.364, -1.154, 1.179] world_goal_yaw_deg=-83.39
16:34:29.600[inf][navigation/replanning_a_star] Cancelling goal.  arrived=False but_will_try_again=True
16:34:29.600[inf][navigation/replanning_a_star] Found safe goal.  x=0.07 y=-0.08
16:34:29.602[inf][navigation/replanning_a_star] Found path 1.1x robot width.
16:34:29.603[inf][navigation/replanning_a_star] changed state  state=path_following
16:34:29.603[inf][navigation/replanning_a_star] Reached goal position, starting final rotation
16:34:29.604[inf][navigation/replanning_a_star] changed state  state=final_rotation
16:34:29.604[inf][navigation/replanning_a_star] Final rotation complete, goal reached
16:34:29.604[inf][navigation/replanning_a_star] changed state  state=arrived
16:34:29.708[inf][navigation/replanning_a_star] changed state  state=idle
16:34:29.709[inf][navigation/replanning_a_star] Arrived at goal.
16:34:29.709[inf][navigation/replanning_a_star] Cancelling goal.  arrived=True but_will_try_again=False
16:34:29.712[inf][os/ar/navigation/navigate.py] XR navigation goal reached
16:34:29.767[inf][os/ar/navigation/navigate.py] XR navigation goal published  odom_goal=[0.258, 0.337, 0.026] odom_goal_yaw_deg=-0 world_goal=[0.012, -1.104, 1.389] world_goal_yaw_deg=-41.9
16:34:29.768[inf][navigation/replanning_a_star] Got new goal  goal=PoseStamped(pos=[0.258, 0.337, 0.026], euler=[90.0, 0.0, 59.1])
16:34:29.768[inf][navigation/replanning_a_star] Cancelling goal.  arrived=False but_will_try_again=True
16:34:29.769[inf][navigation/replanning_a_star] Found safe goal.  x=0.22 y=0.32
16:34:29.773[inf][navigation/replanning_a_star] Found path 1.1x robot width.
16:34:29.775[inf][navigation/replanning_a_star] changed state  state=initial_rotation
16:34:30.358[inf][navigation/replanning_a_star] Got new goal  goal=PoseStamped(pos=[0.388, 0.397, 0.026], euler=[90.0, 0.0, 9.9])
16:34:30.358[inf][navigation/replanning_a_star] Cancelling goal.  arrived=False but_will_try_again=True
16:34:30.358[inf][os/ar/navigation/navigate.py] XR navigation goal published  odom_goal=[0.388, 0.397, 0.026] odom_goal_yaw_deg=-0 world_goal=[0.047, -1.104, 1.527] world_goal_yaw_deg=-91.06
16:34:30.359[inf][navigation/replanning_a_star] changed state  state=idle
16:34:30.360[inf][navigation/replanning_a_star] Found safe goal.  x=0.38 y=0.37
16:34:30.362[inf][navigation/replanning_a_star] Local planner loop exited due to stop event.
16:34:30.364[inf][navigation/replanning_a_star] Found path 1.1x robot width.
16:34:30.366[inf][navigation/replanning_a_star] changed state  state=initial_rotation
16:34:31.499[inf][navigation/replanning_a_star] changed state  state=path_following
16:34:33.363[inf][navigation/replanning_a_star] Reached goal position, starting final rotation
16:34:33.364[inf][navigation/replanning_a_star] changed state  state=final_rotation
16:34:34.180[inf][navigation/replanning_a_star] Final rotation complete, goal reached
16:34:34.180[inf][navigation/replanning_a_star] changed state  state=arrived
16:34:34.281[inf][navigation/replanning_a_star] changed state  state=idle
16:34:34.282[inf][navigation/replanning_a_star] Arrived at goal.
16:34:34.282[inf][navigation/replanning_a_star] Cancelling goal.  arrived=True but_will_try_again=False
16:34:34.284[inf][os/ar/navigation/navigate.py] XR navigation goal reached
16:34:36.804[inf][os/ar/navigation/navigate.py] XR navigation goal published  odom_goal=[0.477, 0.074, 0.031] odom_goal_yaw_deg=180 world_goal=[-0.287, -1.099, 1.554] world_goal_yaw_deg=161.3
16:34:36.805[inf][os/ar/navigation/navigate.py] XR navigation goal published  odom_goal=[0.477, 0.445, 0.031] odom_goal_yaw_deg=-0 world_goal=[0.077, -1.099, 1.624] world_goal_yaw_deg=-146.7
16:34:36.828[inf][navigation/replanning_a_star] Got new goal  goal=PoseStamped(pos=[0.477, 0.445, 0.031], euler=[90.0, 0.0, -45.7])
16:34:36.830[inf][navigation/replanning_a_star] Cancelling goal.  arrived=False but_will_try_again=True
16:34:36.834[inf][navigation/replanning_a_star] Found safe goal.  x=0.48 y=0.42
16:34:36.839[inf][navigation/replanning_a_star] Found path 1.1x robot width.
16:34:36.841[inf][navigation/replanning_a_star] changed state  state=initial_rotation
16:34:36.842[inf][navigation/replanning_a_star] Got new goal  goal=PoseStamped(pos=[0.477, 0.074, 0.031], euler=[90.0, 0.0, -97.7])
16:34:36.842[inf][navigation/replanning_a_star] Cancelling goal.  arrived=False but_will_try_again=True
16:34:36.842[inf][navigation/replanning_a_star] changed state  state=idle
16:34:36.843[inf][navigation/replanning_a_star] Found safe goal.  x=0.48 y=0.02
16:34:36.843[inf][navigation/replanning_a_star] Local planner loop exited due to stop event.
16:34:36.846[inf][navigation/replanning_a_star] Found path 1.1x robot width.
16:34:36.848[inf][navigation/replanning_a_star] changed state  state=initial_rotation
16:34:37.054[inf][navigation/replanning_a_star] Got new goal  goal=PoseStamped(pos=[0.384, -0.141, 0.031], euler=[90.0, 0.0, -104.8])
16:34:37.055[inf][os/ar/navigation/navigate.py] XR navigation goal published  odom_goal=[0.384, -0.141, 0.031] odom_goal_yaw_deg=180 world_goal=[-0.481, -1.099, 1.421] world_goal_yaw_deg=154.2
16:34:37.055[inf][navigation/replanning_a_star] Cancelling goal.  arrived=False but_will_try_again=True
16:34:37.055[inf][navigation/replanning_a_star] changed state  state=idle
16:34:37.055[inf][navigation/replanning_a_star] Found safe goal.  x=0.38 y=-0.18
16:34:37.056[inf][navigation/replanning_a_star] Local planner loop exited due to stop event.
16:34:37.058[inf][navigation/replanning_a_star] Found path 1.1x robot width.
16:34:37.064[inf][navigation/replanning_a_star] changed state  state=initial_rotation
16:34:37.870[inf][navigation/replanning_a_star] Got new goal  goal=PoseStamped(pos=[0.268, -0.310, 0.025], euler=[90.0, 0.0, -145.9])
16:34:37.871[inf][os/ar/navigation/navigate.py] XR navigation goal published  odom_goal=[0.268, -0.31, 0.025] odom_goal_yaw_deg=-180 world_goal=[-0.624, -1.106, 1.276] world_goal_yaw_deg=113.1
16:34:37.871[inf][navigation/replanning_a_star] Cancelling goal.  arrived=False but_will_try_again=True
16:34:37.871[inf][navigation/replanning_a_star] changed state  state=idle
16:34:37.872[inf][navigation/replanning_a_star] Found safe goal.  x=0.23 y=-0.33
16:34:37.872[inf][navigation/replanning_a_star] Local planner loop exited due to stop event.
16:34:37.876[inf][navigation/replanning_a_star] Found path 1.1x robot width.
16:34:37.878[inf][navigation/replanning_a_star] changed state  state=initial_rotation
16:34:39.636[inf][navigation/replanning_a_star] changed state  state=path_following
16:34:42.015[inf][navigation/replanning_a_star] Reached goal position, starting final rotation
16:34:42.015[inf][navigation/replanning_a_star] changed state  state=final_rotation
16:34:43.148[inf][navigation/replanning_a_star] Final rotation complete, goal reached
16:34:43.148[inf][navigation/replanning_a_star] changed state  state=arrived
16:34:43.249[inf][navigation/replanning_a_star] changed state  state=idle
16:34:43.250[inf][navigation/replanning_a_star] Arrived at goal.
16:34:43.251[inf][navigation/replanning_a_star] Cancelling goal.  arrived=True but_will_try_again=False
16:34:43.252[inf][os/ar/navigation/navigate.py] XR navigation goal reached
16:34:44.579[inf][navigation/replanning_a_star] Got new goal  goal=PoseStamped(pos=[0.192, -0.325, 0.031], euler=[90.0, 0.0, -101.0])
16:34:44.579[inf][navigation/replanning_a_star] Cancelling goal.  arrived=False but_will_try_again=True
16:34:44.580[inf][os/ar/navigation/navigate.py] XR navigation goal published  odom_goal=[0.192, -0.325, 0.031] odom_goal_yaw_deg=-180 world_goal=[-0.625, -1.099, 1.198] world_goal_yaw_deg=158
16:34:44.580[inf][navigation/replanning_a_star] Found safe goal.  x=0.18 y=-0.33
16:34:44.582[inf][navigation/replanning_a_star] Found path 1.1x robot width.
16:34:44.583[inf][navigation/replanning_a_star] changed state  state=initial_rotation
16:34:44.819[inf][navigation/replanning_a_star] Got new goal  goal=PoseStamped(pos=[0.165, -0.123, 0.031], euler=[90.0, 0.0, 115.8])
16:34:44.820[inf][os/ar/navigation/navigate.py] XR navigation goal published  odom_goal=[0.165, -0.123, 0.031] odom_goal_yaw_deg=-180 world_goal=[-0.422, -1.099, 1.209] world_goal_yaw_deg=14.87
16:34:44.820[inf][navigation/replanning_a_star] Cancelling goal.  arrived=False but_will_try_again=True
16:34:44.820[inf][navigation/replanning_a_star] changed state  state=idle
16:34:44.820[inf][navigation/replanning_a_star] Local planner loop exited due to stop event.
16:34:44.821[inf][navigation/replanning_a_star] Found safe goal.  x=0.13 y=-0.13
16:34:44.823[inf][navigation/replanning_a_star] Found path 1.1x robot width.
16:34:44.824[inf][navigation/replanning_a_star] changed state  state=initial_rotation
16:34:45.450[inf][os/ar/navigation/navigate.py] XR navigation goal published  odom_goal=[0.33, -0.001, 0.031] odom_goal_yaw_deg=0 world_goal=[-0.334, -1.099, 1.395] world_goal_yaw_deg=-71.15
16:34:45.450[inf][navigation/replanning_a_star] Got new goal  goal=PoseStamped(pos=[0.330, -0.001, 0.031], euler=[90.0, 0.0, 29.8])
16:34:45.450[inf][navigation/replanning_a_star] Cancelling goal.  arrived=False but_will_try_again=True
16:34:45.451[inf][navigation/replanning_a_star] changed state  state=idle
16:34:45.452[inf][navigation/replanning_a_star] Local planner loop exited due to stop event.
16:34:45.452[inf][navigation/replanning_a_star] Found safe goal.  x=0.33 y=-0.03
16:34:45.457[inf][navigation/replanning_a_star] Found path 1.1x robot width.
16:34:45.459[inf][navigation/replanning_a_star] changed state  state=initial_rotation
16:34:47.314[inf][navigation/replanning_a_star] changed state  state=path_following
16:34:47.935[inf][navigation/replanning_a_star] Reached goal position, starting final rotation
16:34:47.935[inf][navigation/replanning_a_star] changed state  state=final_rotation
16:34:48.561[inf][navigation/replanning_a_star] Final rotation complete, goal reached
16:34:48.562[inf][navigation/replanning_a_star] changed state  state=arrived
16:34:48.663[inf][navigation/replanning_a_star] changed state  state=idle
16:34:48.663[inf][navigation/replanning_a_star] Arrived at goal.
16:34:48.664[inf][navigation/replanning_a_star] Cancelling goal.  arrived=True but_will_try_again=False
16:34:48.665[inf][os/ar/navigation/navigate.py] XR navigation goal reached
16:34:49.858[inf][os/ar/navigation/navigate.py] XR navigation goal published  odom_goal=[0.514, -0.008, 0.027] odom_goal_yaw_deg=0 world_goal=[-0.376, -1.104, 1.574] world_goal_yaw_deg=-63.19
16:34:49.858[inf][navigation/replanning_a_star] Got new goal  goal=PoseStamped(pos=[0.514, -0.008, 0.027], euler=[90.0, 0.0, 37.8])
16:34:49.859[inf][navigation/replanning_a_star] Cancelling goal.  arrived=False but_will_try_again=True
16:34:49.860[inf][navigation/replanning_a_star] Found safe goal.  x=0.48 y=-0.03
16:34:49.866[inf][navigation/replanning_a_star] Found path 1.1x robot width.
16:34:49.868[inf][navigation/replanning_a_star] changed state  state=initial_rotation
16:34:50.186[inf][os/ar/navigation/navigate.py] XR navigation goal published  odom_goal=[0.415, 0.177, 0.027] odom_goal_yaw_deg=-180 world_goal=[-0.174, -1.104, 1.513] world_goal_yaw_deg=85.88
16:34:50.186[inf][navigation/replanning_a_star] Got new goal  goal=PoseStamped(pos=[0.415, 0.177, 0.027], euler=[90.0, 0.0, -173.1])
16:34:50.186[inf][navigation/replanning_a_star] Cancelling goal.  arrived=False but_will_try_again=True
16:34:50.187[inf][navigation/replanning_a_star] changed state  state=idle
16:34:50.187[inf][navigation/replanning_a_star] Found safe goal.  x=0.38 y=0.17
16:34:50.187[inf][navigation/replanning_a_star] Local planner loop exited due to stop event.
16:34:50.192[inf][navigation/replanning_a_star] Found path 1.1x robot width.
16:34:50.195[inf][navigation/replanning_a_star] changed state  state=initial_rotation
16:34:50.693[inf][navigation/replanning_a_star] Got new goal  goal=PoseStamped(pos=[0.257, 0.358, 0.031], euler=[90.0, 0.0, 139.2])
16:34:50.693[inf][os/ar/navigation/navigate.py] XR navigation goal published  odom_goal=[0.257, 0.358, 0.031] odom_goal_yaw_deg=-180 world_goal=[0.033, -1.099, 1.392] world_goal_yaw_deg=38.19
16:34:50.694[inf][navigation/replanning_a_star] Cancelling goal.  arrived=False but_will_try_again=True
16:34:50.694[inf][navigation/replanning_a_star] changed state  state=idle
16:34:50.694[inf][navigation/replanning_a_star] Found safe goal.  x=0.23 y=0.32
16:34:50.694[inf][navigation/replanning_a_star] Local planner loop exited due to stop event.
16:34:50.699[inf][navigation/replanning_a_star] Found path 1.1x robot width.
16:34:50.702[inf][navigation/replanning_a_star] changed state  state=initial_rotation
16:34:51.054[inf][os/ar/navigation/navigate.py] XR navigation goal published  odom_goal=[0.147, 0.527, 0.03] odom_goal_yaw_deg=-180 world_goal=[0.22, -1.1, 1.316] world_goal_yaw_deg=-2.4
16:34:51.054[inf][navigation/replanning_a_star] Got new goal  goal=PoseStamped(pos=[0.147, 0.527, 0.030], euler=[90.0, -0.0, 98.6])
16:34:51.054[inf][navigation/replanning_a_star] Cancelling goal.  arrived=False but_will_try_again=True
16:34:51.055[inf][navigation/replanning_a_star] changed state  state=idle
16:34:51.055[inf][navigation/replanning_a_star] Found safe goal.  x=0.13 y=0.53
16:34:51.056[inf][navigation/replanning_a_star] Local planner loop exited due to stop event.
16:34:51.060[inf][navigation/replanning_a_star] Found path 1.1x robot width.
16:34:51.064[inf][navigation/replanning_a_star] changed state  state=initial_rotation
16:34:51.988[inf][navigation/replanning_a_star] changed state  state=path_following
16:34:53.323[inf][navigation/replanning_a_star] Reached goal position, starting final rotation
16:34:53.324[inf][navigation/replanning_a_star] changed state  state=final_rotation
16:34:53.324[inf][navigation/replanning_a_star] Final rotation complete, goal reached
16:34:53.324[inf][navigation/replanning_a_star] changed state  state=arrived
16:34:53.428[inf][navigation/replanning_a_star] changed state  state=idle
16:34:53.429[inf][navigation/replanning_a_star] Arrived at goal.
16:34:53.429[inf][navigation/replanning_a_star] Cancelling goal.  arrived=True but_will_try_again=False
16:34:53.430[inf][os/ar/navigation/navigate.py] XR navigation goal reached
16:34:54.008[inf][navigation/replanning_a_star] Got new goal  goal=PoseStamped(pos=[0.569, 0.179, 0.024], euler=[90.0, 0.0, -142.2])
16:34:54.008[inf][os/ar/navigation/navigate.py] XR navigation goal published  odom_goal=[0.569, 0.179, 0.024] odom_goal_yaw_deg=-180 world_goal=[-0.202, -1.106, 1.664] world_goal_yaw_deg=116.8
16:34:54.009[inf][navigation/replanning_a_star] Cancelling goal.  arrived=False but_will_try_again=True
16:34:54.009[inf][os/ar/navigation/navigate.py] XR navigation goal published  odom_goal=[0.351, 0.443, 0.021] odom_goal_yaw_deg=-0 world_goal=[0.098, -1.109, 1.5] world_goal_yaw_deg=-115.7
16:34:54.009[inf][navigation/replanning_a_star] Found safe goal.  x=0.53 y=0.17
16:34:54.012[inf][navigation/replanning_a_star] Found path 1.1x robot width.
16:34:54.015[inf][navigation/replanning_a_star] Got new goal  goal=PoseStamped(pos=[0.351, 0.443, 0.021], euler=[90.0, 0.0, -14.8])
16:34:54.015[inf][navigation/replanning_a_star] changed state  state=initial_rotation
16:34:54.015[inf][navigation/replanning_a_star] Cancelling goal.  arrived=False but_will_try_again=True
16:34:54.016[inf][navigation/replanning_a_star] changed state  state=idle
16:34:54.016[inf][navigation/replanning_a_star] Found safe goal.  x=0.33 y=0.43
16:34:54.016[inf][navigation/replanning_a_star] Local planner loop exited due to stop event.
16:34:54.019[inf][navigation/replanning_a_star] Found path 1.1x robot width.
16:34:54.020[inf][navigation/replanning_a_star] changed state  state=initial_rotation
16:34:56.181[inf][navigation/replanning_a_star] changed state  state=path_following
16:34:56.700[inf][navigation/replanning_a_star] Reached goal position, starting final rotation
16:34:56.701[inf][navigation/replanning_a_star] changed state  state=final_rotation
16:34:56.907[inf][navigation/replanning_a_star] Final rotation complete, goal reached
16:34:56.908[inf][navigation/replanning_a_star] changed state  state=arrived
16:34:57.012[inf][navigation/replanning_a_star] changed state  state=idle
16:34:57.013[inf][navigation/replanning_a_star] Arrived at goal.
16:34:57.013[inf][navigation/replanning_a_star] Cancelling goal.  arrived=True but_will_try_again=False
16:34:57.053[inf][os/ar/navigation/navigate.py] XR navigation goal reached
16:34:59.058[inf][os/ar/navigation/navigate.py] XR navigation goal published  odom_goal=[0.466, 0.104, 0.025] odom_goal_yaw_deg=180 world_goal=[-0.256, -1.105, 1.548] world_goal_yaw_deg=129.7
16:34:59.059[inf][navigation/replanning_a_star] Got new goal  goal=PoseStamped(pos=[0.466, 0.104, 0.025], euler=[90.0, 0.0, -129.4])
16:34:59.060[inf][navigation/replanning_a_star] Cancelling goal.  arrived=False but_will_try_again=True
16:34:59.061[inf][navigation/replanning_a_star] Found safe goal.  x=0.43 y=0.07
16:34:59.067[inf][navigation/replanning_a_star] Found path 1.1x robot width.
16:34:59.076[inf][navigation/replanning_a_star] changed state  state=initial_rotation
16:34:59.384[inf][os/ar/navigation/navigate.py] XR navigation goal published  odom_goal=[0.276, 0.023, 0.025] odom_goal_yaw_deg=-180 world_goal=[-0.299, -1.105, 1.346] world_goal_yaw_deg=109
16:34:59.385[inf][navigation/replanning_a_star] Got new goal  goal=PoseStamped(pos=[0.276, 0.023, 0.025], euler=[90.0, 0.0, -150.1])
16:34:59.385[inf][navigation/replanning_a_star] Cancelling goal.  arrived=False but_will_try_again=True
16:35:25.245[err][navigation/replanning_a_star] Error in local planning  exception=Traceback (most recent call last):
  File "/Users/johannestscharn/repositories/dimos/.venv/lib/python3.12/site-packages/dimos/navigation/replanning_a_star/local_planner.py", line 149, in _thread_entrypoint
    self._loop()
  File "/Users/johannestscharn/repositories/dimos/.venv/lib/python3.12/site-packages/dimos/navigation/replanning_a_star/local_planner.py", line 174, in _loop
    raise RuntimeError("No path set for local planner.")
RuntimeError: No path set for local planner.
16:35:25.247[inf][navigation/replanning_a_star] Failure in navigation.
16:36:49.995[inf][os/ar/network/websocket_serv] XR inbound text message  type=emergency_stop
16:36:49.996[inf][os/ar/bridge/safety.py      ] XR emergency_stop received
16:36:49.997[inf][os/ar/navigation/navigate.py] XR emergency_stop handled nav_reset=true
16:36:50.003[inf][os/ar/bridge/motion_router.p] motion router direct publish  method=emergency_stop publish_mono=2.325e+04
16:36:50.004[inf][os/ar/registration/baseline.] BaselineCollector failed  reason=Emergency stop received
16:36:57.903[inf][os/ar/network/websocket_serv] XR inbound text message  type=emergency_stop
16:36:57.904[inf][os/ar/bridge/safety.py      ] XR emergency_stop received
16:36:57.904[inf][os/ar/navigation/navigate.py] XR emergency_stop handled nav_reset=true
16:36:57.905[inf][os/ar/bridge/motion_router.p] motion router direct publish  method=emergency_stop publish_mono=2.326e+04
16:36:57.905[inf][os/ar/registration/baseline.] BaselineCollector failed  reason=Emergency stop received
16:40:53.250[err][navigation/replanning_a_star] Error in local planning  exception=Traceback (most recent call last):
  File "/Users/johannestscharn/repositories/dimos/.venv/lib/python3.12/site-packages/dimos/navigation/replanning_a_star/local_planner.py", line 149, in _thread_entrypoint
    self._loop()
  File "/Users/johannestscharn/repositories/dimos/.venv/lib/python3.12/site-packages/dimos/navigation/replanning_a_star/local_planner.py", line 174, in _loop
    raise RuntimeError("No path set for local planner.")
RuntimeError: No path set for local planner.
16:40:53.256[inf][navigation/replanning_a_star] Failure in navigation.
16:41:46.538[wrn][os/ar/network/websocket_serv] Invalid inbound WebSocket message  error=math domain error
16:42:23.162[wrn][os/ar/network/websocket_serv] Invalid inbound WebSocket message  error=math domain error  [repeats until disconnect]
16:42:52.685[inf][os/ar/network/websocket_serv] XR inbound text message  type=registration_command
16:42:52.689[deb][os/ar/registration/session/c] tag tracker active updated  active=False reason=session_stop
16:42:52.689[inf][os/ar/network/websocket_serv] XR inbound text message  type=registration_command  [×N more same burst]
16:42:52.691[deb][os/ar/registration/session/c] tag tracker active updated  active=False reason=session_stop
16:42:52.692[deb][os/ar/registration/session/c] tag tracker active updated  active=False reason=session_stop
16:43:05.211[inf][os/ar/network/websocket_serv] XR inbound text message  type=registration_command
16:43:05.211[inf][os/ar/network/websocket_serv] XR inbound text message  type=registration_command  [×N more same burst]
16:43:05.212[deb][os/ar/registration/session/c] tag tracker active updated  active=False reason=session_stop
16:43:05.215[deb][os/ar/registration/session/c] tag tracker active updated  active=False reason=session_stop
16:43:05.216[deb][os/ar/registration/session/c] tag tracker active updated  active=False reason=session_stop
16:43:52.840[deb][os/ar/registration/session/c] tag tracker active updated  active=False reason=session_stop
16:43:52.840[deb][os/ar/registration/session/c] tag tracker active updated  active=False reason=session_stop
16:43:52.841[deb][os/ar/registration/session/c] tag tracker active updated  active=False reason=session_stop
16:44:35.529[inf][os/ar/network/websocket_serv] XR inbound text message  type=registration_command
16:44:35.530[inf][os/ar/network/websocket_serv] XR inbound text message  type=registration_command  [×N more same burst]
16:44:35.530[deb][os/ar/registration/session/c] tag tracker active updated  active=False reason=session_stop
16:44:35.531[deb][os/ar/registration/session/c] tag tracker active updated  active=False reason=session_stop
16:44:35.531[deb][os/ar/registration/session/c] tag tracker active updated  active=False reason=session_stop
16:46:35.625[wrn][os/ar/navigation/navigate.py] XR navigation goal stalled  stall_reason=no_path
16:47:10.235[wrn][os/ar/world_frame/transforms] gravity_level_transform diagnostic: translation=[ 0.107 -0.795  1.168] up_world=[ 0.285  0.958 -0.044] input_rotation=[[-0.21   0.935  0.285]
 [ 0.107 -0.267  0.958]
 [ 0.972  0.231 -0.044]]
16:47:10.236[wrn][os/ar/world_frame/transforms] gravity_level_transform: input up-axis far from world-up (angle=16.7 deg) — registration input likely malformed; this warning is rate-limited to once per 30 s
16:47:40.367[wrn][os/ar/world_frame/transforms] gravity_level_transform: input up-axis far from world-up (angle=19.0 deg) — registration input likely malformed; this warning is rate-limited to once per 30 s
16:48:13.247[wrn][os/ar/world_frame/transforms] gravity_level_transform: input up-axis far from world-up (angle=19.0 deg) — registration input likely malformed; this warning is rate-limited to once per 30 s  [repeats until disconnect]
16:48:33.430[wrn][navigation/replanning_a_star] Travelling to goal 0.2701263675493505m away from requested goal.
16:51:28.040[inf][os/ar/bridge/safety.py      ] XR client disconnect handled nav_reset=true registration_cleared=true
16:51:28.043[inf][os/ar/bridge/motion_router.p] motion router direct publish  method=emergency_stop publish_mono=2.413e+04
16:51:28.045[inf][os/ar/bridge/module.py      ] XR bridge last client disconnected lidar_mode_reset=true
16:53:49.731[inf][os/ar/network/websocket_serv] XR inbound text message  type=registration_command
16:53:49.731[inf][os/ar/network/websocket_serv] XR inbound text message  type=registration_command  [×N more same burst]
16:53:49.737[deb][os/ar/registration/session/c] tag tracker active updated  active=False reason=session_stop
16:53:49.739[deb][os/ar/registration/session/c] tag tracker active updated  active=True reason=baseline_start
16:53:49.740[inf][os/ar/registration/session/f] XR registration started  mode=april_odom_baseline
16:54:04.701[inf][os/ar/network/websocket_serv] XR inbound text message  type=registration_command
16:54:04.702[inf][os/ar/network/websocket_serv] XR inbound text message  type=registration_command  [×N more same burst]
16:54:04.702[inf][os/ar/network/websocket_serv] XR inbound text message  type=registration_pose
16:54:04.704[deb][os/ar/registration/session/c] tag tracker active updated  active=False reason=session_stop
16:54:04.712[inf][os/ar/registration/session/c] XR registration stopped
16:54:04.728[deb][os/ar/registration/session/c] tag tracker active updated  active=False reason=manual_mode
16:54:04.730[inf][os/ar/registration/session/f] XR registration started  mode=manual_pose
16:54:04.733[inf][os/ar/registration/session/f] Manual registration pose received  position=[-0.759, -0.903, -0.885]
16:54:04.734[inf][os/ar/registration/session/f] Manual registration candidate confirmed  position=[-0.759, -0.903, -0.885] quality=0.35
16:54:06.437[inf][os/ar/network/websocket_serv] XR inbound text message  type=registration_pose  [×N more same burst]
16:54:09.846[inf][os/ar/registration/session/f] Manual registration candidate confirmed  position=[-0.34, -0.741, -0.845] quality=0.35
16:54:15.389[inf][os/ar/registration/session/f] Manual registration candidate confirmed  position=[-0.289, -0.865, -0.693] quality=0.35
16:54:15.391[deb][os/ar/registration/session/c] tag tracker active updated  active=False reason=registration_finish
16:54:15.392[inf][os/ar/registration/session/f] Registration succeeded  approximate=True mode=manual_pose quality=0.35
16:54:22.749[deb][os/ar/registration/session/c] tag tracker active updated  active=False reason=session_stop
16:54:22.774[deb][os/ar/registration/session/c] tag tracker active updated  active=False reason=session_stop
16:54:22.775[deb][os/ar/registration/session/c] tag tracker active updated  active=False reason=session_stop
16:54:22.776[deb][os/ar/registration/session/c] tag tracker active updated  active=False reason=session_stop
16:54:22.777[deb][os/ar/registration/session/c] tag tracker active updated  active=False reason=session_stop
16:54:22.777[deb][os/ar/registration/session/c] tag tracker active updated  active=False reason=session_stop
16:56:37.271[inf][os/ar/network/websocket_serv] XR inbound text message  type=registration_command
16:56:37.274[inf][os/ar/network/websocket_serv] XR inbound text message  type=registration_command  [×N more same burst]
16:56:37.294[deb][os/ar/registration/session/c] tag tracker active updated  active=False reason=session_stop
16:56:37.299[deb][os/ar/registration/session/c] tag tracker active updated  active=False reason=session_stop
16:56:37.301[deb][os/ar/registration/session/c] tag tracker active updated  active=False reason=session_stop
16:57:00.858[inf][os/ar/bridge/safety.py      ] XR client disconnect handled nav_reset=true registration_cleared=true
16:57:00.861[inf][os/ar/bridge/motion_router.p] motion router direct publish  method=emergency_stop publish_mono=2.447e+04
16:57:00.862[inf][os/ar/bridge/module.py      ] XR bridge last client disconnected lidar_mode_reset=true
16:57:16.036[inf][os/ar/bridge/status_service.] bridge connectivity updated  reconnecting=True robot_connected=False streams_active=False
16:57:16.540[inf][os/ar/bridge/status_service.] bridge connectivity updated  reconnecting=False robot_connected=False streams_active=False
