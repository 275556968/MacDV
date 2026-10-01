import Foundation
import WebKit
import Combine

// MARK: - Feed Channel Definition
public enum FeedChannel: String, CaseIterable, Identifiable {
    case jingxuan = "精选横屏"
    case recommend = "综合推荐"
    public var id: String { rawValue }
    
    public var url: String {
        switch self {
        case .jingxuan:
            return "https://www.douyin.com/jingxuan"
        case .recommend:
            return "https://www.douyin.com"
        }
    }
}

@MainActor
public class DouyinEngine: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {
    public static let shared = DouyinEngine()
    
    @Published public var isReady: Bool = false
    @Published public var isLoading: Bool = false
    @Published public var isLoggedIn: Bool = false
    @Published public var statusMessage: String = "正在初始化引擎..."
    @Published public var currentCookieHeader: String = ""
    @Published public var currentChannel: FeedChannel = .jingxuan
    @Published public var horizontalOnly: Bool = true
    
    public var webView: WKWebView!
    private var readyContinuations: [CheckedContinuation<Void, Never>] = []
    private var seenAwemeIds: Set<String> = []
    private let schemeBlocker = SafeSchemeBlocker()
    
    public override init() {
        super.init()
        setupWebView()
    }
    
    private func setupWebView() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = WKWebsiteDataStore.default()
        
        let prefs = WKWebpagePreferences()
        prefs.allowsContentJavaScript = true
        config.defaultWebpagePreferences = prefs
        
        // Neutralize window.open, iframe, and custom scheme probing at the JS DOM level
        let blockScript = """
        (function() {
            const blocked = ['bitbrowser', 'adspower', 'hubstudio', 'ixbrowser', 'maskfog', 'snssdk', 'bytedance'];
            function isBad(u) {
                if (!u || typeof u !== 'string') return false;
                const s = u.toLowerCase().trim();
                return blocked.some(b => s.startsWith(b + ':') || s.includes(b + '://'));
            }

            const origOpen = window.open;
            window.open = function(url, ...args) {
                if (isBad(url)) {
                    console.log('🛡️ Neutralized window.open:', url);
                    return null;
                }
                return origOpen.call(this, url, ...args);
            };

            try {
                const proto = HTMLIFrameElement.prototype;
                const desc = Object.getOwnPropertyDescriptor(proto, 'src');
                if (desc && desc.set) {
                    const origSet = desc.set;
                    Object.defineProperty(proto, 'src', {
                        set: function(val) {
                            if (isBad(val)) {
                                console.log('🛡️ Neutralized iframe.src:', val);
                                return;
                            }
                            return origSet.call(this, val);
                        },
                        get: desc.get
                    });
                }
            } catch(e) {}

            try {
                const origSetAttr = Element.prototype.setAttribute;
                Element.prototype.setAttribute = function(name, val) {
                    if ((name === 'src' || name === 'href') && isBad(val)) {
                        console.log('🛡️ Neutralized setAttribute:', name, val);
                        return;
                    }
                    return origSetAttr.call(this, name, val);
                };
            } catch(e) {}

            try {
                const origAssign = Location.prototype.assign;
                if (origAssign) {
                    Location.prototype.assign = function(url) {
                        if (isBad(url)) return;
                        return origAssign.call(this, url);
                    };
                }
                const origReplace = Location.prototype.replace;
                if (origReplace) {
                    Location.prototype.replace = function(url) {
                        if (isBad(url)) return;
                        return origReplace.call(this, url);
                    };
                }
            } catch(e) {}
        })();
        """
        let userScript = WKUserScript(source: blockScript, injectionTime: .atDocumentStart, forMainFrameOnly: false)
        config.userContentController.addUserScript(userScript)
        
        // Register custom scheme handler to completely absorb bitbrowser:// probes
        for scheme in ["bitbrowser", "adspower", "hubstudio", "ixbrowser", "maskfog", "snssdk", "bytedance"] {
            config.setURLSchemeHandler(schemeBlocker, forURLScheme: scheme)
        }
        
        let wv = WKWebView(frame: CGRect(x: 0, y: 0, width: 800, height: 600), configuration: config)
        wv.customUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15"
        wv.navigationDelegate = self
        wv.uiDelegate = self
        self.webView = wv
        
        loadDouyinHome()
    }
    
    public func loadChannel(_ channel: FeedChannel) {
        isReady = false
        statusMessage = "正在载入\(channel.rawValue)..."
        if let url = URL(string: channel.url) {
            webView.load(URLRequest(url: url))
        }
    }
    
    public func switchChannel(_ channel: FeedChannel) {
        guard currentChannel != channel else { return }
        currentChannel = channel
        seenAwemeIds.removeAll()
        loadChannel(channel)
    }
    
    public func loadDouyinHome() {
        loadChannel(currentChannel)
    }
    
    // MARK: - Navigation Delegate
    public func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, preferences: WKWebpagePreferences, decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel, preferences)
            return
        }
        let scheme = url.scheme?.lowercased() ?? ""
        if scheme == "http" || scheme == "https" || scheme == "about" || scheme == "blob" || scheme == "data" {
            decisionHandler(.allow, preferences)
        } else {
            // Block external custom schemes like bitbrowser://, snssdk://, etc.
            print("🛑 [DouyinEngine] Blocked non-http scheme: \(url.absoluteString)")
            decisionHandler(.cancel, preferences)
        }
    }
    
    public func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        let scheme = url.scheme?.lowercased() ?? ""
        if scheme == "http" || scheme == "https" || scheme == "about" || scheme == "blob" || scheme == "data" {
            decisionHandler(.allow)
        } else {
            print("🛑 [DouyinEngine] Blocked non-http scheme: \(url.absoluteString)")
            decisionHandler(.cancel)
        }
    }
    
    // MARK: - UI Delegate
    public func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        // Prevent opening popup windows with custom schemes
        if let url = navigationAction.request.url {
            let scheme = url.scheme?.lowercased() ?? ""
            if scheme == "http" || scheme == "https" {
                webView.load(navigationAction.request)
            }
        }
        return nil
    }
    
    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Wait 2.5s for initial JS runtime scripts (ttwid, acrawler) to settle
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
            guard let self = self else { return }
            self.isReady = true
            self.statusMessage = "引擎就绪"
            self.checkLoginStatus()
            
            for cont in self.readyContinuations {
                cont.resume()
            }
            self.readyContinuations.removeAll()
        }
    }
    
    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        statusMessage = "加载异常: \(error.localizedDescription)"
    }
    
    public func waitUntilReady() async {
        if isReady { return }
        await withCheckedContinuation { cont in
            readyContinuations.append(cont)
        }
    }
    
    // MARK: - Check & Manage Cookies
    public func checkLoginStatus() {
        WKWebsiteDataStore.default().httpCookieStore.getAllCookies { [weak self] cookies in
            Task { @MainActor [weak self] in
                guard let self = self else { return }
                var headerParts: [String] = []
                var hasValidSession = false
                
                for c in cookies where c.domain.contains("douyin.com") {
                    headerParts.append("\(c.name)=\(c.value)")
                    // ONLY sessionid and sessionid_ss represent a real logged-in user!
                    if (c.name == "sessionid" || c.name == "sessionid_ss") && !c.value.isEmpty {
                        hasValidSession = true
                    }
                }
                
                self.isLoggedIn = hasValidSession
                self.currentCookieHeader = headerParts.joined(separator: "; ")
                if hasValidSession {
                    self.statusMessage = "已登录抖音账号"
                } else {
                    self.statusMessage = "未登录（游客模式浏览）"
                }
            }
        }
    }
    
    public func triggerWebLoginModal() {
        let js = """
        (() => {
            const btns = Array.from(document.querySelectorAll('button, div, span'));
            const loginBtn = btns.find(b => b.textContent && b.textContent.trim() === '登录');
            if (loginBtn) {
                loginBtn.click();
            }
        })()
        """
        webView.evaluateJavaScript(js, completionHandler: nil)
    }
    
    public func logout() async {
        let store = WKWebsiteDataStore.default().httpCookieStore
        let cookies: [HTTPCookie] = await withCheckedContinuation { cont in
            store.getAllCookies { list in
                cont.resume(returning: list)
            }
        }
        for c in cookies where c.domain.contains("douyin") {
            await store.deleteCookie(c)
        }
        self.isLoggedIn = false
        self.statusMessage = "未登录（游客模式浏览）"
        self.currentCookieHeader = ""
        loadDouyinHome()
    }
    
    public func applyCookieHeader(_ headerString: String) async -> Bool {
        let store = WKWebsiteDataStore.default().httpCookieStore
        let parts = headerString.components(separatedBy: ";")
        
        for part in parts {
            let pair = part.trimmingCharacters(in: .whitespacesAndNewlines).components(separatedBy: "=")
            if pair.count >= 2 {
                let name = pair[0].trimmingCharacters(in: .whitespaces)
                let value = pair[1...].joined(separator: "=").trimmingCharacters(in: .whitespaces)
                let props: [HTTPCookiePropertyKey: Any] = [
                    .name: name,
                    .value: value,
                    .domain: ".douyin.com",
                    .path: "/"
                ]
                if let cookie = HTTPCookie(properties: props) {
                    await store.setCookie(cookie)
                }
            }
        }
        
        loadDouyinHome()
        await waitUntilReady()
        checkLoginStatus()
        return isLoggedIn
    }
    
    // MARK: - Core Fetch API
    public func fetchFeed(count: Int = 10, reset: Bool = false) async throws -> [AwemeItem] {
        await waitUntilReady()
        self.isLoading = true
        defer { self.isLoading = false }
        
        if reset {
            seenAwemeIds.removeAll()
        }
        
        let path = "/aweme/v1/web/tab/feed/?device_platform=webapp&aid=6383&channel=channel_pc_web&count=\(count)&version_code=170400&version_name=17.4.0&cookie_enabled=true&screen_width=1920&screen_height=1080&browser_language=zh-CN&browser_platform=MacIntel&browser_name=Safari"
        
        let js = """
        const response = await fetch('\(path)', {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Accept': 'application/json, text/plain, */*'
            }
        });
        const text = await response.text();
        return text;
        """
        
        do {
            let result = try await webView.callAsyncJavaScript(js, arguments: [:], in: nil, contentWorld: .page)
            guard let jsonString = result as? String, let data = jsonString.data(using: .utf8) else {
                throw NSError(domain: "DouyinEngine", code: -1, userInfo: [NSLocalizedDescriptionKey: "无效响应数据"])
            }
            
            let decoder = JSONDecoder()
            let feed = try decoder.decode(FeedResponse.self, from: data)
            guard let list = feed.awemeList, !list.isEmpty else {
                return []
            }
            
            var validItems: [AwemeItem] = []
            for item in list {
                // Filter out vertical phone videos if horizontalOnly is active
                if horizontalOnly && !item.isHorizontal {
                    continue
                }
                if !seenAwemeIds.contains(item.awemeId) {
                    seenAwemeIds.insert(item.awemeId)
                    validItems.append(item)
                }
            }
            
            // If deduplication cleared all items, fallback to non-empty list
            if validItems.isEmpty {
                if horizontalOnly {
                    validItems = list.filter { $0.isHorizontal }
                } else {
                    validItems = list
                }
            }
            
            return validItems
        } catch {
            print("Fetch feed error: \(error)")
            throw error
        }
    }
    
    public func fetchComments(awemeId: String, cursor: Int64 = 0, count: Int = 20) async throws -> [CommentItem] {
        await waitUntilReady()
        
        let path = "/aweme/v1/web/comment/list/?device_platform=webapp&aid=6383&channel=channel_pc_web&aweme_id=\(awemeId)&cursor=\(cursor)&count=\(count)"
        
        let js = """
        const response = await fetch('\(path)', {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Accept': 'application/json, text/plain, */*'
            }
        });
        const text = await response.text();
        return text;
        """
        
        let result = try await webView.callAsyncJavaScript(js, arguments: [:], in: nil, contentWorld: .page)
        guard let jsonString = result as? String, let data = jsonString.data(using: .utf8) else {
            return []
        }
        
        let decoder = JSONDecoder()
        let resp = try decoder.decode(CommentListResponse.self, from: data)
        return resp.comments ?? []
    }
}

// MARK: - Safe Scheme Interceptor to absorb custom schemes
class SafeSchemeBlocker: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        if let url = urlSchemeTask.request.url {
            print("🛡️ [SafeSchemeBlocker] Silently absorbed scheme request: \(url.absoluteString)")
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(Data())
            urlSchemeTask.didFinish()
        }
    }
    
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}
