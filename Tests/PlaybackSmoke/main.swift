import SwiftUI
import AppKit
import AVFoundation

struct SmokeSelection { var url: URL?; var next: URL?; var index: Int; var retry = 0 }
final class Scenario: ObservableObject {
    @Published var selection: SmokeSelection
    @Published var mounted = true
    @Published var playing = true
    var shown: [URL] = []
    var failed: [URL?] = []
    init(_ first: URL, _ next: URL) { selection = .init(url: first, next: next, index: 0) }
}
struct Host: View {
    @ObservedObject var scenario: Scenario
    var body: some View {
        let s = scenario.selection
        if scenario.mounted {
            VideoPlayerView(url: s.url, nextURL: s.next, pageIndex: s.index, retryID: s.retry,
                            isPlaying: scenario.playing, isMuted: false,
                            onDisplay: { scenario.shown.append($0) },
                            onFailure: { scenario.failed.append($0) })
        } else { Color.black }
    }
}

@MainActor func tick(_ duration: TimeInterval = 0.01) {
    RunLoop.main.run(until: Date().addingTimeInterval(duration))
}
@MainActor func waitFor(_ label: String, seconds: Double = 6, _ condition: () -> Bool) throws {
    let deadline = Date().addingTimeInterval(seconds)
    while !condition() {
        guard Date() < deadline else { throw SmokeError("timeout: " + label) }
        tick(0.005)
    }
}
@MainActor func smoke() throws {
    let tmp = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    let a = tmp.appendingPathComponent("red.mov"), b = tmp.appendingPathComponent("green.mov")
    let c = tmp.appendingPathComponent("blue.mov")
    try writeClip(a, red: 224, green: 40, blue: 28)
    try writeClip(b, red: 20, green: 204, blue: 72)
    try writeClip(c, red: 40, green: 60, blue: 232)
    let port = try String(contentsOf: tmp.appendingPathComponent("port"), encoding: .utf8)
    let slow = URL(string: "http://127.0.0.1:\(port)/slow.mov")!
    let stuck = URL(string: "http://127.0.0.1:\(port)/timeout.mov")!
    let scenario = Scenario(a, b)
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    app.finishLaunching()
    let size = NSSize(width: 320, height: 200)
    let win = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: .borderless, backing: .buffered, defer: false)
    win.isReleasedWhenClosed = false
    let host = NSHostingView(rootView: Host(scenario: scenario))
    host.wantsLayer = true
    win.contentView = host
    win.orderBack(nil)
    defer { win.contentView = nil; win.close() }

    func layers() -> [AVPlayerLayer] {
        func children(_ layer: CALayer) -> [AVPlayerLayer] {
            if let layer = layer as? AVPlayerLayer { return [layer] }
            return (layer.sublayers ?? []).flatMap(children)
        }
        return host.layer.map(children) ?? []
    }
    func layer(_ url: URL) -> AVPlayerLayer? {
        layers().first { ($0.player?.currentItem?.asset as? AVURLAsset)?.url == url }
    }
    // Not a screenshot: ensure the displayed layer covers the viewport center
    // and is not hidden by its own ancestors. At steady state this must be true
    // throughout a deliberately stalled handoff.
    func holdsCenter(_ url: URL) -> Bool {
        guard let item = layer(url), let root = host.layer, item.isReadyForDisplay else { return false }
        var current: CALayer? = item
        while let l = current {
            if l.isHidden || l.opacity < 0.9 { return false }
            if l === root { break }
            current = l.superlayer
        }
        let center = CGPoint(x: root.bounds.midX, y: root.bounds.midY)
        guard item.convert(item.bounds, to: root).contains(center),
              let siblings = item.superlayer?.sublayers, let z = siblings.firstIndex(of: item) else { return false }
        // A retained but obscured old layer would still flash black.
        return !siblings.dropFirst(z + 1).contains { l in
            l is AVPlayerLayer && !l.isHidden && l.opacity > 0.05 && l.convert(l.bounds, to: root).contains(center)
        }
    }
    func assertHeld(_ url: URL, for duration: TimeInterval) throws {
        let deadline = Date().addingTimeInterval(duration)
        repeat {
            try require(holdsCenter(url), "lost visible decoded frame of \(url.lastPathComponent)")
            tick(0.009)
        } while Date() < deadline
    }
    // Inspect the production slide while the outgoing & incoming textures coexist.
    // The two page rectangles must meet exactly one viewport height apart, and
    // reversing the index must reverse their signed offset.
    func slideSpacing(_ old: URL, _ new: URL) throws -> CGFloat {
        guard let out = layer(old), let incoming = layer(new), let root = host.layer else {
            throw SmokeError("slide did not retain both layers")
        }
        try require(out.isReadyForDisplay && incoming.isReadyForDisplay, "undecoded layer participating in slide")
        let incomingMid = incoming.convert(incoming.bounds, to: root).midY
        let outgoingMid = out.convert(out.bounds, to: root).midY
        let d = host.convert(NSPoint(x: 0, y: incomingMid), to: nil).y
              - host.convert(NSPoint(x: 0, y: outgoingMid), to: nil).y
        try require(abs(abs(d) - root.bounds.height) < 1.1, "gap/overlap between moving pages: \(d), height=\(root.bounds.height)")
        var animated: CALayer? = incoming
        while let l = animated {
            if l.animation(forKey: "page") != nil { return d }
            animated = l.superlayer
        }
        throw SmokeError("missing vertical page animation")
    }
    try waitFor("first frame") { scenario.shown.last == a && holdsCenter(a) }
    try waitFor("decoded standby frame") { layer(b)?.isReadyForDisplay == true }
    let warmed = layer(b)?.player
    try require(warmed != nil && warmed?.isMuted == true, "standby should be silent")
    scenario.selection = .init(url: b, next: nil, index: 1)
    try waitFor("prewarmed next selected") { scenario.shown.last == b }
    try require(layer(b)?.player === warmed, "prewarmed decoder discarded at promotion")
    try require(layer(b)?.player?.isMuted == false && layer(a)?.player?.isMuted != false,
                "two audio sources were unmuted after promotion")
    var forward: CGFloat?
    let reduce = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    if !reduce {
        forward = try slideSpacing(a, b)
        try require(forward! < 0, "forward page must enter from the window's lower edge (dy=\(forward!))")
    }
    try waitFor("forward settles") { layer(a) == nil && holdsCenter(b) }
    scenario.playing = false
    scenario.selection = .init(url: a, next: nil, index: 0)
    try waitFor("previous selected") { scenario.shown.last == a }
    if let forward { let backward = try slideSpacing(b, a); try require(forward * backward < 0, "direction did not reverse") }
    try waitFor("backward settles") { layer(b) == nil && holdsCenter(a) }
    guard let paused = layer(a)?.player, let pausedItem = paused.currentItem else { throw SmokeError("missing paused player") }
    NotificationCenter.default.post(name: .AVPlayerItemDidPlayToEndTime, object: pausedItem)
    tick(0.1)
    try require(paused.rate == 0, "paused or ended player resumed without input")
    scenario.playing = true
    try waitFor("user resumed playback") { paused.rate > 0 }
    print("PASS single audible channel and paused handoff")
    print("PASS first decoded frame, silent prewarm/reuse, forward/back handoff (reduce motion: \(reduce))")

    scenario.selection = .init(url: slow, next: nil, index: 1)
    try waitFor("withheld first byte requested") { FileManager.default.fileExists(atPath: tmp.appendingPathComponent("slow.mov.requested").path) }
    try assertHeld(a, for: 0.4)
    try require(!scenario.shown.contains(slow), "slow video promoted without bytes")
    scenario.selection = .init(url: c, next: nil, index: 2)
    try waitFor("newest selection promoted") { scenario.shown.last == c }
    try Data().write(to: tmp.appendingPathComponent("slow.mov.release"))
    try waitFor("newest frame centered") { holdsCenter(c) && layer(a) == nil }
    try assertHeld(c, for: 0.3)
    try require(!scenario.shown.contains(slow), "stale callback promoted superseded selection")
    print("PASS retained outgoing frame during stall and cancelled obsolete switch")

    guard let current = layer(c)?.player, let item = current.currentItem else { throw SmokeError("missing active item") }
    NotificationCenter.default.post(name: .AVPlayerItemFailedToPlayToEndTime, object: item)
    try waitFor("mid-clip failure forwarded") { scenario.failed.contains(c) && current.rate == 0 }
    scenario.selection = .init(url: c, next: nil, index: 2, retry: 1)
    try waitFor("failed active decoder replaced") { layer(c)?.player !== current && holdsCenter(c) }
    print("PASS mid-clip failure notification and fresh decoder on retry")


    scenario.selection = .init(url: stuck, next: nil, index: 3)
    try waitFor("timeout fixture requested") { FileManager.default.fileExists(atPath: tmp.appendingPathComponent("timeout.mov.requested").path) }
    let deadline = Date().addingTimeInterval(35)
    while !scenario.failed.contains(stuck) {
        try require(Date() < deadline, "no bounded failure for a stalled handoff")
        try assertHeld(c, for: 0.04)
    }
    try require(!scenario.shown.contains(stuck), "timed-out frame was promoted")
    try Data().write(to: tmp.appendingPathComponent("timeout.mov.release"))
    scenario.selection = .init(url: stuck, next: nil, index: 3, retry: 1)
    try waitFor("same URL retried and promoted") { scenario.shown.last == stuck }
    try waitFor("retried frame centered") { holdsCenter(stuck) && layer(c) == nil }
    scenario.selection = .init(url: nil, next: nil, index: 4)
    try waitFor("invalid URL reported") { scenario.failed.contains(nil) }
    try assertHeld(stuck, for: 0.08)
    print("PASS bounded timeout, same-URL retry, nil URL retains last frame")

    guard let lastPlayer = layer(stuck)?.player else { throw SmokeError("missing final player") }
    scenario.mounted = false
    try waitFor("teardown releases item and audio") {
        lastPlayer.currentItem == nil && lastPlayer.rate == 0 && lastPlayer.isMuted && layers().isEmpty
    }
    print("PASS unmount stops and releases decoder")
}

do { try MainActor.assumeIsolated { try smoke() } }
catch { FileHandle.standardError.write(Data("FAIL \(error.localizedDescription)\n".utf8)); exit(1) }
