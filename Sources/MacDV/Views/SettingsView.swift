import SwiftUI

public struct SettingsView: View {
    public var onClose: () -> Void
    
    @ObservedObject private var engine = DouyinEngine.shared
    @AppStorage("windowOpacity") private var windowOpacity: Double = 1.0
    @AppStorage("isAlwaysOnTop") private var isAlwaysOnTop: Bool = false
    @AppStorage("autoPlaySound") private var autoPlaySound: Bool = true
    @AppStorage("preferHighestQuality") private var preferHighestQuality: Bool = true
    @AppStorage("startInPureMode") private var startInPureMode: Bool = false
    @AppStorage("autoPureInFullscreen") private var autoPureInFullscreen: Bool = true
    @AppStorage("preventDisplaySleep") private var preventDisplaySleep: Bool = true
    @AppStorage("seekStepSeconds") private var seekStepSeconds: Int = 10
    
    public init(onClose: @escaping () -> Void) {
        self.onClose = onClose
    }
    
    public var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("偏好设置 & 快捷键")
                    .font(.system(size: 16, weight: .bold))
                Spacer()
                Button(action: onClose) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 20))
                        .foregroundColor(.secondary)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 14)
            .background(Color(NSColor.windowBackgroundColor))
            
            Divider()
            
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    // Section 1: Window & Boss Mode (摸鱼模式)
                    VStack(alignment: .leading, spacing: 12) {
                        Text("摸鱼与窗口显示")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundColor(.secondary)
                        
                        Toggle("窗口始终置顶 (Always on Top)", isOn: $isAlwaysOnTop)
                            .onChange(of: isAlwaysOnTop) { newValue in
                                updateWindowLevel(alwaysOnTop: newValue)
                            }
                        
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text("窗口透明度")
                                Spacer()
                                Text("\(Int(windowOpacity * 100))%")
                                    .font(.system(size: 12, design: .monospaced))
                                    .foregroundColor(.secondary)
                            }
                            Slider(value: $windowOpacity, in: 0.25...1.0)
                                .onChange(of: windowOpacity) { newValue in
                                    updateWindowAlpha(newValue)
                                }
                        }
                    }
                    .padding(14)
                    .background(Color(NSColor.controlBackgroundColor))
                    .cornerRadius(10)
                    
                    // Section 2: Pure Mode Experience (全屏纯净模式)
                    VStack(alignment: .leading, spacing: 10) {
                        Text("纯净观影模式 (仅显示视频)")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundColor(.secondary)
                        
                        Toggle("软件启动时自动隐藏所有按钮 (纯净模式)", isOn: $startInPureMode)
                        
                        Toggle("进入全屏时自动隐藏所有按钮 (全屏纯净模式)", isOn: $autoPureInFullscreen)
                        
                        Text("开启后全屏完全不显示任何文案、头像、操作按钮或进度条，全屏幕只有纯净视频画面。可随时按键盘「H」键切换隐藏与显示。")
                            .font(.system(size: 11))
                            .foregroundColor(.secondary)
                    }
                    .padding(14)
                    .background(Color(NSColor.controlBackgroundColor))
                    .cornerRadius(10)
                    
                    // Section 3: Video Playback & Quality
                    VStack(alignment: .leading, spacing: 10) {
                        Text("画质与音量")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundColor(.secondary)
                        
                        Toggle("始终以最高清晰度播放 (1080P/超清)", isOn: $preferHighestQuality)
                        
                        Text("自动分析视频的所有码率流，优先选择最高分辨率与最高比特率（如 1080P/2K/4K），尽可能发挥 Mac 视网膜屏幕效果。")
                            .font(.system(size: 11))
                            .foregroundColor(.secondary)
                        
                        Divider().padding(.vertical, 2)
                        
                        Toggle("启动时播放声音 (取消静音)", isOn: $autoPlaySound)
                        
                        Divider().padding(.vertical, 2)
                        
                        Toggle("播放时防止屏幕休眠 (保持屏幕常亮)", isOn: $preventDisplaySleep)
                            .onChange(of: preventDisplaySleep) { _ in
                                SleepPreventer.shared.preferenceDidChange()
                            }
                        
                        Text("观看长视频或全屏观影时，系统将自动阻止 Mac 屏幕变暗、灰屏或进入休眠；暂停播放后自动恢复系统默认休眠设置。")
                            .font(.system(size: 11))
                            .foregroundColor(.secondary)
                    }
                    .padding(14)
                    .background(Color(NSColor.controlBackgroundColor))
                    .cornerRadius(10)
                    
                    // Section 4: Fast Forward & Rewind
                    VStack(alignment: .leading, spacing: 10) {
                        Text("视频快进与后退 (全屏 / 正常播放)")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundColor(.secondary)
                        
                        HStack {
                            Text("方向键快进 / 快退步长")
                            Spacer()
                            Text("\(seekStepSeconds) 秒")
                                .font(.system(size: 14, weight: .bold, design: .monospaced))
                                .foregroundColor(.cyan)
                        }
                        
                        Picker("", selection: $seekStepSeconds) {
                            Text("5 秒").tag(5)
                            Text("10 秒 (推荐)").tag(10)
                            Text("15 秒").tag(15)
                            Text("30 秒").tag(30)
                            Text("60 秒").tag(60)
                        }
                        .pickerStyle(.segmented)
                        
                        HStack {
                            Text("微调时长:")
                                .font(.system(size: 12))
                                .foregroundColor(.secondary)
                            Spacer()
                            Stepper("", value: $seekStepSeconds, in: 1...180, step: 1)
                        }
                        
                        Text("全屏或正常观影时，按键盘「→ (右箭头)」即可快进，按「← (左箭头)」即可后退，画面中央会实时显示快进/快退指示器与时间。")
                            .font(.system(size: 11))
                            .foregroundColor(.secondary)
                    }
                    .padding(14)
                    .background(Color(NSColor.controlBackgroundColor))
                    .cornerRadius(10)
                    
                    // Section 5: Account Status
                    VStack(alignment: .leading, spacing: 10) {
                        Text("当前账号状态")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundColor(.secondary)
                        
                        HStack {
                            Circle()
                                .fill(engine.isLoggedIn ? Color.green : Color.orange)
                                .frame(width: 10, height: 10)
                            Text(engine.statusMessage)
                                .font(.system(size: 13, weight: .medium))
                            Spacer()
                            if engine.isLoggedIn {
                                Button("退出登录") {
                                    Task {
                                        await engine.logout()
                                    }
                                }
                                .buttonStyle(.bordered)
                            } else {
                                Button("重新检测") {
                                    engine.checkLoginStatus()
                                }
                                .buttonStyle(.bordered)
                            }
                        }
                    }
                    .padding(14)
                    .background(Color(NSColor.controlBackgroundColor))
                    .cornerRadius(10)
                    
                    // Section 6: Keyboard Shortcuts
                    VStack(alignment: .leading, spacing: 10) {
                        Text("键盘快捷键")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundColor(.secondary)
                        
                        ShortcutRow(key: "→ (右箭头)", desc: "视频快进 (前进 \(seekStepSeconds) 秒)")
                        ShortcutRow(key: "← (左箭头)", desc: "视频后退 (后退 \(seekStepSeconds) 秒)")
                        ShortcutRow(key: "H", desc: "纯净模式切换 (隐藏/恢复所有按钮)")
                        ShortcutRow(key: "↓ / J", desc: "下一个视频")
                        ShortcutRow(key: "↑ / K", desc: "上一个视频")
                        ShortcutRow(key: "Space (空格)", desc: "暂停 / 继续播放")
                        ShortcutRow(key: "S", desc: "切换画面铺满 / 原始比例")
                        ShortcutRow(key: "F", desc: "进入 / 退出全屏模式")
                        ShortcutRow(key: "双击画面", desc: "快速切换全屏")
                        ShortcutRow(key: "触控板双指滑动", desc: "精准逐个切换视频 (防连跳)")
                        ShortcutRow(key: "M", desc: "快速静音 / 开启声音")
                        ShortcutRow(key: "C", desc: "打开 / 关闭评论抽屉")
                        ShortcutRow(key: "R", desc: "刷新当前视频流")
                        ShortcutRow(key: "T", desc: "切换窗口置顶状态")
                    }
                    .padding(14)
                    .background(Color(NSColor.controlBackgroundColor))
                    .cornerRadius(10)
                }
                .padding(20)
            }
        }
        .frame(width: 480, height: 500)
    }
    
    private func updateWindowLevel(alwaysOnTop: Bool) {
        if let window = NSApplication.shared.windows.first {
            window.level = alwaysOnTop ? .floating : .normal
        }
    }
    
    private func updateWindowAlpha(_ alpha: Double) {
        if let window = NSApplication.shared.windows.first {
            window.alphaValue = CGFloat(alpha)
        }
    }
}

// MARK: - Shortcut Row
private struct ShortcutRow: View {
    let key: String
    let desc: String
    
    var body: some View {
        HStack {
            Text(key)
                .font(.system(size: 11, weight: .bold, design: .monospaced))
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .background(Color.secondary.opacity(0.15))
                .cornerRadius(4)
            Spacer()
            Text(desc)
                .font(.system(size: 12))
                .foregroundColor(.secondary)
        }
    }
}
