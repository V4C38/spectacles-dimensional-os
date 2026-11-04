"""Generate the vector architecture review. Requires reportlab; no runtime dependencies.

Usage: python tools/reviews/generate_multi_client_review.py [validation sentence]
"""

from pathlib import Path
import math
import sys

from reportlab.lib.colors import HexColor
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "docs/reviews/dimos-ar-multi-client-alignment-review.pdf"
VALIDATION = sys.argv[1] if len(sys.argv) > 1 else (
    "Acceptance gate: ./launcher/scripts/run-ci.sh. Device acceptance remains pending."
)
C = canvas.Canvas(str(OUTPUT), pagesize=(842, 595))
C.setTitle("DimOS AR | Multi-client authority and alignment")
C.setAuthor("DimOS AR architecture review")
INK, TEAL, PURPLE, AMBER = "#20303D", "#137F7A", "#705AA9", "#AF762C"


def text(x, y, value, size=11, color=INK, bold=False):
    C.setFillColor(HexColor(color))
    C.setFont("Helvetica-Bold" if bold else "Helvetica", size)
    C.drawString(x, y, value)


def lines(x, y, values, size=11, color=INK):
    for value in values:
        text(x, y, value, size, color)
        y -= size * 1.55


def page(number, title, subtitle):
    C.setFillColor(HexColor("#F5F6F2"))
    C.rect(0, 0, 842, 595, fill=1, stroke=0)
    text(42, 555, "DIMOS / AR", 11, TEAL, True)
    text(620, 555, "MULTI-CLIENT / REVIEW", 10, INK, True)
    text(42, 504, title, 29, bold=True)
    text(42, 476, subtitle, 11)
    C.setStrokeColor(HexColor("#D5DDDA"))
    C.line(42, 55, 800, 55)
    text(42, 35, "multi-client / experimental integration / authority, responsiveness and bounded traffic", 9)
    text(759, 35, f"{number} / 6", 10)


def box(x, y, width, height, title, body=(), color=TEAL):
    C.setFillColor(HexColor("#FFFFFF"))
    C.setStrokeColor(HexColor(color))
    C.setLineWidth(1.2)
    C.roundRect(x, y, width, height, 9, fill=1, stroke=1)
    text(x + 14, y + height - 25, title, 13, color, True)
    lines(x + 14, y + height - 48, body, 10)


def arrow(x, y, end_x, end_y, color=INK):
    C.setStrokeColor(HexColor(color))
    C.setLineWidth(1.4)
    C.line(x, y, end_x, end_y)
    angle = math.atan2(end_y - y, end_x - x)
    for delta in (-0.5, 0.5):
        C.line(end_x, end_y, end_x - 7 * math.cos(angle + delta),
               end_y - 7 * math.sin(angle + delta))


page(1, "Multiple connections need one robot owner.",
     "The original transport accepted multiple clients; shared interaction authority was incomplete.")
box(42, 300, 205, 135, "Before / independent intent", [
    "Each headset could submit motion.", "Drafts and modes lived locally.",
    "Latest client pose could affect agent.", "One slow receiver could lose controls.",
], AMBER)
box(309, 300, 224, 135, "Now / authoritative state", [
    "One robot-wide lease, one epoch.", "Server validates motion and revisions.",
    "Shared targets, preview, mode, plans.", "Every client may Emergency Stop.",
])
box(595, 300, 205, 135, "Native robot execution", [
    "Navigation + optional arm adapter.", "Accepted operations outlive edits.",
    "Late work is fenced before effects.", "Agent/manual needs quiescence.",
], PURPLE)
arrow(247, 367, 309, 367)
arrow(533, 367, 595, 367)
text(42, 253, "Explicit replication boundaries", 17, bold=True)
for x, title, body in [
    (42, "ARModule / replication", ["Authority, leases, epochs", "Canonical target snapshots"]),
    (302, "ClientCore / replication", ["Prediction + interpolation", "Shared portable interaction facts"]),
    (562, "Both hosts / replication", ["Grey cross + input eligibility", "Apply each headset's own origin"]),
]:
    box(x, 128, 238, 101, title, body)
text(42, 84, "Scope: one robot, mixed Specs/WebXR peers; no upstream DimOS edits or scene-file edits.", 11)
C.showPage()

page(2, "Fast for the owner. Smooth for observers.",
     "Local prediction is immediate; the server remains the source of accepted robot state.")
box(42, 313, 211, 122, "Client A / dragging", [
    "Render local pose immediately.", "Acquire / renew robot-wide lease.",
    "Send fenced target samples.",
])
box(315, 313, 211, 122, "ARModule / canonical odom", [
    "Validate epoch + lease + sequence.", "Publish shared state at up to 20 Hz.",
    "Keep nav and arm groups distinct.",
], PURPLE)
box(588, 313, 212, 122, "Client B / observing", [
    "Buffer samples for about 100 ms.", "Interpolate position + rotation.",
    "Render using B's tracking origin.",
])
arrow(253, 374, 315, 374)
arrow(526, 374, 588, 374)
text(42, 267, "Replica timing", 15, bold=True)
for x, label in [(145, "gesture"), (325, "accepted"), (505, "observer"), (685, "final pose")]:
    C.setFillColor(HexColor(TEAL))
    C.circle(x, 230, 5, fill=1, stroke=0)
    text(x - 32, 207, label, 10)
arrow(150, 230, 680, 230, TEAL)
text(42, 172, "Owner prediction never waits for the network. Native commands wait for authority.", 12, bold=True)
lines(42, 143, [
    "Observers do not extrapolate. Quaternion interpolation takes the shortest rotation path.",
    "Final samples settle exactly; stale / reordered snapshots cannot revive an old gesture.",
    "Reliable controls preserve order. Coalesced telemetry avoids unbounded backlog; failed peers retire.",
    "Late join and reconnect rebuild from full state; parked targets remain available for handover.",
], 11)
C.showPage()

page(3, "Only one client plans the selected target.",
     "The reservation survives the first release so the two-gesture preview workflow stays exclusive.")
steps = [
    (42, "1 / First gesture", ["A grabs valid floor target.", "Robot-wide lease granted."]),
    (238, "2 / First release", ["Shared preview remains.", "A keeps planning reservation."]),
    (434, "3 / Second gesture", ["A sets heading and confirms.", "Server accepts native goal."]),
    (630, "4 / Handover", ["Reservation ends.", "B can grab shared target."]),
]
for x, title, body in steps:
    box(x, 311, 170, 125, title, body, TEAL if x in (42, 630) else PURPLE)
for x in (212, 408, 604):
    arrow(x, 371, x + 26, 371)
box(42, 153, 366, 115, "Observer B / unavailable", [
    "Sees A's target and advisory route.", "Grey marker with cross; grabbing is disabled.",
    "Emergency Stop and cancellation controls stay reachable.",
], AMBER)
box(434, 153, 366, 115, "Reservation cleanup", [
    "Confirm / cancel / deselect / tracking loss.", "Disconnect or lease expiry also retires authority.",
    "Normal live release opens authority and keeps the target.",
])
lines(42, 108, [
    "A 500 ms lease is renewed during the reservation. Losing renewal cannot leave an immortal lock.",
    "Arm execution has a separate robot-owned busy state; ending an edit does not unlock an active operation.",
], 11)
C.showPage()

page(4, "One world, independently aligned headsets.",
     "AprilTag math is reusable across clients; calibration and capture timing decide physical accuracy.")
for x, title, body in [
    (42, "Robot side", ["Native odometry", "Measured base-to-tag mount"]),
    (302, "Observed tag", ["Known black-square size", "Camera optical pose at exposure"]),
    (562, "Headset side", ["Per-client tracking origin", "Never shared between headsets"]),
]:
    box(x, 323, 238, 108, title, body)
arrow(280, 377, 302, 377)
arrow(540, 377, 562, 377)
text(42, 284, "T_odom_client = (T_odom_base x T_base_tag) x inverse(T_client_camera x T_camera_tag)", 13, PURPLE, True)
box(42, 133, 366, 115, "Implemented corrections", [
    "Keep existing bracket interpolation acceptance.",
    "100 ms applies only to nearest-sample fallback.",
    "Keep canonical targets in odom; reproject on correction.",
    "Reference resets and capture IDs fence stale work.",
])
box(434, 133, 366, 115, "Physical checks still required", [
    "Verify tag size and rigid robot mount by measurement.",
    "Validate camera intrinsics, crop and extrinsics per device.",
    "Check two-headset target overlap while both move.",
    "Wrong size or mount can still give low reprojection error.",
], AMBER)
lines(42, 99, [
    "Synthetic tag/PnP checks and unit tests support the transform chain; they do not certify device alignment.",
    "Built-in Quest calibration assumptions still need measured-device verification.",
], 11)
C.showPage()

page(5, "Keep bulk data away from control.",
     "Compact state, cached geometry and bounded workers protect interaction responsiveness.")
box(42, 324, 224, 110, "Control channel", [
    "Authority, Stop, targets and replies.", "Small revision references, not full plans.",
    "Bounded reliable queue; snapshots coalesce.", "Owner input renders without an ACK wait.",
])
box(309, 324, 224, 110, "Paired bulk channel", [
    "Model / route / trajectory by revision.", "JPEG uploads and latest-only LiDAR.",
    "Small records and incremental decoding.", "Download budget; timely image uploads.",
], PURPLE)
box(576, 324, 224, 110, "Bounded native work", [
    "Latest-only sensor and costmap inputs.", "Control stays off perception worker lanes.",
    "Hung work cannot spawn replacements.", "Late results are generation-fenced.",
], AMBER)
arrow(266, 370, 309, 370); arrow(533, 370, 576, 370)
text(42, 309, "Arm-state bytes / update: synthetic 6 joints, 1,000 trajectory points", 10)
for y, label, width, color in [(289, "Before: 149,384 B", 320, AMBER), (273, "After: 839 B", 2, TEAL)]:
    text(42, y, label, 10, color, True)
    C.setFillColor(HexColor(color)); C.rect(230, y, width, 8, fill=1, stroke=0)
text(42, 250, "Release frees editing; the server finishes motion.", 17, bold=True)
box(42, 130, 366, 107, "Takeoverable finishing", [
    "Continue toward the last validated arm target.", "No former-client 30 Hz finishing stream.",
    "A new grab replaces the native motion generation.", "Server loss, Stop or last disconnect ends the tail.",
])
box(434, 130, 366, 107, "Preserved presentation", [
    "Observers use the existing 100 ms target buffer.", "Measured robot feedback remains separate from intent.",
    "Cache model/path geometry; update transforms per frame.", "Execute and reset retain exclusive operation ownership.",
], PURPLE)
lines(42, 96, [
    "Five peers at 10 Hz: arm-state application traffic falls from 7.47 MB/s to 41.95 KB/s in this workload.",
    "Loopback control ACK p95: about 2.5 ms during bulk transfer. Synthetic Mac evidence; not Wi-Fi or headset results.",
], 10)
C.showPage()

page(6, "Test the races, then verify on devices.",
     "Automated coverage exercises shared state and native boundaries; hardware remains a separate acceptance step.")
box(42, 275, 238, 158, "Unit / deterministic clocks", [
    "Competing grabs; delayed grants.", "Lease expiry; renew; cancellation.",
    "Epoch / sequence / revision fences.", "Predicted and interpolated targets.",
    "Native plan / execute late results.", "Exposure timestamps and alignment.", "Late assets / delayed disconnect cleanup.",
])
box(302, 275, 238, 158, "Integration / production owners", [
    "Real multi-socket ARModule tests.", "Five browser contexts, one server.",
    "Shared preview and grey cross.", "Confirm / handover / disconnect.",
    "Native ports simulated explicitly.", "Native Specs compiler checked.", "Release / accepted-motion races.",
], PURPLE)
box(562, 275, 238, 158, "Device / acceptance", [
    "Specs + Quest concurrent session.", "Moving tags, occlusion, relocalize.",
    "Wi-Fi jitter and temporary loss.", "Observed drag smoothness.",
    "Physical stop / backend feedback.", "Actual robot and camera mounts.",
], AMBER)
text(42, 235, "Repository validation", 16, bold=True)
lines(42, 207, [VALIDATION], 10)
lines(42, 173, [
    "Native Preview scenarios remain pending: the external CLAD/MCP installation is unavailable.",
    "Native agent turns cannot be forcibly cancelled; a running turn may issue later skills after a software stop.",
    "Manual admission waits for confirmed turn/navigation/following quiescence. Validate hardware stop behavior.",
    "Native goal-monitor races can still stop a newer goal; source-correlated transport cannot repair that algorithm.",
    "No finite test suite proves every scenario. Physical safety, alignment and visual latency need device evidence.",
], 10)
text(42, 94, "Implementation map", 11, TEAL, True)
text(42, 76, "dimos/ar/replication | ClientCore/replication | both host replication folders | PROTOCOL.md", 10)
C.save()
print(OUTPUT)
