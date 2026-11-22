import SwiftUI
import AVFoundation
import AppKit
import QuartzCore

/// A persistent video surface: one visible decoder + one silent neighbour.
/// Keep this representable mounted across selections; never key it by video ID.
public struct VideoPlayerView: NSViewRepresentable {
    public let url: URL?
    public let nextURL: URL?
    public let pageIndex: Int
    public let retryID: Int
    public let isPlaying: Bool
    public let isMuted: Bool
    public let fillScreen: Bool
    public let playbackRate: Float
    public var onDisplay: ((URL) -> Void)?
    public var onFailure: ((URL?) -> Void)?
    public var onProgressUpdate: ((Double, Double) -> Void)?

    public init(url: URL?, nextURL: URL? = nil, pageIndex: Int = 0, retryID: Int = 0,
                isPlaying: Bool, isMuted: Bool, fillScreen: Bool = true, playbackRate: Float = 1,
                onDisplay: ((URL) -> Void)? = nil, onFailure: ((URL?) -> Void)? = nil,
                onProgressUpdate: ((Double, Double) -> Void)? = nil) {
        self.url = url
        self.nextURL = nextURL
        self.pageIndex = pageIndex
        self.retryID = retryID
        self.isPlaying = isPlaying
        self.isMuted = isMuted
        self.fillScreen = fillScreen
        self.playbackRate = playbackRate
        self.onDisplay = onDisplay
        self.onFailure = onFailure
        self.onProgressUpdate = onProgressUpdate
    }

    public func makeNSView(context: Context) -> NSView { PageHost(frame: .zero) }
    public func updateNSView(_ view: NSView, context: Context) { (view as? PageHost)?.configure(self) }
    public static func dismantleNSView(_ view: NSView, coordinator: ()) { (view as? PageHost)?.shutdown() }
}

private struct Selection: Equatable {
    let url: URL?
    let index: Int
    let retry: Int
}

@MainActor private final class VideoSlot {
    let url: URL
    let player: AVPlayer
    let item: AVPlayerItem
    let layer: AVPlayerLayer
    var observations: [NSKeyValueObservation] = []
    var failedDuringPlayback = false
    var didPreroll = false
    var decodingRequestedFrame = false
    var commandedRate: Float?
    var index = 0

    init(url: URL, gravity: AVLayerVideoGravity) {
        self.url = url
        let headers = [
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
            "Referer": "https://www.douyin.com/"
        ]
        let asset = AVURLAsset(url: url, options: url.isFileURL ? nil : ["AVURLAssetHTTPHeaderFieldsKey": headers])
        item = AVPlayerItem(asset: asset)
        item.preferredForwardBufferDuration = 3
        player = AVPlayer(playerItem: item)
        player.isMuted = true
        layer = AVPlayerLayer(player: player)
        layer.videoGravity = gravity
        layer.backgroundColor = NSColor.black.cgColor
        layer.masksToBounds = true
    }

    func dispose() {
        observations.forEach { $0.invalidate() }
        observations.removeAll()
        player.isMuted = true
        player.pause()
        player.cancelPendingPrerolls()
        item.cancelPendingSeeks()
        layer.removeFromSuperlayer()
        layer.player = nil
        player.replaceCurrentItem(with: nil)
    }
}

@MainActor private final class PageHost: NSView {
    // Both pages slide on the same Core Animation track. Their edges therefore
    // stay joined even if AppKit misses a display refresh.
    private let track = CALayer()
    private var active: VideoSlot?
    private var spare: VideoSlot?
    private var retiring: VideoSlot?
    private var settings: VideoPlayerView?
    private var selection: Selection?
    private var reportedDisplay: Selection?
    private var reportedFailure: Selection?
    private var deadline: DispatchWorkItem?
    private var scheduled = false
    private var progressToken: Any?
    private var progressPlayer: AVPlayer?
    private var seekTask: DispatchWorkItem?
    private var seekTarget: Double?
    private var animationID: UInt = 0
    private var lastSize: CGSize = .zero
    private var lastGravity: AVLayerVideoGravity = .resizeAspectFill
    private var gravity: AVLayerVideoGravity { settings?.fillScreen == false ? .resizeAspect : .resizeAspectFill }

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.masksToBounds = true
        layer?.backgroundColor = NSColor.black.cgColor
        layer?.addSublayer(track)
        NotificationCenter.default.addObserver(self, selector: #selector(didEnd(_:)),
                                               name: .AVPlayerItemDidPlayToEndTime, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(didFailToEnd(_:)),
                                               name: .AVPlayerItemFailedToPlayToEndTime, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(seek(_:)),
                                               name: Notification.Name("MacDVSeekDelta"), object: nil)
    }
    required init?(coder: NSCoder) { nil }

    override func layout() {
        super.layout()
        guard bounds.size != lastSize else { return }
        lastSize = bounds.size
        if retiring != nil { finishSlide() }
        withoutActions {
            track.frame = bounds
            for slot in [active, spare].compactMap({ $0 }) { slot.layer.frame = track.bounds }
        }
    }

    private func withoutActions(_ work: () -> Void) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        work()
        CATransaction.commit()
    }

    func configure(_ value: VideoPlayerView) {
        settings = value
        let request = Selection(url: value.url, index: value.pageIndex, retry: value.retryID)
        if request != selection {
            deadline?.cancel()
            deadline = nil
            selection = request
            reportedFailure = nil
            reportedDisplay = nil
            cancelSeek()
        }
        if gravity != lastGravity {
            lastGravity = gravity
            withoutActions {
                for slot in [active, spare, retiring].compactMap({ $0 }) { slot.layer.videoGravity = gravity }
            }
        }
        // KVO, completion notifications, and SwiftUI updates converge on the
        // main queue; never publish SwiftUI state from updateNSView itself.
        schedule()
    }

    private func schedule() {
        guard !scheduled, settings != nil else { return }
        scheduled = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.scheduled = false
            self.reconcile()
        }
    }

    private func stage(_ url: URL) -> VideoSlot {
        if let spare, spare.url == url { return spare }
        spare?.dispose()
        let slot = VideoSlot(url: url, gravity: gravity)
        spare = slot
        withoutActions {
            slot.layer.frame = track.bounds
            // Behind the opaque front page but attached to the same live tree:
            // the first decoded frame can be prepared without being seen/heard.
            track.insertSublayer(slot.layer, at: 0)
        }
        let changed: () -> Void = { [weak self] in
            DispatchQueue.main.async { [weak self] in self?.schedule() }
        }
        slot.observations = [
            slot.layer.observe(\.isReadyForDisplay, options: [.new]) { _, _ in changed() },
            slot.item.observe(\.status, options: [.new]) { _, _ in changed() },
            slot.player.observe(\.status, options: [.new]) { _, _ in changed() }
        ]
        return slot
    }

    private func prepare(_ slot: VideoSlot, requested: Bool) {
        guard slot.player.status == .readyToPlay, slot.item.status == .readyToPlay,
              !slot.layer.isReadyForDisplay else { return }
        if requested {
            // Some codecs won't present their first frame on preroll alone.
            // Decode muted underneath the current video until the layer signals.
            if !slot.decodingRequestedFrame {
                slot.decodingRequestedFrame = true
                slot.player.cancelPendingPrerolls()
                slot.player.playImmediately(atRate: 1)
            }
        } else if !slot.didPreroll {
            slot.didPreroll = true
            slot.player.preroll(atRate: 1) { _ in }
        }
    }

    private func reconcile() {
        guard let settings, let request = selection else { return }
        applyActivePlayback()
        guard reportedFailure != request else { return }
        guard let url = request.url else { fail(request); return }
        if let active, active.url == url, !active.failedDuringPlayback,
           active.item.status != .failed, active.player.status != .failed {
            active.index = request.index
            announce(request)
            guard retiring == nil else { return }
            if let next = settings.nextURL, next != url {
                // If the user cancelled their page turn while a muted decoder was
                // advancing, discard it rather than preloading from mid-video.
                if spare?.decodingRequestedFrame == true { spare?.dispose(); spare = nil }
                prepare(stage(next), requested: false)
            } else { spare?.dispose(); spare = nil }
            return
        }
        guard retiring == nil else { return } // coalesce quick flicks until the slide ends
        if deadline == nil {
            let timer = DispatchWorkItem { [weak self] in
                guard let self, self.selection == request else { return }
                self.fail(request)
            }
            deadline = timer
            DispatchQueue.main.asyncAfter(deadline: .now() + 12, execute: timer)
        }
        let slot = stage(url)
        if slot.item.status == .failed || slot.player.status == .failed {
            fail(request)
        } else if slot.layer.isReadyForDisplay && slot.item.status == .readyToPlay {
            promote(slot, for: request)
        } else {
            prepare(slot, requested: true)
        }
    }

    private func fail(_ request: Selection) {
        guard request == selection, reportedFailure != request else { return }
        deadline?.cancel()
        deadline = nil
        reportedFailure = request
        spare?.dispose()
        spare = nil
        // Do not clear the last good layer on media/timeout failure.
        settings?.onFailure?(request.url)
    }

    private func announce(_ request: Selection) {
        guard let url = request.url, reportedDisplay != request else { return }
        reportedDisplay = request
        deadline?.cancel()
        deadline = nil
        settings?.onDisplay?(url)
    }

    private func promote(_ slot: VideoSlot, for request: Selection) {
        guard spare === slot, request == selection else { return }
        let previous = active
        stopProgress()
        cancelSeek()
        previous?.player.isMuted = true
        previous?.player.pause()
        spare = nil
        active = slot
        slot.index = request.index
        slot.player.cancelPendingPrerolls()
        slot.item.preferredForwardBufferDuration = 0
        applyActivePlayback()
        observeProgress(slot)
        let height = track.bounds.height
        let shouldSlide = previous != nil && previous?.index != request.index && height > 1
            && !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        if let previous, shouldSlide {
            retiring = previous
            let travel = request.index > previous.index ? height : -height
            withoutActions {
                slot.layer.frame = track.bounds
                previous.layer.frame = track.bounds.offsetBy(dx: 0, dy: travel)
                let animation = CABasicAnimation(keyPath: "transform.translation.y")
                animation.fromValue = -travel
                animation.toValue = 0
                animation.duration = 0.26
                animation.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
                animationID &+= 1
                let id = animationID
                CATransaction.setCompletionBlock { [weak self] in
                    DispatchQueue.main.async { [weak self] in
                        guard let self, self.animationID == id else { return }
                        self.finishSlide()
                    }
                }
                track.add(animation, forKey: "page")
            }
        } else {
            previous?.dispose()
        }
        announce(request)
        schedule()
    }

    private func finishSlide() {
        animationID &+= 1
        track.removeAnimation(forKey: "page")
        retiring?.dispose()
        retiring = nil
        schedule()
    }

    private func applyActivePlayback() {
        guard let slot = active, let settings else { return }
        slot.player.isMuted = settings.isMuted
        let playable = !slot.failedDuringPlayback && slot.item.status != .failed && slot.player.status != .failed
        let rate: Float = settings.isPlaying && playable ? settings.playbackRate : 0
        guard slot.commandedRate != rate else { return }
        slot.commandedRate = rate
        if rate == 0 { slot.player.pause() } else { slot.player.playImmediately(atRate: rate) }
        SleepPreventer.shared.updatePlaybackState(isPlaying: rate > 0)
    }

    private func observeProgress(_ slot: VideoSlot) {
        progressPlayer = slot.player
        progressToken = slot.player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 5),
                                                            queue: .main) { [weak self, weak slot] time in
            MainActor.assumeIsolated { // explicitly registered on DispatchQueue.main above
                guard let self, let slot, self.active === slot, self.selection?.url == slot.url else { return }
                let total = slot.item.duration.seconds
                if total.isFinite, total > 0, time.seconds.isFinite {
                    self.settings?.onProgressUpdate?(time.seconds, total)
                }
            }
        }
    }

    private func stopProgress() {
        if let token = progressToken { progressPlayer?.removeTimeObserver(token) }
        progressToken = nil
        progressPlayer = nil
    }

    // AVFoundation can post completion on a non-main queue.
    @objc nonisolated private func didFailToEnd(_ note: Notification) {
        guard let item = note.object as? AVPlayerItem else { return }
        DispatchQueue.main.async { [weak self, weak item] in
            guard let self, let slot = self.active, slot.item === item else { return }
            slot.failedDuringPlayback = true
            self.applyActivePlayback()
            if let request = self.selection, request.url == slot.url { self.fail(request) }
        }
    }

    @objc nonisolated private func didEnd(_ note: Notification) {
        guard let item = note.object as? AVPlayerItem else { return }
        DispatchQueue.main.async { [weak self, weak item] in
            guard let self, let slot = self.active, slot.item === item, self.settings?.isPlaying == true else { return }
            slot.player.seek(to: .zero) { [weak self, weak slot] finished in
                DispatchQueue.main.async { [weak self, weak slot] in
                    guard let self, let slot, finished, self.active === slot, let settings = self.settings,
                          settings.isPlaying else { return }
                    slot.player.playImmediately(atRate: settings.playbackRate)
                }
            }
        }
    }

    @objc private func seek(_ note: Notification) {
        guard let delta = note.userInfo?["delta"] as? Double,
              let slot = active, selection?.url == slot.url else { return }
        let duration = slot.item.duration.seconds
        let base = seekTarget ?? slot.player.currentTime().seconds
        guard base.isFinite, duration.isFinite, duration > 0 else { return }
        let target = max(0, min(duration, base + delta))
        seekTarget = target
        seekTask?.cancel()
        let job = DispatchWorkItem { [weak self, weak slot] in
            guard let self, let slot, self.active === slot else { return }
            let tolerance = CMTime(seconds: 0.2, preferredTimescale: 600)
            slot.player.seek(to: CMTime(seconds: target, preferredTimescale: 600),
                             toleranceBefore: tolerance, toleranceAfter: tolerance) { [weak self, weak slot] finished in
                DispatchQueue.main.async { [weak self, weak slot] in
                    guard let self, let slot, finished, self.active === slot, self.seekTarget == target else { return }
                    self.seekTarget = nil
                }
            }
        }
        seekTask = job
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05, execute: job)
    }

    private func cancelSeek() {
        seekTask?.cancel()
        seekTask = nil
        seekTarget = nil
    }

    func shutdown() {
        settings = nil
        selection = nil
        cancelSeek()
        deadline?.cancel()
        deadline = nil
        stopProgress()
        finishSlide()
        active?.dispose()
        spare?.dispose()
        active = nil
        spare = nil
        NotificationCenter.default.removeObserver(self)
        SleepPreventer.shared.updatePlaybackState(isPlaying: false)
    }
}
