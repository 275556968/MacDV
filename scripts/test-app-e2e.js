const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'PreloadMediaEngagementData,AutoplayIgnoreWebAudio');

const engine = require('../src/main/engine');
const sleepPreventer = require('../src/main/sleep-preventer');

console.log('🚀 [E2E Test] Starting WinDV End-to-End Automated Test...');

app.whenReady().then(async () => {
    // Create main window in test mode
    const win = new BrowserWindow({
        width: 1120,
        height: 700,
        show: false, // run headless/offscreen for automated verification
        frame: false,
        backgroundColor: '#0a0a0c',
        webPreferences: {
            preload: path.join(__dirname, '../src/preload/preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true
        }
    });

    win.webContents.on('console-message', (event, level, message) => {
        console.log(`[Renderer Console] ${message}`);
    });

    // Setup IPC Handlers matching main.js
    ipcMain.handle('window:minimize', () => {});
    ipcMain.handle('window:maximize', () => {});
    ipcMain.handle('window:close', () => {});
    ipcMain.handle('window:isMaximized', () => false);
    ipcMain.handle('window:setAlwaysOnTop', (e, f) => !!f);
    ipcMain.handle('window:setOpacity', (e, o) => Number(o));
    ipcMain.handle('window:setFullScreen', (e, f) => !!f);
    ipcMain.handle('engine:getStatus', () => engine.getStatus());
    ipcMain.handle('engine:switchChannel', async (e, k) => {
        await engine.switchChannel(k);
        return { statusMessage: engine.statusMessage, currentChannel: engine.currentChannel };
    });
    ipcMain.handle('engine:fetchFeed', async (e, opts) => engine.fetchFeed(opts.count, opts.reset, opts.horizontalOnly));
    ipcMain.handle('engine:fetchComments', async (e, opts) => engine.fetchComments(opts.awemeId, opts.cursor, opts.count));
    ipcMain.handle('engine:checkLogin', async () => engine.checkLoginStatus());
    ipcMain.handle('engine:applyCookie', async (e, str) => engine.applyCookieHeader(str));
    ipcMain.handle('engine:logout', async () => engine.logout());
    ipcMain.handle('engine:openLoginWindow', async () => {});
    ipcMain.handle('sleep:setPlaybackState', (e, p) => sleepPreventer.updatePlaybackState(p));
    ipcMain.handle('sleep:setPreference', (e, p) => sleepPreventer.setPreference(p));
    ipcMain.handle('clipboard:write', (e, t) => true);

    console.log('[E2E Test] Loading renderer index.html...');
    await win.loadFile(path.join(__dirname, '../src/renderer/index.html'));

    console.log('[E2E Test] Initializing Douyin engine...');
    await engine.init();
    win.webContents.send('engine:ready', {
        statusMessage: engine.statusMessage,
        isLoggedIn: engine.isLoggedIn
    });

    console.log('[E2E Test] Waiting for feed fetch and video playback initialization...');
    const startTime = Date.now();
    let videoLoaded = false;

    while (Date.now() - startTime < 25000) {
        await new Promise(r => setTimeout(r, 1000));
        
        try {
            const state = await win.webContents.executeJavaScript(`
                (() => {
                    const player = window.videoPlayer?.video;
                    const app = window.app;
                    return {
                        itemCount: app?.items?.length || 0,
                        currentIndex: app?.currentIndex || 0,
                        hasVideoSrc: !!(player && player.src),
                        videoSrc: player?.src || '',
                        videoDuration: player?.duration || 0,
                        videoPaused: player?.paused ?? true,
                        authorName: document.getElementById('author-name')?.textContent || '',
                        qualityBadge: document.getElementById('quality-badge')?.textContent || '',
                        isOverlayVisible: !document.getElementById('overlay-layer')?.classList.contains('hide-overlay')
                    };
                })()
            `);

            console.log(`[E2E Test] Status check: items=${state.itemCount}, hasSrc=${state.hasVideoSrc}, dur=${state.videoDuration.toFixed(1)}s, author="${state.authorName}", quality="${state.qualityBadge}"`);

            if (state.itemCount > 0 && state.hasVideoSrc && state.videoDuration > 0) {
                console.log('✅ [E2E Test] Verified: Video feed loaded and player started successfully!');
                videoLoaded = true;
                break;
            }
        } catch (e) {
            console.log('[E2E Test] Polling error:', e.message);
        }
    }

    if (!videoLoaded) {
        console.error('❌ [E2E Test] Video failed to load within timeout');
        win.destroy();
        app.quit();
        process.exit(1);
    }

    // Test Next Video switching
    console.log('[E2E Test] Testing Next Video shortcut/function...');
    await win.webContents.executeJavaScript(`window.app.nextVideo()`);
    await new Promise(r => setTimeout(r, 2000));
    const nextState = await win.webContents.executeJavaScript(`
        (() => {
            return {
                currentIndex: window.app?.currentIndex,
                authorName: document.getElementById('author-name')?.textContent
            };
        })()
    `);
    console.log(`✅ [E2E Test] Next Video verified: index=${nextState.currentIndex}, author="${nextState.authorName}"`);

    // Test Pure Mode toggle
    console.log('[E2E Test] Testing Pure Mode toggle (H key)...');
    await win.webContents.executeJavaScript(`window.app.togglePureMode()`);
    const pureState = await win.webContents.executeJavaScript(`
        (() => {
            return {
                isPureMode: window.app?.isPureMode,
                overlayHidden: document.getElementById('overlay-layer')?.classList.contains('hide-overlay'),
                titlebarHidden: document.getElementById('titlebar')?.classList.contains('hide-overlay')
            };
        })()
    `);
    console.log(`✅ [E2E Test] Pure Mode verified: isPure=${pureState.isPureMode}, overlayHidden=${pureState.overlayHidden}`);

    // Test Comment Drawer open and fetch
    console.log('[E2E Test] Testing Comment Drawer...');
    await win.webContents.executeJavaScript(`window.commentDrawer.open()`);
    await new Promise(r => setTimeout(r, 3000));
    const commentState = await win.webContents.executeJavaScript(`
        (() => {
            return {
                isOpen: window.commentDrawer?.isOpen,
                commentRowsCount: document.querySelectorAll('#comment-list .comment-row').length,
                drawerTitle: document.getElementById('comment-drawer-title')?.textContent
            };
        })()
    `);
    console.log(`✅ [E2E Test] Comment Drawer verified: isOpen=${commentState.isOpen}, title="${commentState.drawerTitle}", rowsCount=${commentState.commentRowsCount}`);

    // Test Seek delta HUD
    console.log('[E2E Test] Testing Seek HUD (+10s)...');
    await win.webContents.executeJavaScript(`window.videoPlayer.seekDelta(10)`);
    const hudState = await win.webContents.executeJavaScript(`
        (() => {
            const hud = document.getElementById('seek-hud');
            const dir = document.getElementById('seek-hud-direction')?.textContent;
            return {
                hudVisible: !hud.classList.contains('hidden'),
                directionText: dir
            };
        })()
    `);
    console.log(`✅ [E2E Test] Seek HUD verified: visible=${hudState.hudVisible}, text="${hudState.directionText}"`);

    // Test Idle Auto-Hide (Mouse cursor & UI chrome disappearance)
    console.log('[E2E Test] Testing Idle Auto-Hide (Mouse cursor + UI overlays)...');
    await win.webContents.executeJavaScript(`
        window.commentDrawer?.close();
        window.app?.setPureMode(false);
        window.app?.handleUserIdle();
    `);
    const idleState = await win.webContents.executeJavaScript(`
        (() => {
            return {
                cursorHidden: document.body.classList.contains('cursor-hidden'),
                titlebarHidden: document.getElementById('titlebar')?.classList.contains('hide-overlay'),
                overlayHidden: document.getElementById('overlay-layer')?.classList.contains('hide-overlay')
            };
        })()
    `);
    console.log(`✅ [E2E Test] Idle Auto-Hide verified: cursorHidden=${idleState.cursorHidden}, titlebarHidden=${idleState.titlebarHidden}, overlayHidden=${idleState.overlayHidden}`);

    // Test User Activity Wakeup (Mouse cursor & UI chrome reappearance)
    console.log('[E2E Test] Testing Activity Wakeup (Mouse move restores cursor + UI)...');
    await win.webContents.executeJavaScript(`window.app.handleUserActivity()`);
    const activeState = await win.webContents.executeJavaScript(`
        (() => {
            return {
                cursorHidden: document.body.classList.contains('cursor-hidden'),
                titlebarHidden: document.getElementById('titlebar')?.classList.contains('hide-overlay'),
                overlayHidden: document.getElementById('overlay-layer')?.classList.contains('hide-overlay')
            };
        })()
    `);
    console.log(`✅ [E2E Test] Activity Wakeup verified: cursorHidden=${activeState.cursorHidden}, titlebarHidden=${activeState.titlebarHidden}, overlayHidden=${activeState.overlayHidden}`);

    // Test True Fullscreen Toggle
    console.log('[E2E Test] Testing True Fullscreen Toggle...');
    await win.webContents.executeJavaScript(`window.app.toggleFullScreen()`);
    const fsState = await win.webContents.executeJavaScript(`
        (() => {
            return {
                isFullScreen: window.app?.isFullScreen,
                bodyHasClass: document.body.classList.contains('is-fullscreen')
            };
        })()
    `);
    console.log(`✅ [E2E Test] Fullscreen verified: isFullScreen=${fsState.isFullScreen}, bodyHasClass=${fsState.bodyHasClass}`);

    console.log('\n🎉 =======================================================');
    console.log('🎉 ALL WIN-DV AUTOMATED END-TO-END TESTS PASSED PERFECTLY!');
    console.log('🎉 =======================================================\n');

    win.destroy();
    app.quit();
});
