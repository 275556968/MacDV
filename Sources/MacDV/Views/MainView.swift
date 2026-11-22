import SwiftUI
import AppKit

public struct MainView: View {
    @ObservedObject private var engine = DouyinEngine.shared
    
    @State private var items: [AwemeItem] = []
    @State private var currentIndex: Int = 0
    @State private var feedTask: Task<Void, Never>?
    @State private var feedGeneration = 0
    @State private var feedMessage: String?
    @State private var queueChannel: FeedChannel?
    @State private var advanceWhenLoaded = false
    @State private var isPaused: Bool = false
    @State private var isMuted: Bool = false
    @State private var currentProgress: Double = 0.0
    
    // Selection can get ahead of the display while a new stream decodes.
    @State private var displayedItem: AwemeItem?
    @State private var failedID: String?
    @State private var standardStreamID: String?
    @State private var retryID = 0
    @State private var showWaitHint = false
    @State private var eventMonitor: Any?
    private enum HoldInput { case arrow, mouse }
    @State private var holdInput: HoldInput?
    @State private var boostTimer: Timer?
    @State private var boosting = false

    // Display & Window state
    @State private var fillScreen: Bool = true
    @State private var isFullScreen: Bool = false
    @State private var isControlsVisible: Bool = true
    @State private var autoHideTimer: Timer? = nil
    
    // Pure Video Mode
    @AppStorage("startInPureMode") private var startInPureMode: Bool = false
    @AppStorage("autoPureInFullscreen") private var autoPureInFullscreen: Bool = true
    @State private var isPureMode: Bool = false
    @State private var showPureToast: Bool = false
    @State private var pureToastMessage: String = ""
    
    @State private var showLoginSheet: Bool = false
    @State private var showCommentSheet: Bool = false
    @State private var showSettingsSheet: Bool = false
    @State private var isAlwaysOnTop: Bool = false
    
    @State private var scrollAccumulator: CGFloat = 0
    @State private var hasTriggeredForCurrentGesture: Bool = false
    @State private var lastSwitchTimestamp: TimeInterval = 0
    private let scrollThreshold: CGFloat = 30.0
    
    @AppStorage("preferHighestQuality") private var preferHighestQuality: Bool = true
    
    // Seek configuration & state
    @AppStorage("seekStepSeconds") private var seekStepSeconds: Int = 10
    @State private var currentTime: Double = 0.0
    @State private var totalDuration: Double = 0.0
    @State private var showSeekToast: Bool = false
    @State private var seekToastMessage: String = ""
    @State private var seekToastProgress: Double = 0.0
    @State private var seekToastDirectionIsForward: Bool = true
    @State private var seekToastTimer: Timer? = nil
    
    public init() {}
    
    public var currentItem: AwemeItem? {
        guard currentIndex >= 0 && currentIndex < items.count else { return nil }
        return items[currentIndex]
    }
    
    private func playbackURL(for item: AwemeItem) -> URL? {
        if preferHighestQuality && standardStreamID != item.id {
            return item.highestQualityUrl
        }
        return item.video?.playUrl ?? item.highestQualityUrl
    }

    private var followingURL: URL? {
        let next = currentIndex + 1
        return items.indices.contains(next) ? playbackURL(for: items[next]) : nil
    }

    @ViewBuilder
    private func playbackStatus(for item: AwemeItem) -> some View {
        if failedID == item.id {
            VStack(spacing: 10) {
                Text("这条视频暂时无法播放")
                HStack {
                    Button("重试") { failedID = nil; standardStreamID = nil; retryID += 1 }
                    Button("下一条") { nextVideo() }
                }
            }
            .padding(14)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
        } else if displayedItem == nil || (showWaitHint && displayedItem?.id != item.id) {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text(displayedItem == nil ? "正在准备第一帧…" : "正在缓冲视频…")
            }
            .font(.callout)
            .padding(12)
            .background(.regularMaterial, in: Capsule())
            .allowsHitTesting(false)
        }
    }

    public var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            
            if let item = currentItem {
                // Video Player Layer
                VideoPlayerView(
                    url: playbackURL(for: item),
                    nextURL: followingURL,
                    pageIndex: currentIndex,
                    retryID: retryID,
                    isPlaying: !isPaused,
                    isMuted: isMuted,
                    fillScreen: fillScreen,
                    playbackRate: boosting ? 2 : 1,
                    onDisplay: { url in
                        guard let selected = currentItem, playbackURL(for: selected) == url else { return }
                        displayedItem = selected
                        failedID = nil
                        showWaitHint = false
                    },
                    onFailure: { url in
                        guard let selected = currentItem, playbackURL(for: selected) == url else { return }
                        if preferHighestQuality, let fallback = selected.video?.playUrl, fallback != url {
                            standardStreamID = selected.id
                        } else {
                            failedID = selected.id
                        }
                    }
                ) { current, total in
                    self.currentTime = current
                    self.totalDuration = total
                    if total > 0 {
                        self.currentProgress = current / total
                    }
                }
                .ignoresSafeArea()
                .task(id: item.id) {
                    showWaitHint = false
                    try? await Task.sleep(nanoseconds: 400_000_000)
                    guard !Task.isCancelled, displayedItem?.id != item.id else { return }
                    showWaitHint = true
                }
                
                // Action & Metadata Overlay
                if let visible = displayedItem {
                    VideoActionOverlay(
                        aweme: visible,
                        isPaused: isPaused,
                        progress: currentProgress,
                        isControlsVisible: isControlsVisible,
                        isPureMode: isPureMode,
                        onTogglePlay: {
                            isPaused.toggle()
                            resetControlsTimer()
                        },
                        onOpenComment: {
                            showCommentSheet.toggle()
                        },
                        onToggleFullScreen: {
                            toggleFullScreen()
                        }
                    )
                    .id(visible.id) // Reset only the overlay, never the playback surface.
                }
                playbackStatus(for: item)
                if boosting {
                    VStack {
                        Text("2× 倍速播放").font(.caption.bold()).padding(8)
                            .background(.regularMaterial, in: Capsule())
                        Spacer()
                    }.padding(.top, 50).allowsHitTesting(false)
                }
            } else {
                // Loading or Empty State
                VStack(spacing: 16) {
                    ProgressView()
                        .scaleEffect(1.2)
                    Text(feedMessage ?? engine.statusMessage)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.white.opacity(0.8))
                    
                    if feedTask == nil && items.isEmpty {
                        Button("点击刷新视频流") {
                            loadFeed(reset: true)
                        }
                        .buttonStyle(.borderedProminent)
                    }
                }
            }
            
            // Top Navigation & Control Toolbar
            VStack {
                HStack(spacing: 12) {
                    // Logo
                    HStack(spacing: 6) {
                        Image(systemName: "play.tv.fill")
                            .font(.system(size: 14))
                            .foregroundColor(.pink)
                        Text("MacDV")
                            .font(.system(size: 13, weight: .heavy, design: .rounded))
                            .foregroundColor(.white)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Capsule().fill(Color.black.opacity(0.45)))
                    
                    // Channel Switcher (横屏精选 vs 综合推荐)
                    Picker("", selection: Binding(
                        get: { engine.currentChannel },
                        set: { newChan in
                            engine.switchChannel(newChan)
                            loadFeed(reset: true)
                        }
                    )) {
                        Text("📺 横屏精选").tag(FeedChannel.jingxuan)
                        Text("📱 综合推荐").tag(FeedChannel.recommend)
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 175)
                    
                    Spacer()
                    
                    // Pure Mode Toggle Button
                    Button(action: togglePureMode) {
                        Image(systemName: isPureMode ? "sparkles.tv.fill" : "sparkles.tv")
                            .font(.system(size: 13))
                            .foregroundColor(isPureMode ? .purple : .white.opacity(0.85))
                            .frame(width: 28, height: 28)
                            .background(Circle().fill(Color.black.opacity(0.45)))
                    }
                    .buttonStyle(.plain)
                    .help(isPureMode ? "退出纯净模式 (H)" : "纯净模式 (H)：全屏仅显示视频")
                    
                    // Fill Screen Mode Toggle
                    Button(action: {
                        fillScreen.toggle()
                        resetControlsTimer()
                    }) {
                        Image(systemName: fillScreen ? "arrow.up.left.and.arrow.down.right.square.fill" : "aspectratio")
                            .font(.system(size: 13))
                            .foregroundColor(fillScreen ? .cyan : .white.opacity(0.85))
                            .frame(width: 28, height: 28)
                            .background(Circle().fill(Color.black.opacity(0.45)))
                    }
                    .buttonStyle(.plain)
                    .help(fillScreen ? "画面模式：铺满屏幕 (按 S 切换原始比例)" : "画面模式：原始比例 (按 S 切换铺满)")
                    
                    // Fullscreen Toggle
                    Button(action: {
                        toggleFullScreen()
                        resetControlsTimer()
                    }) {
                        Image(systemName: isFullScreen ? "arrow.down.right.and.arrow.up.left" : "viewfinder")
                            .font(.system(size: 13))
                            .foregroundColor(.white.opacity(0.85))
                            .frame(width: 28, height: 28)
                            .background(Circle().fill(Color.black.opacity(0.45)))
                    }
                    .buttonStyle(.plain)
                    .help("全屏模式 (F)")
                    
                    // Pin to top button
                    Button(action: togglePinOnTop) {
                        Image(systemName: isAlwaysOnTop ? "pin.fill" : "pin")
                            .font(.system(size: 13))
                            .foregroundColor(isAlwaysOnTop ? .yellow : .white.opacity(0.85))
                            .frame(width: 28, height: 28)
                            .background(Circle().fill(Color.black.opacity(0.45)))
                    }
                    .buttonStyle(.plain)
                    .help(isAlwaysOnTop ? "取消置顶 (T)" : "窗口置顶 (T)")
                    
                    // Mute / Unmute
                    Button(action: { isMuted.toggle() }) {
                        Image(systemName: isMuted ? "speaker.slash.fill" : "speaker.wave.2.fill")
                            .font(.system(size: 13))
                            .foregroundColor(.white.opacity(0.85))
                            .frame(width: 28, height: 28)
                            .background(Circle().fill(Color.black.opacity(0.45)))
                    }
                    .buttonStyle(.plain)
                    .help(isMuted ? "开启声音 (M)" : "静音 (M)")
                    
                    // Refresh Feed
                    Button(action: { loadFeed(reset: true) }) {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 13))
                            .foregroundColor(.white.opacity(0.85))
                            .frame(width: 28, height: 28)
                            .background(Circle().fill(Color.black.opacity(0.45)))
                    }
                    .buttonStyle(.plain)
                    .help("刷新推荐流 (R)")
                    
                    // Login / Account status
                    Button(action: { showLoginSheet = true }) {
                        HStack(spacing: 5) {
                            Circle()
                                .fill(engine.isLoggedIn ? Color.green : Color.orange)
                                .frame(width: 7, height: 7)
                            Text(engine.isLoggedIn ? "已登录" : "登录")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundColor(.white)
                        }
                        .padding(.horizontal, 9)
                        .padding(.vertical, 5)
                        .background(Capsule().fill(Color.black.opacity(0.45)))
                    }
                    .buttonStyle(.plain)
                    .help("登录抖音账号以获取个性化推荐")
                    
                    // Settings Button
                    Button(action: { showSettingsSheet = true }) {
                        Image(systemName: "gearshape.fill")
                            .font(.system(size: 13))
                            .foregroundColor(.white.opacity(0.85))
                            .frame(width: 28, height: 28)
                            .background(Circle().fill(Color.black.opacity(0.45)))
                    }
                    .buttonStyle(.plain)
                    .help("设置与快捷键")
                }
                .padding(.horizontal, 14)
                .padding(.top, 10)
                .opacity(!isPureMode && (isControlsVisible || isPaused) ? 1.0 : 0.0)
                .allowsHitTesting(!isPureMode)
                .animation(.easeInOut(duration: 0.25), value: !isPureMode && (isControlsVisible || isPaused))
                
                Spacer()
            }
            
            // Floating Pure Mode Toast
            if showPureToast {
                VStack {
                    Spacer().frame(height: 52)
                    HStack(spacing: 8) {
                        Image(systemName: isPureMode ? "sparkles.tv.fill" : "tv")
                            .foregroundColor(.cyan)
                        Text(pureToastMessage)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(.white)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 9)
                    .background(Capsule().fill(Color.black.opacity(0.85)))
                    .overlay(Capsule().stroke(Color.white.opacity(0.2), lineWidth: 1))
                    .shadow(radius: 8)
                    Spacer()
                }
                .transition(.move(edge: .top).combined(with: .opacity))
                .zIndex(100)
            }
            
            // Floating Seek HUD Toast (Appears on Left/Right Arrow Key)
            if showSeekToast {
                VStack(spacing: 9) {
                    HStack(spacing: 10) {
                        Image(systemName: seekToastDirectionIsForward ? "forward.fill" : "backward.fill")
                            .font(.system(size: 20, weight: .bold))
                            .foregroundColor(.cyan)
                        
                        Text(seekToastMessage)
                            .font(.system(size: 15, weight: .semibold, design: .monospaced))
                            .foregroundColor(.white)
                    }
                    
                    // Mini progress bar in HUD
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule()
                                .fill(Color.white.opacity(0.2))
                            Capsule()
                                .fill(
                                    LinearGradient(
                                        colors: [Color.cyan, Color.blue],
                                        startPoint: .leading,
                                        endPoint: .trailing
                                    )
                                )
                                .frame(width: max(0, min(geo.size.width, geo.size.width * CGFloat(seekToastProgress))))
                        }
                    }
                    .frame(width: 180, height: 4)
                }
                .padding(.horizontal, 22)
                .padding(.vertical, 14)
                .background(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(Color.black.opacity(0.85))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color.white.opacity(0.18), lineWidth: 1)
                )
                .shadow(color: Color.black.opacity(0.5), radius: 15, x: 0, y: 5)
                .transition(.scale(scale: 0.9).combined(with: .opacity))
                .zIndex(150)
            }
            
            // Side Drawer Comment Overlay
            if showCommentSheet, let item = displayedItem {
                HStack {
                    Spacer()
                    CommentSheetView(awemeId: item.awemeId) {
                        withAnimation(.spring()) {
                            showCommentSheet = false
                        }
                    }
                    .frame(width: 380)
                    .transition(.move(edge: .trailing))
                    .shadow(radius: 12)
                }
            }
        }
        .frame(minWidth: 720, idealWidth: 1120, maxWidth: .infinity,
               minHeight: 450, idealHeight: 700, maxHeight: .infinity)
        .sheet(isPresented: $showLoginSheet) {
            LoginSheetView(
                onLoginSuccess: {
                    loadFeed(reset: true)
                },
                onClose: {
                    showLoginSheet = false
                }
            )
        }
        .sheet(isPresented: $showSettingsSheet) {
            SettingsView(onClose: {
                showSettingsSheet = false
            })
        }
        .onAppear {
            setupEventMonitor()
            if startInPureMode {
                isPureMode = true
                triggerPureToast("已开启启动纯净模式 (按 H 恢复显示)")
            } else {
                resetControlsTimer()
            }
            if items.isEmpty { loadFeed() }
        }
        .onDisappear {
            cancelFeedRequest()
        }
        .onDisappear {
            cancelBoost()
            if let eventMonitor { NSEvent.removeMonitor(eventMonitor) }
            eventMonitor = nil
            autoHideTimer?.invalidate()
            seekToastTimer?.invalidate()
        }
        .onChange(of: currentItem?.id) { newID in
            cancelBoost()
            if failedID != newID { failedID = nil }
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didResignActiveNotification)) { _ in
            cancelBoost()
        }
        .onReceive(NotificationCenter.default.publisher(for: NSWindow.didResignKeyNotification)) { _ in
            cancelBoost()
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("MacDVForwardStep"))) { _ in
            if !showSettingsSheet && !showLoginSheet { seekVideo(by: Double(seekStepSeconds)) }
        }
        .onReceive(NotificationCenter.default.publisher(for: NSWindow.didEnterFullScreenNotification)) { _ in
            self.isFullScreen = true
            if self.autoPureInFullscreen {
                withAnimation(.easeInOut(duration: 0.25)) {
                    self.isPureMode = true
                }
                self.triggerPureToast("全屏纯净模式：全屏仅保留视频 (按 H 显示界面)")
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: NSWindow.willExitFullScreenNotification)) { _ in
            self.isFullScreen = false
            if self.autoPureInFullscreen {
                withAnimation(.easeInOut(duration: 0.25)) {
                    self.isPureMode = false
                    self.isControlsVisible = true
                }
                self.resetControlsTimer()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: NSWindow.didExitFullScreenNotification)) { _ in
            self.isFullScreen = false
            if self.autoPureInFullscreen {
                withAnimation(.easeInOut(duration: 0.25)) {
                    self.isPureMode = false
                    self.isControlsVisible = true
                }
                self.resetControlsTimer()
            }
        }
    }
    
    // MARK: - Actions & Navigation
    private func selectVideo(_ index: Int) {
        guard items.indices.contains(index) else { return }
        currentIndex = index
        currentTime = 0
        totalDuration = 0
        currentProgress = 0
        isPaused = false
        if !isPureMode { resetControlsTimer() }
    }

    private func nextVideo() {
        guard queueChannel == engine.currentChannel, !items.isEmpty else {
            if feedTask == nil { loadFeed(reset: true) }
            return
        }
        if currentIndex + 1 < items.count {
            advanceWhenLoaded = false
            selectVideo(currentIndex + 1)
            if currentIndex >= items.count - 3 { loadMoreFeed() }
        } else {
            // Coalesce wheel/key presses at the boundary into a single step.
            advanceWhenLoaded = true
            loadMoreFeed()
        }
    }

    private func previousVideo() {
        advanceWhenLoaded = false
        if currentIndex > 0 { selectVideo(currentIndex - 1) }
    }

    private func cancelFeedRequest() {
        feedGeneration &+= 1
        feedTask?.cancel()
        feedTask = nil
        advanceWhenLoaded = false
    }

    private func loadFeed(reset: Bool = false) {
        if reset {
            cancelFeedRequest()
            if engine.needsNavigationRetry { engine.loadDouyinHome() }
        }
        requestFeed(replace: true)
    }

    private func loadMoreFeed() {
        requestFeed(replace: false)
    }

    private func requestFeed(replace: Bool) {
        guard feedTask == nil else { return }
        let generation = feedGeneration
        let channel = engine.currentChannel
        feedMessage = replace ? "正在获取\(channel.rawValue)…" : nil
        feedTask = Task { @MainActor in
            var prefetchSmallFirstBatch = false
            defer {
                if feedGeneration == generation {
                    feedTask = nil
                    advanceWhenLoaded = false
                    if prefetchSmallFirstBatch { loadMoreFeed() }
                }
            }
            do {
                let existing = replace ? Set<String>() : Set(items.map(\.awemeId))
                for attempt in 0..<3 {
                    try Task.checkCancellation()
                    guard generation == feedGeneration, channel == engine.currentChannel else { return }
                    var known = existing
                    let batch: [AwemeItem]
                    do {
                        batch = try await engine.fetchFeed(count: 10)
                    } catch {
                        try Task.checkCancellation()
                        // On the first page WebKit can finish navigating before the
                        // service returns usable JSON. Retry only that fast failure.
                        if !DouyinEngine.canRetryWarmupFailure(error) || attempt == 2 { throw error }
                        batch = []
                    }
                    try Task.checkCancellation()
                    guard generation == feedGeneration, channel == engine.currentChannel else { return }
                    let fresh = batch.filter { !$0.awemeId.isEmpty && known.insert($0.awemeId).inserted }
                    if !fresh.isEmpty {
                        feedMessage = nil
                        if replace {
                            // Commit only after success. Keep the current video visible
                            // throughout a refresh, including on timeout or empty results.
                            items = fresh
                            queueChannel = channel
                            selectVideo(0)
                            prefetchSmallFirstBatch = fresh.count <= 3
                        } else {
                            let oldCount = items.count
                            items.append(contentsOf: fresh)
                            if advanceWhenLoaded && currentIndex == oldCount - 1 {
                                selectVideo(oldCount)
                            }
                        }
                        return
                    }
                    if attempt < 2 {
                        // The final attempt reaches the old 2.5-second warm-up
                        // window, without charging that delay to a healthy launch.
                        try await Task.sleep(nanoseconds: attempt == 0 ? 650_000_000 : 1_850_000_000)
                    }
                }
                throw NSError(domain: "MacDV.Feed", code: 1, userInfo: [
                    NSLocalizedDescriptionKey: "暂时没有新的可播放视频"
                ])
            } catch {
                guard generation == feedGeneration, channel == engine.currentChannel, !Task.isCancelled else { return }
                let message = "\(error.localizedDescription)，可点刷新重试"
                feedMessage = message
                if !items.isEmpty && (replace || advanceWhenLoaded) { triggerPureToast(message) }
            }
        }
    }

    private func togglePinOnTop() {
        isAlwaysOnTop.toggle()
        if let window = NSApplication.shared.windows.first {
            window.level = isAlwaysOnTop ? .floating : .normal
        }
        if !isPureMode { resetControlsTimer() }
    }
    
    private func toggleFullScreen() {
        if let window = NSApplication.shared.keyWindow ?? NSApplication.shared.windows.first {
            window.toggleFullScreen(nil)
        }
    }
    
    private func togglePureMode() {
        withAnimation(.easeInOut(duration: 0.25)) {
            isPureMode.toggle()
            if !isPureMode {
                isControlsVisible = true
            }
        }
        if !isPureMode {
            resetControlsTimer()
        }
        triggerPureToast(isPureMode ? "纯净模式已开启：全屏仅保留视频 (按 H 恢复)" : "已退出纯净模式，恢复按键")
    }
    
    private func triggerPureToast(_ msg: String) {
        pureToastMessage = msg
        withAnimation(.easeInOut(duration: 0.2)) {
            showPureToast = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.4) {
            withAnimation(.easeInOut(duration: 0.3)) {
                self.showPureToast = false
            }
        }
    }
    
    private func resetControlsTimer() {
        guard !isPureMode else { return }
        withAnimation(.easeInOut(duration: 0.2)) {
            isControlsVisible = true
        }
        autoHideTimer?.invalidate()
        if !isPaused {
            autoHideTimer = Timer.scheduledTimer(withTimeInterval: 3.5, repeats: false) { _ in
                Task { @MainActor in
                    withAnimation(.easeInOut(duration: 0.35)) {
                        self.isControlsVisible = false
                    }
                }
            }
        }
    }
    
    // MARK: - Seeking
    private func seekVideo(by delta: Double) {
        guard let displayedItem, displayedItem.id == currentItem?.id else { return }
        let current = currentTime
        let total = totalDuration
        
        let targetTime: Double
        if total > 0 {
            targetTime = max(0, min(total, current + delta))
            currentTime = targetTime
            currentProgress = targetTime / total
        } else {
            targetTime = max(0, current + delta)
            currentTime = targetTime
        }
        
        // Post seek event to AVPlayer
        NotificationCenter.default.post(
            name: Notification.Name("MacDVSeekDelta"),
            object: nil,
            userInfo: ["delta": delta]
        )
        
        // Trigger Seek HUD Toast
        triggerSeekToast(delta: delta, currentTime: targetTime, totalDuration: total)
        
        if !isPureMode {
            resetControlsTimer()
        }
    }
    
    private func triggerSeekToast(delta: Double, currentTime: Double, totalDuration: Double) {
        let isForward = delta > 0
        seekToastDirectionIsForward = isForward
        
        let sign = isForward ? "+" : "-"
        let sec = Int(abs(delta))
        let timeStr = formatTime(currentTime)
        let totalStr = totalDuration > 0 ? formatTime(totalDuration) : "--:--"
        seekToastMessage = "\(sign)\(sec)s  (\(timeStr) / \(totalStr))"
        if totalDuration > 0 {
            seekToastProgress = currentTime / totalDuration
        }
        
        seekToastTimer?.invalidate()
        withAnimation(.easeOut(duration: 0.15)) {
            showSeekToast = true
        }
        seekToastTimer = Timer.scheduledTimer(withTimeInterval: 1.2, repeats: false) { _ in
            Task { @MainActor in
                withAnimation(.easeInOut(duration: 0.25)) {
                    self.showSeekToast = false
                }
            }
        }
    }
    
    private func formatTime(_ seconds: Double) -> String {
        guard seconds.isFinite && !seconds.isNaN && seconds >= 0 else { return "00:00" }
        let totalSec = Int(seconds)
        let min = totalSec / 60
        let sec = totalSec % 60
        if min >= 60 {
            let hour = min / 60
            let remMin = min % 60
            return String(format: "%02d:%02d:%02d", hour, remMin, sec)
        } else {
            return String(format: "%02d:%02d", min, sec)
        }
    }
    
    // MARK: - Keyboard & Trackpad Monitors
    private func beginHold(_ input: HoldInput) {
        guard holdInput == nil else { return }
        holdInput = input
        boostTimer = Timer.scheduledTimer(withTimeInterval: 0.28, repeats: false) { _ in
            Task { @MainActor in
                guard holdInput == input, !isPaused, let displayedItem,
                      displayedItem.id == currentItem?.id else { return }
                boosting = true
            }
        }
    }

    private func cancelBoost() {
        boostTimer?.invalidate()
        boostTimer = nil
        holdInput = nil
        boosting = false
    }

    private func setupEventMonitor() {
        guard eventMonitor == nil else { return }
        eventMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .keyUp, .rightMouseDown, .rightMouseUp, .scrollWheel, .mouseMoved]) { event in
            if event.type == .rightMouseUp && holdInput == .mouse {
                cancelBoost()
                return nil
            }
            if event.type == .keyUp && event.keyCode == 124 && holdInput == .arrow {
                let shouldSeek = !boosting
                cancelBoost()
                if shouldSeek { seekVideo(by: Double(seekStepSeconds)) }
                return nil
            }
            guard !showSettingsSheet, !showLoginSheet, event.window?.sheetParent == nil,
                  !event.modifierFlags.contains(.command) else { return event }
            if showCommentSheet, event.type == .scrollWheel { return event }
            if event.type == .rightMouseDown && !showCommentSheet {
                beginHold(.mouse)
                return nil
            }
            if event.type == .mouseMoved {
                if !isPureMode { resetControlsTimer() }
                return event
            }
            
            if event.type == .keyDown {
                switch event.keyCode {
                case 49: // Space
                    isPaused.toggle()
                    if !isPureMode { resetControlsTimer() }
                    return nil
                case 123: // Left Arrow -> Seek backward
                    seekVideo(by: -Double(seekStepSeconds))
                    return nil
                case 124: // Tap to seek, hold to play at 2x
                    if !event.isARepeat { beginHold(.arrow) }
                    return nil
                case 125, 38: // Down Arrow or 'J'
                    nextVideo()
                    return nil
                case 126, 40: // Up Arrow or 'K'
                    previousVideo()
                    return nil
                case 4: // 'H' key -> Toggle Pure Mode
                    togglePureMode()
                    return nil
                case 1: // 'S' key -> Toggle fill screen mode
                    fillScreen.toggle()
                    if !isPureMode { resetControlsTimer() }
                    return nil
                case 3: // 'F' key -> Toggle Fullscreen
                    toggleFullScreen()
                    return nil
                case 53: // Escape key -> Exit fullscreen or pure mode and restore controls
                    if isFullScreen {
                        toggleFullScreen()
                        return nil
                    } else if isPureMode {
                        togglePureMode()
                        return nil
                    }
                case 46: // 'M' key -> Toggle mute
                    isMuted.toggle()
                    if !isPureMode { resetControlsTimer() }
                    return nil
                case 8: // 'C' key -> Toggle comments
                    withAnimation {
                        showCommentSheet.toggle()
                    }
                    if !isPureMode { resetControlsTimer() }
                    return nil
                case 15: // 'R' key -> Refresh feed
                    loadFeed(reset: true)
                    if !isPureMode { resetControlsTimer() }
                    return nil
                case 17: // 'T' key -> Pin window
                    togglePinOnTop()
                    if !isPureMode { resetControlsTimer() }
                    return nil
                default:
                    break
                }
            } else if event.type == .scrollWheel {
                if !isPureMode { resetControlsTimer() }
                // Ignore inertia momentum scrolling completely to prevent runaway skips
                if !event.momentumPhase.isEmpty {
                    return event
                }
                
                // Trackpad gesture handling
                if event.phase == .began {
                    scrollAccumulator = 0
                    hasTriggeredForCurrentGesture = false
                } else if event.phase == .ended || event.phase == .cancelled {
                    scrollAccumulator = 0
                    hasTriggeredForCurrentGesture = false
                } else if event.phase == .changed {
                    if !hasTriggeredForCurrentGesture {
                        scrollAccumulator += event.scrollingDeltaY
                        if scrollAccumulator < -scrollThreshold {
                            hasTriggeredForCurrentGesture = true
                            scrollAccumulator = 0
                            nextVideo()
                        } else if scrollAccumulator > scrollThreshold {
                            hasTriggeredForCurrentGesture = true
                            scrollAccumulator = 0
                            previousVideo()
                        }
                    }
                } else if event.phase.isEmpty {
                    // Traditional mouse wheel (discrete steps)
                    let now = ProcessInfo.processInfo.systemUptime
                    if now - lastSwitchTimestamp > 0.45 {
                        let deltaY = event.scrollingDeltaY
                        if deltaY < 0 {
                            lastSwitchTimestamp = now
                            nextVideo()
                        } else if deltaY > 0 {
                            lastSwitchTimestamp = now
                            previousVideo()
                        }
                    }
                }
            }
            return event
        }
    }
}
