<h1 align="center">Spectacles AR for Robotics and Physical AI</h1>

<p align="center">
  <a href="https://github.com/V4C38/spectacles-dimensional-os"><img src="https://img.shields.io/badge/GitHub-repo-181717?style=flat-square&logo=github&logoColor=white" alt="GitHub"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/V4C38/spectacles-dimensional-os?style=flat-square" alt="MIT License"></a>
  <a href="https://github.com/V4C38/spectacles-dimensional-os/stargazers"><img src="https://img.shields.io/github/stars/V4C38/spectacles-dimensional-os?style=flat-square" alt="Stars"></a>
  <a href="https://github.com/V4C38/spectacles-dimensional-os/network/members"><img src="https://img.shields.io/github/forks/V4C38/spectacles-dimensional-os?style=flat-square" alt="Forks"></a>
  <a href="https://github.com/V4C38/spectacles-dimensional-os/graphs/contributors"><img src="https://img.shields.io/github/contributors/V4C38/spectacles-dimensional-os?style=flat-square" alt="Contributors"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-Lens-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Python-bridge-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python">
</p>

<p>
  This project explores the use of <b>Augmented Reality as an interface for robotics and physical AI</b> in the context of navigation tasks and sensor data visualization. <br>
  AR glasses: <b>Snap Spectacles</b> 2024 developer kit. Robot: <b>Unitree Go2 quadruped or G1 humanoid</b>. Controlled via <a href="https://github.com/dimensionalOS/dimos">Dimensional OS</a> which handles the entire physical stack, incl. navigation and LiDAR data streaming.
</p>

<p align="center">
  <a href="#setup">Setup</a> •
  <a href="#system-design">System Design</a> •
  <a href="#augmented-reality-interface">Augmented Reality Interface</a> •
  <a href="#pose-drift">Pose Drift</a>
</p>


<p align="center">
  <img src="assets/specs_dimos_hero.gif" alt="Spectacles AR manual control of a Unitree Go2" width="800" />
</p>


<a id="prerequisites"></a>

### Supported Hardware

<table align="center">
  <tr>
    <th>Quadruped</th>
    <th>Humanoid</th>
  </tr>
  <tr>
    <td>🟩 Unitree Go2 pro/air<br><sub>Fully supported &amp; tested</sub></td>
    <td>🟧 Unitree G1<br><sub>Supported, not tested - looking for collaborators</sub></td>
  </tr>
</table>


<a id="setup"></a>

### Setup

Mac which runs DimOS, Spectacles AR glasses and the robot need to be on the <b>same WiFi</b> with a stable internet connection. 

<a id="vialauncher"></a>
<details open>
<summary><strong>Via launcher (recommended)</strong></summary>


<img src="assets/specs_dimos_bridgelauncher.png" alt="DimOS AR Bridge launcher: robot stack, Bridge IP, OPENAI_API_KEY, AprilTags, and log" width="640" />


The launcher is a small web app that runs on your Mac and manages <b>Dimensional OS</b> and the <b>AR Bridge</b> in a clean UI. <br> It installs and configures both if needed, handles robot network discovery, generates and configures the <b>AprilTag</b> settings, and starts or stops the bridge. The <b>Log</b> also shows detailed output which is useful for debugging.


Double-click [`launcher/Start Launcher.command`](launcher/Start%20Launcher.command) in Finder, or run:

```bash
cd /path/to/spectacles-dimensional-os
./launcher/scripts/start-launcher.sh
```

Your browser opens at `http://127.0.0.1:8790`. Leave the terminal window it started from open, closing it stops the launcher.

The **Dependencies** tab allows installing and configuring dependencies based on your selected stack (Go2 / G1), choose whether to reuse a Dimensional OS install you already have or download a fresh one, then press **Install**. This can take a while.

**Every run:** pick **Unitree Go2** or **Unitree G1**, press **Start**, and wait for status to turn to **Bridge Ready**. The value shown as **Bridge IP** is the address you type into the Lens during the setup wizard. If no robot answers on the network, the bridge starts with a simulated robot instead.

macOS asks for your admin password the first time you start after a reboot. Dimensional OS needs a local network route and larger socket buffers for its internal messaging.

</details>

<a id="manual-install"></a>
<details>
<summary><strong>Via manual install</strong></summary>

The launcher runs two scripts, and you can run them yourself.

[`launcher/scripts/setup.sh`](launcher/scripts/setup.sh) locates a Dimensional OS install or clones one into `../dimos`, then installs this repo's `dimos-ar` package into that same Python environment and runs its tests. Add `--stack g1` if you need the G1 navigation stack, which requires Dimensional OS from source.

```bash
./launcher/scripts/setup.sh
```

[`launcher/scripts/start.sh`](launcher/scripts/start.sh) applies the macOS network settings, asks which robot stack to run, looks for the robot on the network, and boots the bridge on port **8787**. The log prints the address to enter on Spectacles. Set `OPENAI_API_KEY` beforehand if you want Agent Mode, and `ROBOT_IP` to skip discovery.

```bash
./launcher/scripts/start.sh
```

To skip the scripts entirely, install [Dimensional OS](https://github.com/dimensionalOS/dimos) yourself, add `dimos-ar` to the same environment, and start the blueprint:

```bash
cd /path/to/spectacles-dimensional-os/dimos-ar
/path/to/dimos/.venv/bin/python3 -m pip install -e ".[dev]"

sudo ../launcher/scripts/configure-system.sh --apply

export ROBOT_IP=<robot-lan-ip>   # or "fake" for a simulated robot
/path/to/dimos/.venv/bin/python3 -c "
from dimos.core.coordination.module_coordinator import ModuleCoordinator
from dimos.ar.blueprints import unitree_go2_ar
ModuleCoordinator.build(unitree_go2_ar).loop()
"
```

Equivalent once the blueprint is registered in DimOS: `dimos run unitree-go2-ar`.

</details>

<details>
<summary><strong>AprilTag setup</strong></summary>

Fiducial localization uses a robot-mounted <b>AprilTag 36h11</b> at a pose known to ARModule. Print assets and the generator live in [`assets/markers/`](assets/markers/), not inside `dimos-ar/`.

**Print:** use [`apriltag_robot_0_a4.pdf`](assets/markers/apriltag_robot_0_a4.pdf) or [`apriltag_robot_0_letter.pdf`](assets/markers/apriltag_robot_0_letter.pdf). Print at <b>100% scale</b> (no “fit to page”) and check that the sticker is <b>70 mm</b> total (56 mm black square). Mount it flat on a rigid backing.

**Regenerate or add IDs:**

```bash
python3 assets/markers/generate_marker.py --ids 0
```

**Go2 mount** (from [`UNITREE_GO2_PROFILE`](dimos-ar/dimos/ar/robot/profiles/unitree_go2.py)): one tag, ID 0, on top of the body, 18 cm ahead of the robot center and 6 cm up, pitched slightly back.

<p align="center">
  <img src="assets/specs_dimos_go2tagmount.jpg" alt="Default AprilTag mount location on Unitree Go2" width="480" />
</p>

Mount geometry is part of the robot profile, not launcher config. A G1 profile is not in this package yet; ID 1 print files in `assets/markers/` are leftover sheets only.

Enable the fiducial provider in DimOS config (`armodule.localization.providers`) when you want ARModule to request marker observations.

</details>

#### Register inside Spectacles Lens

Open [`lens-studio/spectacles-dimensional-os.esproj`](lens-studio/spectacles-dimensional-os.esproj) in Lens Studio and send the Lens to your Spectacles (Lens with experimental API enabled cannot be published so you need to upload via LS). The <b>Registration Wizard</b> walks you through connecting and locating the robot. Enter the <b>Bridge IP</b> from the launcher when asked.

<p align="center">
  <img src="assets/specs_dimos_registrationwizard.gif" alt="Registration wizard on Spectacles: connect, scan tag, finish setup" width="480" />
</p>

Leave the robot standing still and walk around it while looking at the tag. Registration finishes on its own once it has gathered sufficient tag sightings. Keep viewing distance about <b>0.5 - 1.5 meters</b>.
Alternatively, switch to <b>Manual Placement</b>, where you drag a marker onto the robot by hand - this doesn`t require printing and mounting the tag but yields much lower accuracy and will not support <b>runtime drift correction</b>.

Alignment is rough at first and gets better as the robot moves and more tag sightings are integrated into the world frame calibration.

<a id="system-design"></a>

## System Design

<b>Dimensional OS</b> runs the robot. It owns the connection to the Go2 or G1, builds a map out of the LiDAR, plans routes through that map and handles the navigation. In <b>Agent Mode</b> it also runs the language model behind your voice commands. 

<b>ARModule</b> (`dimos.ar`) is the main addition of this repo. It streams the robot's position, route and LiDAR over a <b>WebSocket</b> and takes navigation goals and localization observations back. Fiducial or VPS localization relates the client's tracking frame to robot `odom`.

ARModule is <b>device agnostic</b>. Clients implement [`PROTOCOL.md`](dimos-ar/PROTOCOL.md) as the communication protocol for all messages.

The <b>Spectacles Lens</b> is the reference client. It renders the robot and its route, reads hand gestures, sends camera images the bridge requires for AprilTag based frame alignment and handles speech.

```mermaid
flowchart LR
  Robot["Unitree<br>Go2 / G1"]

  subgraph DimOS["Dimensional OS (Mac)"]
    direction TB
    Stack["Robot stack<br>connection · mapping · planning · agent"]
    Bridge["AR-Bridge · dimos-ar<br>world alignment · WebSocket server"]
    Stack <--> Bridge
  end

  Lens["Spectacles Lens<br>lens-studio"]

  Robot <-->|"WebRTC / DDS"| Stack
  Bridge <-->|"WebSocket protocol"| Lens
```

<details>
<summary><strong>Architecture overview</strong></summary>

**ARModule**

Python package under `dimos-ar/dimos/ar/`, loaded by Dimensional OS. Blueprint is `unitree_go2_ar`. One owner per concern:

- `ARModule` (`module.py`) is the DimOS `In`/`Out` surface.
- `websocket/` talks to AR clients (port **8787**).
- `localization/` owns fiducial and VPS episodes; marker geometry lives in `robot/profiles/`.
- `navigation/`, `robot/`, and `sensors/` own goals, safety, odometry correction, and LiDAR.

Printable AprilTags and `generate_marker.py` live in [`assets/markers/`](assets/markers/).

```mermaid
flowchart LR
  Module["module.py<br>ARModule"]
  Net["websocket/"]
  Loc["localization/"]
  Rest["navigation/ · robot/<br>sensors/"]

  Module --> Net
  Module --> Loc
  Module --> Rest
```

**Spectacles Lens**

Lens Studio project with scripts split into two folders, wired by two scene scripts:

- `ARBridge/` implements [`PROTOCOL.md`](dimos-ar/PROTOCOL.md): WebSocket session, inbound routing, and one client per domain (registration, telemetry, navigation, camera, agent).
- `App/` is the Spectacles side: UI, presenters, registration wizard, and hand input.
- `ARBridgeServices` is the composition root. It holds the scene inputs and builds the runtime services.
- `ARBridgeCoordinator` owns phase and mode. It starts in registration, hands off to runtime, and tears down on disconnect.

Inbound messages land in `AppState`, and the UI reacts to that store rather than to raw messages.

```mermaid
flowchart LR
  subgraph App["App/"]
    Services["ARBridgeServices<br>composition root"]
    Coord["ARBridgeCoordinator<br>lifecycle"]
    UI["UI · Robot · Nav · Wizard"]
  end

  subgraph BridgeLayer["ARBridge/"]
    Net["Network · Session"]
    Clients["Domain clients"]
  end

  Coord --> Services
  Services --> UI
  Services --> Net
  Services --> Clients
```

</details>

<a id="augmented-reality-interface"></a>

## Augmented Reality Interface

<p align="center">
  <img src="assets/specs_dimos_arwalk.gif" alt="Spectacles AR interface with Unitree Go2 outdoors: wrist menu and LiDAR visualization" width="800" />
</p>

Hold your left palm up to open the <b>wrist menu</b>. Switch between <b>Manual</b> and <b>Agent Mode</b>, restart registration (i.e. re-calibrate the frame alignment), show the <b>debug console</b>, and request <b>emergency stop</b> (will immediately cancel all navigation).

<p align="center">
  <img src="assets/specs_dimos_wristui.gif" alt="Wrist menu on Spectacles: Manual/Agent mode, LiDAR, registration, debug console, and emergency stop" width="480" />
</p>

The <b>LiDAR</b> button in the wrist menu cycles three states: <b>off</b>, <b>obstacles only</b> (filters the point cloud by proximity to the robot bridge-side — performance friendly), and the <b>full point cloud</b> around the robot (performance heavy, can cause glasses to overheat over a long period).

<a id="manual-mode"></a>

### Manual Mode

The <b>NavigationMarker</b> is initially attached to the robot and allows the user to drag it at any time. The direction you drag sets the heading it should face when it arrives, as indicated by the arrow. The robot will continuously move towards the marker.
The yellow path line shown is the real navigation path the planner sends back, rendered in world space. 


<a id="agent-mode"></a>

### Agent Mode

Wake word <b>"Robot"</b> activates receival of voice commands. This state is indicated on the Robot Marker by <b>Idle</b> vs <b>Asleep</b> (before wake word detected). <br>
Speech to text runs on the Spectacles and the transcript goes to a <b>GPT-4o</b> agent on the Mac, which picks from the tools below. The session closes after <b>30 seconds</b> of silence. Say <b>"stop"</b> and the robot stops immediately (same Emergency Stop path as in the wrist UI).

Anything the agent starts looks and behaves exactly like a manually placed navigation goal. You can grab the marker and take over at any point which will override the goal set by the agent immediately.

The agent does respond in a few words on the robot and in the debug console. It would be possible to implement TTS into the Lens if needed. It will assume reasonable defaults when user commands are unspecific.

| Tool | What it does |
|------|--------------|
| `relative_move` | Walk or turn by an amount relative to where the robot is now |
| `navigate_to_user` | Come to you, using the position of your headset |
| `get_user_pose` | Find out where you are standing and which way you face |
| `cancel_navigation` | Emergency-stop the robot and clear the current goal |
| `place_marker` | Leave a marker floating in the room |
| `draw_line` | Draw a line between two points in the room |
| `clear_annotation` | Remove a marker or line it drew earlier |

> [!NOTE]
> Agent Mode needs `OPENAI_API_KEY` set in the launcher and an internet connection on the Mac.

<a id="pose-drift"></a>

## Pose Drift

<p align="center">
  <img src="assets/specs_dimos_drift.gif" alt="Runtime pose drift: AR robot marker and path slowly misalign as the Go2 walks" width="800" />
</p>

During fast movements (as shown in the GIF above) the <b>RobotMarker</b> can lag behind the real robot position, but will quickly recover when the velocity reduces (i.e. coming to a hold). Drift is also directly proportional to travelled distance and as a function of network quality. The amount of drift varies but is approx. <b>25 cm</b> at a total travel distance of <b>5 m</b>.

The cause is <b>inconsistent odometry data</b> from the robot itself. In simple terms, the robot estimates its current world pose by adding up how far it has moved, and on Unitree hardware those numbers are not consistent, so small errors accumulate over time and distance.

The bridge corrects for this whenever it gets a valid camera frame at the <b>AprilTag</b>. It compares where the tag really is against where the robot reports to be and corrects the alignment to match the observation. Between those corrections the error grows again.

> [!NOTE]
> Expect drift to accumulate over long distance walks - it is automatically corrected when the April Tag is sighted by the glasses camera.
<details>
<summary><h3>Development &amp; Troubleshooting</h3></summary>

Run the full CI suite before opening a PR. It covers both sides and mirrors what GitHub Actions runs.

```bash
./launcher/scripts/run-ci.sh
```

Python tests on their own, using the Dimensional OS environment:

```bash
cd dimos-ar
/path/to/dimos/.venv/bin/python3 -m pytest
```

Lens tests on their own. These are plain TypeScript and do not need Lens Studio:

```bash
cd lens-studio/Tests
npm test
```

### Troubleshooting

| Symptom | Things to try |
|---------|----------------|
| Lens cannot connect | Check that Spectacles and the Mac are on the same WiFi and that you typed the Bridge IP from the launcher, not `127.0.0.1`. |
| AprilTag not detected | Get closer, improve the lighting, keep walking around the robot, and check that the tag printed at full size. |
| Drift after registration | Expected, see [Pose Drift](#pose-drift). Look at the tag while the robot stands still so the bridge can correct itself. |
| Navigation unavailable | The bridge log reports which capabilities the robot advertised. G1 navigation needs the Unitree DDS packages in the DimOS environment. |
| Agent does not respond | Check that `OPENAI_API_KEY` is set in the launcher and that the Mac has internet. |
| Wake word ignored | Turn on the debug console and watch line 7 to see what was transcribed, and check that you are in Agent Mode. |
| Robot does not move | Registration has to be finished and the robot connected. The agent reply on line 8 turns red or yellow when something failed. |

</details>

## Contributing

Contributions, ideas and bug reports are welcome. If you are changing something that crosses between the bridge and the Lens, read [`CONTRIBUTING.md`](CONTRIBUTING.md) first, especially the rules on keeping the protocol in sync.

## License

MIT License, see [LICENSE](LICENSE).
