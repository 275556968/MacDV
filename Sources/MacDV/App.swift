import SwiftUI
import AppKit

@main
struct MacDVApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    
    var body: some Scene {
        WindowGroup {
            MainView()
                .preferredColorScheme(.dark)
        }
        .windowStyle(.hiddenTitleBar)
        .windowToolbarStyle(.unifiedCompact)
        .commands {
            CommandGroup(replacing: .newItem) {}
            CommandMenu("控制") {
                Button("下一个视频") {
                    postKeyEvent(keyCode: 125)
                }
                .keyboardShortcut(.downArrow, modifiers: [])
                
                Button("上一个视频") {
                    postKeyEvent(keyCode: 126)
                }
                .keyboardShortcut(.upArrow, modifiers: [])
                
                Button("播放 / 暂停") {
                    postKeyEvent(keyCode: 49)
                }
                .keyboardShortcut(.space, modifiers: [])
                
                Button("快退") {
                    postKeyEvent(keyCode: 123)
                }
                .keyboardShortcut(.leftArrow, modifiers: [])
                
                Button("快进") {
                    postKeyEvent(keyCode: 124)
                }
                .keyboardShortcut(.rightArrow, modifiers: [])
                
                Divider()
                
                Button("切换画面铺满 / 比例") {
                    postKeyEvent(keyCode: 1) // 'S' key
                }
                .keyboardShortcut("s", modifiers: [.command])
                
                Button("切换全屏") {
                    postKeyEvent(keyCode: 3) // 'F' key
                }
                .keyboardShortcut("f", modifiers: [.command])
                
                Button("切换纯净模式 (仅保留视频)") {
                    postKeyEvent(keyCode: 4) // 'H' key
                }
                
                Divider()
                
                Button("刷新推荐流") {
                    postKeyEvent(keyCode: 15) // 'R' key
                }
                .keyboardShortcut("r", modifiers: [.command])
            }
        }
    }
    
    private func postKeyEvent(keyCode: UInt16) {
        if let event = NSEvent.keyEvent(
            with: .keyDown,
            location: .zero,
            modifierFlags: [],
            timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: NSApplication.shared.keyWindow?.windowNumber ?? 0,
            context: nil,
            characters: "",
            charactersIgnoringModifiers: "",
            isARepeat: false,
            keyCode: keyCode
        ) {
            NSApplication.shared.sendEvent(event)
        }
    }
}

class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        if let window = NSApplication.shared.windows.first {
            window.title = "MacDV - 抖音 Mac 客户端 (横屏精选)"
            window.titleVisibility = .hidden
            window.titlebarAppearsTransparent = true
            window.isMovableByWindowBackground = true
            // Default widescreen landscape resolution for Mac (16:10 / 16:9 friendly)
            window.setContentSize(NSSize(width: 1120, height: 700))
            window.minSize = NSSize(width: 720, height: 450)
            window.collectionBehavior = [.fullScreenPrimary, .managed]
            window.center()
        }
    }
    
    func application(_ application: NSApplication, open urls: [URL]) {
        // Silently swallow custom scheme probes like bitbrowser://cc/ from macOS LaunchServices
        for url in urls {
            print("🛡️ [AppDelegate] Silently swallowed custom scheme: \(url.absoluteString)")
        }
    }
    
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }
    
    func applicationWillTerminate(_ notification: Notification) {
        SleepPreventer.shared.allowSleep()
    }
}
