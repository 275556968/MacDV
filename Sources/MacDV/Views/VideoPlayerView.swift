import SwiftUI
import AVFoundation
import AVKit

// MARK: - Native Video Player View (AVPlayerView)
public struct VideoPlayerView: NSViewRepresentable {
    public let url: URL?
    public let isPlaying: Bool
    public let isMuted: Bool
    public let fillScreen: Bool
    public var onProgressUpdate: ((Double, Double) -> Void)? = nil
    
    public init(url: URL?, isPlaying: Bool, isMuted: Bool, fillScreen: Bool = true, onProgressUpdate: ((Double, Double) -> Void)? = nil) {
        self.url = url
        self.isPlaying = isPlaying
        self.isMuted = isMuted
        self.fillScreen = fillScreen
        self.onProgressUpdate = onProgressUpdate
    }
    
    public func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }
    
    public func makeNSView(context: Context) -> AVPlayerView {
        let playerView = AVPlayerView()
        playerView.controlsStyle = .none
        playerView.videoGravity = fillScreen ? .resizeAspectFill : .resizeAspect
        context.coordinator.setupPlayer(in: playerView)
        return playerView
    }
    
    public func updateNSView(_ nsView: AVPlayerView, context: Context) {
        nsView.videoGravity = fillScreen ? .resizeAspectFill : .resizeAspect
        context.coordinator.update(url: url, isPlaying: isPlaying, isMuted: isMuted, parent: self)
    }
    
    public class Coordinator: NSObject {
        var parent: VideoPlayerView
        var player: AVPlayer?
        weak var playerView: AVPlayerView?
        var timeObserverToken: Any?
        var itemStatusObservation: NSKeyValueObservation?
        var currentUrl: URL?
        
        init(_ parent: VideoPlayerView) {
            self.parent = parent
            super.init()
        }
        
        func setupPlayer(in view: AVPlayerView) {
            let player = AVPlayer()
            player.automaticallyWaitsToMinimizeStalling = false
            self.player = player
            self.playerView = view
            view.player = player
            
            // Loop playback notification
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(playerItemDidReachEnd),
                name: .AVPlayerItemDidPlayToEndTime,
                object: nil
            )
            
            // Seek delta notification
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(handleSeekNotification(_:)),
                name: Notification.Name("MacDVSeekDelta"),
                object: nil
            )
            
            // Time observer
            let interval = CMTime(seconds: 0.2, preferredTimescale: CMTimeScale(NSEC_PER_SEC))
            timeObserverToken = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
                guard let self = self, let currentItem = self.player?.currentItem else { return }
                let current = time.seconds
                let total = currentItem.duration.seconds
                if total.isFinite && total > 0 {
                    self.parent.onProgressUpdate?(current, total)
                }
            }
        }
        
        var pendingSeekTarget: Double? = nil
        var seekDebounceTimer: Timer? = nil
        
        @objc func handleSeekNotification(_ notification: Notification) {
            guard let delta = notification.userInfo?["delta"] as? Double,
                  let player = self.player,
                  let currentItem = player.currentItem else { return }
            
            let durationSeconds = currentItem.duration.seconds
            guard durationSeconds.isFinite && durationSeconds > 0 else { return }
            
            let baseSeconds = pendingSeekTarget ?? player.currentTime().seconds
            let targetSeconds = max(0, min(durationSeconds, baseSeconds + delta))
            pendingSeekTarget = targetSeconds
            
            seekDebounceTimer?.invalidate()
            seekDebounceTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: false) { [weak self] _ in
                guard let self = self, let target = self.pendingSeekTarget, let player = self.player else { return }
                let targetTime = CMTime(seconds: target, preferredTimescale: 600)
                player.seek(to: targetTime, toleranceBefore: CMTime(seconds: 0.2, preferredTimescale: 600), toleranceAfter: CMTime(seconds: 0.2, preferredTimescale: 600)) { [weak self] _ in
                    guard let self = self else { return }
                    self.pendingSeekTarget = nil
                    if self.parent.isPlaying {
                        self.player?.play()
                        SleepPreventer.shared.updatePlaybackState(isPlaying: true)
                    }
                }
            }
        }
        
        func update(url: URL?, isPlaying: Bool, isMuted: Bool, parent: VideoPlayerView) {
            self.parent = parent
            guard let player = self.player else { return }
            
            player.isMuted = isMuted
            
            if currentUrl != url {
                currentUrl = url
                itemStatusObservation?.invalidate()
                itemStatusObservation = nil
                
                if let url = url {
                    print("🎬 [VideoPlayerView] Loading URL: \(url.absoluteString)")
                    let headers = [
                        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
                        "Referer": "https://www.douyin.com/"
                    ]
                    let asset = AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": headers])
                    let item = AVPlayerItem(asset: asset)
                    
                    itemStatusObservation = item.observe(\.status, options: [.new]) { [weak self] observedItem, _ in
                        guard let self = self else { return }
                        if observedItem.status == .readyToPlay {
                            print("🎬 [VideoPlayerView] Item ready to play! Duration: \(observedItem.duration.seconds)s")
                            if self.parent.isPlaying {
                                self.player?.play()
                                SleepPreventer.shared.updatePlaybackState(isPlaying: true)
                            }
                        } else if observedItem.status == .failed {
                            print("❌ [VideoPlayerView] Item failed: \(String(describing: observedItem.error))")
                            SleepPreventer.shared.updatePlaybackState(isPlaying: false)
                        }
                    }
                    
                    player.replaceCurrentItem(with: item)
                    if isPlaying {
                        player.play()
                        SleepPreventer.shared.updatePlaybackState(isPlaying: true)
                    } else {
                        SleepPreventer.shared.updatePlaybackState(isPlaying: false)
                    }
                } else {
                    player.replaceCurrentItem(with: nil)
                    SleepPreventer.shared.updatePlaybackState(isPlaying: false)
                }
            } else {
                if isPlaying {
                    if player.rate == 0 {
                        player.play()
                    }
                    SleepPreventer.shared.updatePlaybackState(isPlaying: true)
                } else {
                    if player.rate != 0 {
                        player.pause()
                    }
                    SleepPreventer.shared.updatePlaybackState(isPlaying: false)
                }
            }
        }
        
        @objc func playerItemDidReachEnd(notification: Notification) {
            if let player = self.player {
                player.seek(to: .zero)
                player.play()
                SleepPreventer.shared.updatePlaybackState(isPlaying: true)
            }
        }
        
        deinit {
            NotificationCenter.default.removeObserver(self)
            itemStatusObservation?.invalidate()
            seekDebounceTimer?.invalidate()
            if let token = timeObserverToken, let player = self.player {
                player.removeTimeObserver(token)
            }
            SleepPreventer.shared.updatePlaybackState(isPlaying: false)
        }
    }
}
