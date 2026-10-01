import SwiftUI
import WebKit

public struct LoginSheetView: View {
    public var onLoginSuccess: () -> Void
    public var onClose: () -> Void
    
    @ObservedObject private var engine = DouyinEngine.shared
    @State private var selectedTab: Int = 0 // 0: 扫码/网页登录, 1: Cookie 手动导入
    @State private var manualCookieInput: String = ""
    @State private var isProcessingCookie: Bool = false
    @State private var showSuccessBanner: Bool = false
    @State private var hasInitialChecked: Bool = false
    
    public init(onLoginSuccess: @escaping () -> Void, onClose: @escaping () -> Void) {
        self.onLoginSuccess = onLoginSuccess
        self.onClose = onClose
    }
    
    public var body: some View {
        VStack(spacing: 0) {
            // Header Bar
            HStack {
                Text(engine.isLoggedIn ? "账号管理" : "登录抖音账号")
                    .font(.system(size: 16, weight: .bold))
                
                Spacer()
                
                Picker("", selection: $selectedTab) {
                    Text("官方扫码登录").tag(0)
                    Text("Cookie 导入 (myDV模式)").tag(1)
                }
                .pickerStyle(.segmented)
                .frame(width: 250)
                
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
            
            if selectedTab == 0 {
                // Tab 0: Web Login View
                ZStack {
                    VStack(spacing: 0) {
                        HStack {
                            Image(systemName: "qrcode.viewfinder")
                                .font(.system(size: 14))
                                .foregroundColor(.pink)
                            Text("使用手机「抖音 App」扫一扫完成登录；登录成功后将自动切换为个性化推荐")
                                .font(.system(size: 12))
                                .foregroundColor(.secondary)
                            Spacer()
                            if engine.isLoggedIn {
                                Button("退出当前账号") {
                                    Task {
                                        await engine.logout()
                                    }
                                }
                                .buttonStyle(.bordered)
                                .controlSize(.small)
                            } else {
                                Button("呼出登录框") {
                                    engine.triggerWebLoginModal()
                                }
                                .buttonStyle(.bordered)
                                .controlSize(.small)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(Color(NSColor.controlBackgroundColor))
                        
                        Divider()
                        
                        WebLoginContainer(webView: engine.webView)
                    }
                    
                    if showSuccessBanner {
                        VStack(spacing: 12) {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 48))
                                .foregroundColor(.green)
                            Text("登录成功！正在进入个性化推荐...")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundColor(.primary)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Color(NSColor.windowBackgroundColor).opacity(0.94))
                        .transition(.opacity)
                    }
                }
            } else {
                // Tab 1: Manual Cookie Import (myDV compatibility)
                VStack(alignment: .leading, spacing: 16) {
                    Text("从浏览器中复制抖音网页版 Cookie (Header String 格式)")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.secondary)
                    
                    TextEditor(text: $manualCookieInput)
                        .font(.system(size: 12, design: .monospaced))
                        .padding(8)
                        .background(Color(NSColor.textBackgroundColor))
                        .cornerRadius(8)
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.gray.opacity(0.3), lineWidth: 1))
                        .frame(maxHeight: .infinity)
                    
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("💡 提示：在 Chrome / Safari 登录 douyin.com 后使用 Cookie-Editor 插件导出即可。")
                                .font(.system(size: 11))
                                .foregroundColor(.secondary)
                            Text("必须包含 sessionid 字段才具有登录态。")
                                .font(.system(size: 11))
                                .foregroundColor(.orange)
                        }
                        
                        Spacer()
                        
                        Button("应用并登录") {
                            applyManualCookie()
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(manualCookieInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isProcessingCookie)
                    }
                }
                .padding(20)
            }
        }
        .frame(width: 720, height: 640)
        .onAppear {
            engine.checkLoginStatus()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                if !engine.isLoggedIn {
                    engine.triggerWebLoginModal()
                }
                hasInitialChecked = true
                startLoginDetectionTimer()
            }
        }
    }
    
    private func applyManualCookie() {
        isProcessingCookie = true
        Task {
            let success = await engine.applyCookieHeader(manualCookieInput)
            isProcessingCookie = false
            if success {
                triggerSuccess()
            }
        }
    }
    
    private func startLoginDetectionTimer() {
        Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { timer in
            Task { @MainActor in
                let wasLoggedIn = self.engine.isLoggedIn
                self.engine.checkLoginStatus()
                
                // Only trigger success on state transition from false to true
                if !wasLoggedIn && self.engine.isLoggedIn {
                    timer.invalidate()
                    self.triggerSuccess()
                }
            }
        }
    }
    
    private func triggerSuccess() {
        withAnimation {
            showSuccessBanner = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
            onLoginSuccess()
            onClose()
        }
    }
}

// MARK: - Embed WebKit View
private struct WebLoginContainer: NSViewRepresentable {
    let webView: WKWebView
    
    func makeNSView(context: Context) -> WKWebView {
        return webView
    }
    
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
