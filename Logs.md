ConfigurationValidator.ts:16] SIK Version : 0.17.2
I 21:53:30 The sent Lens has successfully started on Spectacles
I 21:53:30 [Assets/Scripts/App/ARBridgeCoordinator.ts:345] ARBridgeCoordinator: enterRegistration
I 21:53:30 [Assets/Scripts/ARBridge/Registration/RegistrationClient.ts:127] RegistrationClient: stop (manual_pose)
I 21:53:30 [Packages/SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton.ts:83] WARNING: ImageButton is being automatically converted to a toggle.
I 21:53:30 [Assets/Scripts/App/Registration/RegistrationWizard.ts:626] RegistrationWizard: start
I 21:53:30 [Assets/Scripts/ARBridge/Registration/RegistrationClient.ts:127] RegistrationClient: stop (manual_pose)
I 21:53:30 [Assets/Scripts/App/ARBridgeCoordinator.ts:345] ARBridgeCoordinator: enterRegistration
I 21:53:30 [Assets/Scripts/ARBridge/Registration/RegistrationClient.ts:127] RegistrationClient: stop (manual_pose)
I 21:53:30 [Assets/Scripts/ARBridge/Registration/RegistrationClient.ts:127] RegistrationClient: stop (manual_pose)
I 21:53:30 [Assets/Scripts/ARBridge/Registration/RegistrationClient.ts:127] RegistrationClient: stop (manual_pose)
I 21:53:31 [Assets/Scripts/App/Navigation/NavigationController.ts:965] NavigationController: requestEmergencyStop
I 21:53:31 [Assets/Scripts/ARBridge/Network/WebSocketTransport.ts:573] WebSocketTransport: cannot send emergency_stop before hello negotiates robot_id
I 21:53:33 [Assets/Scripts/App/Registration/RegistrationWizard.ts:626] RegistrationWizard: startup step completed
I 21:53:33 [Assets/Scripts/App/Registration/RegistrationWizard.ts:626] RegistrationWizard: step start -> connect
I 21:53:33 [Assets/Scripts/ARBridge/Registration/RegistrationClient.ts:127] RegistrationClient: stop (manual_pose)
I 21:53:33 [Assets/Scripts/ARBridge/Registration/RegistrationClient.ts:127] RegistrationClient: stop (manual_pose)
I 21:53:33 [Assets/Scripts/App/Registration/RegistrationWizard.ts:626] RegistrationWizard: connect attempt 192.168.1.166
I 21:53:33 [Assets/Scripts/ARBridge/Network/WebSocketTransport.ts:221] ARBridgeSession: connecting to ws://192.168.1.166:8787
I 21:53:35 [Assets/Scripts/ARBridge/Network/ARBridgeSession.ts:264] ARBridgeSession: tryConnect failed — Error: WebSocket connection error
I 21:53:37 [Assets/Scripts/ARBridge/Network/ARBridgeSession.ts:264] ARBridgeSession: tryConnect failed — Error: WebSocket connection error
I 21:53:40 [Assets/Scripts/ARBridge/Network/ARBridgeSession.ts:264] ARBridgeSession: tryConnect failed — Error: WebSocket connection error
I 21:53:41 [Assets/Scripts/ARBridge/Network/WebSocketTransport.ts:509] ARBridgeSession: connected
I 21:53:41 [Assets/Scripts/ARBridge/Session/InboundRouter.ts:208] InboundRouter: bridge connection: connected
I 21:53:41 [Assets/Scripts/ARBridge/Telemetry/TelemetryClient.ts:86] TelemetryClient: lidarMode bridge sync mode=off
I 21:53:41 [Assets/Scripts/ARBridge/Telemetry/TelemetryClient.ts:86] TelemetryClient: lidarMode bridge sync mode=off
I 21:53:41 [Assets/Scripts/App/Registration/RegistrationWizard.ts:626] RegistrationWizard: connect succeeded
I 21:53:41 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:382] InboundProcessor: RX bridge_status world_frame_committed=false robot_connected=true
I 21:53:41 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:53:41 [Assets/Scripts/ARBridge/Network/WebSocketTransport.ts:444] BridgeClockSync: ready offset=1783626808.7442s rtt=0.1002s samples=4
I 21:53:46 [Assets/Scripts/App/Registration/RegistrationWizard.ts:626] RegistrationWizard: connect step completed
I 21:53:46 [Assets/Scripts/App/Registration/RegistrationWizard.ts:626] RegistrationWizard: step connect -> register
I 21:53:46 [Assets/Scripts/ARBridge/Registration/RegistrationClient.ts:175] RegistrationClient: registration_command:stop sent
I 21:53:46 [Assets/Scripts/ARBridge/Registration/RegistrationClient.ts:127] RegistrationClient: stop (manual_pose)
I 21:53:46 [Assets/Scripts/ARBridge/Registration/RegistrationClient.ts:175] RegistrationClient: registration_command:start:april_tag sent
I 21:53:46 [Assets/Scripts/ARBridge/Registration/RegistrationClient.ts:331] RegistrationClient: registration_command start mode=april_tag sent
I 21:53:46 [Assets/Scripts/ARBridge/Registration/RegistrationClient.ts:113] RegistrationClient: start mode=april_tag
I 21:53:46 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:70] DeviceCameraStream: started (imageSmallerDimension=756)
I 21:53:46 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:170] FrameCaptureController: camera stream ON
I 21:53:47 [Assets/Scripts/App/Registration/RegistrationWizard.ts:626] RegistrationWizard: registration_status phase=scanning mode=april_tag "Look at the AprilTag on your robot"
I 21:53:47 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:200] DeviceCameraStream: first frame texture=1008x756
I 21:53:47 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:363] CameraClient: camera_info sent 1008x756 scale=1.000x1.000
I 21:53:47 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=1 capture_ts_robot=1783626827.0084 lens_ts=18.2642 offset=1783626808.7442
I 21:53:47 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=1 pipeline=159ms jpeg=145025B
I 21:53:47 [Assets/Scripts/App/Registration/RegistrationWizard.ts:626] RegistrationWizard: registration_status phase=scanning mode=april_tag ""
I 21:53:47 [Assets/Scripts/App/Robot/RobotMarker.ts:268] [RuntimePoseAnimator] pose_age raw=1783626808.786s clamped=0.550s clamp_hit_fraction=1.00
I 21:53:47 [Assets/Scripts/App/Registration/RegistrationWizard.ts:626] RegistrationWizard: registration_status phase=scanning mode=april_tag "Look at the AprilTag on your robot"
I 21:53:48 [Assets/Scripts/App/Registration/RegistrationWizard.ts:626] RegistrationWizard: registration_status phase=scanning mode=april_tag ""
I 21:53:48 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:382] InboundProcessor: RX bridge_status world_frame_committed=true robot_connected=true
I 21:53:48 [Assets/Scripts/App/Registration/RegistrationWizard.ts:626] RegistrationWizard: registration_status phase=succeeded mode=april_tag "Registration successful"
I 21:53:48 [Assets/Scripts/App/Registration/RegistrationWizard.ts:626] RegistrationWizard: registration succeeded
I 21:53:48 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:92] DeviceCameraStream: stopped
I 21:53:48 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:175] FrameCaptureController: camera stream OFF
I 21:53:48 [Assets/Scripts/App/Registration/RegistrationWizard.ts:626] RegistrationWizard: auto registration: camera capture error
I 21:53:48 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:210] CameraClient: capture failed: Error: DeviceCameraStream stopped
I 21:53:48 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:363] InboundProcessor: RX pose #1 pos=(0.44,-0.89,-0.86)
I 21:53:50 [Assets/Scripts/App/Registration/RegistrationWizard.ts:626] RegistrationWizard: finish connect=done registration=done
I 21:53:50 [Assets/Scripts/ARBridge/Registration/RegistrationClient.ts:127] RegistrationClient: stop (manual_pose)
I 21:53:50 [Assets/Scripts/App/ARBridgeCoordinator.ts:345] ARBridgeCoordinator: enterRuntime
I 21:53:50 [Assets/Scripts/ARBridge/Registration/RegistrationClient.ts:127] RegistrationClient: stop (manual_pose)
I 21:53:50 [Assets/Scripts/App/ARBridgeCoordinator.ts:345] ARBridgeCoordinator: robotInteractionMode: runtimeRobot
I 21:53:50 [Assets/Scripts/App/Navigation/NavigationController.ts:965] NavigationController: nav arm
I 21:53:53 [Assets/Scripts/App/Navigation/NavigationController.ts:965] NavigationController: nav goal commit sent=true
I 21:53:54 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:53:54 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:70] DeviceCameraStream: started (imageSmallerDimension=756)
I 21:53:54 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:170] FrameCaptureController: camera stream ON
I 21:53:54 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:200] DeviceCameraStream: first frame texture=1008x756
I 21:53:54 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:363] CameraClient: camera_info sent 1008x756 scale=1.000x1.000
I 21:53:54 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=2 capture_ts_robot=1783626834.7779 lens_ts=26.0337 offset=1783626808.7442
I 21:53:54 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=2 pipeline=175ms jpeg=171607B
I 21:53:56 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:92] DeviceCameraStream: stopped
I 21:53:56 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:175] FrameCaptureController: camera stream OFF
I 21:53:56 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:70] DeviceCameraStream: started (imageSmallerDimension=756)
I 21:53:56 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:170] FrameCaptureController: camera stream ON
I 21:53:56 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:200] DeviceCameraStream: first frame texture=1008x756
I 21:53:56 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:363] CameraClient: camera_info sent 1008x756 scale=1.000x1.000
I 21:53:57 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=3 capture_ts_robot=1783626836.9772 lens_ts=28.2330 offset=1783626808.7442
I 21:53:57 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=3 pipeline=50ms jpeg=136867B
I 21:53:58 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:53:59 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=9 capture_ts_robot=1783626839.3427 lens_ts=30.5985 offset=1783626808.7442
I 21:53:59 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=9 pipeline=50ms jpeg=137991B
I 21:54:00 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:92] DeviceCameraStream: stopped
I 21:54:00 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:175] FrameCaptureController: camera stream OFF
I 21:54:03 [Assets/Scripts/App/Navigation/NavigationController.ts:965] NavigationController: nav goal commit sent=true
I 21:54:03 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:54:03 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:54:03 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:54:03 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:54:03 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:54:04 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:70] DeviceCameraStream: started (imageSmallerDimension=756)
I 21:54:04 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:170] FrameCaptureController: camera stream ON
I 21:54:04 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:200] DeviceCameraStream: first frame texture=1008x756
I 21:54:05 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:363] CameraClient: camera_info sent 1008x756 scale=1.000x1.000
I 21:54:05 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=2 capture_ts_robot=1783626845.0111 lens_ts=36.2669 offset=1783626808.7442
I 21:54:05 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=2 pipeline=117ms jpeg=133879B
I 21:54:05 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:92] DeviceCameraStream: stopped
I 21:54:05 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:175] FrameCaptureController: camera stream OFF
I 21:54:05 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:70] DeviceCameraStream: started (imageSmallerDimension=756)
I 21:54:05 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:170] FrameCaptureController: camera stream ON
I 21:54:05 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:200] DeviceCameraStream: first frame texture=1008x756
I 21:54:06 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:363] CameraClient: camera_info sent 1008x756 scale=1.000x1.000
I 21:54:07 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=5 capture_ts_robot=1783626847.2412 lens_ts=38.4970 offset=1783626808.7442
I 21:54:07 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=5 pipeline=33ms jpeg=154776B
I 21:54:07 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:54:09 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:92] DeviceCameraStream: stopped
I 21:54:09 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:175] FrameCaptureController: camera stream OFF
I 21:54:09 [Assets/Scripts/App/Navigation/NavigationController.ts:965] NavigationController: nav goal commit sent=true
I 21:54:10 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:54:10 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:54:12 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:70] DeviceCameraStream: started (imageSmallerDimension=756)
I 21:54:12 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:170] FrameCaptureController: camera stream ON
I 21:54:12 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:200] DeviceCameraStream: first frame texture=1008x756
I 21:54:12 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:363] CameraClient: camera_info sent 1008x756 scale=1.000x1.000
I 21:54:12 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=2 capture_ts_robot=1783626852.6454 lens_ts=43.9012 offset=1783626808.7442
I 21:54:12 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=2 pipeline=117ms jpeg=135604B
I 21:54:13 [Assets/Scripts/ARBridge/Telemetry/TelemetryClient.ts:143] TelemetryClient: world_frame_correction transDeltaM=0.134 yawDeltaDeg=1.45 yawCorrected=true solveQuality=0.947 solveMethod=similarity confidence=0.00 yawObservable=true scaleObservable=false
I 21:54:14 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=8 capture_ts_robot=1783626854.6419 lens_ts=45.8977 offset=1783626808.7442
I 21:54:14 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=8 pipeline=67ms jpeg=147373B
I 21:54:15 [Assets/Scripts/ARBridge/Telemetry/TelemetryClient.ts:143] TelemetryClient: world_frame_correction transDeltaM=0.068 yawDeltaDeg=1.97 yawCorrected=true solveQuality=0.932 solveMethod=similarity confidence=0.40 yawObservable=true scaleObservable=true
I 21:54:15 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:54:16 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:92] DeviceCameraStream: stopped
I 21:54:16 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:175] FrameCaptureController: camera stream OFF
I 21:54:17 [Assets/Scripts/App/Navigation/NavigationController.ts:965] NavigationController: nav goal commit sent=true
I 21:54:17 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:54:17 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:54:17 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:54:18 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:54:18 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:54:18 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:70] DeviceCameraStream: started (imageSmallerDimension=756)
I 21:54:18 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:170] FrameCaptureController: camera stream ON
I 21:54:18 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:200] DeviceCameraStream: first frame texture=1008x756
I 21:54:18 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:363] CameraClient: camera_info sent 1008x756 scale=1.000x1.000
I 21:54:18 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=2 capture_ts_robot=1783626858.4454 lens_ts=49.7012 offset=1783626808.7442
I 21:54:18 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=2 pipeline=134ms jpeg=189039B
I 21:54:18 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:363] InboundProcessor: RX pose #304 pos=(1.28,-0.90,-1.11)
I 21:54:19 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:92] DeviceCameraStream: stopped
I 21:54:19 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:175] FrameCaptureController: camera stream OFF
I 21:54:19 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:70] DeviceCameraStream: started (imageSmallerDimension=756)
I 21:54:19 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:170] FrameCaptureController: camera stream ON
I 21:54:19 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:200] DeviceCameraStream: first frame texture=1008x756
I 21:54:19 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:363] CameraClient: camera_info sent 1008x756 scale=1.000x1.000
I 21:54:19 [Assets/Scripts/ARBridge/Telemetry/TelemetryClient.ts:143] TelemetryClient: world_frame_correction transDeltaM=0.036 yawDeltaDeg=1.98 yawCorrected=true solveQuality=0.934 solveMethod=similarity confidence=0.65 yawObservable=true scaleObservable=true
I 21:54:20 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:92] DeviceCameraStream: stopped
I 21:54:20 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:175] FrameCaptureController: camera stream OFF
I 21:54:20 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:70] DeviceCameraStream: started (imageSmallerDimension=756)
I 21:54:20 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:170] FrameCaptureController: camera stream ON
I 21:54:20 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:200] DeviceCameraStream: first frame texture=1008x756
I 21:54:20 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:363] CameraClient: camera_info sent 1008x756 scale=1.000x1.000
I 21:54:20 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=3 capture_ts_robot=1783626860.6742 lens_ts=51.9300 offset=1783626808.7442
I 21:54:20 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=3 pipeline=58ms jpeg=172478B
I 21:54:21 [Assets/Scripts/ARBridge/Telemetry/TelemetryClient.ts:143] TelemetryClient: world_frame_correction transDeltaM=0.022 yawDeltaDeg=1.45 yawCorrected=true solveQuality=0.934 solveMethod=similarity confidence=0.76 yawObservable=true scaleObservable=true
I 21:54:22 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:54:22 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=8 capture_ts_robot=1783626862.8742 lens_ts=54.1300 offset=1783626808.7442
I 21:54:22 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=8 pipeline=67ms jpeg=136479B
I 21:54:23 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:92] DeviceCameraStream: stopped
I 21:54:23 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:175] FrameCaptureController: camera stream OFF
I 21:54:24 [Assets/Scripts/App/Navigation/NavigationController.ts:965] NavigationController: nav goal commit sent=true
I 21:54:24 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:54:24 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:54:24 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:54:25 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:54:25 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:54:26 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:70] DeviceCameraStream: started (imageSmallerDimension=756)
I 21:54:26 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:170] FrameCaptureController: camera stream ON
I 21:54:26 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:200] DeviceCameraStream: first frame texture=1008x756
I 21:54:26 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:363] CameraClient: camera_info sent 1008x756 scale=1.000x1.000
I 21:54:26 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=2 capture_ts_robot=1783626866.5074 lens_ts=57.7632 offset=1783626808.7442
I 21:54:26 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=2 pipeline=134ms jpeg=136567B
I 21:54:27 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:54:28 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:92] DeviceCameraStream: stopped
I 21:54:28 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:175] FrameCaptureController: camera stream OFF
I 21:54:29 [Assets/Scripts/App/Navigation/NavigationController.ts:965] NavigationController: nav goal commit sent=true
I 21:54:29 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:54:29 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:54:29 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:54:29 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:54:29 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:54:30 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:70] DeviceCameraStream: started (imageSmallerDimension=756)
I 21:54:30 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:170] FrameCaptureController: camera stream ON
I 21:54:30 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:200] DeviceCameraStream: first frame texture=1008x756
I 21:54:30 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:363] CameraClient: camera_info sent 1008x756 scale=1.000x1.000
I 21:54:30 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=2 capture_ts_robot=1783626870.2423 lens_ts=61.4981 offset=1783626808.7442
I 21:54:30 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=2 pipeline=125ms jpeg=142340B
I 21:54:32 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=8 capture_ts_robot=1783626872.3085 lens_ts=63.5643 offset=1783626808.7442
I 21:54:32 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=8 pipeline=50ms jpeg=130219B
I 21:54:34 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=15 capture_ts_robot=1783626874.3428 lens_ts=65.5986 offset=1783626808.7442
I 21:54:34 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=15 pipeline=33ms jpeg=130620B
I 21:54:35 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:92] DeviceCameraStream: stopped
I 21:54:35 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:175] FrameCaptureController: camera stream OFF
I 21:54:35 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:124] CameraClient: ack seq=17 expected=-1 (mismatch)
I 21:54:36 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:54:39 [Assets/Scripts/App/Navigation/NavigationController.ts:965] NavigationController: nav goal commit sent=true
I 21:54:39 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:54:39 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:54:39 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:54:39 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:54:39 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:54:43 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:70] DeviceCameraStream: started (imageSmallerDimension=756)
I 21:54:43 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:170] FrameCaptureController: camera stream ON
I 21:54:43 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:200] DeviceCameraStream: first frame texture=1008x756
I 21:54:43 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:363] CameraClient: camera_info sent 1008x756 scale=1.000x1.000
I 21:54:43 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=2 capture_ts_robot=1783626883.2085 lens_ts=74.4643 offset=1783626808.7442
I 21:54:43 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=2 pipeline=125ms jpeg=122145B
I 21:54:45 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=8 capture_ts_robot=1783626885.2781 lens_ts=76.5339 offset=1783626808.7442
I 21:54:45 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=8 pipeline=33ms jpeg=191078B
I 21:54:47 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=15 capture_ts_robot=1783626887.7406 lens_ts=78.9964 offset=1783626808.7442
I 21:54:47 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=15 pipeline=50ms jpeg=134711B
I 21:54:48 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:54:48 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:363] InboundProcessor: RX pose #609 pos=(1.05,-0.88,-3.17)
I 21:54:49 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:92] DeviceCameraStream: stopped
I 21:54:49 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:175] FrameCaptureController: camera stream OFF
I 21:54:53 [Assets/Scripts/App/Navigation/NavigationController.ts:965] NavigationController: nav goal commit sent=true
I 21:54:53 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:54:53 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:54:53 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:54:54 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:54:54 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:54:55 [Assets/Scripts/App/Navigation/NavigationController.ts:965] NavigationController: nav goal commit sent=true
I 21:54:58 [Assets/Scripts/App/Navigation/NavigationController.ts:965] NavigationController: nav goal commit sent=true
I 21:55:00 [Assets/Scripts/App/Navigation/NavigationController.ts:965] NavigationController: nav goal commit sent=true
I 21:55:03 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:70] DeviceCameraStream: started (imageSmallerDimension=756)
I 21:55:03 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:170] FrameCaptureController: camera stream ON
I 21:55:03 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:200] DeviceCameraStream: first frame texture=1008x756
I 21:55:03 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:363] CameraClient: camera_info sent 1008x756 scale=1.000x1.000
I 21:55:03 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=2 capture_ts_robot=1783626903.1398 lens_ts=94.3956 offset=1783626808.7442
I 21:55:03 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=2 pipeline=109ms jpeg=177560B
I 21:55:05 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=7 capture_ts_robot=1783626905.1398 lens_ts=96.3956 offset=1783626808.7442
I 21:55:05 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=7 pipeline=75ms jpeg=161852B
I 21:55:07 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=13 capture_ts_robot=1783626907.8064 lens_ts=99.0622 offset=1783626808.7442
I 21:55:07 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=13 pipeline=50ms jpeg=163935B
I 21:55:08 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:55:08 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:92] DeviceCameraStream: stopped
I 21:55:08 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:175] FrameCaptureController: camera stream OFF
I 21:55:15 [Assets/Scripts/App/Navigation/NavigationController.ts:965] NavigationController: nav goal commit sent=true
I 21:55:15 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:55:15 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:55:15 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:55:15 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:55:15 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:55:16 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:70] DeviceCameraStream: started (imageSmallerDimension=756)
I 21:55:16 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:170] FrameCaptureController: camera stream ON
I 21:55:16 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:200] DeviceCameraStream: first frame texture=1008x756
I 21:55:16 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:363] CameraClient: camera_info sent 1008x756 scale=1.000x1.000
I 21:55:16 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=2 capture_ts_robot=1783626916.9081 lens_ts=108.1639 offset=1783626808.7442
I 21:55:17 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=2 pipeline=117ms jpeg=197467B
I 21:55:17 [Assets/Scripts/App/Navigation/NavigationController.ts:965] NavigationController: nav goal commit sent=true
I 21:55:17 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:92] DeviceCameraStream: stopped
I 21:55:17 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:175] FrameCaptureController: camera stream OFF
I 21:55:18 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=failed error_code=- retryable=- stall_reason=-
I 21:55:18 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:55:18 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:55:19 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:363] InboundProcessor: RX pose #903 pos=(-0.71,-0.88,-6.71)
I 21:55:19 [Assets/Scripts/App/Navigation/NavigationController.ts:965] NavigationController: nav goal commit sent=true
I 21:55:20 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:70] DeviceCameraStream: started (imageSmallerDimension=756)
I 21:55:20 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:170] FrameCaptureController: camera stream ON
I 21:55:20 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:200] DeviceCameraStream: first frame texture=1008x756
I 21:55:20 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:363] CameraClient: camera_info sent 1008x756 scale=1.000x1.000
I 21:55:20 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=2 capture_ts_robot=1783626920.2394 lens_ts=111.4952 offset=1783626808.7442
I 21:55:20 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=2 pipeline=117ms jpeg=159279B
I 21:55:22 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=8 capture_ts_robot=1783626922.4733 lens_ts=113.7291 offset=1783626808.7442
I 21:55:22 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=8 pipeline=17ms jpeg=176210B
I 21:55:24 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=15 capture_ts_robot=1783626924.7059 lens_ts=115.9617 offset=1783626808.7442
I 21:55:24 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=15 pipeline=50ms jpeg=126624B
I 21:55:24 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:55:25 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:92] DeviceCameraStream: stopped
I 21:55:25 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:175] FrameCaptureController: camera stream OFF
I 21:55:25 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:70] DeviceCameraStream: started (imageSmallerDimension=756)
I 21:55:25 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:170] FrameCaptureController: camera stream ON
I 21:55:25 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:200] DeviceCameraStream: first frame texture=1008x756
I 21:55:25 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:363] CameraClient: camera_info sent 1008x756 scale=1.000x1.000
I 21:55:26 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:92] DeviceCameraStream: stopped
I 21:55:26 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:175] FrameCaptureController: camera stream OFF
I 21:55:26 [Assets/Scripts/App/Navigation/NavigationController.ts:965] NavigationController: nav goal commit sent=true
I 21:55:26 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:70] DeviceCameraStream: started (imageSmallerDimension=756)
I 21:55:26 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:170] FrameCaptureController: camera stream ON
I 21:55:26 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:200] DeviceCameraStream: first frame texture=1008x756
I 21:55:26 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:55:26 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:363] CameraClient: camera_info sent 1008x756 scale=1.000x1.000
I 21:55:26 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:55:26 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=3 capture_ts_robot=1783626926.7059 lens_ts=117.9617 offset=1783626808.7442
I 21:55:26 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=3 pipeline=50ms jpeg=140681B
I 21:55:27 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:92] DeviceCameraStream: stopped
I 21:55:27 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:175] FrameCaptureController: camera stream OFF
I 21:55:27 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:70] DeviceCameraStream: started (imageSmallerDimension=756)
I 21:55:27 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:170] FrameCaptureController: camera stream ON
I 21:55:27 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:200] DeviceCameraStream: first frame texture=1008x756
I 21:55:27 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:363] CameraClient: camera_info sent 1008x756 scale=1.000x1.000
I 21:55:29 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=7 capture_ts_robot=1783626929.1725 lens_ts=120.4283 offset=1783626808.7442
I 21:55:29 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=7 pipeline=67ms jpeg=136798B
I 21:55:29 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:55:30 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:92] DeviceCameraStream: stopped
I 21:55:30 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:175] FrameCaptureController: camera stream OFF
I 21:55:35 [Assets/Scripts/App/Navigation/NavigationController.ts:965] NavigationController: nav goal commit sent=true
I 21:55:35 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:55:35 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:55:35 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:55:35 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:55:35 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:55:35 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:55:35 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:55:35 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:55:36 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:55:38 [Assets/Scripts/App/Navigation/NavigationController.ts:965] NavigationController: nav goal commit sent=true
I 21:55:38 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:55:38 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:55:39 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:55:39 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:55:39 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:55:39 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:70] DeviceCameraStream: started (imageSmallerDimension=756)
I 21:55:39 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:170] FrameCaptureController: camera stream ON
I 21:55:39 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:200] DeviceCameraStream: first frame texture=1008x756
I 21:55:39 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:363] CameraClient: camera_info sent 1008x756 scale=1.000x1.000
I 21:55:39 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=2 capture_ts_robot=1783626939.6389 lens_ts=130.8947 offset=1783626808.7442
I 21:55:39 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=2 pipeline=150ms jpeg=137530B
I 21:55:41 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:55:41 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=8 capture_ts_robot=1783626941.9068 lens_ts=133.1626 offset=1783626808.7442
I 21:55:41 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=8 pipeline=50ms jpeg=129298B
I 21:55:42 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:92] DeviceCameraStream: stopped
I 21:55:42 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:175] FrameCaptureController: camera stream OFF
I 21:55:43 [Assets/Scripts/App/Navigation/NavigationController.ts:965] NavigationController: nav goal commit sent=true
I 21:55:43 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:55:43 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:55:44 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:55:44 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:55:44 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:55:44 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:70] DeviceCameraStream: started (imageSmallerDimension=756)
I 21:55:44 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:170] FrameCaptureController: camera stream ON
I 21:55:44 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:200] DeviceCameraStream: first frame texture=1008x756
I 21:55:44 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:363] CameraClient: camera_info sent 1008x756 scale=1.000x1.000
I 21:55:44 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=2 capture_ts_robot=1783626944.8054 lens_ts=136.0612 offset=1783626808.7442
I 21:55:44 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=2 pipeline=100ms jpeg=138858B
I 21:55:47 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=9 capture_ts_robot=1783626946.9721 lens_ts=138.2279 offset=1783626808.7442
I 21:55:47 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=9 pipeline=67ms jpeg=154235B
I 21:55:47 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:55:48 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:92] DeviceCameraStream: stopped
I 21:55:48 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:175] FrameCaptureController: camera stream OFF
I 21:55:49 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:363] InboundProcessor: RX pose #1199 pos=(3.59,-0.88,-3.51)
I 21:55:52 [Assets/Scripts/App/Navigation/NavigationController.ts:965] NavigationController: nav goal commit sent=true
I 21:55:52 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:55:52 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:55:52 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:55:53 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:55:53 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:55:54 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:70] DeviceCameraStream: started (imageSmallerDimension=756)
I 21:55:54 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:170] FrameCaptureController: camera stream ON
I 21:55:54 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:200] DeviceCameraStream: first frame texture=1008x756
I 21:55:54 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:363] CameraClient: camera_info sent 1008x756 scale=1.000x1.000
I 21:55:54 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=2 capture_ts_robot=1783626954.2781 lens_ts=145.5339 offset=1783626808.7442
I 21:55:54 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=2 pipeline=142ms jpeg=201723B
I 21:55:54 Project saved /Users/johannestscharn/Repositories/spectacles-dimensional-os/lens-studio/spectacles-dimensional-os.esproj
I 21:55:56 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=9 capture_ts_robot=1783626956.6718 lens_ts=147.9276 offset=1783626808.7442
I 21:55:56 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=9 pipeline=33ms jpeg=183340B
I 21:55:57 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:55:58 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:92] DeviceCameraStream: stopped
I 21:55:58 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:175] FrameCaptureController: camera stream OFF
I 21:56:02 [Assets/Scripts/App/Navigation/NavigationController.ts:965] NavigationController: nav goal commit sent=true
I 21:56:02 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:56:02 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:56:02 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:56:03 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:56:03 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:56:03 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:70] DeviceCameraStream: started (imageSmallerDimension=756)
I 21:56:03 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:170] FrameCaptureController: camera stream ON
I 21:56:03 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:200] DeviceCameraStream: first frame texture=1008x756
I 21:56:03 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:363] CameraClient: camera_info sent 1008x756 scale=1.000x1.000
I 21:56:03 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=2 capture_ts_robot=1783626963.8050 lens_ts=155.0608 offset=1783626808.7442
I 21:56:03 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=2 pipeline=150ms jpeg=182257B
I 21:56:04 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:92] DeviceCameraStream: stopped
I 21:56:04 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:175] FrameCaptureController: camera stream OFF
I 21:56:04 [Assets/Scripts/App/Navigation/NavigationController.ts:965] NavigationController: nav goal commit sent=true
I 21:56:07 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:70] DeviceCameraStream: started (imageSmallerDimension=756)
I 21:56:07 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:170] FrameCaptureController: camera stream ON
I 21:56:07 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:200] DeviceCameraStream: first frame texture=1008x756
I 21:56:07 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:363] CameraClient: camera_info sent 1008x756 scale=1.000x1.000
I 21:56:07 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=2 capture_ts_robot=1783626967.1723 lens_ts=158.4281 offset=1783626808.7442
I 21:56:07 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=2 pipeline=117ms jpeg=204238B
I 21:56:08 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:56:09 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=8 capture_ts_robot=1783626969.2715 lens_ts=160.5273 offset=1783626808.7442
I 21:56:09 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=8 pipeline=67ms jpeg=184597B
I 21:56:10 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:92] DeviceCameraStream: stopped
I 21:56:10 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:175] FrameCaptureController: camera stream OFF
I 21:56:11 [Assets/Scripts/App/Navigation/NavigationController.ts:965] NavigationController: nav goal commit sent=true
I 21:56:11 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:56:11 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:56:11 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:56:11 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:56:11 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:56:13 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:70] DeviceCameraStream: started (imageSmallerDimension=756)
I 21:56:13 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:170] FrameCaptureController: camera stream ON
I 21:56:13 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:200] DeviceCameraStream: first frame texture=1008x756
I 21:56:13 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:363] CameraClient: camera_info sent 1008x756 scale=1.000x1.000
I 21:56:13 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=2 capture_ts_robot=1783626973.1047 lens_ts=164.3605 offset=1783626808.7442
I 21:56:13 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=2 pipeline=134ms jpeg=169296B
I 21:56:13 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:56:14 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:92] DeviceCameraStream: stopped
I 21:56:14 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:175] FrameCaptureController: camera stream OFF
I 21:56:15 [Assets/Scripts/App/ARBridgeCoordinator.ts:345] ARBridgeCoordinator: setDebugMode: true
I 21:56:19 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:363] InboundProcessor: RX pose #1483 pos=(3.79,-0.88,-3.49)
I 21:56:29 [Assets/Scripts/App/Navigation/NavigationController.ts:965] NavigationController: nav goal commit sent=true
I 21:56:29 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:56:29 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:56:29 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:56:29 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:56:29 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:56:31 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:70] DeviceCameraStream: started (imageSmallerDimension=756)
I 21:56:31 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:170] FrameCaptureController: camera stream ON
I 21:56:31 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:200] DeviceCameraStream: first frame texture=1008x756
I 21:56:31 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:363] CameraClient: camera_info sent 1008x756 scale=1.000x1.000
I 21:56:31 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=2 capture_ts_robot=1783626991.5376 lens_ts=182.7934 offset=1783626808.7442
I 21:56:31 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=2 pipeline=175ms jpeg=176352B
I 21:56:32 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:56:33 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:92] DeviceCameraStream: stopped
I 21:56:33 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:175] FrameCaptureController: camera stream OFF
I 21:56:37 [Assets/Scripts/App/Navigation/NavigationController.ts:965] NavigationController: nav goal commit sent=true
I 21:56:37 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:56:37 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:56:37 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:56:37 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:56:37 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:56:38 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:70] DeviceCameraStream: started (imageSmallerDimension=756)
I 21:56:38 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:170] FrameCaptureController: camera stream ON
I 21:56:38 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:200] DeviceCameraStream: first frame texture=1008x756
I 21:56:39 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:363] CameraClient: camera_info sent 1008x756 scale=1.000x1.000
I 21:56:39 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=2 capture_ts_robot=1783626999.0041 lens_ts=190.2599 offset=1783626808.7442
I 21:56:39 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=2 pipeline=100ms jpeg=164038B
I 21:56:41 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=8 capture_ts_robot=1783627001.0707 lens_ts=192.3265 offset=1783626808.7442
I 21:56:41 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=8 pipeline=50ms jpeg=161618B
I 21:56:43 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=15 capture_ts_robot=1783627003.2707 lens_ts=194.5265 offset=1783626808.7442
I 21:56:43 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=15 pipeline=50ms jpeg=128089B
I 21:56:44 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:92] DeviceCameraStream: stopped
I 21:56:44 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:175] FrameCaptureController: camera stream OFF
I 21:56:44 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:56:46 [Assets/Scripts/App/Navigation/NavigationController.ts:965] NavigationController: nav goal commit sent=true
I 21:56:46 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:56:46 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:56:46 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:56:46 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:56:46 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:56:46 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:70] DeviceCameraStream: started (imageSmallerDimension=756)
I 21:56:46 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:170] FrameCaptureController: camera stream ON
I 21:56:46 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:200] DeviceCameraStream: first frame texture=1008x756
I 21:56:46 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:363] CameraClient: camera_info sent 1008x756 scale=1.000x1.000
I 21:56:46 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=2 capture_ts_robot=1783627006.8752 lens_ts=198.1310 offset=1783626808.7442
I 21:56:46 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=2 pipeline=134ms jpeg=154000B
I 21:56:49 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=8 capture_ts_robot=1783627008.9727 lens_ts=200.2285 offset=1783626808.7442
I 21:56:49 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=8 pipeline=67ms jpeg=140946B
I 21:56:51 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:363] InboundProcessor: RX pose #1761 pos=(1.48,-0.89,-2.44)
I 21:56:51 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=17 capture_ts_robot=1783627011.5711 lens_ts=202.8269 offset=1783626808.7442
I 21:56:51 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=17 pipeline=67ms jpeg=122671B
I 21:56:52 [Assets/Scripts/App/Robot/RobotMarker.ts:268] [RuntimePoseAnimator] pose_age raw=0.152s clamped=0.152s clamp_hit_fraction=0.37
I 21:56:53 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=23 capture_ts_robot=1783627013.8372 lens_ts=205.0930 offset=1783626808.7442
I 21:56:53 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=23 pipeline=50ms jpeg=126803B
I 21:56:55 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:56:56 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:92] DeviceCameraStream: stopped
I 21:56:56 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:175] FrameCaptureController: camera stream OFF
I 21:56:57 [Assets/Scripts/App/Navigation/NavigationController.ts:965] NavigationController: nav goal commit sent=true
I 21:56:57 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:56:57 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:56:57 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:56:58 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:56:58 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:56:58 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:70] DeviceCameraStream: started (imageSmallerDimension=756)
I 21:56:58 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:170] FrameCaptureController: camera stream ON
I 21:56:58 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:200] DeviceCameraStream: first frame texture=1008x756
I 21:56:59 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:363] CameraClient: camera_info sent 1008x756 scale=1.000x1.000
I 21:56:59 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:314] CameraClient: seq=2 capture_ts_robot=1783627018.7369 lens_ts=209.9927 offset=1783626808.7442
I 21:56:59 [Assets/Scripts/ARBridge/Camera/CameraClient.ts:321] CameraClient: seq=2 pipeline=134ms jpeg=136425B
I 21:57:00 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=succeeded error_code=- retryable=- stall_reason=-
I 21:57:00 [Assets/Scripts/ARBridge/Camera/DeviceCameraStream.ts:92] DeviceCameraStream: stopped
I 21:57:00 [Assets/Scripts/ARBridge/Camera/FrameCaptureController.ts:175] FrameCaptureController: camera stream OFF
I 21:57:12 [Assets/Scripts/App/Robot/RobotMarker.ts:268] [RuntimePoseAnimator] pose_age raw=0.078s clamped=0.078s clamp_hit_fraction=0.13
I 21:57:13 [Assets/Scripts/App/ARBridgeCoordinator.ts:345] ARBridgeCoordinator: setLidarMode: obstacles
I 21:57:13 [Assets/Scripts/ARBridge/Telemetry/TelemetryClient.ts:86] TelemetryClient: lidarMode bridge sync mode=obstacles
I 21:57:15 [Assets/Scripts/App/ARBridgeCoordinator.ts:345] ARBridgeCoordinator: setLidarMode: full
I 21:57:15 [Assets/Scripts/ARBridge/Telemetry/TelemetryClient.ts:86] TelemetryClient: lidarMode bridge sync mode=full
I 21:57:21 [Assets/Scripts/App/Robot/RobotMarker.ts:268] [RuntimePoseAnimator] pose_age raw=1.121s clamped=0.550s clamp_hit_fraction=0.11
I 21:57:21 [Assets/Scripts/App/Navigation/NavigationController.ts:965] NavigationController: nav goal commit sent=true
I 21:57:21 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=idle error_code=- retryable=- stall_reason=-
I 21:57:21 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=navigating error_code=- retryable=- stall_reason=-
I 21:57:22 [Assets/Scripts/App/Robot/RobotMarker.ts:268] [RuntimePoseAnimator] pose_age raw=6.133s clamped=0.550s clamp_hit_fraction=1.00
I 21:57:27 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:382] InboundProcessor: RX bridge_status world_frame_committed=true robot_connected=false
I 21:57:27 [Assets/Scripts/App/Robot/RobotMarker.ts:268] [RuntimePoseAnimator] pose_age raw=11.136s clamped=0.550s clamp_hit_fraction=1.00
I 21:57:30 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=recovering error_code=- retryable=true stall_reason=no_path
I 21:57:30 [Assets/Scripts/ARBridge/Network/InboundProcessor.ts:392] InboundProcessor: RX nav_status phase=recovering error_code=- retryable=- stall_reason=-
I 21:57:32 [Assets/Scripts/App/Robot/RobotMarker.ts:268] [RuntimePoseAnimator] pose_age raw=16.140s clamped=0.550s clamp_hit_fraction=1.00
I 21:57:37 [Assets/Scripts/App/Robot/RobotMarker.ts:268] [RuntimePoseAnimator] pose_age raw=21.144s clamped=0.550s clamp_hit_fraction=1.00
I 21:57:42 [Assets/Scripts/App/Robot/RobotMarker.ts:268] [RuntimePoseAnimator] pose_age raw=26.147s clamped=0.550s clamp_hit_fraction=1.00
I 21:57:47 [Assets/Scripts/App/Robot/RobotMarker.ts:268] [RuntimePoseAnimator] pose_age raw=31.177s clamped=0.550s clamp_hit_fraction=1.00
W 21:58:07 Spectacles has disconnected from Lens Studio.










🕒 Robot Connection Mode    : 📡 STA-L         (21:49:09)
19:49:09.563[inf][dimos/mapping/voxels.py       ] VoxelGrid using device: CPU:0
Video channel: on
19:49:09.885[inf][ar/network/websocket_server.py] AR WebSocket server listening host=0.0.0.0 port=8787
19:49:09.885[inf][s-ar/dimos/ar/bridge/module.py] ARBridge started websocket=ws://0.0.0.0:8787
--------------------------------------------------
Bridge ready — ws://0.0.0.0:8787
Spectacles: enter 192.168.1.62 in the lens
--------------------------------------------------
▸ 19:49:09.951[inf][os/ar/bridge/status_service.py] bridge connectivity updated reconnecting=False robot_connected=True streams_active=False
19:49:09.975[deb][dimos/ar/bridge/odom_buffer.py] odom source_ts provenance (assume good; remove log after hardware check) receive_mono=17850.401377 source_ts=1783626549.844021 wall_age_s=0.131142
19:49:09.976[inf][os/ar/bridge/status_service.py] bridge connectivity updated reconnecting=False robot_connected=True streams_active=True
19:49:11.061[deb][tocol/pubsub/impl/shmpubsub.py] SharedMemory PubSub starting (backend=auto)
19:53:41.158[inf][ar/network/websocket_server.py] AR client connected remote=('192.168.1.210', 54092)
--------------------------------------------------
AR client connected remote=('192.168.1.210', 54092)
--------------------------------------------------
19:53:41.294[inf][ar/network/websocket_server.py] AR inbound text message type=set_lidar_mode
19:53:41.296[inf][r/dimos/ar/bridge/telemetry.py] LiDAR mode updated mode=off obstacle_max_distance_m=0.8 obstacle_min_distance_m=0.1 obstacle_opaque_distance_m=0.5
19:53:41.297[inf][ar/network/websocket_server.py] AR inbound text message type=set_lidar_mode
19:53:46.947[inf][ar/network/websocket_server.py] AR inbound text message type=registration_command
19:53:46.948[inf][ar/network/websocket_server.py] AR inbound text message type=registration_command
19:53:46.948[inf][ar/network/websocket_server.py] AR inbound text message type=registration_command
19:53:46.953[deb][stration/session/controller.py] tag tracker active updated active=True reason=april_tag_start
19:53:46.954[inf][/registration/session/flows.py] AR registration started mode=april_tag
19:53:47.082[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
19:53:47.083[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles resolution=1008x756
19:53:47.196[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=145025 seq=1
19:53:47.292[war][s/ar/world_frame/transforms.py] gravity_level_transform diagnostic: translation=[ 0.535 -0.948 -0.802] up_world=[0.229 0.922 0.312] input_rotation=[[-0.563 -0.794  0.229]
 [ 0.387 -0.009  0.922]
 [-0.73   0.608  0.312]]
19:53:47.294[war][s/ar/world_frame/transforms.py] gravity_level_transform: input up-axis far from world-up (angle=22.8 deg) — registration input likely malformed; this warning is rate-limited to once per 30 s
19:53:47.294[inf][tion/session/session_frames.py] registration scan frame observation_count=1 observations_added=1 rejections_distance=0 rejections_reprojection=0 rejections_skew=0 seq=1 source_ts_gap_s=0.0753 tag_detected=True
19:53:47.295[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
19:53:48.762[inf][/registration/session/flows.py] AprilTag registration aligner commit alignment_confidence=0.8029 approximate=True n_obs=4 scale_observable=False yaw_observable=True
19:53:48.763[deb][stration/session/controller.py] tag tracker active updated active=False reason=registration_finish
19:53:48.769[deb][mos/ar/world_frame/registry.py] TF publish_static not supported by current backend — skipping world→odom TF
▸ 19:53:48.770[inf][/registration/session/flows.py] Registration succeeded approximate=True mode=april_tag quality=0.803
--------------------------------------------------
Registration succeeded mode=april_tag quality=0.8
--------------------------------------------------
19:53:53.754[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:53:53.868[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=18134.292189
19:53:53.869[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.007, 0.011, -0.016] odom_goal_yaw_deg=-0.0 world_goal=[0.439, -1.225, -0.864] world_goal_yaw_deg=126.99
19:53:53.867[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.007, 0.011, -0.016], euler=[90.0, 0.0, 5.5])
19:53:53.891[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:53:53.954[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.06
19:53:54.035[inf][nning_a_star/global_planner.py] Found safe goal. x=0.02 y=0.08
19:53:54.067[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:53:54.083[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:53:54.102[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=3
19:53:54.362[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.344, -0.187, 0.034] odom_goal_yaw_deg=180.0 world_goal=[0.869, -1.175, -0.634] world_goal_yaw_deg=-57.84
19:53:54.388[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.344, -0.187, 0.034], euler=[90.0, 0.0, -179.3])
19:53:54.390[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:53:54.390[inf][anning_a_star/local_planner.py] changed state state=idle
19:53:54.391[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:53:54.396[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:53:54.399[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:53:54.784[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:53:54.786[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.649, -0.318, 0.077], euler=[90.0, 0.0, -165.3])
19:53:54.786[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:53:54.786[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.649, -0.318, 0.077] odom_goal_yaw_deg=180.0 world_goal=[1.207, -1.132, -0.395] world_goal_yaw_deg=-43.87
19:53:54.787[inf][anning_a_star/local_planner.py] changed state state=idle
19:53:54.787[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.609, -0.307, 0.08] odom_goal_yaw_deg=-180.0 world_goal=[1.17, -1.129, -0.43] world_goal_yaw_deg=-43.8
19:53:54.787[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:53:54.788[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.68 y=-0.33
19:53:54.792[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:53:54.795[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.609, -0.307, 0.080], euler=[90.0, 0.0, -165.3])
19:53:54.795[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:53:54.795[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:53:54.796[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:53:54.796[inf][anning_a_star/local_planner.py] changed state state=idle
19:53:54.797[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.63 y=-0.33
19:53:54.802[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:53:54.805[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:53:54.890[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
19:53:54.891[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles resolution=1008x756
19:53:55.246[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=171607 seq=2
19:53:55.268[inf][imos/ar/world_frame/aligner.py] alignment_update method=similarity min_obs=3 n_obs=0 skip_reason=insufficient_obs
19:53:55.269[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626834.777927 frame_age_s=0.1431 latest_residual_m=None obs_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=1 residual_along_camera_ray_m=None residual_along_track_m=None residual_cross_track_m=None residual_vertical_m=None robot_speed_ms=0.02 seq=2 source_ts_gap_s=0.015123 total_rejections=1 window_centroid_residual_m=None
19:53:56.840[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
19:53:56.840[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles resolution=1008x756
19:53:56.872[inf][anning_a_star/local_planner.py] changed state state=path_following
19:53:57.398[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=136867 seq=3
19:53:57.428[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626836.977198 frame_age_s=0.0991 latest_residual_m=None obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=None residual_along_track_m=None residual_cross_track_m=None residual_vertical_m=None robot_speed_ms=0.127 seq=3 source_ts_gap_s=0.009373 total_rejections=0 window_centroid_residual_m=None
19:53:58.617[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:53:58.618[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:53:58.618[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:53:58.618[inf][anning_a_star/local_planner.py] changed state state=arrived
19:53:58.721[inf][anning_a_star/local_planner.py] changed state state=idle
19:53:58.722[inf][nning_a_star/global_planner.py] Arrived at goal.
19:53:58.722[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 19:53:58.778[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:53:58.779[inf][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.249
19:53:59.719[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=137991 seq=9
19:53:59.742[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626839.3427 frame_age_s=0.1059 latest_residual_m=None obs_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=None residual_along_track_m=None residual_cross_track_m=None residual_vertical_m=None robot_speed_ms=0.04 seq=9 source_ts_gap_s=0.048309 total_rejections=0 window_centroid_residual_m=None
19:54:03.609[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:54:03.611[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=18144.035337
19:54:03.611[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.556, -0.379, -0.021], euler=[90.0, 0.0, -157.9])
19:54:03.612[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.556, -0.379, -0.021] odom_goal_yaw_deg=-180.0 world_goal=[1.212, -1.23, -0.534] world_goal_yaw_deg=-36.45
19:54:03.613[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:03.614[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.001
19:54:03.614[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.58 y=-0.42
19:54:03.617[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:03.619[inf][anning_a_star/local_planner.py] changed state state=path_following
19:54:03.620[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:54:03.620[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:54:03.621[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
19:54:03.621[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:54:03.622[inf][anning_a_star/local_planner.py] changed state state=arrived
19:54:03.726[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:03.728[inf][nning_a_star/global_planner.py] Arrived at goal.
19:54:03.728[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 19:54:03.733[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:54:03.734[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
19:54:03.872[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.656, -0.148, 0.029], euler=[90.0, 0.0, 134.5])
19:54:03.873[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.656, -0.148, 0.029] odom_goal_yaw_deg=180.0 world_goal=[1.032, -1.18, -0.276] world_goal_yaw_deg=-104.01
19:54:03.873[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:03.874[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.68 y=-0.17
19:54:03.877[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:03.878[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:54:03.880[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=4
19:54:04.184[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.633, 0.05, 0.029] odom_goal_yaw_deg=-0.0 world_goal=[0.805, -1.18, -0.171] world_goal_yaw_deg=-158.26
19:54:04.184[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.633, 0.050, 0.029], euler=[90.0, -0.0, 80.3])
19:54:04.184[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:04.185[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:04.185[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.68 y=0.03
19:54:04.186[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:54:04.189[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:04.191[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:54:05.144[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
19:54:05.144[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles resolution=1008x756
19:54:05.211[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=133879 seq=2
19:54:05.227[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626845.011095 frame_age_s=0.1011 latest_residual_m=0.1403 obs_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.041 residual_along_track_m=0.1007 residual_cross_track_m=0.0263 residual_vertical_m=-0.094 robot_speed_ms=0.029 seq=2 source_ts_gap_s=0.040148 total_rejections=0 window_centroid_residual_m=0.1403
19:54:06.043[inf][anning_a_star/local_planner.py] changed state state=path_following
19:54:06.242[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
19:54:06.243[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles resolution=1008x756
19:54:07.291[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:54:07.291[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:54:07.291[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:54:07.292[inf][anning_a_star/local_planner.py] changed state state=arrived
19:54:07.395[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:07.395[inf][nning_a_star/global_planner.py] Arrived at goal.
19:54:07.396[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 19:54:07.397[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:54:07.397[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.28
19:54:07.475[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=154776 seq=5
19:54:07.506[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626847.241209 frame_age_s=0.0847 latest_residual_m=0.2711 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.1722 residual_along_track_m=-0.2522 residual_cross_track_m=0.0489 residual_vertical_m=-0.0864 robot_speed_ms=0.446 seq=5 source_ts_gap_s=0.018806 total_rejections=0 window_centroid_residual_m=0.2711
19:54:09.982[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:54:09.984[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=18150.408711
19:54:09.985[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.663, -0.025, -0.02] odom_goal_yaw_deg=180.0 world_goal=[0.905, -1.228, -0.188] world_goal_yaw_deg=-135.51
19:54:09.985[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.663, -0.025, -0.020], euler=[90.0, 0.0, 103.0])
19:54:09.987[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:09.988[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.001
19:54:09.988[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.68 y=-0.07
19:54:09.992[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:09.993[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:54:10.013[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=2
19:54:10.313[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.369, -0.676, 0.063] odom_goal_yaw_deg=-0.0 world_goal=[1.407, -1.146, -0.927] world_goal_yaw_deg=58.45
19:54:10.329[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.369, -0.676, 0.063], euler=[90.0, 0.0, -63.0])
19:54:10.329[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:10.330[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:10.330[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:54:10.331[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.38 y=-0.72
19:54:10.336[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:10.339[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:54:10.711[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.09, -0.824, 0.091] odom_goal_yaw_deg=0.0 world_goal=[1.382, -1.118, -1.32] world_goal_yaw_deg=92.57
19:54:10.711[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.090, -0.824, 0.091], euler=[90.0, 0.0, -28.9])
19:54:10.712[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:10.712[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:10.713[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:54:10.714[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.12 y=-0.82
19:54:10.723[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:10.731[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:54:10.955[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.077, -0.84, 0.095] odom_goal_yaw_deg=0.0 world_goal=[1.392, -1.114, -1.345] world_goal_yaw_deg=84.11
19:54:10.974[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.077, -0.840, 0.095], euler=[90.0, 0.0, -37.4])
19:54:10.974[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:10.975[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:10.975[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.12 y=-0.87
19:54:10.976[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:54:10.980[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:10.983[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:54:12.222[inf][anning_a_star/local_planner.py] changed state state=path_following
19:54:12.675[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
19:54:12.675[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles resolution=1008x756
19:54:13.142[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=135604 seq=2
19:54:13.168[inf][imos/ar/world_frame/aligner.py] alignment_update alpha_scale=0.0 alpha_yaw=1.0 baseline_m=0.4039 confidence=0.0 max_pair_skew_s=0.0506 mean_ambiguity_ratio=1.226 method=similarity n_obs=3 n_rejected=1 resid_rms_m=0.0222 s=1.25 scale_held=True scale_observable=False yaw_deg=122.93 yaw_held=False yaw_observable=True
19:54:13.173[inf][imos/ar/world_frame/aligner.py] Runtime correction applied baseline_m=0.404 marker_jump_m=0.122 observation_count=3 solve_method=similarity solve_quality=0.947 trans_delta_m=0.134 yaw_delta_deg=1.45
19:54:13.177[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626852.645374 frame_age_s=0.1018 latest_residual_m=0.0723 obs_added=1 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.0667 residual_along_track_m=0.0413 residual_cross_track_m=0.0207 residual_vertical_m=-0.0557 robot_speed_ms=0.358 seq=2 source_ts_gap_s=0.050392 total_rejections=0 window_centroid_residual_m=0.1874
19:54:13.189[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=1
19:54:13.445[inf][imos/ar/world_frame/aligner.py] alignment_held append_seq=7
19:54:14.708[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:54:14.708[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:54:15.133[inf][mos/ar/tag_tracking/tracker.py] tag_mount_up_axis_check median_up_axis_tilt_deg=23.27 sample_count=10
19:54:15.435[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:54:15.436[inf][anning_a_star/local_planner.py] changed state state=arrived
19:54:15.486[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=155331 seq=10
19:54:15.526[inf][imos/ar/world_frame/aligner.py] alignment_update alpha_scale=1.0 alpha_yaw=1.0 baseline_m=1.1799 confidence=0.4032 max_pair_skew_s=0.0515 mean_ambiguity_ratio=1.1698 method=similarity n_obs=3 n_rejected=1 resid_rms_m=0.0143 s=1.198 scale_held=False scale_observable=True yaw_deg=120.96 yaw_held=False yaw_observable=True
19:54:15.528[inf][imos/ar/world_frame/aligner.py] Runtime correction applied baseline_m=1.18 marker_jump_m=0.095 observation_count=3 solve_method=similarity solve_quality=0.932 trans_delta_m=0.068 yaw_delta_deg=1.97
19:54:15.530[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626855.175499 frame_age_s=0.0944 latest_residual_m=0.0647 obs_added=1 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.0479 residual_along_track_m=0.0403 residual_cross_track_m=0.0174 residual_vertical_m=-0.0476 robot_speed_ms=0.03 seq=10 source_ts_gap_s=0.051473 total_rejections=0 window_centroid_residual_m=0.5851
19:54:15.540[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:15.541[inf][nning_a_star/global_planner.py] Arrived at goal.
19:54:15.542[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
19:54:15.542[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.001
▸ 19:54:15.545[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:54:15.545[inf][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.216
19:54:15.932[inf][imos/ar/world_frame/aligner.py] alignment_held append_seq=8
19:54:17.739[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:54:17.742[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=18158.166283
19:54:17.743[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.114, -0.67, -0.02] odom_goal_yaw_deg=-0.0 world_goal=[1.223, -1.228, -0.985] world_goal_yaw_deg=66.86
19:54:17.755[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.114, -0.670, -0.020], euler=[90.0, -0.0, -54.1])
19:54:17.756[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:17.756[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.12 y=-0.67
19:54:17.760[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:17.761[inf][anning_a_star/local_planner.py] changed state state=path_following
19:54:17.762[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:54:17.762[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:54:17.762[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:54:17.763[inf][anning_a_star/local_planner.py] changed state state=arrived
19:54:17.766[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
19:54:17.864[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:17.865[inf][nning_a_star/global_planner.py] Arrived at goal.
19:54:17.865[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 19:54:17.866[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:54:17.867[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
19:54:18.083[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.096, -0.996, 0.03] odom_goal_yaw_deg=-0.0 world_goal=[1.43, -1.178, -1.402] world_goal_yaw_deg=67.57
19:54:18.099[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.096, -0.996, 0.030], euler=[90.0, 0.0, -53.4])
19:54:18.099[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:18.100[inf][nning_a_star/global_planner.py] Found safe goal. x=0.08 y=-0.97
19:54:18.104[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:18.106[inf][anning_a_star/local_planner.py] changed state state=path_following
19:54:18.108[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=5
19:54:18.443[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.627, -1.303, 0.069], euler=[90.0, 0.0, -29.7])
19:54:18.444[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.627, -1.303, 0.069] odom_goal_yaw_deg=-0.0 world_goal=[1.417, -1.139, -2.137] world_goal_yaw_deg=91.22
19:54:18.444[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:18.445[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:18.446[inf][nning_a_star/global_planner.py] Found safe goal. x=0.63 y=-1.32
19:54:18.445[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:54:18.455[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:18.461[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:54:18.881[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
19:54:18.882[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles resolution=1008x756
19:54:18.993[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=189039 seq=2
19:54:19.032[war][s/ar/world_frame/transforms.py] gravity_level_transform: input up-axis far from world-up (angle=17.2 deg) — registration input likely malformed; this warning is rate-limited to once per 30 s
19:54:19.041[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626858.445387 frame_age_s=0.1074 latest_residual_m=0.0688 obs_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.0331 residual_along_track_m=-0.0537 residual_cross_track_m=0.0175 residual_vertical_m=-0.0392 robot_speed_ms=0.037 seq=2 source_ts_gap_s=0.009515 total_rejections=0 window_centroid_residual_m=0.6743
19:54:19.042[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:54:19.044[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.957, -1.447, 0.023], euler=[90.0, 0.0, -25.4])
19:54:19.045[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:19.046[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:19.047[inf][nning_a_star/global_planner.py] Found safe goal. x=0.93 y=-1.42
19:54:19.046[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.909, -1.426, 0.012] odom_goal_yaw_deg=-0.0 world_goal=[1.369, -1.196, -2.502] world_goal_yaw_deg=91.6
19:54:19.048[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:54:19.048[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.957, -1.447, 0.023] odom_goal_yaw_deg=-0.0 world_goal=[1.362, -1.184, -2.564] world_goal_yaw_deg=95.61
19:54:19.053[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:19.058[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.909, -1.426, 0.012], euler=[90.0, 0.0, -29.4])
19:54:19.059[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:54:19.059[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:19.060[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:19.061[inf][nning_a_star/global_planner.py] Found safe goal. x=0.93 y=-1.42
19:54:19.063[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:54:19.074[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:19.079[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:54:19.523[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
19:54:19.524[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles resolution=1008x756
19:54:19.806[inf][anning_a_star/local_planner.py] changed state state=path_following
19:54:19.818[inf][imos/ar/world_frame/aligner.py] alignment_update alpha_scale=0.9995 alpha_yaw=1.0 baseline_m=0.8941 confidence=0.65 max_pair_skew_s=0.0515 mean_ambiguity_ratio=1.419 method=similarity n_obs=3 n_rejected=1 resid_rms_m=0.0053 s=1.1865 scale_held=False scale_observable=True yaw_deg=118.98 yaw_held=False yaw_observable=True
19:54:19.821[inf][imos/ar/world_frame/aligner.py] Runtime correction applied baseline_m=0.894 marker_jump_m=0.052 observation_count=3 solve_method=similarity solve_quality=0.934 trans_delta_m=0.036 yaw_delta_deg=1.98
19:54:19.824[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=2 dropped_fifo=0 fifo_depth=1
19:54:20.062[inf][imos/ar/world_frame/aligner.py] alignment_held append_seq=9
19:54:20.256[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
19:54:20.257[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles resolution=1008x756
19:54:21.004[inf][imos/ar/world_frame/aligner.py] alignment_update alpha_scale=1.0 alpha_yaw=1.0 baseline_m=1.0144 confidence=0.7599 max_pair_skew_s=0.0563 mean_ambiguity_ratio=1.5277 method=similarity n_obs=4 n_rejected=0 resid_rms_m=0.0081 s=1.1689 scale_held=False scale_observable=True yaw_deg=117.53 yaw_held=False yaw_observable=True
19:54:21.008[inf][imos/ar/world_frame/aligner.py] Runtime correction applied baseline_m=1.014 marker_jump_m=0.019 observation_count=4 solve_method=similarity solve_quality=0.934 trans_delta_m=0.022 yaw_delta_deg=1.45
19:54:21.326[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=146153 seq=4
19:54:21.351[inf][imos/ar/world_frame/aligner.py] alignment_held append_seq=10
19:54:21.360[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626861.074198 frame_age_s=0.1099 latest_residual_m=0.1149 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=-0.0014 residual_along_track_m=-0.1096 residual_cross_track_m=0.0069 residual_vertical_m=-0.034 robot_speed_ms=0.364 seq=4 source_ts_gap_s=0.009604 total_rejections=0 window_centroid_residual_m=0.72
19:54:22.698[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:54:22.699[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:54:22.700[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:54:22.700[inf][anning_a_star/local_planner.py] changed state state=arrived
19:54:22.803[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:22.804[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.001
19:54:22.803[inf][nning_a_star/global_planner.py] Arrived at goal.
19:54:22.804[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 19:54:22.805[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:54:22.805[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.304
19:54:23.662[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=132890 seq=9
19:54:23.680[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626863.307473 frame_age_s=0.0903 latest_residual_m=1.1244 obs_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.4309 residual_along_track_m=-1.1225 residual_cross_track_m=0.0521 residual_vertical_m=-0.0399 robot_speed_ms=0.006 seq=9 source_ts_gap_s=0.01643 total_rejections=0 window_centroid_residual_m=1.7351
19:54:24.658[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:54:24.660[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=18165.084673
19:54:24.661[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.903, -1.351, -0.021] odom_goal_yaw_deg=-0.0 world_goal=[1.416, -1.215, -2.385] world_goal_yaw_deg=82.09
19:54:24.661[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.903, -1.351, -0.021], euler=[90.0, 0.0, -35.4])
19:54:24.662[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:24.663[inf][nning_a_star/global_planner.py] Found safe goal. x=0.88 y=-1.37
19:54:24.671[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:24.674[inf][anning_a_star/local_planner.py] changed state state=path_following
19:54:24.674[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:54:24.677[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:54:24.677[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
19:54:24.677[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:54:24.678[inf][anning_a_star/local_planner.py] changed state state=arrived
19:54:24.779[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:24.780[inf][nning_a_star/global_planner.py] Arrived at goal.
19:54:24.781[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 19:54:24.782[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:54:24.783[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
19:54:25.054[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.321, -1.327, 0.029] odom_goal_yaw_deg=0.0 world_goal=[1.166, -1.165, -2.805] world_goal_yaw_deg=113.78
19:54:25.056[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.407, -1.346, 0.029], euler=[90.0, 0.0, -11.2])
19:54:25.056[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.407, -1.346, 0.029] odom_goal_yaw_deg=0.0 world_goal=[1.139, -1.165, -2.905] world_goal_yaw_deg=106.29
19:54:25.057[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:25.057[inf][nning_a_star/global_planner.py] Found safe goal. x=1.38 y=-1.37
19:54:25.062[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:25.064[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.321, -1.327, 0.029], euler=[90.0, 0.0, -3.7])
19:54:25.065[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:54:25.065[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:25.065[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:25.066[inf][nning_a_star/global_planner.py] Found safe goal. x=1.28 y=-1.37
19:54:25.066[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:54:25.068[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=7
19:54:25.070[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:25.072[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:54:26.216[inf][anning_a_star/local_planner.py] changed state state=path_following
19:54:26.746[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
19:54:26.747[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles resolution=1008x756
19:54:26.766[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=136567 seq=2
19:54:26.806[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626866.507396 frame_age_s=0.1065 latest_residual_m=1.1586 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.4214 residual_along_track_m=-0.836 residual_cross_track_m=0.8017 residual_vertical_m=-0.0304 robot_speed_ms=0.166 seq=2 source_ts_gap_s=0.01989 total_rejections=0 window_centroid_residual_m=1.7653
19:54:27.257[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:54:27.258[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:54:27.258[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:54:27.258[inf][anning_a_star/local_planner.py] changed state state=arrived
19:54:27.358[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:27.359[inf][nning_a_star/global_planner.py] Arrived at goal.
19:54:27.359[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 19:54:27.360[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:54:27.361[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.374
19:54:29.513[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:54:29.515[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=18169.939536
19:54:29.516[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.171, -1.299, -0.022] odom_goal_yaw_deg=-0.0 world_goal=[1.218, -1.216, -2.635] world_goal_yaw_deg=110.0
19:54:29.520[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.171, -1.299, -0.022], euler=[90.0, 0.0, -7.5])
19:54:29.521[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:29.522[inf][nning_a_star/global_planner.py] Found safe goal. x=1.13 y=-1.32
19:54:29.523[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.002
19:54:29.527[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:29.528[inf][anning_a_star/local_planner.py] changed state state=path_following
19:54:29.529[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
19:54:29.529[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:54:29.530[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:54:29.530[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:54:29.530[inf][anning_a_star/local_planner.py] changed state state=arrived
19:54:29.644[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:29.655[inf][nning_a_star/global_planner.py] Arrived at goal.
19:54:29.656[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 19:54:29.657[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:54:29.658[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
19:54:29.790[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.594, -1.247, 0.028], euler=[90.0, 0.0, 3.0])
19:54:29.790[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:29.790[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.594, -1.247, 0.028] odom_goal_yaw_deg=-0.0 world_goal=[0.936, -1.166, -3.045] world_goal_yaw_deg=120.56
19:54:29.791[inf][nning_a_star/global_planner.py] Found safe goal. x=1.58 y=-1.27
19:54:29.795[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:29.798[inf][anning_a_star/local_planner.py] changed state state=path_following
19:54:29.800[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=6
19:54:30.246[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.178, -1.237, 0.147] odom_goal_yaw_deg=-0.0 world_goal=[0.61, -1.046, -3.645] world_goal_yaw_deg=115.79
19:54:30.246[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.178, -1.237, 0.147], euler=[90.0, 0.0, -1.7])
19:54:30.247[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:30.247[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:30.248[inf][nning_a_star/global_planner.py] Found safe goal. x=2.18 y=-1.27
19:54:30.248[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:54:30.259[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:30.262[inf][anning_a_star/local_planner.py] changed state state=path_following
19:54:30.428[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
19:54:30.431[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles resolution=1008x756
19:54:30.471[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=142340 seq=2
19:54:30.492[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626870.242275 frame_age_s=0.0972 latest_residual_m=1.4366 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.507 residual_along_track_m=-1.3229 residual_cross_track_m=0.5588 residual_vertical_m=-0.0379 robot_speed_ms=0.258 seq=2 source_ts_gap_s=0.005816 total_rejections=0 window_centroid_residual_m=2.0294
19:54:30.493[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.162, -1.292, 0.074], euler=[90.0, 0.0, -3.3])
19:54:30.493[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.162, -1.292, 0.074] odom_goal_yaw_deg=0.0 world_goal=[0.135, -1.12, -4.695] world_goal_yaw_deg=114.2
19:54:30.493[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:30.494[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:30.494[inf][nning_a_star/global_planner.py] Found safe goal. x=3.13 y=-1.32
19:54:30.495[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:54:30.521[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:30.527[inf][anning_a_star/local_planner.py] changed state state=path_following
19:54:30.980[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:54:30.982[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.305, -1.296, 0.036] odom_goal_yaw_deg=-0.0 world_goal=[-0.478, -1.158, -5.881] world_goal_yaw_deg=121.09
19:54:30.982[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.389, -1.296, 0.036], euler=[90.0, 0.0, 1.7])
19:54:30.983[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:30.983[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:30.983[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.389, -1.296, 0.036] odom_goal_yaw_deg=0.0 world_goal=[-0.523, -1.157, -5.969] world_goal_yaw_deg=119.21
19:54:30.984[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:54:30.985[inf][nning_a_star/global_planner.py] Found safe goal. x=4.38 y=-1.32
19:54:31.003[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:31.011[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.305, -1.296, 0.036], euler=[90.0, 0.0, 3.6])
19:54:31.011[inf][anning_a_star/local_planner.py] changed state state=path_following
19:54:31.012[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:31.014[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:31.014[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:54:31.016[inf][nning_a_star/global_planner.py] Found safe goal. x=4.28 y=-1.32
19:54:31.040[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:31.075[inf][anning_a_star/local_planner.py] changed state state=path_following
19:54:32.536[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=130219 seq=8
19:54:32.560[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626872.308508 frame_age_s=0.0943 latest_residual_m=2.1045 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.6293 residual_along_track_m=-2.029 residual_cross_track_m=0.5572 residual_vertical_m=-0.039 robot_speed_ms=0.597 seq=8 source_ts_gap_s=0.021431 total_rejections=0 window_centroid_residual_m=2.6707
19:54:34.566[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=130620 seq=15
19:54:34.607[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626874.342837 frame_age_s=0.1065 latest_residual_m=3.4529 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.8838 residual_along_track_m=-3.2636 residual_cross_track_m=1.1268 residual_vertical_m=-0.0409 robot_speed_ms=0.526 seq=15 source_ts_gap_s=0.026549 total_rejections=0 window_centroid_residual_m=3.9942
19:54:36.361[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:54:36.362[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:54:36.363[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:54:36.363[inf][anning_a_star/local_planner.py] changed state state=arrived
19:54:36.466[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:36.466[inf][nning_a_star/global_planner.py] Arrived at goal.
19:54:36.466[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.0
19:54:36.467[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 19:54:36.468[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:54:36.469[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
19:54:39.524[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:54:39.525[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=18179.949687
19:54:39.526[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.275, -1.319, -0.020], euler=[90.0, 0.0, -1.3])
19:54:39.526[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.275, -1.319, -0.02] odom_goal_yaw_deg=-0.0 world_goal=[-0.438, -1.213, -5.863] world_goal_yaw_deg=116.22
19:54:39.527[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:39.528[inf][nning_a_star/global_planner.py] Found safe goal. x=4.23 y=-1.32
19:54:39.539[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:39.541[inf][anning_a_star/local_planner.py] changed state state=path_following
19:54:39.541[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
19:54:39.542[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:54:39.542[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:54:39.542[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:54:39.543[inf][anning_a_star/local_planner.py] changed state state=arrived
19:54:39.645[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:39.646[inf][nning_a_star/global_planner.py] Arrived at goal.
19:54:39.647[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 19:54:39.648[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:54:39.648[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
19:54:39.865[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.067, -1.341, 0.024] odom_goal_yaw_deg=-180.0 world_goal=[0.238, -1.169, -4.623] world_goal_yaw_deg=-77.81
19:54:39.866[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.067, -1.341, 0.024], euler=[90.0, 0.0, 164.7])
19:54:39.867[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:39.867[inf][nning_a_star/global_planner.py] Found safe goal. x=3.03 y=-1.37
19:54:39.878[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:39.884[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:54:39.893[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=14
19:54:40.162[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.723, -1.356, 0.028], euler=[90.0, 0.0, 177.2])
19:54:40.162[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.723, -1.356, 0.028] odom_goal_yaw_deg=-180.0 world_goal=[0.979, -1.165, -3.238] world_goal_yaw_deg=-65.27
19:54:40.162[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:40.163[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:40.163[inf][nning_a_star/global_planner.py] Found safe goal. x=1.68 y=-1.37
19:54:40.163[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:54:40.194[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:40.200[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:54:40.390[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.592, -1.349, 0.064] odom_goal_yaw_deg=180.0 world_goal=[1.043, -1.13, -3.098] world_goal_yaw_deg=-69.06
19:54:40.395[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.592, -1.349, 0.064], euler=[90.0, 0.0, 173.4])
19:54:40.395[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:40.396[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:40.396[inf][nning_a_star/global_planner.py] Found safe goal. x=1.58 y=-1.37
19:54:40.397[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:54:40.426[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:40.433[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:54:42.709[inf][anning_a_star/local_planner.py] changed state state=path_following
19:54:43.273[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
19:54:43.274[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles resolution=1008x756
19:54:43.438[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=122145 seq=2
19:54:43.455[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626883.208512 frame_age_s=0.1372 latest_residual_m=4.8584 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=4.17 residual_along_track_m=4.5517 residual_cross_track_m=1.6984 residual_vertical_m=-0.0384 robot_speed_ms=0.195 seq=2 source_ts_gap_s=0.013497 total_rejections=0 window_centroid_residual_m=5.3769
19:54:45.462[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=191078 seq=8
19:54:45.516[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626885.278065 frame_age_s=0.0892 latest_residual_m=3.8009 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=1 residual_along_camera_ray_m=3.6087 residual_along_track_m=3.6924 residual_cross_track_m=0.9009 residual_vertical_m=-0.0371 robot_speed_ms=0.511 seq=8 source_ts_gap_s=0.049488 total_rejections=1 window_centroid_residual_m=4.3365
19:54:47.673[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=164891 seq=14
19:54:47.698[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626887.143451 frame_age_s=0.0866 latest_residual_m=2.6668 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=1 residual_along_camera_ray_m=2.4888 residual_along_track_m=2.6577 residual_cross_track_m=0.2165 residual_vertical_m=-0.0388 robot_speed_ms=0.575 seq=14 source_ts_gap_s=0.021852 total_rejections=1 window_centroid_residual_m=3.2225
19:54:48.200[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:54:48.202[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:54:48.202[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:54:48.203[inf][anning_a_star/local_planner.py] changed state state=arrived
19:54:48.305[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:48.306[inf][nning_a_star/global_planner.py] Arrived at goal.
19:54:48.307[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
19:54:48.310[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.003
▸ 19:54:48.310[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:54:48.311[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.265
19:54:53.651[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:54:53.653[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=18194.077293
19:54:53.654[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.635, -1.384, -0.021] odom_goal_yaw_deg=-180.0 world_goal=[1.056, -1.215, -3.162] world_goal_yaw_deg=-54.97
19:54:53.682[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.635, -1.384, -0.021], euler=[90.0, 0.0, -172.5])
19:54:53.683[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:53.684[inf][nning_a_star/global_planner.py] Found safe goal. x=1.63 y=-1.42
19:54:53.684[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.001
19:54:53.691[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:53.693[inf][anning_a_star/local_planner.py] changed state state=path_following
19:54:53.693[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
19:54:53.693[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:54:53.694[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:54:53.694[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:54:53.694[inf][anning_a_star/local_planner.py] changed state state=arrived
19:54:53.796[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:53.797[inf][nning_a_star/global_planner.py] Arrived at goal.
19:54:53.797[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 19:54:53.799[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:54:53.799[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
19:54:53.975[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.020, -1.342, 0.029], euler=[90.0, 0.0, -0.7])
19:54:53.975[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.043, -1.341, 0.029] odom_goal_yaw_deg=-0.0 world_goal=[0.791, -1.165, -3.561] world_goal_yaw_deg=104.36
19:54:53.976[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:53.977[inf][nning_a_star/global_planner.py] Found safe goal. x=1.98 y=-1.37
19:54:53.976[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.02, -1.342, 0.029] odom_goal_yaw_deg=0.0 world_goal=[0.804, -1.165, -3.538] world_goal_yaw_deg=116.84
19:54:53.985[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:53.988[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.043, -1.341, 0.029], euler=[90.0, 0.0, -13.2])
19:54:53.989[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:54:53.989[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:53.990[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:53.990[inf][nning_a_star/global_planner.py] Found safe goal. x=2.03 y=-1.37
19:54:53.991[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:54:53.991[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=5
19:54:53.998[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:54.008[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:54:55.694[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:54:55.695[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=18196.119422
19:54:55.696[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.191, -1.362, 0.031] odom_goal_yaw_deg=-0.0 world_goal=[0.732, -1.162, -3.726] world_goal_yaw_deg=99.91
19:54:55.715[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.191, -1.362, 0.031], euler=[90.0, 0.0, -17.6])
19:54:55.715[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:55.716[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:55.716[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:54:55.717[inf][nning_a_star/global_planner.py] Found safe goal. x=2.18 y=-1.37
19:54:55.724[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:55.727[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:54:56.057[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.69, -1.332, 0.063] odom_goal_yaw_deg=0.0 world_goal=[0.432, -1.131, -4.227] world_goal_yaw_deg=118.71
19:54:56.059[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.690, -1.332, 0.063], euler=[90.0, 0.0, 1.2])
19:54:56.059[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:56.061[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:56.061[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:54:56.062[inf][nning_a_star/global_planner.py] Found safe goal. x=2.68 y=-1.37
19:54:56.076[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:56.083[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:54:56.275[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.246, -1.309, 0.041] odom_goal_yaw_deg=-0.0 world_goal=[0.108, -1.153, -4.791] world_goal_yaw_deg=117.18
19:54:56.275[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.246, -1.309, 0.041], euler=[90.0, 0.0, -0.4])
19:54:56.276[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:56.276[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:56.277[inf][nning_a_star/global_planner.py] Found safe goal. x=3.23 y=-1.32
19:54:56.277[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:54:56.295[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:56.301[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:54:56.686[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.843, -1.351, 0.049] odom_goal_yaw_deg=-0.0 world_goal=[-0.172, -1.145, -5.433] world_goal_yaw_deg=95.54
19:54:56.723[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.843, -1.351, 0.049], euler=[90.0, 0.0, -22.0])
19:54:56.725[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:56.726[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:56.727[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:54:56.727[inf][nning_a_star/global_planner.py] Found safe goal. x=3.83 y=-1.37
19:54:56.763[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:56.787[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:54:57.076[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:54:57.078[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.971, -1.457, 0.233] odom_goal_yaw_deg=0.0 world_goal=[-0.131, -0.961, -5.623] world_goal_yaw_deg=87.58
19:54:57.079[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.971, -1.457, 0.233], euler=[90.0, 0.0, -29.9])
19:54:57.080[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:57.080[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:57.081[war][nning_a_star/global_planner.py] Travelling to goal 0.23786708222894495m away from requested goal.
19:54:57.082[inf][nning_a_star/global_planner.py] Found safe goal. x=3.93 y=-1.47
19:54:57.082[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:54:57.100[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:57.109[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:54:57.343[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.411, -1.36, 0.124] odom_goal_yaw_deg=0.0 world_goal=[-0.469, -1.07, -6.026] world_goal_yaw_deg=126.6
19:54:57.361[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.411, -1.360, 0.124], euler=[90.0, 0.0, 9.1])
19:54:57.362[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:57.362[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:57.363[inf][nning_a_star/global_planner.py] Found safe goal. x=4.38 y=-1.37
19:54:57.364[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:54:57.408[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:57.416[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:54:57.694[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.782, -1.367, 0.125] odom_goal_yaw_deg=0.0 world_goal=[-0.662, -1.068, -6.415] world_goal_yaw_deg=98.26
19:54:57.695[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.782, -1.367, 0.125], euler=[90.0, 0.0, -19.3])
19:54:57.695[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:57.696[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:57.697[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:54:57.698[inf][nning_a_star/global_planner.py] Found safe goal. x=4.78 y=-1.37
19:54:57.720[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:57.726[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:54:57.937[inf][anning_a_star/local_planner.py] changed state state=path_following
19:54:58.063[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=18198.487709
19:54:58.064[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.409, -1.213, 0.027] odom_goal_yaw_deg=0.0 world_goal=[-1.16, -1.167, -6.981] world_goal_yaw_deg=68.81
19:54:58.065[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.409, -1.213, 0.027], euler=[90.0, 0.0, -48.7])
19:54:58.065[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:58.066[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:58.067[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:54:58.068[inf][nning_a_star/global_planner.py] Found safe goal. x=5.38 y=-1.27
19:54:58.086[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:58.101[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:54:58.750[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:54:58.752[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.566, -1.167, -0.044] odom_goal_yaw_deg=-0.0 world_goal=[-1.293, -1.238, -7.119] world_goal_yaw_deg=131.59
19:54:58.752[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.566, -1.167, -0.044], euler=[90.0, 0.0, 14.1])
19:54:58.753[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:58.753[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.0
19:54:58.753[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:58.754[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:54:58.756[inf][nning_a_star/global_planner.py] Found safe goal. x=5.58 y=-1.27
19:54:58.775[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:58.785[inf][anning_a_star/local_planner.py] changed state state=path_following
19:54:58.978[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.413, -1.212, 0.032] odom_goal_yaw_deg=-180.0 world_goal=[-1.164, -1.162, -6.985] world_goal_yaw_deg=-4.79
19:54:58.979[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.413, -1.212, 0.032], euler=[90.0, 0.0, -122.3])
19:54:58.979[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:58.979[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:58.980[inf][nning_a_star/global_planner.py] Found safe goal. x=5.38 y=-1.27
19:54:58.981[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:54:59.005[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:59.012[inf][anning_a_star/local_planner.py] changed state state=path_following
19:54:59.307[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.134, -0.982, 0.066] odom_goal_yaw_deg=-0.0 world_goal=[-1.251, -1.128, -6.572] world_goal_yaw_deg=-163.4
19:54:59.308[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.134, -0.982, 0.066], euler=[90.0, 0.0, 79.1])
19:54:59.309[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:59.310[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:59.310[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:54:59.317[war][nning_a_star/global_planner.py] Travelling to goal 0.20393063571034373m away from requested goal.
19:54:59.317[inf][nning_a_star/global_planner.py] Found safe goal. x=5.13 y=-1.17
19:54:59.356[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:59.363[inf][anning_a_star/local_planner.py] changed state state=path_following
19:54:59.659[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.962, -1.062, 0.068], euler=[90.0, 0.0, 169.4])
19:54:59.659[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.962, -1.062, 0.068] odom_goal_yaw_deg=-180.0 world_goal=[-1.075, -1.126, -6.437] world_goal_yaw_deg=-73.11
19:54:59.659[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:54:59.659[inf][anning_a_star/local_planner.py] changed state state=idle
19:54:59.660[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:54:59.664[inf][nning_a_star/global_planner.py] Found safe goal. x=4.93 y=-1.17
19:54:59.687[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:54:59.697[inf][anning_a_star/local_planner.py] changed state state=path_following
19:55:00.074[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:55:00.075[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=18200.499231
19:55:00.076[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.701, -1.317, 0.062] odom_goal_yaw_deg=-180.0 world_goal=[-0.67, -1.132, -6.303] world_goal_yaw_deg=10.2
19:55:00.076[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.701, -1.317, 0.062], euler=[90.0, 0.0, -107.3])
19:55:00.076[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:00.077[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:00.077[inf][nning_a_star/global_planner.py] Found safe goal. x=4.68 y=-1.32
19:55:00.078[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:55:00.098[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:00.103[inf][anning_a_star/local_planner.py] changed state state=path_following
19:55:00.596[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.089, -1.213, 0.027] odom_goal_yaw_deg=-0.0 world_goal=[-0.987, -1.167, -6.649] world_goal_yaw_deg=125.51
19:55:00.597[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.089, -1.213, 0.027], euler=[90.0, 0.0, 8.0])
19:55:00.598[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:00.598[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:00.599[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:55:00.600[inf][nning_a_star/global_planner.py] Found safe goal. x=5.08 y=-1.22
19:55:00.648[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:00.658[inf][anning_a_star/local_planner.py] changed state state=path_following
19:55:01.030[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.257, -1.19, -0.001] odom_goal_yaw_deg=0.0 world_goal=[-1.103, -1.194, -6.811] world_goal_yaw_deg=133.1
19:55:01.030[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.257, -1.190, -0.001], euler=[90.0, 0.0, 15.6])
19:55:01.031[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:01.032[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:01.033[inf][nning_a_star/global_planner.py] Found safe goal. x=5.23 y=-1.22
19:55:01.034[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:55:01.054[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:01.062[inf][anning_a_star/local_planner.py] changed state state=path_following
19:55:01.435[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:55:01.437[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.084, -1.039, 0.008] odom_goal_yaw_deg=180.0 world_goal=[-1.165, -1.186, -6.55] world_goal_yaw_deg=-149.98
19:55:01.437[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.084, -1.039, 0.008], euler=[90.0, 0.0, 92.5])
19:55:01.438[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:01.439[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:01.439[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:55:01.440[inf][nning_a_star/global_planner.py] Found safe goal. x=5.08 y=-1.07
19:55:01.459[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:01.470[inf][anning_a_star/local_planner.py] changed state state=path_following
19:55:01.735[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.579, -1.194, -0.258] odom_goal_yaw_deg=-0.0 world_goal=[-1.272, -1.451, -7.147] world_goal_yaw_deg=39.03
19:55:01.735[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.579, -1.194, -0.258], euler=[90.0, 0.0, -78.5])
19:55:01.736[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:01.737[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:01.738[war][nning_a_star/global_planner.py] Travelling to goal 0.2699822465399106m away from requested goal.
19:55:01.739[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:55:01.739[inf][nning_a_star/global_planner.py] Found safe goal. x=5.58 y=-1.27
19:55:01.759[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:01.792[inf][anning_a_star/local_planner.py] changed state state=path_following
19:55:02.096[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=18202.520701
19:55:02.097[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.006, -1.393, -0.063], euler=[90.0, 0.0, -143.3])
19:55:02.098[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.006, -1.393, -0.063] odom_goal_yaw_deg=-180.0 world_goal=[-0.756, -1.257, -6.66] world_goal_yaw_deg=-25.77
19:55:02.098[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:02.098[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:02.099[inf][nning_a_star/global_planner.py] Found safe goal. x=4.98 y=-1.42
19:55:02.099[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:55:02.115[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:02.122[inf][anning_a_star/local_planner.py] changed state state=path_following
19:55:02.337[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.11, -1.454, 0.035] odom_goal_yaw_deg=0.0 world_goal=[-0.749, -1.158, -6.801] world_goal_yaw_deg=55.74
19:55:02.364[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.110, -1.454, 0.035], euler=[90.0, 0.0, -61.8])
19:55:02.365[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:02.366[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:02.367[inf][nning_a_star/global_planner.py] Found safe goal. x=5.08 y=-1.47
19:55:02.366[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:55:02.387[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:02.397[inf][anning_a_star/local_planner.py] changed state state=path_following
19:55:03.183[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
19:55:03.185[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles resolution=1008x756
19:55:03.408[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=177560 seq=2
19:55:03.435[war][s/ar/world_frame/transforms.py] gravity_level_transform: input up-axis far from world-up (angle=17.5 deg) — registration input likely malformed; this warning is rate-limited to once per 30 s
19:55:03.439[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626903.139811 frame_age_s=0.1037 latest_residual_m=3.168 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=2.8862 residual_along_track_m=-3.0094 residual_cross_track_m=0.9892 residual_vertical_m=-0.0374 robot_speed_ms=0.518 seq=2 source_ts_gap_s=0.04116 total_rejections=0 window_centroid_residual_m=3.713
19:55:05.647[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=161852 seq=7
19:55:05.673[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626905.139759 frame_age_s=0.1085 latest_residual_m=4.491 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=4.0116 residual_along_track_m=-4.4611 residual_cross_track_m=0.5162 residual_vertical_m=-0.0396 robot_speed_ms=0.614 seq=7 source_ts_gap_s=0.026439 total_rejections=0 window_centroid_residual_m=5.0086
19:55:06.966[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:55:06.968[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:55:07.707[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626907.006387 frame_age_s=0.1047 latest_residual_m=5.7195 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=5.0987 residual_along_track_m=-5.4706 residual_cross_track_m=1.6683 residual_vertical_m=-0.0423 robot_speed_ms=1.571 seq=12 source_ts_gap_s=0.023161 total_rejections=0 window_centroid_residual_m=6.2337
19:55:07.936[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:55:07.936[inf][anning_a_star/local_planner.py] changed state state=arrived
19:55:08.049[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:08.052[inf][nning_a_star/global_planner.py] Arrived at goal.
19:55:08.053[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
19:55:08.054[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.003
▸ 19:55:08.055[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:55:08.056[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.288
19:55:08.072[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=163935 seq=13
19:55:15.077[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:55:15.084[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=18215.508465
19:55:15.088[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[5.027, -1.436, -0.021] odom_goal_yaw_deg=-0.0 world_goal=[-0.723, -1.215, -6.706] world_goal_yaw_deg=57.61
19:55:15.089[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[5.027, -1.436, -0.021], euler=[90.0, 0.0, -59.9])
19:55:15.093[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:15.094[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.001
19:55:15.094[inf][nning_a_star/global_planner.py] Found safe goal. x=5.03 y=-1.47
19:55:15.100[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:15.101[inf][anning_a_star/local_planner.py] changed state state=path_following
19:55:15.102[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:55:15.102[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:55:15.102[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
19:55:15.102[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:55:15.102[inf][anning_a_star/local_planner.py] changed state state=arrived
19:55:15.207[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:15.207[inf][nning_a_star/global_planner.py] Arrived at goal.
19:55:15.208[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 19:55:15.209[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:55:15.210[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
19:55:15.354[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.657, -1.351, 0.029] odom_goal_yaw_deg=-180.0 world_goal=[-0.611, -1.165, -6.276] world_goal_yaw_deg=-44.55
19:55:15.355[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.657, -1.351, 0.029], euler=[90.0, 0.0, -162.1])
19:55:15.355[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:15.356[inf][nning_a_star/global_planner.py] Found safe goal. x=4.63 y=-1.37
19:55:15.365[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:15.367[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:55:15.370[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=6
19:55:15.624[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.042, -1.278, 0.068], euler=[90.0, 0.0, 177.3])
19:55:15.624[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.042, -1.278, 0.068] odom_goal_yaw_deg=-180.0 world_goal=[-0.355, -1.126, -5.6] world_goal_yaw_deg=-65.15
19:55:15.624[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:15.625[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:15.625[inf][nning_a_star/global_planner.py] Found safe goal. x=4.03 y=-1.32
19:55:15.626[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:55:15.648[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:15.652[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:55:15.975[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[4.099, -1.445, 0.13] odom_goal_yaw_deg=-0.0 world_goal=[-0.212, -1.064, -5.749] world_goal_yaw_deg=29.88
19:55:15.976[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[4.099, -1.445, 0.130], euler=[90.0, 0.0, -87.6])
19:55:15.977[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:15.977[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:15.978[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:55:15.979[inf][nning_a_star/global_planner.py] Found safe goal. x=4.08 y=-1.47
19:55:15.992[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:15.995[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:55:16.959[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:55:16.963[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
19:55:16.968[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles resolution=1008x756
19:55:16.969[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.871, -2.265, 0.029], euler=[90.0, 0.0, 151.7])
19:55:16.969[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:16.969[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.871, -2.265, 0.029] odom_goal_yaw_deg=-180.0 world_goal=[1.301, -1.165, -4.919] world_goal_yaw_deg=-90.78
19:55:16.970[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:16.971[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:55:16.978[war][nning_a_star/global_planner.py] Travelling to goal 0.4925493003288898m away from requested goal.
19:55:16.979[inf][nning_a_star/global_planner.py] Found safe goal. x=2.83 y=-1.77
19:55:17.005[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:17.013[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:55:17.304[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=197467 seq=2
19:55:17.357[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626916.908086 frame_age_s=0.1102 latest_residual_m=5.7622 obs_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=1 residual_along_camera_ray_m=5.5783 residual_along_track_m=1.4246 residual_cross_track_m=5.5831 residual_vertical_m=-0.0425 robot_speed_ms=0.014 seq=2 source_ts_gap_s=0.020632 total_rejections=1 window_centroid_residual_m=6.2765
19:55:17.358[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=18217.782482
19:55:17.359[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.361, -1.948, 0.037], euler=[90.0, 0.0, 92.7])
19:55:17.359[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.361, -1.948, 0.037] odom_goal_yaw_deg=-180.0 world_goal=[0.708, -1.157, -5.255] world_goal_yaw_deg=-149.74
19:55:17.360[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:17.361[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
19:55:17.361[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:17.361[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:55:17.363[war][nning_a_star/global_planner.py] Travelling to goal 0.36432163631821624m away from requested goal.
19:55:17.364[inf][nning_a_star/global_planner.py] Found safe goal. x=3.08 y=-1.72
19:55:17.382[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:17.390[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:55:17.908[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.341, -4.084, 0.037] odom_goal_yaw_deg=-180.0 world_goal=[4.922, -1.157, -2.572] world_goal_yaw_deg=-34.63
19:55:17.908[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.341, -4.084, 0.037], euler=[90.0, 0.0, -152.2])
19:55:17.909[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:17.910[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:17.916[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:55:17.920[war][nning_a_star/global_planner.py] Travelling to goal 0.3963587875519412m away from requested goal.
19:55:17.921[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.73 y=-4.17
19:55:17.948[war][nning_a_star/global_planner.py] No path found to the goal. x=-0.725 y=-4.175
19:55:17.949[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
19:55:17.950[inf][imos/ar/navigation/navigate.py] AR navigation goal failed
19:55:17.951[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=0.0
19:55:18.127[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:55:18.130[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.428, -1.394, 0.067], euler=[90.0, 0.0, -166.3])
19:55:18.130[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.428, -1.394, 0.067] odom_goal_yaw_deg=180.0 world_goal=[0.097, -1.127, -5.026] world_goal_yaw_deg=-48.78
19:55:18.130[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:18.132[inf][nning_a_star/global_planner.py] Found safe goal. x=3.43 y=-1.42
19:55:18.152[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:18.158[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:55:18.164[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=18
19:55:18.366[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.337, -1.531, 0.061], euler=[90.0, -0.0, -138.4])
19:55:18.366[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.337, -1.531, 0.061] odom_goal_yaw_deg=-180.0 world_goal=[0.289, -1.133, -5.006] world_goal_yaw_deg=-20.91
19:55:18.366[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:18.366[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:18.367[inf][nning_a_star/global_planner.py] Found safe goal. x=3.33 y=-1.57
19:55:18.367[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:55:18.401[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:18.406[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:55:18.710[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[3.198, -1.756, 0.018] odom_goal_yaw_deg=-180.0 world_goal=[0.597, -1.176, -4.983] world_goal_yaw_deg=-47.23
19:55:18.711[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[3.198, -1.756, 0.018], euler=[90.0, 0.0, -164.8])
19:55:18.711[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:18.711[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:18.712[inf][nning_a_star/global_planner.py] Found safe goal. x=3.13 y=-1.72
19:55:18.712[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:55:18.732[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:18.739[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:55:18.980[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.956, -1.503, 0.105] odom_goal_yaw_deg=-180.0 world_goal=[0.465, -1.089, -4.595] world_goal_yaw_deg=-97.1
19:55:19.008[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.956, -1.503, 0.105], euler=[90.0, 0.0, 145.4])
19:55:19.009[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:19.010[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:19.011[inf][nning_a_star/global_planner.py] Found safe goal. x=2.93 y=-1.52
19:55:19.011[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:55:19.045[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:19.063[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:55:19.465[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:55:19.467[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=18219.890961
19:55:19.468[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.541, -1.415, 0.062], euler=[90.0, 0.0, 169.2])
19:55:19.468[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.541, -1.415, 0.062] odom_goal_yaw_deg=-180.0 world_goal=[0.599, -1.132, -4.118] world_goal_yaw_deg=-73.28
19:55:19.469[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:19.469[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:19.470[inf][nning_a_star/global_planner.py] Found safe goal. x=2.53 y=-1.42
19:55:19.471[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:55:19.487[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:19.492[inf][anning_a_star/local_planner.py] changed state state=path_following
19:55:19.788[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.28, -1.407, 0.021] odom_goal_yaw_deg=180.0 world_goal=[0.731, -1.173, -3.842] world_goal_yaw_deg=-61.5
19:55:19.827[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.280, -1.407, 0.021], euler=[90.0, 0.0, -179.0])
19:55:19.828[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:19.829[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:19.829[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:55:19.830[inf][nning_a_star/global_planner.py] Found safe goal. x=2.28 y=-1.42
19:55:19.849[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:19.856[inf][anning_a_star/local_planner.py] changed state state=path_following
19:55:20.303[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
19:55:20.303[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles resolution=1008x756
19:55:20.525[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=159279 seq=2
19:55:20.552[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626920.239384 frame_age_s=0.1286 latest_residual_m=5.6011 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=5.4283 residual_along_track_m=5.581 residual_cross_track_m=0.473 residual_vertical_m=-0.0337 robot_speed_ms=0.416 seq=2 source_ts_gap_s=0.02866 total_rejections=0 window_centroid_residual_m=6.1186
19:55:22.666[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=176210 seq=8
19:55:22.697[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626922.473327 frame_age_s=0.0832 latest_residual_m=4.1606 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=4.0391 residual_along_track_m=4.0434 residual_cross_track_m=0.9798 residual_vertical_m=-0.0373 robot_speed_ms=0.6 seq=8 source_ts_gap_s=0.015705 total_rejections=0 window_centroid_residual_m=4.6863
19:55:24.629[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:55:24.629[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:55:24.630[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:55:24.631[inf][anning_a_star/local_planner.py] changed state state=arrived
19:55:24.733[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:24.736[inf][nning_a_star/global_planner.py] Arrived at goal.
19:55:24.737[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
19:55:24.750[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.008
▸ 19:55:24.751[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:55:24.752[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.3
19:55:25.088[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=126624 seq=15
19:55:25.110[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626924.705943 frame_age_s=0.0893 latest_residual_m=2.7297 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=2.5912 residual_along_track_m=2.6265 residual_cross_track_m=0.7422 residual_vertical_m=-0.039 robot_speed_ms=0.214 seq=15 source_ts_gap_s=0.045186 total_rejections=0 window_centroid_residual_m=3.291
19:55:25.790[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
19:55:25.798[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles resolution=1008x756
19:55:26.365[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:55:26.366[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=18226.789904
19:55:26.366[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[2.272, -1.408, -0.033], euler=[90.0, 0.0, 179.6])
19:55:26.367[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:26.367[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[2.272, -1.408, -0.033] odom_goal_yaw_deg=180.0 world_goal=[0.736, -1.226, -3.835] world_goal_yaw_deg=-62.84
19:55:26.368[inf][nning_a_star/global_planner.py] Found safe goal. x=2.23 y=-1.42
19:55:26.375[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:26.377[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:55:26.378[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=2
19:55:26.639[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
19:55:26.640[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles resolution=1008x756
19:55:26.703[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.657, -1.479, 0.026], euler=[90.0, -0.0, -173.9])
19:55:26.703[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.657, -1.479, 0.026] odom_goal_yaw_deg=-180.0 world_goal=[1.142, -1.168, -3.236] world_goal_yaw_deg=-56.35
19:55:26.703[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:26.703[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:26.704[inf][nning_a_star/global_planner.py] Found safe goal. x=1.63 y=-1.52
19:55:26.704[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:55:26.713[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:26.718[inf][anning_a_star/local_planner.py] changed state state=path_following
19:55:27.253[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.586, -1.582, 0.064] odom_goal_yaw_deg=180.0 world_goal=[1.287, -1.129, -3.218] world_goal_yaw_deg=14.74
19:55:27.255[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.586, -1.582, 0.064], euler=[90.0, 0.0, -102.8])
19:55:27.256[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:27.256[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:27.257[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:55:27.258[inf][nning_a_star/global_planner.py] Found safe goal. x=1.58 y=-1.62
19:55:27.267[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:27.273[inf][anning_a_star/local_planner.py] changed state state=path_following
19:55:27.619[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
19:55:27.620[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles resolution=1008x756
19:55:27.658[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=131432 seq=2
19:55:27.678[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626927.239457 frame_age_s=0.0785 latest_residual_m=2.5851 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=1 residual_along_camera_ray_m=2.394 residual_along_track_m=2.2564 residual_cross_track_m=1.261 residual_vertical_m=-0.0341 robot_speed_ms=0.232 seq=2 source_ts_gap_s=0.04279 total_rejections=1 window_centroid_residual_m=3.1515
19:55:28.615[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:55:28.615[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:55:29.541[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:55:29.542[inf][anning_a_star/local_planner.py] changed state state=arrived
19:55:29.643[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:29.644[inf][nning_a_star/global_planner.py] Arrived at goal.
19:55:29.644[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 19:55:29.645[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:55:29.646[inf][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.242
19:55:29.930[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=136975 seq=8
19:55:29.954[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626929.472488 frame_age_s=0.1009 latest_residual_m=1.9952 obs_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=1 residual_along_camera_ray_m=1.7426 residual_along_track_m=0.1208 residual_cross_track_m=1.9912 residual_vertical_m=-0.0364 robot_speed_ms=0.007 seq=8 source_ts_gap_s=0.018494 total_rejections=1 window_centroid_residual_m=2.5952
19:55:35.333[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:55:35.335[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=18235.758682
19:55:35.335[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.626, -1.606, -0.027], euler=[90.0, 0.0, -120.6])
19:55:35.336[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.626, -1.606, -0.027] odom_goal_yaw_deg=180.0 world_goal=[1.291, -1.221, -3.273] world_goal_yaw_deg=-3.11
19:55:35.336[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:35.337[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.0
19:55:35.337[inf][nning_a_star/global_planner.py] Found safe goal. x=1.63 y=-1.63
19:55:35.342[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:35.343[inf][anning_a_star/local_planner.py] changed state state=path_following
19:55:35.343[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:55:35.344[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:55:35.344[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
19:55:35.344[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:55:35.344[inf][anning_a_star/local_planner.py] changed state state=arrived
19:55:35.447[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:35.448[inf][nning_a_star/global_planner.py] Arrived at goal.
19:55:35.448[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 19:55:35.450[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:55:35.450[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
19:55:35.625[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.552, -1.769, 0.023] odom_goal_yaw_deg=180.0 world_goal=[1.5, -1.171, -3.284] world_goal_yaw_deg=-3.45
19:55:35.645[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.552, -1.769, 0.023], euler=[90.0, 0.0, -121.0])
19:55:35.645[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:35.647[inf][nning_a_star/global_planner.py] Found safe goal. x=1.53 y=-1.78
19:55:35.653[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:35.656[inf][anning_a_star/local_planner.py] changed state state=path_following
19:55:35.657[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:55:35.657[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:55:35.657[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:55:35.658[inf][anning_a_star/local_planner.py] changed state state=arrived
19:55:35.658[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=3
19:55:35.762[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:35.763[inf][nning_a_star/global_planner.py] Arrived at goal.
19:55:35.763[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 19:55:35.788[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:55:35.788[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.29
19:55:35.920[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.569, -1.765, 0.023] odom_goal_yaw_deg=-180.0 world_goal=[1.486, -1.171, -3.3] world_goal_yaw_deg=-0.77
19:55:35.920[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.569, -1.765, 0.023], euler=[90.0, 0.0, -118.3])
19:55:35.921[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:35.922[inf][nning_a_star/global_planner.py] Found safe goal. x=1.53 y=-1.78
19:55:35.930[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:35.931[inf][anning_a_star/local_planner.py] changed state state=path_following
19:55:35.932[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:55:35.932[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:55:35.932[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=3
19:55:35.932[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:55:35.933[inf][anning_a_star/local_planner.py] changed state state=arrived
19:55:36.036[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:36.037[inf][nning_a_star/global_planner.py] Arrived at goal.
19:55:36.038[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 19:55:36.039[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:55:36.039[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.286
19:55:38.825[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:55:38.830[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=18239.254174
19:55:38.831[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.627, -1.607, -0.027] odom_goal_yaw_deg=-180.0 world_goal=[1.291, -1.221, -3.273] world_goal_yaw_deg=-3.12
19:55:38.842[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.627, -1.607, -0.027], euler=[90.0, 0.0, -120.6])
19:55:38.843[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:38.844[inf][nning_a_star/global_planner.py] Found safe goal. x=1.63 y=-1.63
19:55:38.852[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:38.854[inf][anning_a_star/local_planner.py] changed state state=path_following
19:55:38.856[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:55:38.857[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:55:38.857[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
19:55:38.857[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:55:38.858[inf][anning_a_star/local_planner.py] changed state state=arrived
19:55:38.961[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:38.962[inf][nning_a_star/global_planner.py] Arrived at goal.
19:55:38.962[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 19:55:38.964[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:55:38.964[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
19:55:39.150[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.547, -1.93, 0.023] odom_goal_yaw_deg=-180.0 world_goal=[1.669, -1.171, -3.366] world_goal_yaw_deg=-2.45
19:55:39.151[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.547, -1.930, 0.023], euler=[90.0, 0.0, -120.0])
19:55:39.151[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:39.152[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.588, -1.879, 0.023] odom_goal_yaw_deg=-180.0 world_goal=[1.594, -1.171, -3.381] world_goal_yaw_deg=4.28
19:55:39.153[inf][nning_a_star/global_planner.py] Found safe goal. x=1.53 y=-1.98
19:55:39.163[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:39.165[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.588, -1.879, 0.023], euler=[90.0, 0.0, -113.2])
19:55:39.166[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:39.166[inf][anning_a_star/local_planner.py] changed state state=path_following
19:55:39.167[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:39.167[inf][nning_a_star/global_planner.py] Found safe goal. x=1.58 y=-1.93
19:55:39.167[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=6
19:55:39.168[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:55:39.173[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:39.175[inf][anning_a_star/local_planner.py] changed state state=path_following
19:55:39.513[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.374, -2.138, 0.03] odom_goal_yaw_deg=180.0 world_goal=[1.978, -1.164, -3.299] world_goal_yaw_deg=-12.81
19:55:39.513[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.374, -2.138, 0.030], euler=[90.0, 0.0, -130.3])
19:55:39.514[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:39.515[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:39.515[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:55:39.516[inf][nning_a_star/global_planner.py] Found safe goal. x=1.33 y=-2.18
19:55:39.540[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:39.548[inf][anning_a_star/local_planner.py] changed state state=path_following
19:55:39.834[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
19:55:39.835[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:55:39.836[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles resolution=1008x756
19:55:39.838[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.286, -2.225, 0.038], euler=[90.0, 0.0, -134.3])
19:55:39.838[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.286, -2.225, 0.038] odom_goal_yaw_deg=180.0 world_goal=[2.116, -1.156, -3.254] world_goal_yaw_deg=-16.74
19:55:39.838[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:39.839[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:39.839[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:55:39.840[inf][nning_a_star/global_planner.py] Found safe goal. x=1.28 y=-2.28
19:55:39.847[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:39.850[inf][anning_a_star/local_planner.py] changed state state=path_following
19:55:39.878[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=137530 seq=2
19:55:39.898[war][s/ar/world_frame/transforms.py] gravity_level_transform: input up-axis far from world-up (angle=17.5 deg) — registration input likely malformed; this warning is rate-limited to once per 30 s
19:55:39.903[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626939.638901 frame_age_s=0.1256 latest_residual_m=1.9975 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=1.7139 residual_along_track_m=-0.1321 residual_cross_track_m=1.993 residual_vertical_m=-0.0289 robot_speed_ms=0.22 seq=2 source_ts_gap_s=0.022043 total_rejections=0 window_centroid_residual_m=2.6011
19:55:41.098[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:55:41.098[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:55:41.099[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:55:41.099[inf][anning_a_star/local_planner.py] changed state state=arrived
19:55:41.200[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:41.200[inf][nning_a_star/global_planner.py] Arrived at goal.
19:55:41.201[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
19:55:41.235[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.034
▸ 19:55:41.236[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:55:41.236[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.278
19:55:42.174[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=129298 seq=8
19:55:42.199[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626941.906794 frame_age_s=0.1048 latest_residual_m=2.1685 obs_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=1.6663 residual_along_track_m=-0.7928 residual_cross_track_m=2.0178 residual_vertical_m=-0.0483 robot_speed_ms=0.002 seq=8 source_ts_gap_s=0.03139 total_rejections=0 window_centroid_residual_m=2.776
19:55:43.854[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:55:43.856[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=18244.280176
19:55:43.857[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.288, -2.240, -0.012], euler=[90.0, 0.0, -119.3])
19:55:43.857[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.288, -2.24, -0.012] odom_goal_yaw_deg=-180.0 world_goal=[2.131, -1.206, -3.265] world_goal_yaw_deg=-1.78
19:55:43.858[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:43.859[inf][nning_a_star/global_planner.py] Found safe goal. x=1.28 y=-2.27
19:55:43.866[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:43.868[inf][anning_a_star/local_planner.py] changed state state=path_following
19:55:43.869[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
19:55:43.869[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:55:43.870[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:55:43.870[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:55:43.870[inf][anning_a_star/local_planner.py] changed state state=arrived
19:55:43.972[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:43.973[inf][nning_a_star/global_planner.py] Arrived at goal.
19:55:43.974[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 19:55:43.975[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:55:43.975[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
19:55:44.173[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.053, -2.648, 0.038] odom_goal_yaw_deg=-180.0 world_goal=[2.681, -1.156, -3.241] world_goal_yaw_deg=1.35
19:55:44.204[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.053, -2.648, 0.038], euler=[90.0, 0.0, -116.2])
19:55:44.204[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:44.205[inf][nning_a_star/global_planner.py] Found safe goal. x=1.03 y=-2.67
19:55:44.214[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:44.216[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:55:44.219[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=6
19:55:44.390[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.920, -3.222, 0.027], euler=[90.0, 0.0, -106.8])
19:55:44.391[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:44.391[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.92, -3.222, 0.027] odom_goal_yaw_deg=-180.0 world_goal=[3.347, -1.166, -3.414] world_goal_yaw_deg=10.73
19:55:44.391[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:44.392[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:55:44.392[inf][nning_a_star/global_planner.py] Found safe goal. x=0.88 y=-3.22
19:55:44.403[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:44.408[inf][anning_a_star/local_planner.py] changed state state=path_following
19:55:44.708[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.842, -3.592, 0.049] odom_goal_yaw_deg=-180.0 world_goal=[3.772, -1.145, -3.532] world_goal_yaw_deg=17.49
19:55:44.758[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.842, -3.592, 0.049], euler=[90.0, 0.0, -100.0])
19:55:44.759[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:44.759[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:44.760[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:55:44.761[inf][nning_a_star/global_planner.py] Found safe goal. x=0.83 y=-3.62
19:55:44.772[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:44.779[inf][anning_a_star/local_planner.py] changed state state=path_following
19:55:44.941[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:55:44.942[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
19:55:44.954[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.855, -3.516, 0.049] odom_goal_yaw_deg=-180.0 world_goal=[3.687, -1.145, -3.504] world_goal_yaw_deg=17.77
19:55:44.955[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles resolution=1008x756
19:55:44.968[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.855, -3.516, 0.049], euler=[90.0, 0.0, -99.8])
19:55:44.969[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:44.970[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:44.970[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:55:44.971[inf][nning_a_star/global_planner.py] Found safe goal. x=0.83 y=-3.52
19:55:44.984[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=138858 seq=2
19:55:44.985[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:44.990[inf][anning_a_star/local_planner.py] changed state state=path_following
19:55:45.011[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626944.805441 frame_age_s=0.0964 latest_residual_m=2.1955 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=1.7533 residual_along_track_m=-1.0718 residual_cross_track_m=1.9157 residual_vertical_m=-0.0406 robot_speed_ms=0.254 seq=2 source_ts_gap_s=0.03711 total_rejections=0 window_centroid_residual_m=2.8009
19:55:47.182[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:55:47.184[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:55:47.184[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:55:47.184[inf][anning_a_star/local_planner.py] changed state state=arrived
19:55:47.289[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:47.290[inf][nning_a_star/global_planner.py] Arrived at goal.
19:55:47.292[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 19:55:47.317[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:55:47.317[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.261
19:55:47.318[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.026
19:55:47.325[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=154235 seq=9
19:55:47.380[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626946.972057 frame_age_s=0.0933 latest_residual_m=3.0138 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=2.4009 residual_along_track_m=-2.4149 residual_cross_track_m=1.8027 residual_vertical_m=-0.0442 robot_speed_ms=0.464 seq=9 source_ts_gap_s=0.022325 total_rejections=0 window_centroid_residual_m=3.561
19:55:52.769[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:55:52.771[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=18253.194832
19:55:52.772[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.893, -3.444, -0.02] odom_goal_yaw_deg=180.0 world_goal=[3.592, -1.214, -3.505] world_goal_yaw_deg=7.2
19:55:52.789[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.893, -3.444, -0.020], euler=[90.0, 0.0, -110.3])
19:55:52.790[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:52.791[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.0
19:55:52.791[inf][nning_a_star/global_planner.py] Found safe goal. x=0.88 y=-3.47
19:55:52.800[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:52.802[inf][anning_a_star/local_planner.py] changed state state=path_following
19:55:52.802[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:55:52.802[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:55:52.803[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:55:52.803[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
19:55:52.803[inf][anning_a_star/local_planner.py] changed state state=arrived
19:55:52.905[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:52.906[inf][nning_a_star/global_planner.py] Arrived at goal.
19:55:52.907[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 19:55:52.909[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:55:52.909[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
19:55:53.045[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.717, -3.831, 0.030], euler=[90.0, 0.0, -110.9])
19:55:53.045[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.717, -3.831, 0.03] odom_goal_yaw_deg=-180.0 world_goal=[4.088, -1.164, -3.532] world_goal_yaw_deg=6.65
19:55:53.046[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:53.047[inf][nning_a_star/global_planner.py] Found safe goal. x=0.68 y=-3.87
19:55:53.059[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:53.062[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:55:53.064[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=6
19:55:53.275[inf][anning_a_star/local_planner.py] changed state state=path_following
19:55:53.349[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.591, -4.17, 0.05] odom_goal_yaw_deg=-180.0 world_goal=[4.507, -1.144, -3.584] world_goal_yaw_deg=1.99
19:55:53.350[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.591, -4.170, 0.050], euler=[90.0, 0.0, -115.5])
19:55:53.350[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:53.351[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:53.351[inf][nning_a_star/global_planner.py] Found safe goal. x=0.58 y=-4.17
19:55:53.352[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:55:53.363[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:53.368[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:55:53.662[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.554, -4.224, 0.057] odom_goal_yaw_deg=180.0 world_goal=[4.583, -1.137, -3.576] world_goal_yaw_deg=-13.51
19:55:53.662[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.554, -4.224, 0.057], euler=[90.0, 0.0, -131.0])
19:55:53.663[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:55:53.664[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:53.665[inf][nning_a_star/global_planner.py] Found safe goal. x=0.53 y=-4.22
19:55:53.666[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:55:53.678[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:55:53.680[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:55:54.434[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
19:55:54.436[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles resolution=1008x756
19:55:54.516[inf][anning_a_star/local_planner.py] changed state state=path_following
19:55:54.523[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=201723 seq=2
19:55:54.597[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626954.278117 frame_age_s=0.1049 latest_residual_m=3.2621 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=2.9964 residual_along_track_m=-3.2309 residual_cross_track_m=0.4476 residual_vertical_m=-0.043 robot_speed_ms=0.05 seq=2 source_ts_gap_s=0.054254 total_rejections=0 window_centroid_residual_m=3.7983
19:55:55.863[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
19:55:56.542[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=207055 seq=8
19:55:56.625[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626956.241808 frame_age_s=0.0959 latest_residual_m=3.7082 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=1 residual_along_camera_ray_m=3.4359 residual_along_track_m=-2.9607 residual_cross_track_m=2.2324 residual_vertical_m=-0.0402 robot_speed_ms=0.338 seq=8 source_ts_gap_s=0.012773 total_rejections=1 window_centroid_residual_m=4.2283
19:55:57.162[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:55:57.163[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:55:57.164[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:55:57.164[inf][anning_a_star/local_planner.py] changed state state=arrived
19:55:57.261[inf][anning_a_star/local_planner.py] changed state state=idle
19:55:57.263[inf][nning_a_star/global_planner.py] Arrived at goal.
19:55:57.264[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 19:55:57.265[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:55:57.266[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.26
19:56:02.744[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:56:02.747[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=18263.171038
19:56:02.748[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.611, -4.25, -0.024] odom_goal_yaw_deg=-180.0 world_goal=[4.579, -1.218, -3.649] world_goal_yaw_deg=-16.02
19:56:02.750[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.611, -4.250, -0.024], euler=[90.0, 0.0, -133.6])
19:56:02.751[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:56:02.752[inf][nning_a_star/global_planner.py] Found safe goal. x=0.58 y=-4.27
19:56:02.753[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.001
19:56:02.760[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:56:02.762[inf][anning_a_star/local_planner.py] changed state state=path_following
19:56:02.762[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
19:56:02.763[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:56:02.763[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:56:02.763[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:56:02.764[inf][anning_a_star/local_planner.py] changed state state=arrived
19:56:02.867[inf][anning_a_star/local_planner.py] changed state state=idle
19:56:02.867[inf][nning_a_star/global_planner.py] Arrived at goal.
19:56:02.868[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 19:56:02.870[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:56:02.871[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
19:56:03.133[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.56, -4.154, 0.026] odom_goal_yaw_deg=-180.0 world_goal=[4.507, -1.168, -3.544] world_goal_yaw_deg=-79.88
19:56:03.134[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.560, -4.154, 0.026], euler=[90.0, 0.0, 162.6])
19:56:03.134[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:56:03.135[inf][nning_a_star/global_planner.py] Found safe goal. x=0.53 y=-4.17
19:56:03.143[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:56:03.145[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:56:03.147[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=3
19:56:03.879[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
19:56:03.880[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles resolution=1008x756
19:56:03.936[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=182257 seq=2
19:56:04.041[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626963.804973 frame_age_s=0.1176 latest_residual_m=4.0869 obs_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=3.8264 residual_along_track_m=-0.7352 residual_cross_track_m=4.0199 residual_vertical_m=-0.0465 robot_speed_ms=0.016 seq=2 source_ts_gap_s=0.019443 total_rejections=0 window_centroid_residual_m=4.5724
19:56:04.599[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:56:04.601[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.606, -4.267, -0.014] odom_goal_yaw_deg=-180.0 world_goal=[4.6, -1.208, -3.653] world_goal_yaw_deg=-40.45
19:56:04.602[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.606, -4.267, -0.014], euler=[90.0, 0.0, -158.0])
19:56:04.603[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:56:04.603[inf][anning_a_star/local_planner.py] changed state state=idle
19:56:04.604[inf][nning_a_star/global_planner.py] Found safe goal. x=0.58 y=-4.27
19:56:04.605[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:56:04.613[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:56:04.616[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:56:04.816[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=18265.239892
19:56:04.817[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.562, -3.901, 0.031], euler=[90.0, 0.0, 87.6])
19:56:04.817[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.562, -3.901, 0.031] odom_goal_yaw_deg=0.0 world_goal=[4.244, -1.162, -3.41] world_goal_yaw_deg=-154.87
19:56:04.818[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:56:04.818[inf][anning_a_star/local_planner.py] changed state state=idle
19:56:04.819[inf][nning_a_star/global_planner.py] Found safe goal. x=0.53 y=-3.92
19:56:04.820[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:56:04.829[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:56:04.832[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:56:05.009[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.571, -3.771, 0.027] odom_goal_yaw_deg=180.0 world_goal=[4.105, -1.167, -3.348] world_goal_yaw_deg=-151.77
19:56:05.009[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.571, -3.771, 0.027], euler=[90.0, 0.0, 90.7])
19:56:05.009[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:56:05.010[inf][anning_a_star/local_planner.py] changed state state=idle
19:56:05.011[inf][nning_a_star/global_planner.py] Found safe goal. x=0.53 y=-3.77
19:56:05.011[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:56:05.020[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:56:05.025[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:56:06.417[inf][anning_a_star/local_planner.py] changed state state=path_following
19:56:07.540[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
19:56:07.541[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles resolution=1008x756
19:56:07.616[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=204238 seq=2
19:56:07.681[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626967.172286 frame_age_s=0.1083 latest_residual_m=4.0052 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=3.7534 residual_along_track_m=3.3936 residual_cross_track_m=2.1271 residual_vertical_m=-0.028 robot_speed_ms=0.33 seq=2 source_ts_gap_s=0.009754 total_rejections=0 window_centroid_residual_m=4.4935
19:56:07.945[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
19:56:08.084[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:56:08.087[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:56:08.088[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:56:08.089[inf][anning_a_star/local_planner.py] changed state state=arrived
19:56:08.185[inf][anning_a_star/local_planner.py] changed state state=idle
19:56:08.186[inf][nning_a_star/global_planner.py] Arrived at goal.
19:56:08.187[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
19:56:08.187[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.001
▸ 19:56:08.189[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:56:08.190[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.282
19:56:09.876[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=184902 seq=9
19:56:09.909[war][s/ar/world_frame/transforms.py] gravity_level_transform: input up-axis far from world-up (angle=17.5 deg) — registration input likely malformed; this warning is rate-limited to once per 30 s
19:56:09.913[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626969.604825 frame_age_s=0.1233 latest_residual_m=3.5652 obs_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=3.334 residual_along_track_m=3.565 residual_cross_track_m=0.0032 residual_vertical_m=-0.0326 robot_speed_ms=0.042 seq=9 source_ts_gap_s=0.015192 total_rejections=0 window_centroid_residual_m=4.0612
19:56:11.327[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:56:11.336[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=18271.759799
19:56:11.336[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.619, -3.830, -0.027], euler=[90.0, 0.0, 99.0])
19:56:11.337[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:56:11.338[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.619, -3.83, -0.027] odom_goal_yaw_deg=-180.0 world_goal=[4.141, -1.221, -3.43] world_goal_yaw_deg=-143.5
19:56:11.339[inf][nning_a_star/global_planner.py] Found safe goal. x=0.58 y=-3.87
19:56:11.347[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:56:11.349[inf][anning_a_star/local_planner.py] changed state state=path_following
19:56:11.350[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
19:56:11.350[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:56:11.350[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:56:11.351[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:56:11.351[inf][anning_a_star/local_planner.py] changed state state=arrived
19:56:11.455[inf][anning_a_star/local_planner.py] changed state state=idle
19:56:11.456[inf][nning_a_star/global_planner.py] Arrived at goal.
19:56:11.456[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 19:56:11.457[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:56:11.458[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
19:56:11.618[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.671, -3.78, 0.023] odom_goal_yaw_deg=-0.0 world_goal=[4.06, -1.171, -3.457] world_goal_yaw_deg=168.64
19:56:11.618[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.671, -3.780, 0.023], euler=[90.0, 0.0, 51.1])
19:56:11.619[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:56:11.619[inf][nning_a_star/global_planner.py] Found safe goal. x=0.63 y=-3.82
19:56:11.626[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:56:11.627[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:56:11.628[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=2
19:56:11.937[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.828, -3.514, 0.023] odom_goal_yaw_deg=-0.0 world_goal=[3.7, -1.17, -3.476] world_goal_yaw_deg=-179.38
19:56:11.938[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.828, -3.514, 0.023], euler=[90.0, 0.0, 63.1])
19:56:11.938[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:56:11.938[inf][anning_a_star/local_planner.py] changed state state=idle
19:56:11.939[inf][nning_a_star/global_planner.py] Found safe goal. x=0.83 y=-3.52
19:56:11.940[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:56:11.948[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:56:11.961[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:56:12.694[inf][anning_a_star/local_planner.py] changed state state=path_following
19:56:13.237[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
19:56:13.238[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles resolution=1008x756
19:56:13.275[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=169296 seq=2
19:56:13.325[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626973.104735 frame_age_s=0.1068 latest_residual_m=3.5378 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=3.3511 residual_along_track_m=2.6102 residual_cross_track_m=2.3877 residual_vertical_m=-0.0396 robot_speed_ms=0.194 seq=2 source_ts_gap_s=0.06037 total_rejections=0 window_centroid_residual_m=4.0372
19:56:13.627[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:56:13.628[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:56:13.629[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:56:13.629[inf][anning_a_star/local_planner.py] changed state state=arrived
19:56:13.732[inf][anning_a_star/local_planner.py] changed state state=idle
19:56:13.733[inf][nning_a_star/global_planner.py] Arrived at goal.
19:56:13.733[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
19:56:13.733[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.001
▸ 19:56:13.748[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:56:13.749[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.29
19:56:14.542[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
19:56:29.205[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:56:29.208[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=18289.631524
19:56:29.209[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.805, -3.589, -0.019] odom_goal_yaw_deg=-0.0 world_goal=[3.789, -1.213, -3.493] world_goal_yaw_deg=172.71
19:56:29.209[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.805, -3.589, -0.019], euler=[90.0, 0.0, 55.2])
19:56:29.210[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:56:29.211[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.001
19:56:29.212[inf][nning_a_star/global_planner.py] Found safe goal. x=0.78 y=-3.62
19:56:29.225[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:56:29.228[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
19:56:29.229[inf][anning_a_star/local_planner.py] changed state state=path_following
19:56:29.229[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:56:29.229[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:56:29.230[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:56:29.230[inf][anning_a_star/local_planner.py] changed state state=arrived
19:56:29.343[inf][anning_a_star/local_planner.py] changed state state=idle
19:56:29.344[inf][nning_a_star/global_planner.py] Arrived at goal.
19:56:29.344[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 19:56:29.345[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:56:29.346[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
19:56:29.525[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.926, -3.324, 0.031] odom_goal_yaw_deg=0.0 world_goal=[3.45, -1.163, -3.475] world_goal_yaw_deg=-169.13
19:56:29.578[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.926, -3.324, 0.031], euler=[90.0, 0.0, 73.3])
19:56:29.582[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:56:29.584[inf][nning_a_star/global_planner.py] Found safe goal. x=0.93 y=-3.32
19:56:29.594[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:56:29.609[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:56:29.644[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=5
19:56:30.182[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.862, -3.155, 0.031] odom_goal_yaw_deg=180.0 world_goal=[3.309, -1.163, -3.318] world_goal_yaw_deg=-125.45
19:56:30.193[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.861, -3.126, 0.032] odom_goal_yaw_deg=-180.0 world_goal=[3.279, -1.162, -3.301] world_goal_yaw_deg=-138.93
19:56:30.206[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.862, -3.155, 0.031], euler=[90.0, 0.0, 117.0])
19:56:30.206[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:56:30.208[inf][anning_a_star/local_planner.py] changed state state=idle
19:56:30.208[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:56:30.211[inf][nning_a_star/global_planner.py] Found safe goal. x=0.83 y=-3.17
19:56:30.233[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:56:30.237[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:56:30.238[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.861, -3.126, 0.032], euler=[90.0, 0.0, 103.5])
19:56:30.238[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:56:30.240[inf][anning_a_star/local_planner.py] changed state state=idle
19:56:30.240[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:56:30.241[inf][nning_a_star/global_planner.py] Found safe goal. x=0.83 y=-3.17
19:56:30.319[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:56:30.323[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:56:31.039[inf][anning_a_star/local_planner.py] changed state state=path_following
19:56:31.794[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
19:56:31.795[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles resolution=1008x756
19:56:31.819[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=176352 seq=2
19:56:31.850[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626991.537613 frame_age_s=0.1433 latest_residual_m=3.2603 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=1 residual_along_camera_ray_m=3.0849 residual_along_track_m=3.1239 residual_cross_track_m=0.9329 residual_vertical_m=-0.028 robot_speed_ms=0.188 seq=2 source_ts_gap_s=0.006406 total_rejections=1 window_centroid_residual_m=3.7849
19:56:32.063[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:56:32.064[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:56:32.065[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:56:32.065[inf][anning_a_star/local_planner.py] changed state state=arrived
19:56:32.167[inf][anning_a_star/local_planner.py] changed state state=idle
19:56:32.170[inf][nning_a_star/global_planner.py] Arrived at goal.
19:56:32.171[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 19:56:32.226[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:56:32.227[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.284
19:56:37.409[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:56:37.413[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=18297.836645
19:56:37.414[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.791, -3.229, -0.017], euler=[90.0, -0.0, 85.6])
19:56:37.415[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.791, -3.229, -0.017] odom_goal_yaw_deg=-0.0 world_goal=[3.424, -1.21, -3.284] world_goal_yaw_deg=-156.83
19:56:37.417[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:56:37.421[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.002
19:56:37.422[inf][nning_a_star/global_planner.py] Found safe goal. x=0.78 y=-3.27
19:56:37.433[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:56:37.434[inf][anning_a_star/local_planner.py] changed state state=path_following
19:56:37.434[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:56:37.434[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:56:37.435[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:56:37.435[inf][anning_a_star/local_planner.py] changed state state=arrived
19:56:37.435[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
19:56:37.537[inf][anning_a_star/local_planner.py] changed state state=idle
19:56:37.538[inf][nning_a_star/global_planner.py] Arrived at goal.
19:56:37.539[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 19:56:37.540[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:56:37.540[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
19:56:37.660[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.136, -2.68, 0.034] odom_goal_yaw_deg=-0.0 world_goal=[2.669, -1.16, -3.345] world_goal_yaw_deg=179.89
19:56:37.661[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.136, -2.680, 0.034], euler=[90.0, 0.0, 62.4])
19:56:37.662[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:56:37.663[inf][nning_a_star/global_planner.py] Found safe goal. x=1.13 y=-2.72
19:56:37.674[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:56:37.677[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:56:37.680[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=9
19:56:38.028[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.329, -2.283, 0.066] odom_goal_yaw_deg=-0.0 world_goal=[2.153, -1.128, -3.331] world_goal_yaw_deg=-178.73
19:56:38.054[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.329, -2.283, 0.066], euler=[90.0, 0.0, 63.7])
19:56:38.055[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:56:38.056[inf][anning_a_star/local_planner.py] changed state state=idle
19:56:38.056[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:56:38.058[inf][nning_a_star/global_planner.py] Found safe goal. x=1.33 y=-2.32
19:56:38.069[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:56:38.075[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:56:38.409[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.502, -1.742, 0.053] odom_goal_yaw_deg=-0.0 world_goal=[1.498, -1.141, -3.217] world_goal_yaw_deg=-169.57
19:56:38.437[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.502, -1.742, 0.053], euler=[90.0, 0.0, 72.9])
19:56:38.438[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:56:38.439[inf][anning_a_star/local_planner.py] changed state state=idle
19:56:38.440[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:56:38.440[inf][nning_a_star/global_planner.py] Found safe goal. x=1.48 y=-1.77
19:56:38.463[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:56:38.470[inf][anning_a_star/local_planner.py] changed state state=path_following
19:56:38.714[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:56:38.718[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.555, -1.464, 0.052], euler=[90.0, 0.0, 80.2])
19:56:38.718[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.555, -1.464, 0.052] odom_goal_yaw_deg=-0.0 world_goal=[1.182, -1.142, -3.122] world_goal_yaw_deg=-162.25
19:56:38.721[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:56:38.722[inf][anning_a_star/local_planner.py] changed state state=idle
19:56:38.723[inf][nning_a_star/global_planner.py] Found safe goal. x=1.53 y=-1.47
19:56:38.723[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:56:38.744[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:56:38.780[inf][anning_a_star/local_planner.py] changed state state=path_following
19:56:39.036[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
19:56:39.038[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles resolution=1008x756
19:56:39.039[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.542, -1.512, 0.070], euler=[90.0, 0.0, 160.6])
19:56:39.039[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:56:39.040[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.542, -1.512, 0.07] odom_goal_yaw_deg=-180.0 world_goal=[1.239, -1.124, -3.135] world_goal_yaw_deg=-81.85
19:56:39.040[inf][anning_a_star/local_planner.py] changed state state=idle
19:56:39.041[inf][nning_a_star/global_planner.py] Found safe goal. x=1.53 y=-1.52
19:56:39.041[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:56:39.061[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:56:39.066[inf][anning_a_star/local_planner.py] changed state state=path_following
19:56:39.332[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=164038 seq=2
19:56:39.361[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783626999.004096 frame_age_s=0.0946 latest_residual_m=2.8988 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=1 residual_along_camera_ray_m=2.6973 residual_along_track_m=2.8844 residual_cross_track_m=0.2867 residual_vertical_m=-0.0341 robot_speed_ms=0.07 seq=2 source_ts_gap_s=0.00944 total_rejections=1 window_centroid_residual_m=3.43
19:56:41.395[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=161618 seq=8
19:56:41.418[war][s/ar/world_frame/transforms.py] gravity_level_transform: input up-axis far from world-up (angle=17.5 deg) — registration input likely malformed; this warning is rate-limited to once per 30 s
19:56:41.422[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783627001.070712 frame_age_s=0.108 latest_residual_m=2.3238 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=2.1422 residual_along_track_m=1.2945 residual_cross_track_m=1.9296 residual_vertical_m=-0.0342 robot_speed_ms=0.541 seq=8 source_ts_gap_s=0.032672 total_rejections=0 window_centroid_residual_m=2.8974
19:56:42.209[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
19:56:42.925[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:56:42.927[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:56:43.427[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=128089 seq=15
19:56:43.481[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783627003.270656 frame_age_s=0.0799 latest_residual_m=1.8361 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=1.4352 residual_along_track_m=0.5477 residual_cross_track_m=1.752 residual_vertical_m=-0.0412 robot_speed_ms=0.084 seq=15 source_ts_gap_s=0.045018 total_rejections=0 window_centroid_residual_m=2.4396
19:56:44.598[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:56:44.599[inf][anning_a_star/local_planner.py] changed state state=arrived
19:56:44.703[inf][anning_a_star/local_planner.py] changed state state=idle
19:56:44.704[inf][nning_a_star/global_planner.py] Arrived at goal.
19:56:44.704[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.001
19:56:44.704[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 19:56:44.705[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:56:44.706[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.269
19:56:46.121[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:56:46.123[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=18306.546125
19:56:46.123[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.412, -1.585, -0.023], euler=[90.0, 0.0, 146.6])
19:56:46.123[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:56:46.124[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.412, -1.585, -0.023] odom_goal_yaw_deg=-180.0 world_goal=[1.385, -1.217, -3.039] world_goal_yaw_deg=-95.82
19:56:46.124[inf][nning_a_star/global_planner.py] Found safe goal. x=1.38 y=-1.62
19:56:46.131[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:56:46.131[inf][anning_a_star/local_planner.py] changed state state=path_following
19:56:46.132[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:56:46.133[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:56:46.133[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:56:46.133[inf][anning_a_star/local_planner.py] changed state state=arrived
19:56:46.151[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
19:56:46.233[inf][anning_a_star/local_planner.py] changed state state=idle
19:56:46.234[inf][nning_a_star/global_planner.py] Arrived at goal.
19:56:46.234[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 19:56:46.235[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:56:46.236[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
19:56:46.412[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[1.083, -1.446, 0.027] odom_goal_yaw_deg=-180.0 world_goal=[1.418, -1.167, -2.623] world_goal_yaw_deg=-87.04
19:56:46.422[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[1.083, -1.446, 0.027], euler=[90.0, 0.0, 155.4])
19:56:46.422[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:56:46.424[inf][nning_a_star/global_planner.py] Found safe goal. x=1.08 y=-1.37
19:56:46.435[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:56:46.442[inf][anning_a_star/local_planner.py] changed state state=path_following
19:56:46.471[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=5
19:56:46.998[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
19:56:47.006[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[0.522, -1.181, 0.041], euler=[90.0, 0.0, 156.2])
19:56:47.001[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[0.522, -1.181, 0.041] odom_goal_yaw_deg=-180.0 world_goal=[1.446, -1.152, -1.898] world_goal_yaw_deg=-86.31
19:56:47.007[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:56:47.007[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles resolution=1008x756
19:56:47.007[inf][anning_a_star/local_planner.py] changed state state=idle
19:56:47.008[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:56:47.009[inf][nning_a_star/global_planner.py] Found safe goal. x=0.48 y=-1.27
19:56:47.021[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:56:47.025[inf][anning_a_star/local_planner.py] changed state state=path_following
19:56:47.085[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=154000 seq=2
19:56:47.181[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783627006.875211 frame_age_s=0.1007 latest_residual_m=1.7093 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=1.393 residual_along_track_m=1.709 residual_cross_track_m=0.007 residual_vertical_m=-0.0299 robot_speed_ms=0.202 seq=2 source_ts_gap_s=0.016026 total_rejections=0 window_centroid_residual_m=2.3148
19:56:47.184[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:56:47.190[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.032, -0.927, 0.036] odom_goal_yaw_deg=180.0 world_goal=[1.483, -1.158, -1.187] world_goal_yaw_deg=-87.56
19:56:47.190[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.032, -0.927, 0.036], euler=[90.0, 0.0, 154.9])
19:56:47.190[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:56:47.191[inf][anning_a_star/local_planner.py] changed state state=idle
19:56:47.191[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:56:47.192[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.07 y=-0.97
19:56:47.261[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:56:47.267[inf][anning_a_star/local_planner.py] changed state state=path_following
19:56:47.523[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.299, -0.683, 0.1] odom_goal_yaw_deg=-180.0 world_goal=[1.374, -1.094, -0.779] world_goal_yaw_deg=-105.09
19:56:47.523[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.299, -0.683, 0.100], euler=[90.0, 0.0, 137.4])
19:56:47.524[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:56:47.524[inf][anning_a_star/local_planner.py] changed state state=idle
19:56:47.525[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:56:47.525[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.32 y=-0.72
19:56:47.550[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:56:47.557[inf][anning_a_star/local_planner.py] changed state state=path_following
19:56:47.613[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.365, -0.622, 0.103] odom_goal_yaw_deg=-180.0 world_goal=[1.347, -1.091, -0.677] world_goal_yaw_deg=-104.89
19:56:47.613[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.365, -0.622, 0.103], euler=[90.0, 0.0, 137.6])
19:56:47.614[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:56:47.614[inf][anning_a_star/local_planner.py] changed state state=idle
19:56:47.615[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:56:47.616[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.37 y=-0.62
19:56:47.642[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:56:47.656[inf][anning_a_star/local_planner.py] changed state state=path_following
19:56:48.457[inf][os/ar/network/ws_send_queue.py] AR WebSocket outbound backlog coalesce_pending=1 dropped_fifo=0 fifo_depth=0
19:56:49.189[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=140946 seq=8
19:56:49.211[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783627008.972657 frame_age_s=0.1084 latest_residual_m=1.2107 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=1.0236 residual_along_track_m=1.1574 residual_cross_track_m=0.3533 residual_vertical_m=-0.0367 robot_speed_ms=0.442 seq=8 source_ts_gap_s=0.254886 total_rejections=0 window_centroid_residual_m=1.8228
19:56:51.447[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=159531 seq=16
19:56:51.528[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783627010.941857 frame_age_s=0.1022 latest_residual_m=1.1898 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.9145 residual_along_track_m=1.1266 residual_cross_track_m=0.3813 residual_vertical_m=-0.0317 robot_speed_ms=1.688 seq=16 source_ts_gap_s=2.224086 total_rejections=0 window_centroid_residual_m=1.8023
19:56:53.795[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=123386 seq=22
19:56:53.817[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783627013.137799 frame_age_s=0.1116 latest_residual_m=0.6183 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.2664 residual_along_track_m=0.4092 residual_cross_track_m=0.4618 residual_vertical_m=-0.0401 robot_speed_ms=0.344 seq=22 source_ts_gap_s=0.026369 total_rejections=0 window_centroid_residual_m=1.1401
19:56:54.911[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:56:54.912[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:56:54.912[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:56:54.912[inf][anning_a_star/local_planner.py] changed state state=arrived
19:56:55.015[inf][anning_a_star/local_planner.py] changed state state=idle
19:56:55.016[inf][nning_a_star/global_planner.py] Arrived at goal.
19:56:55.016[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.0
19:56:55.016[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 19:56:55.017[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:56:55.017[inf][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.208
19:56:55.796[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=131298 seq=28
19:56:56.112[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783627015.840689 frame_age_s=0.0817 latest_residual_m=0.5982 obs_added=0 regime=static rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=1 residual_along_camera_ray_m=0.135 residual_along_track_m=-0.3813 residual_cross_track_m=0.4589 residual_vertical_m=-0.0425 robot_speed_ms=0.002 seq=29 source_ts_gap_s=0.010954 total_rejections=1 window_centroid_residual_m=0.3312
19:56:57.788[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:56:57.790[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=18318.213629
19:56:57.791[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.345, -0.535, 0.032], euler=[90.0, -0.0, 98.3])
19:56:57.791[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:56:57.791[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.345, -0.535, 0.032] odom_goal_yaw_deg=-180.0 world_goal=[1.245, -1.162, -0.65] world_goal_yaw_deg=-144.19
19:56:57.792[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.388, -0.705, -0.018] odom_goal_yaw_deg=-180.0 world_goal=[1.444, -1.212, -0.698] world_goal_yaw_deg=-123.52
19:56:57.792[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.37 y=-0.57
19:56:57.800[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:56:57.801[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.388, -0.705, -0.018], euler=[90.0, 0.0, 118.9])
19:56:57.802[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:56:57.802[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:56:57.802[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=3
19:56:57.803[inf][anning_a_star/local_planner.py] changed state state=idle
19:56:57.804[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.42 y=-0.72
19:56:57.804[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:56:57.813[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:56:57.835[inf][anning_a_star/local_planner.py] changed state state=path_following
19:56:57.836[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:56:57.836[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:56:57.836[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:56:57.837[inf][anning_a_star/local_planner.py] changed state state=arrived
19:56:57.937[inf][anning_a_star/local_planner.py] changed state state=idle
19:56:57.941[inf][nning_a_star/global_planner.py] Arrived at goal.
19:56:57.942[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 19:56:57.969[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:56:57.970[war][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.33
19:56:58.104[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.412, -0.281, 0.032] odom_goal_yaw_deg=180.0 world_goal=[1.018, -1.162, -0.444] world_goal_yaw_deg=-131.09
19:56:58.105[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.412, -0.281, 0.032], euler=[90.0, 0.0, 111.4])
19:56:58.106[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:56:58.107[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.42 y=-0.32
19:56:58.117[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:56:58.123[inf][anning_a_star/local_planner.py] changed state state=path_following
19:56:58.127[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=7
19:56:58.525[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.536, -0.115, 0.050], euler=[90.0, 0.0, 127.0])
19:56:58.526[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.536, -0.115, 0.05] odom_goal_yaw_deg=-180.0 world_goal=[0.913, -1.144, -0.226] world_goal_yaw_deg=-115.43
19:56:58.527[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:56:58.527[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.521, -0.136, 0.055] odom_goal_yaw_deg=180.0 world_goal=[0.927, -1.139, -0.253] world_goal_yaw_deg=-117.46
19:56:58.528[inf][anning_a_star/local_planner.py] changed state state=idle
19:56:58.529[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.57 y=-0.12
19:56:58.529[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:56:58.541[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:56:58.544[inf][anning_a_star/local_planner.py] changed state state=path_following
19:56:58.545[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.521, -0.136, 0.055], euler=[90.0, 0.0, 125.0])
19:56:58.546[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:56:58.547[inf][anning_a_star/local_planner.py] changed state state=idle
19:56:58.548[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:56:58.548[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.52 y=-0.17
19:56:58.572[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:56:58.575[inf][anning_a_star/local_planner.py] changed state state=path_following
19:56:59.076[inf][ar/network/websocket_server.py] AR inbound text message type=camera_info
19:56:59.077[inf][tion/session/session_frames.py] AR camera intrinsics received device=spectacles resolution=1008x756
19:56:59.216[inf][ar/network/websocket_server.py] AR camera frame received jpeg_bytes=136425 seq=2
19:56:59.240[inf][s/ar/world_frame/refinement.py] moving_robot_diag capture_ts_robot=1783627018.736938 frame_age_s=0.1092 latest_residual_m=0.6691 obs_added=0 regime=moving rej_distance=0 rej_innovation=0 rej_mount_residual=0 rej_reprojection=0 rej_skew=0 rej_up_tilt=0 residual_along_camera_ray_m=0.1588 residual_along_track_m=-0.4271 residual_cross_track_m=0.5139 residual_vertical_m=-0.0339 robot_speed_ms=0.339 seq=2 source_ts_gap_s=0.026636 total_rejections=0 window_centroid_residual_m=0.287
19:56:59.515[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:56:59.515[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:57:00.031[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:57:00.033[inf][anning_a_star/local_planner.py] changed state state=arrived
19:57:00.136[inf][anning_a_star/local_planner.py] changed state state=idle
19:57:00.137[inf][nning_a_star/global_planner.py] Arrived at goal.
19:57:00.137[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.001
19:57:00.139[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=True but_will_try_again=False
▸ 19:57:00.141[inf][imos/ar/navigation/navigate.py] AR navigation goal reached
19:57:00.141[inf][imos/ar/navigation/navigate.py] AR navigation arrival shortfall arrival_shortfall_m=0.249
19:57:13.821[inf][ar/network/websocket_server.py] AR inbound text message type=set_lidar_mode
19:57:13.822[inf][r/dimos/ar/bridge/telemetry.py] LiDAR mode updated mode=obstacles obstacle_max_distance_m=0.8 obstacle_min_distance_m=0.1 obstacle_opaque_distance_m=0.5
19:57:14.044[inf][r/dimos/ar/bridge/telemetry.py] LiDAR stream active hz=1.0
19:57:14.046[deb][r/dimos/ar/bridge/telemetry.py] LiDAR payload bytes=47 hz=1.0 points=7
19:57:15.240[inf][ar/network/websocket_server.py] AR inbound text message type=set_lidar_mode
19:57:15.241[inf][r/dimos/ar/bridge/telemetry.py] LiDAR mode updated mode=full obstacle_max_distance_m=0.8 obstacle_min_distance_m=0.1 obstacle_opaque_distance_m=0.5
19:57:21.699[inf][ar/network/websocket_server.py] AR inbound text message type=nav_goal
19:57:21.709[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=send_nav_goal publish_mono=18342.132538
19:57:21.710[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.521, -0.215, -0.026] odom_goal_yaw_deg=-180.0 world_goal=[1.008, -1.22, -0.295] world_goal_yaw_deg=-137.61
19:57:21.714[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.766, -0.563, 0.024] odom_goal_yaw_deg=-180.0 world_goal=[1.501, -1.17, -0.23] world_goal_yaw_deg=-25.08
19:57:21.721[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.521, -0.215, -0.026], euler=[90.0, 0.0, 104.9])
19:57:21.723[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:57:21.725[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.52 y=-0.22
19:57:21.724[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.001
19:57:21.733[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:57:21.735[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.766, -0.563, 0.024], euler=[90.0, 0.0, -142.6])
19:57:21.735[inf][imos/ar/navigation/navigate.py] AR navigation navigating path_waypoints=1
19:57:21.736[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:57:21.736[inf][anning_a_star/local_planner.py] changed state state=path_following
19:57:21.736[inf][anning_a_star/local_planner.py] Reached goal position, starting final rotation
19:57:21.737[inf][anning_a_star/local_planner.py] changed state state=final_rotation
19:57:21.737[inf][anning_a_star/local_planner.py] Final rotation complete, goal reached
19:57:21.737[inf][anning_a_star/local_planner.py] changed state state=arrived
19:57:21.737[inf][anning_a_star/local_planner.py] changed state state=idle
19:57:21.738[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.77 y=-0.57
19:57:21.739[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:57:21.744[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:57:21.749[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:57:21.811[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-1.123, -0.541, 0.039], euler=[90.0, 0.0, 173.0])
19:57:21.812[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:57:21.813[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.964, -0.285, 0.024] odom_goal_yaw_deg=-0.0 world_goal=[1.32, -1.17, 0.126] world_goal_yaw_deg=171.88
19:57:21.813[inf][anning_a_star/local_planner.py] changed state state=idle
19:57:21.814[inf][nning_a_star/global_planner.py] Found safe goal. x=-1.12 y=-0.57
19:57:21.814[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:57:21.814[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-0.978, -0.307, 0.024] odom_goal_yaw_deg=0.0 world_goal=[1.351, -1.17, 0.129] world_goal_yaw_deg=-177.52
19:57:21.815[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-1.123, -0.541, 0.039] odom_goal_yaw_deg=-180.0 world_goal=[1.672, -1.155, 0.153] world_goal_yaw_deg=-69.45
🕒 Signaling State          : ⚫ closed        (21:57:21)
19:57:21.816[inf][imos/ar/navigation/navigate.py] AR navigation goal published odom_goal=[-1.069, -0.434, 0.018] odom_goal_yaw_deg=-0.0 world_goal=[1.531, -1.175, 0.155] world_goal_yaw_deg=147.9
19:57:21.821[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
ERROR:root:Error in callback <function UnitreeWebRTCConnection.raw_video_stream.<locals>.accept_track at 0x13bd16fc0>: 
19:57:21.823[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:57:21.823[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-1.069, -0.434, 0.018], euler=[90.0, 0.0, 30.4])
19:57:21.824[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:57:21.824[inf][anning_a_star/local_planner.py] changed state state=idle
19:57:21.824[inf][nning_a_star/global_planner.py] Found safe goal. x=-1.07 y=-0.47
19:57:21.825[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
ERROR:asyncio:Task exception was never retrieved
future: <Task finished name='Task-32392' coro=<RTCSctpTransport._data_channel_flush() done, defined at /Users/johannestscharn/repositories/dimos/.venv/lib/python3.12/site-packages/aiortc/rtcsctptransport.py:1654> exception=ConnectionError('Cannot send encrypted data, not connected')>
Traceback (most recent call last):
  File "/Users/johannestscharn/repositories/dimos/.venv/lib/python3.12/site-packages/aiortc/rtcsctptransport.py", line 1685, in _data_channel_flush
    await self._send(
  File "/Users/johannestscharn/repositories/dimos/.venv/lib/python3.12/site-packages/aiortc/rtcsctptransport.py", line 1340, in _send
    await self._transmit()
  File "/Users/johannestscharn/repositories/dimos/.venv/lib/python3.12/site-packages/aiortc/rtcsctptransport.py", line 1566, in _transmit
    await self._send_chunk(chunk)
  File "/Users/johannestscharn/repositories/dimos/.venv/lib/python3.12/site-packages/aiortc/rtcsctptransport.py", line 1347, in _send_chunk
    await self.__transport._send_data(
  File "/Users/johannestscharn/repositories/dimos/.venv/lib/python3.12/site-packages/aiortc/rtcdtlstransport.py", line 701, in _send_data
    raise ConnectionError("Cannot send encrypted data, not connected")
ConnectionError: Cannot send encrypted data, not connected
19:57:21.831[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
ERROR:asyncio:Task exception was never retrieved
future: <Task finished name='Task-32398' coro=<RTCSctpTransport._data_channel_flush() done, defined at /Users/johannestscharn/repositories/dimos/.venv/lib/python3.12/site-packages/aiortc/rtcsctptransport.py:1654> exception=ConnectionError('Cannot send encrypted data, not connected')>
Traceback (most recent call last):
  File "/Users/johannestscharn/repositories/dimos/.venv/lib/python3.12/site-packages/aiortc/rtcsctptransport.py", line 1685, in _data_channel_flush
    await self._send(
  File "/Users/johannestscharn/repositories/dimos/.venv/lib/python3.12/site-packages/aiortc/rtcsctptransport.py", line 1340, in _send
    await self._transmit()
  File "/Users/johannestscharn/repositories/dimos/.venv/lib/python3.12/site-packages/aiortc/rtcsctptransport.py", line 1566, in _transmit
    await self._send_chunk(chunk)
  File "/Users/johannestscharn/repositories/dimos/.venv/lib/python3.12/site-packages/aiortc/rtcsctptransport.py", line 1347, in _send_chunk
    await self.__transport._send_data(
  File "/Users/johannestscharn/repositories/dimos/.venv/lib/python3.12/site-packages/aiortc/rtcdtlstransport.py", line 701, in _send_data
    raise ConnectionError("Cannot send encrypted data, not connected")
ConnectionError: Cannot send encrypted data, not connected
🕒 ICE Connection State     : ⚫ closed        (21:57:21)
19:57:21.833[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
🕒 Peer Connection State    : ⚫ closed        (21:57:21)
19:57:21.833[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.964, -0.285, 0.024], euler=[90.0, 0.0, 54.4])
19:57:21.834[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:57:21.834[inf][anning_a_star/local_planner.py] changed state state=idle
19:57:21.835[inf][nning_a_star/global_planner.py] Found safe goal. x=-0.97 y=-0.32
19:57:21.835[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:57:21.841[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:57:21.843[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:57:21.844[inf][nning_a_star/global_planner.py] Got new goal goal=PoseStamped(pos=[-0.978, -0.307, 0.024], euler=[90.0, 0.0, 64.9])
19:57:21.845[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=True
19:57:21.845[inf][anning_a_star/local_planner.py] changed state state=idle
19:57:21.846[inf][nning_a_star/global_planner.py] Found safe goal. x=-1.02 y=-0.32
19:57:21.847[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:57:21.853[inf][nning_a_star/global_planner.py] Found path 1.1x robot width.
19:57:21.855[inf][anning_a_star/local_planner.py] changed state state=initial_rotation
19:57:26.927[inf][os/ar/bridge/status_service.py] bridge connectivity updated reconnecting=True robot_connected=False streams_active=False
19:57:27.456[inf][os/ar/bridge/status_service.py] bridge connectivity updated reconnecting=False robot_connected=False streams_active=False
19:57:30.114[war][imos/ar/navigation/navigate.py] AR navigation goal stalled stall_reason=no_path
19:57:30.118[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=0.0
19:57:30.124[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=cancel_nav_goal publish_mono=18350.546856
19:57:30.136[inf][nning_a_star/global_planner.py] Cancelling goal. arrived=False but_will_try_again=False
19:57:30.144[inf][anning_a_star/local_planner.py] changed state state=idle
19:57:30.144[inf][anning_a_star/local_planner.py] Local planner loop exited due to stop event.
19:57:30.144[inf][imos/ar/navigation/navigate.py] AR navigation path age age_s=0.002
19:57:49.678[inf][s-ar/dimos/ar/bridge/safety.py] AR client disconnect handled nav_reset=true registration_cleared=true
19:57:49.680[inf][mos/ar/bridge/motion_router.py] joystick republisher Hz hz=0.1
19:57:49.683[inf][mos/ar/bridge/motion_router.py] motion router direct publish method=emergency_stop publish_mono=18370.106365
19:57:49.685[inf][s-ar/dimos/ar/bridge/module.py] dimos-ar bridge last client disconnected lidar_mode_reset=true
19:57:49.686[inf][r/dimos/ar/bridge/telemetry.py] LiDAR mode updated mode=off obstacle_max_distance_m=0.8 obstacle_min_distance_m=0.1 obstacle_opaque_distance_m=0.5
19:57:49.697[err][imos/protocol/rpc/pubsubrpc.py] Exception in RPC handler for GO2Connection/publish_request: Data channel is not open
19:57:49.717[err][imos/protocol/rpc/pubsubrpc.py] Exception in RPC handler for Go2RobotProfileModule/emergency_stop: Data channel is not open
