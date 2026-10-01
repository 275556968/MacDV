import Foundation
import AppKit
import IOKit.pwr_mgt

/// SleepPreventer manages macOS system power assertions to prevent the display from
/// dimming, turning off, or going to sleep during video playback.
public final class SleepPreventer: @unchecked Sendable {
    public static let shared = SleepPreventer()
    
    private let lock = NSLock()
    private var assertionID: IOPMAssertionID = 0
    private var hasAssertion: Bool = false
    private var isPlayingVideo: Bool = false
    
    private init() {
        // Automatically release assertion when application is about to terminate
        NotificationCenter.default.addObserver(
            forName: NSApplication.willTerminateNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.allowSleep()
        }
    }
    
    /// Updates whether video is currently playing and acquires or releases sleep assertion accordingly.
    public func updatePlaybackState(isPlaying: Bool) {
        lock.lock()
        defer { lock.unlock() }
        self.isPlayingVideo = isPlaying
        evaluateAssertionLocked()
    }
    
    /// Notifies that the user preference for display sleep prevention has changed.
    public func preferenceDidChange() {
        lock.lock()
        defer { lock.unlock() }
        evaluateAssertionLocked()
    }
    
    private func evaluateAssertionLocked() {
        let isEnabledInSettings = UserDefaults.standard.object(forKey: "preventDisplaySleep") as? Bool ?? true
        
        if isPlayingVideo && isEnabledInSettings {
            preventSleepLocked()
        } else {
            allowSleepLocked()
        }
    }
    
    /// Explicitly acquires the PreventUserIdleDisplaySleep assertion
    public func preventSleep(reason: String = "MacDV Video Playback") {
        lock.lock()
        defer { lock.unlock() }
        preventSleepLocked(reason: reason)
    }
    
    private func preventSleepLocked(reason: String = "MacDV Video Playback") {
        guard !hasAssertion else { return }
        
        var newAssertionID: IOPMAssertionID = 0
        let result = IOPMAssertionCreateWithName(
            kIOPMAssertionTypePreventUserIdleDisplaySleep as CFString,
            IOPMAssertionLevel(kIOPMAssertionLevelOn),
            reason as CFString,
            &newAssertionID
        )
        
        if result == kIOReturnSuccess {
            assertionID = newAssertionID
            hasAssertion = true
            print("💡 [SleepPreventer] 已阻止屏幕休眠 (Assertion ID: \(assertionID))")
        } else {
            print("⚠️ [SleepPreventer] 创建休眠阻止断言失败: \(result)")
        }
    }
    
    /// Explicitly releases the PreventUserIdleDisplaySleep assertion
    public func allowSleep() {
        lock.lock()
        defer { lock.unlock() }
        allowSleepLocked()
    }
    
    private func allowSleepLocked() {
        guard hasAssertion else { return }
        
        let result = IOPMAssertionRelease(assertionID)
        if result == kIOReturnSuccess {
            print("💤 [SleepPreventer] 已释放休眠阻止断言 (ID: \(assertionID))，恢复正常休眠")
        } else {
            print("⚠️ [SleepPreventer] 释放休眠阻止断言失败: \(result)")
        }
        assertionID = 0
        hasAssertion = false
    }
    
    deinit {
        lock.lock()
        defer { lock.unlock() }
        if hasAssertion {
            IOPMAssertionRelease(assertionID)
        }
    }
}
