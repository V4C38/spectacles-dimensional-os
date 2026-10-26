import Foundation
import AppKit
import ScreenCaptureKit
import CoreGraphics
import AVFoundation
import ApplicationServices

// Read the actual Qt Preview viewport bounds; no screenshot or GUI mutation.
func previewViewport(pid: pid_t, window: CGRect, title: String) -> CGRect? {
    func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
        var value: CFTypeRef?
        return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
    }
    func rectangle(_ element: AXUIElement) -> CGRect? {
        guard let rawPosition = attribute(element, kAXPositionAttribute),
              let rawSize = attribute(element, kAXSizeAttribute) else { return nil }
        var position = CGPoint.zero, size = CGSize.zero
        guard AXValueGetValue(rawPosition as! AXValue, .cgPoint, &position),
              AXValueGetValue(rawSize as! AXValue, .cgSize, &size) else { return nil }
        return CGRect(origin: position, size: size)
    }
    var controls: [(String, CGRect)] = []
    var visited = 0
    func visit(_ element: AXUIElement, depth: Int) {
        visited += 1
        guard visited < 1800 && depth < 24 else { return }
        let identifier = attribute(element, kAXIdentifierAttribute) as? String ?? ""
        if identifier.contains("PreviewPanel"), let rect = rectangle(element), rect.width > 0 {
            controls.append((identifier, rect))
        }
        let role = attribute(element, kAXRoleAttribute) as? String ?? ""
        if ["AXTable", "AXOutline", "AXMenuBar"].contains(role) { return }
        for child in attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? [] { visit(child, depth: depth + 1) }
    }
    let application = AXUIElementCreateApplication(pid)
    let windows = attribute(application, kAXWindowsAttribute) as? [AXUIElement] ?? []
    let target = windows.first { (attribute($0, kAXTitleAttribute) as? String ?? "").replacingOccurrences(of: "*", with: "") == title.replacingOccurrences(of: "*", with: "") }
    let bounds = target.flatMap(rectangle) ?? window
    visit(target ?? application, depth: 0)
    let headers = controls.filter { $0.0.contains("PreviewModeSwitchBar") || $0.0.contains("PreviewSourcePicker") }
    let footers = controls.filter { $0.0.contains("::Footer") || $0.0.contains("DeviceSimulationPicker") }
    guard let left = headers.map({ $0.1.minX }).min(),
          let top = headers.map({ $0.1.maxY }).max(),
          let bottom = footers.map({ $0.1.minY }).min(), bottom > top + 100 else { return nil }
    return CGRect(x: left - 4, y: top + 2, width: bounds.maxX - left,
                  height: bottom - top - 4).intersection(bounds)
}

func contain(_ source: CGSize, in bounds: CGRect) -> CGRect {
    let scale = min(bounds.width / source.width, bounds.height / source.height)
    let size = CGSize(width: source.width * scale, height: source.height * scale)
    return CGRect(x: bounds.midX - size.width / 2, y: bounds.midY - size.height / 2,
                  width: size.width, height: size.height)
}

func pixelRect(_ rect: CGRect) -> [String: Int] {
    ["x": Int(rect.minX), "y": Int(rect.minY),
     "width": Int(rect.width) / 2 * 2, "height": Int(rect.height) / 2 * 2]
}

// SCRecordingOutput can omit a static tail and report its start after the first
// frame. Keep the capture's wall clock explicitly, including the final held frame.
// Mutable writer state is confined to queue, including finalization.
final class PreviewFrames: NSObject, SCStreamOutput, @unchecked Sendable {
    let writer: AVAssetWriter
    let input: AVAssetWriterInput
    let adaptor: AVAssetWriterInputPixelBufferAdaptor
    let queue = DispatchQueue(label: "dimos.preview.frames")
    let readyURL: URL
    let window: SCWindow
    let candidateWindows: [[String: Any]]
    let displayID: CGDirectDisplayID
    let frontmostPID: pid_t
    let captureCrop: [String: Int]?
    var layouts: [[String: Any]] = []
    func noteLayout(source: CGRect, destination: CGRect, viewport: CGRect) {
        queue.async {
            let now = CMTimeGetSeconds(CMClockGetTime(CMClockGetHostTimeClock()))
            self.layouts.append(["at": now - (self.firstUptime ?? now), "source": pixelRect(source),
                                 "destination": pixelRect(destination), "viewport": pixelRect(viewport)])
            try? JSONSerialization.data(withJSONObject: self.layouts).write(
                to: self.writer.outputURL.deletingPathExtension().appendingPathExtension("layouts.json"), options: .atomic)
        }
    }
    var firstUptime: TimeInterval?
    var lastPixel: CVPixelBuffer?
    var frameCount = 0
    var focusRestores = 0

    func noteFocusRestore() { queue.async { self.focusRestores += 1 } }

    init(outputURL: URL, window: SCWindow, candidates: [SCWindow], displayID: CGDirectDisplayID,
         frontmostPID: pid_t, width: Int, height: Int) throws {
        self.window = window
        self.displayID = displayID; self.frontmostPID = frontmostPID
        captureCrop = ["x": 0, "y": 0, "width": width, "height": height]
        candidateWindows = candidates.map { ["id": $0.windowID, "title": $0.title ?? "",
            "x": $0.frame.minX, "y": $0.frame.minY, "width": $0.frame.width, "height": $0.frame.height] }
        readyURL = outputURL.deletingPathExtension().appendingPathExtension("ready.json")
        writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
        input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 4_000_000,
                AVVideoExpectedSourceFrameRateKey: 30, AVVideoMaxKeyFrameIntervalKey: 60]])
        input.expectsMediaDataInRealTime = true
        adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input,
            sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height])
        super.init()
        writer.add(input)
        guard writer.startWriting() else { throw writer.error! }
        writer.startSession(atSourceTime: .zero)
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, buffer.isValid, let pixel = buffer.imageBuffer else { return }
        let attachments = CMSampleBufferGetSampleAttachmentsArray(buffer, createIfNecessary: false)
            as? [[SCStreamFrameInfo: Any]]
        guard let raw = attachments?.first?[.status] as? Int, raw == SCFrameStatus.complete.rawValue else { return }
        guard input.isReadyForMoreMediaData else { return }
        let hostNow = CMTimeGetSeconds(CMClockGetTime(CMClockGetHostTimeClock()))
        let uptime = CMTimeGetSeconds(buffer.presentationTimeStamp)
        let firstFrame = firstUptime == nil
        let time = CMTime(seconds: uptime - (firstUptime ?? uptime), preferredTimescale: 60_000)
        guard adaptor.append(pixel, withPresentationTime: time) else { return }
        lastPixel = pixel; frameCount += 1
        if firstFrame {
            firstUptime = uptime
            var record: [String: Any] = ["startedAt": Date().timeIntervalSince1970 * 1000 - (hostNow - uptime) * 1000,
                "windowId": window.windowID, "pid": window.owningApplication?.processID ?? 0,
                "windowTitle": window.title ?? "", "windowCandidates": candidateWindows,
                "displayId": displayID, "frontmostPID": frontmostPID,
                "firstFrameAgeMs": (hostNow - uptime) * 1000,
                "windowWidth": window.frame.width, "windowHeight": window.frame.height,
                "timeline": "SCK host clock; viewport only; live AX bounds; aspect preserved"]
            if let crop = captureCrop { record["captureCrop"] = crop }
            do { try JSONSerialization.data(withJSONObject: record).write(to: readyURL, options: .atomic) }
            catch { fputs("Cannot save recording start: \(error)\n", stderr) }
        }
    }

    func finish() async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            queue.async {
                guard let first = self.firstUptime, let pixel = self.lastPixel else {
                    continuation.resume(throwing: NSError(domain: "SpecsReview", code: 5,
                        userInfo: [NSLocalizedDescriptionKey: "No native window frames were captured"]))
                    return
                }
                let elapsed = CMTimeGetSeconds(CMClockGetTime(CMClockGetHostTimeClock())) - first
                if self.input.isReadyForMoreMediaData {
                    _ = self.adaptor.append(pixel, withPresentationTime: CMTime(seconds: elapsed, preferredTimescale: 60_000))
                }
                self.writer.endSession(atSourceTime: CMTime(seconds: elapsed + 1.0 / 30, preferredTimescale: 60_000))
                self.input.markAsFinished()
                self.writer.finishWriting {
                    if let error = self.writer.error { continuation.resume(throwing: error) }
                    else {
                        do {
                            let completed: [String: Any] = ["elapsedS": elapsed, "frameCount": self.frameCount,
                                "focusRestores": self.focusRestores]
                            try JSONSerialization.data(withJSONObject: completed).write(
                                to: self.writer.outputURL.deletingPathExtension().appendingPathExtension("completed.json"), options: .atomic)
                            fputs("Captured \(self.frameCount) live frames over \(elapsed) wall-clock seconds\n", stderr)
                            continuation.resume()
                        } catch { continuation.resume(throwing: error) }
                    }
                }
            }
        }
    }
}

@main struct RecordPreview {
    @MainActor static func main() async throws {
        _ = NSApplication.shared
        let activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiated, .idleDisplaySleepDisabled],
            reason: "Recording the native Lens Studio review")
        defer { ProcessInfo.processInfo.endActivity(activity) }
        let arguments = CommandLine.arguments
        guard arguments.count >= 4, let pid = Int32(arguments[1]), let duration = Double(arguments[3]) else {
            throw NSError(domain: "SpecsReview", code: 1, userInfo: [NSLocalizedDescriptionKey: "Usage: RecordPreview PID output.mp4 durationSeconds"])
        }
        guard CGPreflightScreenCaptureAccess() else {
            throw NSError(domain: "SpecsReview", code: 2, userInfo: [NSLocalizedDescriptionKey: "Screen Recording permission is required for continuous Preview video"])
        }
        guard let application = NSRunningApplication(processIdentifier: pid),
            application.activate(options: []) else {
            throw NSError(domain: "SpecsReview", code: 4, userInfo: [NSLocalizedDescriptionKey: "Cannot activate Lens Studio for a live Preview recording"])
        }
        let outputURL = URL(fileURLWithPath: arguments[2])
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        let candidates = content.windows.filter { $0.owningApplication?.processID == pid && $0.frame.width > 300 && $0.frame.height > 200 }
        let previewWindows = candidates.filter { ($0.title ?? "").localizedCaseInsensitiveContains("preview") }
        guard let window = (previewWindows.isEmpty ? candidates : previewWindows)
            .max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }) else {
            throw NSError(domain: "SpecsReview", code: 3, userInfo: [NSLocalizedDescriptionKey: "Lens Studio window was not found"])
        }
        let configuration = SCStreamConfiguration()
        guard let display = content.displays.max(by: {
            let a = $0.frame.intersection(window.frame), b = $1.frame.intersection(window.frame)
            return a.width * a.height < b.width * b.height
        }) else { throw NSError(domain: "SpecsReview", code: 6) }
        guard var viewport = previewViewport(pid: pid, window: window.frame, title: window.title ?? "") else {
            throw NSError(domain: "SpecsReview", code: 8,
                userInfo: [NSLocalizedDescriptionKey: "Cannot locate the native Preview viewport through Accessibility"])
        }
        configuration.sourceRect = viewport.offsetBy(dx: -display.frame.minX, dy: -display.frame.minY)
        configuration.width = 1280
        configuration.height = 900
        configuration.preservesAspectRatio = true
        let background = CGColor(gray: 0, alpha: 1)
        configuration.backgroundColor = background
        configuration.destinationRect = contain(viewport.size, in: CGRect(x: 0, y: 0, width: 1280, height: 900))
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 30)
        configuration.pixelFormat = kCVPixelFormatType_32BGRA
        configuration.showsCursor = false
        configuration.capturesAudio = false
        let frames = try PreviewFrames(outputURL: outputURL, window: window, candidates: candidates,
            displayID: display.displayID, frontmostPID: NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0,
            width: configuration.width, height: configuration.height)
        let stream = SCStream(filter: SCContentFilter(display: display, including: [window]), configuration: configuration, delegate: nil)
        try stream.addStreamOutput(frames, type: .screen, sampleHandlerQueue: frames.queue)
        try await stream.startCapture()
        let stopURL = arguments.count > 4 ? URL(fileURLWithPath: arguments[4])
            : outputURL.deletingPathExtension().appendingPathExtension("stop")
        let deadline = Date().addingTimeInterval(max(1, duration))
        let roiURL = outputURL.deletingPathExtension().appendingPathExtension("viewport.json")
        var nextLayout = Date.distantPast
        var previousSource = configuration.sourceRect
        frames.noteLayout(source: configuration.sourceRect, destination: configuration.destinationRect, viewport: viewport)
        var lostFocusAt: Date?
        var focusFailed = false
        while Date() < deadline {
            if FileManager.default.fileExists(atPath: stopURL.path) { break }
            if NSWorkspace.shared.frontmostApplication?.processIdentifier != pid {
                if lostFocusAt == nil { lostFocusAt = Date(); frames.noteFocusRestore() }
                application.unhide(); application.activate(options: [])
                if Date().timeIntervalSince(lostFocusAt!) > 2 { focusFailed = true; break }
            } else { lostFocusAt = nil }
            if Date() >= nextLayout {
                nextLayout = Date().addingTimeInterval(0.25)
                guard let measured = previewViewport(pid: pid, window: window.frame, title: window.title ?? "") else {
                    throw NSError(domain: "SpecsReview", code: 8,
                        userInfo: [NSLocalizedDescriptionKey: "Preview viewport disappeared during capture"])
                }
                viewport = measured
                var source = viewport
                if let data = try? Data(contentsOf: roiURL),
                   let roi = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
                    if let aspect = roi["aspect"] as? Double, aspect > 0 {
                        source = contain(CGSize(width: aspect, height: 1), in: viewport)
                    }
                    if let bounds = roi["bounds"] as? [String: Double],
                       let x = bounds["x"], let y = bounds["y"],
                       let w = bounds["width"], let h = bounds["height"], w > 0, h > 0 {
                        source = CGRect(x: source.minX + x * source.width, y: source.minY + y * source.height,
                                        width: w * source.width, height: h * source.height).intersection(viewport)
                    }
                }
                source = source.offsetBy(dx: -display.frame.minX, dy: -display.frame.minY)
                if source != previousSource {
                    configuration.sourceRect = source
                    configuration.destinationRect = contain(source.size, in: CGRect(x: 0, y: 0, width: 1280, height: 900))
                    try await stream.updateConfiguration(configuration)
                    frames.noteLayout(source: source, destination: configuration.destinationRect, viewport: viewport)
                    previousSource = source
                }
            }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        try await stream.stopCapture()
        try await frames.finish()
        withExtendedLifetime(background) {}
        if focusFailed {
            throw NSError(domain: "SpecsReview", code: 7,
                userInfo: [NSLocalizedDescriptionKey: "Lens Studio lost foreground capture focus and could not be restored"])
        }
    }
}
