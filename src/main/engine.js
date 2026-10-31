const { BrowserWindow, session } = require('electron');

const CHANNELS = {
    jingxuan: {
        name: '精选横屏',
        url: 'https://www.douyin.com/jingxuan'
    },
    recommend: {
        name: '综合推荐',
        url: 'https://www.douyin.com'
    }
};

const BLOCKED_SCHEMES = [
    'bitbrowser', 'adspower', 'hubstudio', 'ixbrowser', 
    'maskfog', 'snssdk', 'bytedance'
];

class DouyinEngine {
    constructor() {
        this.engineWin = null;
        this.isReady = false;
        this.isLoading = false;
        this.isLoggedIn = false;
        this.statusMessage = '正在初始化引擎...';
        this.currentChannel = 'jingxuan';
        this.seenAwemeIds = new Set();
        this.readyCallbacks = [];
        this.horizontalOnly = true;
    }

    async init() {
        if (this.engineWin) return;

        // Setup webRequest rules to attach Referer and User-Agent
        session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
            const url = details.url.toLowerCase();
            if (url.includes('douyin.com') || url.includes('douyinvod.com') || url.includes('amemv.com') || url.includes('zijieapi.com')) {
                details.requestHeaders['Referer'] = 'https://www.douyin.com/';
                details.requestHeaders['Origin'] = 'https://www.douyin.com';
            }
            details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
            callback({ requestHeaders: details.requestHeaders });
        });

        this.engineWin = new BrowserWindow({
            width: 1024,
            height: 768,
            show: false, // background window
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: false,
                webSecurity: true
            }
        });

        const webContents = this.engineWin.webContents;
        webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36');

        // Prevent unwanted popups / external scheme invocations
        webContents.setWindowOpenHandler((details) => {
            const u = details.url.toLowerCase();
            if (BLOCKED_SCHEMES.some(s => u.startsWith(s + ':') || u.includes(s + '://'))) {
                console.log('🛡️ [DouyinEngine] Neutralized window.open scheme:', details.url);
                return { action: 'deny' };
            }
            return { action: 'deny' };
        });

        webContents.on('will-navigate', (event, url) => {
            const u = url.toLowerCase();
            if (BLOCKED_SCHEMES.some(s => u.startsWith(s + ':') || u.includes(s + '://'))) {
                console.log('🛑 [DouyinEngine] Blocked non-http navigation:', url);
                event.preventDefault();
            }
        });

        // DOM-level script injection to prevent scheme probing
        webContents.on('did-finish-load', async () => {
            try {
                await webContents.executeJavaScript(`
                    (() => {
                        const blocked = ['bitbrowser', 'adspower', 'hubstudio', 'ixbrowser', 'maskfog', 'snssdk', 'bytedance'];
                        function isBad(u) {
                            if (!u || typeof u !== 'string') return false;
                            const s = u.toLowerCase().trim();
                            return blocked.some(b => s.startsWith(b + ':') || s.includes(b + '://'));
                        }
                        const origOpen = window.open;
                        window.open = function(url, ...args) {
                            if (isBad(url)) return null;
                            return origOpen.call(this, url, ...args);
                        };
                    })();
                `);
            } catch (e) {}

            // Wait 2.5s for initial JS runtime scripts (ttwid, acrawler) to settle
            setTimeout(async () => {
                this.isReady = true;
                this.statusMessage = '引擎就绪';
                await this.checkLoginStatus();
                this.resolveReadyCallbacks();
            }, 2500);
        });

        webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
            this.statusMessage = `加载异常: ${errorDescription} (${errorCode})`;
            console.error('⚠️ [DouyinEngine] Fail load:', errorDescription);
        });

        await this.loadChannel(this.currentChannel);
    }

    resolveReadyCallbacks() {
        while (this.readyCallbacks.length > 0) {
            const cb = this.readyCallbacks.shift();
            cb();
        }
    }

    async waitUntilReady() {
        if (this.isReady) return;
        return new Promise((resolve) => {
            this.readyCallbacks.push(resolve);
        });
    }

    async loadChannel(channelKey) {
        this.isReady = false;
        const channel = CHANNELS[channelKey] || CHANNELS.jingxuan;
        this.statusMessage = `正在载入${channel.name}...`;
        if (this.engineWin) {
            await this.engineWin.loadURL(channel.url);
        }
    }

    async switchChannel(channelKey) {
        if (this.currentChannel === channelKey) return;
        this.currentChannel = channelKey;
        this.seenAwemeIds.clear();
        await this.loadChannel(channelKey);
    }

    async checkLoginStatus() {
        try {
            const ses = this.engineWin.webContents.session;
            const cookies = await ses.cookies.get({ domain: '.douyin.com' });
            let hasValidSession = false;
            let cookieHeaderParts = [];

            for (const c of cookies) {
                cookieHeaderParts.push(`${c.name}=${c.value}`);
                if ((c.name === 'sessionid' || c.name === 'sessionid_ss') && c.value && c.value.trim().length > 0) {
                    hasValidSession = true;
                }
            }

            this.isLoggedIn = hasValidSession;
            this.currentCookieHeader = cookieHeaderParts.join('; ');

            let userInfo = null;
            if (hasValidSession) {
                this.statusMessage = '已登录抖音账号';
                // Try fetching user profile info from Douyin Web
                try {
                    const js = `
                        fetch('/aweme/v1/web/user/profile/other/', { credentials: 'include' })
                            .then(r => r.json()).catch(() => null);
                    `;
                    const res = await this.engineWin.webContents.executeJavaScript(js);
                    if (res && res.user) {
                        userInfo = {
                            nickname: res.user.nickname,
                            avatarUrl: res.user.avatar_thumb?.url_list?.[0] || res.user.avatar_168x168?.url_list?.[0] || null,
                            secUid: res.user.sec_uid
                        };
                    }
                } catch (e) {}
            } else {
                this.statusMessage = '未登录（游客模式浏览）';
            }

            return {
                isLoggedIn: this.isLoggedIn,
                statusMessage: this.statusMessage,
                cookieHeader: this.currentCookieHeader,
                userInfo
            };
        } catch (err) {
            console.error('[DouyinEngine] Error checking login:', err);
            return { isLoggedIn: false, statusMessage: '检测登录异常' };
        }
    }

    async logout() {
        try {
            const ses = this.engineWin.webContents.session;
            const cookies = await ses.cookies.get({ domain: '.douyin.com' });
            for (const c of cookies) {
                await ses.cookies.remove('https://www.douyin.com', c.name);
                await ses.cookies.remove('https://.douyin.com', c.name);
            }
            this.isLoggedIn = false;
            this.statusMessage = '未登录（游客模式浏览）';
            this.currentCookieHeader = '';
            await this.loadChannel(this.currentChannel);
            return true;
        } catch (err) {
            console.error('[DouyinEngine] Logout error:', err);
            return false;
        }
    }

    async applyCookieHeader(headerString) {
        if (!headerString || typeof headerString !== 'string') return false;
        try {
            const ses = this.engineWin.webContents.session;
            const parts = headerString.split(';');

            for (const part of parts) {
                const eqIdx = part.indexOf('=');
                if (eqIdx > 0) {
                    const name = part.substring(0, eqIdx).trim();
                    const value = part.substring(eqIdx + 1).trim();
                    if (name && value) {
                        await ses.cookies.set({
                            url: 'https://www.douyin.com',
                            domain: '.douyin.com',
                            path: '/',
                            name: name,
                            value: value,
                            secure: true
                        });
                    }
                }
            }

            await this.loadChannel(this.currentChannel);
            await this.waitUntilReady();
            const status = await this.checkLoginStatus();
            return status.isLoggedIn;
        } catch (err) {
            console.error('[DouyinEngine] Apply cookie error:', err);
            return false;
        }
    }

    async fetchFeed(count = 10, reset = false, horizontalOnly = true) {
        await this.waitUntilReady();
        this.isLoading = true;
        if (reset) {
            this.seenAwemeIds.clear();
        }

        const path = `/aweme/v1/web/tab/feed/?device_platform=webapp&aid=6383&channel=channel_pc_web&count=${count}&version_code=170400&version_name=17.4.0&cookie_enabled=true&screen_width=1920&screen_height=1080&browser_language=zh-CN&browser_platform=Win32&browser_name=Chrome`;
        const js = `
            (async () => {
                const response = await fetch('${path}', {
                    method: 'GET',
                    credentials: 'include',
                    headers: {
                        'Accept': 'application/json, text/plain, */*'
                    }
                });
                return await response.text();
            })()
        `;

        try {
            const text = await this.engineWin.webContents.executeJavaScript(js);
            const feed = JSON.parse(text);
            const rawList = feed.aweme_list || [];
            if (!rawList.length) {
                return [];
            }

            const processedItems = [];
            for (const item of rawList) {
                const isHorizontal = !item.video || (item.video.width >= item.video.height);
                if (horizontalOnly && !isHorizontal) {
                    continue;
                }
                if (!this.seenAwemeIds.has(item.aweme_id)) {
                    this.seenAwemeIds.add(item.aweme_id);
                    processedItems.push(this.formatAwemeItem(item));
                }
            }

            // Fallback if deduplication cleared everything
            if (processedItems.length === 0) {
                for (const item of rawList) {
                    const isHorizontal = !item.video || (item.video.width >= item.video.height);
                    if (!horizontalOnly || isHorizontal) {
                        processedItems.push(this.formatAwemeItem(item));
                    }
                }
            }

            return processedItems;
        } catch (err) {
            console.error('[DouyinEngine] fetchFeed error:', err);
            throw err;
        } finally {
            this.isLoading = false;
        }
    }

    async fetchComments(awemeId, cursor = 0, count = 20) {
        await this.waitUntilReady();
        const path = `/aweme/v1/web/comment/list/?device_platform=webapp&aid=6383&channel=channel_pc_web&aweme_id=${awemeId}&cursor=${cursor}&count=${count}`;
        const js = `
            (async () => {
                const response = await fetch('${path}', {
                    method: 'GET',
                    credentials: 'include',
                    headers: {
                        'Accept': 'application/json, text/plain, */*'
                    }
                });
                return await response.text();
            })()
        `;

        try {
            const text = await this.engineWin.webContents.executeJavaScript(js);
            const res = JSON.parse(text);
            return (res.comments || []).map(c => ({
                cid: c.cid,
                text: c.text,
                createTime: c.create_time,
                diggCount: c.digg_count,
                replyCommentTotal: c.reply_comment_total,
                user: {
                    nickname: c.user?.nickname || '抖音用户',
                    avatarUrl: c.user?.avatar_thumb?.url_list?.[0] || c.user?.avatar_medium?.url_list?.[0] || null,
                    secUid: c.user?.sec_uid
                }
            }));
        } catch (err) {
            console.error('[DouyinEngine] fetchComments error:', err);
            return [];
        }
    }

    formatAwemeItem(raw) {
        const v = raw.video || {};
        const isHorizontal = !v.width || !v.height || v.width >= v.height;

        // Choose highest quality video URL
        let highestQualityUrl = null;
        let qualityLabel = '1080P 超清';

        if (v.bit_rate && v.bit_rate.length > 0) {
            const scoreItem = (item) => {
                const gear = (item.gear_name || '').toLowerCase();
                if (gear.includes('4k') || gear.includes('2160')) return 4000;
                if (gear.includes('2k') || gear.includes('1440')) return 2500;
                if (gear.includes('1080')) return 1080;
                if (gear.includes('720')) return 720;
                if (gear.includes('540')) return 540;
                return Math.max(item.play_addr?.width || 0, item.play_addr?.height || 0);
            };

            const sorted = v.bit_rate.slice().sort((a, b) => {
                const sa = scoreItem(a);
                const sb = scoreItem(b);
                if (sa !== sb) return sb - sa;
                return (b.bit_rate || 0) - (a.bit_rate || 0);
            });

            for (const item of sorted) {
                const list = item.play_addr?.url_list || [];
                const found = list.find(u => u.includes('/aweme/v1/play/') && !u.includes('/dash/')) ||
                              list.find(u => !u.includes('-prime') && (u.startsWith('http://') || u.startsWith('https://'))) ||
                              list.find(u => u.startsWith('http://') || u.startsWith('https://'));
                if (found) {
                    highestQualityUrl = found;
                    const gear = (item.gear_name || '').toLowerCase();
                    if (gear.includes('4k') || gear.includes('2160')) qualityLabel = '4K 极清';
                    else if (gear.includes('2k') || gear.includes('1440')) qualityLabel = '2K 超清';
                    else if (gear.includes('1080')) qualityLabel = '1080P 超清';
                    else if (gear.includes('720')) qualityLabel = '720P 高清';
                    else if (gear.includes('540')) qualityLabel = '540P 标清';
                    break;
                }
            }
        }

        // Fallback to play_addr
        if (!highestQualityUrl && v.play_addr?.url_list) {
            const list = v.play_addr.url_list;
            highestQualityUrl = list.find(u => u.includes('/aweme/v1/play/')) ||
                               list.find(u => !u.includes('-prime')) ||
                               list[0];
        }

        const author = raw.author || {};
        const avatarUrl = author.avatar_medium?.url_list?.[0] || author.avatar_thumb?.url_list?.[0] || null;

        const stats = raw.statistics || {};

        return {
            awemeId: raw.aweme_id,
            desc: raw.desc || '',
            createTime: raw.create_time,
            isHorizontal,
            playUrl: highestQualityUrl,
            qualityLabel,
            duration: v.duration || 0,
            width: v.width,
            height: v.height,
            coverUrl: v.cover?.url_list?.[0] || null,
            author: {
                uid: author.uid,
                secUid: author.sec_uid,
                nickname: author.nickname || '抖音用户',
                signature: author.signature || '',
                avatarUrl
            },
            music: {
                title: raw.music?.title || `原声 - ${author.nickname || '抖音'}`,
                author: raw.music?.author || author.nickname
            },
            stats: {
                diggCount: stats.digg_count || 0,
                commentCount: stats.comment_count || 0,
                collectCount: stats.collect_count || 0,
                shareCount: stats.share_count || 0
            }
        };
    }
}

module.exports = new DouyinEngine();
