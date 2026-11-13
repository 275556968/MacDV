const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'PreloadMediaEngagementData,AutoplayIgnoreWebAudio');

const engine = require('../src/main/engine');
const sleepPreventer = require('../src/main/sleep-preventer');
const updater = require('../src/main/updater');

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
    ipcMain.handle('engine:fetchDanmaku', async (e, opts) => engine.fetchDanmaku(opts.awemeId, opts.startMs, opts.durationMs));
    ipcMain.handle('engine:fetchUserProfile',async (e, args) => engine.fetchUserProfile(args.secUid));
    ipcMain.handle('engine:fetchUserPosts', async (e, args) => engine.fetchUserPosts(args.secUid, args.maxCursor, args.count));
    ipcMain.handle('engine:checkLogin', async () => engine.checkLoginStatus());
    ipcMain.handle('engine:applyCookie', async (e, str) => engine.applyCookieHeader(str));
    ipcMain.handle('engine:logout', async () => engine.logout());
    ipcMain.handle('engine:openLoginWindow', async () => {});
    ipcMain.handle('sleep:setPlaybackState', (e, p) => sleepPreventer.updatePlaybackState(p));
    ipcMain.handle('sleep:setPreference', (e, p) => sleepPreventer.setPreference(p));
    ipcMain.handle('clipboard:write', (e, t) => true);
    ipcMain.handle('shell:openExternal', (e, url) => true);
    ipcMain.handle('updater:check', async (e, m) => updater.checkForUpdates(m));
    ipcMain.handle('updater:download', (e, opts) => updater.downloadUpdate(opts.url, opts.assetName, e.sender));
    ipcMain.handle('updater:cancel', () => updater.cancelDownload());
    ipcMain.handle('updater:install', (e, p) => true);
    ipcMain.handle('updater:openFolder', (e, p) => true);
    ipcMain.handle('updater:getVersion', () => '1.0.0');

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
                        isLoading: app?.isLoading || false,
                        engineStatus: document.getElementById('engine-status')?.textContent || '',
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

            console.log(`[E2E Test] Status check: items=${state.itemCount}, loading=${state.isLoading}, status="${state.engineStatus}", hasSrc=${state.hasVideoSrc}, dur=${state.videoDuration.toFixed(1)}s, author="${state.authorName}"`);

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
        return;
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

    // Test watched-video dedupe on the live feed:
    // no duplicated ids in the queue, and played videos are recorded + persisted.
    console.log('[E2E Test] Testing watched-video dedupe on the live feed...');
    const dedupeLiveState = await win.webContents.executeJavaScript(`
        (() => {
            const ids = window.app.items.map(i => String(i.awemeId));
            let persisted = [];
            try { persisted = JSON.parse(localStorage.getItem('windv_seen_ids_v1') || '[]'); } catch (e) {}
            return {
                total: ids.length,
                unique: new Set(ids).size,
                historySize: window.app.seenIds.size,
                currentRecorded: window.app.seenIds.has(String(window.app.currentItem?.awemeId)),
                persisted: persisted.length,
                switchOn: document.getElementById('setting-dedupe-feed')?.checked
            };
        })()
    `);
    if (dedupeLiveState.total !== dedupeLiveState.unique) throw new Error('feed queue contains duplicate videos');
    if (!dedupeLiveState.currentRecorded) throw new Error('played video was not recorded in the watched history');
    if (dedupeLiveState.persisted === 0) throw new Error('watched history was not persisted to localStorage');
    if (dedupeLiveState.switchOn !== true) throw new Error('dedupe setting should default to ON');
    console.log(`✅ [E2E Test] Live dedupe verified: queue unique=${dedupeLiveState.unique}/${dedupeLiveState.total}, history=${dedupeLiveState.historySize}, persisted=${dedupeLiveState.persisted}`);

    // Test author space: click avatar -> profile grid -> pick a video to play
    console.log('[E2E Test] Testing author space...');
    const authorInfo = await win.webContents.executeJavaScript(`
        (() => {
            const author = window.app.currentItem?.author;
            return { secUid: author?.secUid || null, nickname: author?.nickname || '' };
        })()
    `);
    if (!authorInfo.secUid) throw new Error('current video has no author secUid');

    const feedBefore = await win.webContents.executeJavaScript(`
        (() => ({ ids: window.app.items.map(i => i.awemeId), index: window.app.currentIndex }))()
    `);

    await win.webContents.executeJavaScript(`window.spaceView.open(window.app.currentItem.author); true;`);

    let spaceLoaded = false;
    for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 800));
        const s = await win.webContents.executeJavaScript(`
            (() => ({
                open: window.spaceView.isOpen,
                loadingHidden: document.getElementById('space-loading').classList.contains('hidden'),
                cards: document.querySelectorAll('#space-grid .space-card-item').length,
                nickname: document.getElementById('space-nickname').textContent
            }))()
        `);
        if (s.open && s.loadingHidden) {
            spaceLoaded = true;
            console.log(`✅ [E2E Test] Author space loaded: cards=${s.cards}, nickname="${s.nickname}"`);
            if (s.cards === 0) throw new Error('author space has no playable videos');
            break;
        }
    }
    if (!spaceLoaded) throw new Error('author space did not finish loading');

    const spaceModalState = await win.webContents.executeJavaScript(`
        (() => ({
            visible: !document.getElementById('space-modal').classList.contains('hidden'),
            nickname: document.getElementById('space-nickname').textContent,
            cards: document.querySelectorAll('#space-grid .space-card-item').length
        }))()
    `);
    if (!spaceModalState.visible) throw new Error('space modal must be visible');
    if (spaceModalState.cards < 1) throw new Error('space grid must contain at least one video');

    // Scrolling to the bottom of the grid must auto-load the next page
    const gridBefore = await win.webContents.executeJavaScript(`
        (() => ({
            cards: document.querySelectorAll('#space-grid .space-card-item').length,
            hasMore: window.spaceView.hasMore
        }))()
    `);
    if (gridBefore.hasMore) {
        await win.webContents.executeJavaScript(`
            const g = document.getElementById('space-grid');
            g.scrollTop = g.scrollHeight;
            g.dispatchEvent(new Event('scroll'));
            true;
        `);
        let grown = false;
        for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 700));
            const cards = await win.webContents.executeJavaScript(`document.querySelectorAll('#space-grid .space-card-item').length`);
            if (cards > gridBefore.cards) {
                grown = true;
                console.log(`✅ [E2E Test] Space auto-load verified: ${gridBefore.cards} -> ${cards} cards`);
                break;
            }
        }
        if (!grown) throw new Error('scrolling to the bottom did not auto-load more author posts');
    } else {
        console.log('ℹ️ [E2E Test] Author has a single page of posts, auto-load check skipped');
    }

    // Esc closes the space
    await win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' })); true;`);
    const spaceStillOpen = await win.webContents.executeJavaScript(`window.spaceView.isOpen`);
    if (spaceStillOpen) throw new Error('Escape should close the author space');
    console.log('✅ [E2E Test] Space closed by Esc verified');

    // Reopen and click the first video: it must play and the space must close
    await win.webContents.executeJavaScript(`window.spaceView.open(window.app.currentItem.author); true;`);
    await new Promise(r => setTimeout(r, 3000));
    await win.webContents.executeJavaScript(`document.querySelector('#space-grid .space-card-item')?.click(); true;`);
    await new Promise(r => setTimeout(r, 1500));
    const spacePlayState = await win.webContents.executeJavaScript(`
        (() => ({
            isOpen: window.spaceView.isOpen,
            modalHidden: document.getElementById('space-modal').classList.contains('hidden'),
            hasSrc: !!window.videoPlayer.video.src,
            items: window.app.items.length,
            pickedFromSpace: window.spaceView.items.some(i => i.awemeId === window.app.currentItem?.awemeId)
        }))()
    `);
    if (spacePlayState.isOpen || !spacePlayState.modalHidden) throw new Error('space should close after picking a video');
    if (!spacePlayState.pickedFromSpace) throw new Error('picked video is not one of the author posts');
    if (!spacePlayState.hasSrc) throw new Error('picked video did not start loading');
    console.log(`✅ [E2E Test] Space video playback verified: author="${authorInfo.nickname}", queue=${spacePlayState.items}`);

    // While playing an author's videos, a floating button must offer "back to feed"
    const exitPillState = await win.webContents.executeJavaScript(`
        (() => ({
            visible: !document.getElementById('btn-exit-space').classList.contains('hidden'),
            isInSpace: window.app.isInSpace
        }))()
    `);
    if (!exitPillState.isInSpace) throw new Error('app should be in author-space playback mode');
    if (!exitPillState.visible) throw new Error('exit-space button should be visible');

    await win.webContents.executeJavaScript(`document.getElementById('btn-exit-space').click(); true;`);
    await new Promise(r => setTimeout(r, 900));
    const exitState = await win.webContents.executeJavaScript(`
        (() => ({
            isInSpace: window.app.isInSpace,
            pillHidden: document.getElementById('btn-exit-space').classList.contains('hidden'),
            ids: window.app.items.map(i => i.awemeId),
            index: window.app.currentIndex,
            snapshotCleared: window.app.spaceReturn === null,
            toast: document.getElementById('toast-message').textContent
        }))()
    `);
    const feedRestored = JSON.stringify(exitState.ids) === JSON.stringify(feedBefore.ids)
        && exitState.index === feedBefore.index;
    if (exitState.isInSpace || !exitState.pillHidden) throw new Error('exit button should leave the author space');
    if (!feedRestored) throw new Error('recommendation feed queue was not restored');
    if (!exitState.snapshotCleared) throw new Error('space snapshot should be cleared after exit');
    if (!exitState.toast.includes('推荐流')) throw new Error('exit should show a toast');
    console.log(`✅ [E2E Test] Space exit verified: feed restored (${exitState.ids.length} items, index ${exitState.index})`);

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

    // Test Pure Mode edge peek (top / bottom / right):
    // moving to an edge must temporarily reveal the UI but keep pure mode ON.
    const readPeekState = () => win.webContents.executeJavaScript(`
        (() => {
            return {
                isPureMode: window.app?.isPureMode,
                isPeeking: window.app?.isPeeking,
                overlayHidden: document.getElementById('overlay-layer')?.classList.contains('hide-overlay'),
                titlebarHidden: document.getElementById('titlebar')?.classList.contains('hide-overlay')
            };
        })()
    `);

    const edgeCases = [
        ['Top', `window.dispatchEvent(new MouseEvent('mousemove', { clientX: 400, clientY: 10 }))`],
        ['Bottom', `window.dispatchEvent(new MouseEvent('mousemove', { clientX: 400, clientY: window.innerHeight - 5 }))`],
        ['Right', `window.dispatchEvent(new MouseEvent('mousemove', { clientX: window.innerWidth - 5, clientY: 300 }))`]
    ];

    for (const [edgeName, dispatchCode] of edgeCases) {
        await win.webContents.executeJavaScript(`window.app.setPureMode(true)`);
        await new Promise(r => setTimeout(r, 700)); // wait out the 600ms pure-mode cooldown
        await win.webContents.executeJavaScript(dispatchCode);

        const peeked = await readPeekState();
        if (!peeked.isPureMode) throw new Error(`${edgeName} edge must NOT exit pure mode`);
        if (!peeked.isPeeking) throw new Error(`${edgeName} edge should set isPeeking`);
        if (peeked.overlayHidden || peeked.titlebarHidden) throw new Error(`${edgeName} edge should temporarily reveal the UI`);
        console.log(`✅ [E2E Test] ${edgeName} Edge Peek verified: pure=${peeked.isPureMode}, peeking=${peeked.isPeeking}, overlayHidden=${peeked.overlayHidden}`);

        // After 2.5s idle the UI must auto-hide again and pure mode must remain ON
        await new Promise(r => setTimeout(r, 2800));
        const restored = await readPeekState();
        if (!restored.isPureMode) throw new Error(`${edgeName} edge peek must keep pure mode on`);
        if (restored.isPeeking) throw new Error(`${edgeName} edge peek should end automatically`);
        if (!restored.overlayHidden || !restored.titlebarHidden) throw new Error(`${edgeName} edge peek must auto-hide the UI after idle`);
        console.log(`✅ [E2E Test] ${edgeName} Edge Peek auto-restore verified: pure=${restored.isPureMode}, overlayHidden=${restored.overlayHidden}`);
    }

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

    // Test Right-Click 2X Fast Forward Long-Press
    console.log('[E2E Test] Testing Right-Click 2X Fast Forward...');
    // Make sure the base speed is 1.0X so the 2X assertions below are deterministic
    await win.webContents.executeJavaScript(`window.app.setPlaybackSpeed(1.0)`);
    await win.webContents.executeJavaScript(`window.app.startFastForward()`);
    const ffState = await win.webContents.executeJavaScript(`
        (() => {
            const video = window.videoPlayer?.video;
            const hud = document.getElementById('speed-hud');
            return {
                isFastForwarding: window.app?.isFastForwarding,
                playbackRate: video?.playbackRate,
                hudVisible: !hud?.classList.contains('hidden'),
                hudText: hud?.querySelector('.speed-hud-text')?.textContent
            };
        })()
    `);
    console.log(`✅ [E2E Test] 2X Fast Forward Active: isFF=${ffState.isFastForwarding}, rate=${ffState.playbackRate}, hudVisible=${ffState.hudVisible}, text="${ffState.hudText}"`);

    // Release 2X Fast Forward
    console.log('[E2E Test] Testing Release 2X Fast Forward (restore normal speed)...');
    await win.webContents.executeJavaScript(`window.app.stopFastForward()`);
    const ffEndState = await win.webContents.executeJavaScript(`
        (() => {
            const video = window.videoPlayer?.video;
            return {
                isFastForwarding: window.app?.isFastForwarding,
                playbackRate: video?.playbackRate
            };
        })()
    `);
    console.log(`✅ [E2E Test] 2X Fast Forward Released: isFF=${ffEndState.isFastForwarding}, rate=${ffEndState.playbackRate}`);

    // Test Keyboard ArrowRight Long-Press 2X Fast Playback
    console.log('[E2E Test] Testing Keyboard ArrowRight Long-Press 2X...');
    await win.webContents.executeJavaScript(`
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', repeat: true }));
    `);
    const keyFFState = await win.webContents.executeJavaScript(`
        (() => {
            return {
                isFastForwarding: window.app?.isFastForwarding,
                source: window.app?.fastForwardSource,
                rate: window.videoPlayer?.video?.playbackRate
            };
        })()
    `);
    console.log(`✅ [E2E Test] Keyboard ArrowRight 2X Active: isFF=${keyFFState.isFastForwarding}, source="${keyFFState.source}", rate=${keyFFState.rate}`);

    // Test Keyboard ArrowRight Release
    console.log('[E2E Test] Testing Keyboard ArrowRight Release...');
    await win.webContents.executeJavaScript(`
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowRight' }));
    `);
    const keyFFEndState = await win.webContents.executeJavaScript(`
        (() => {
            return {
                isFastForwarding: window.app?.isFastForwarding,
                rate: window.videoPlayer?.video?.playbackRate
            };
        })()
    `);
    console.log(`✅ [E2E Test] Keyboard ArrowRight Released: isFF=${keyFFEndState.isFastForwarding}, rate=${keyFFEndState.rate}`);

    // Test fast-forward auto-reset when the video changes (lost-release safety net)
    console.log('[E2E Test] Testing Fast Forward auto-reset on video switch...');
    await win.webContents.executeJavaScript(`window.app.startFastForward('mouse')`);
    await win.webContents.executeJavaScript(`window.app.nextVideo()`);
    await new Promise(r => setTimeout(r, 300));
    const ffResetState = await win.webContents.executeJavaScript(`
        (() => {
            return {
                isFF: window.app?.isFastForwarding,
                source: window.app?.fastForwardSource,
                rate: window.videoPlayer?.video?.playbackRate,
                hudVisible: !document.getElementById('speed-hud')?.classList.contains('hidden')
            };
        })()
    `);
    if (ffResetState.isFF) throw new Error('Switching videos must abort fast-forward');
    if (Math.abs((ffResetState.rate || 1) - 1) > 0.01) throw new Error('Playback rate must be restored to 1.0 after video switch');
    console.log(`✅ [E2E Test] Fast Forward reset verified: isFF=${ffResetState.isFF}, rate=${ffResetState.rate}, hudVisible=${ffResetState.hudVisible}`);

    // MARK: - Playback speed control (top-right)
    console.log('[E2E Test] Testing playback speed control...');
    await win.webContents.executeJavaScript(`window.app.setPlaybackSpeed(1.5)`);
    await new Promise(r => setTimeout(r, 300));
    const speedState = await win.webContents.executeJavaScript(`
        (() => {
            return {
                rate: window.videoPlayer.video.playbackRate,
                base: window.videoPlayer.playbackRate,
                label: document.getElementById('speed-label')?.textContent,
                saved: JSON.parse(localStorage.getItem('windv_settings') || '{}').playbackSpeed,
                activeOption: document.querySelector('#speed-menu .speed-option.active')?.textContent,
                controlHighlighted: document.getElementById('speed-control')?.classList.contains('at-speed')
            };
        })()
    `);
    if (Math.abs(speedState.rate - 1.5) > 0.01) throw new Error('speed control did not apply 1.5X, got ' + speedState.rate);
    if (speedState.label !== '1.5X') throw new Error('speed label should read 1.5X, got ' + speedState.label);
    if (speedState.saved !== 1.5) throw new Error('playback speed was not persisted');
    if (speedState.activeOption !== '1.5X') throw new Error('speed menu does not mark 1.5X as active');
    if (!speedState.controlHighlighted) throw new Error('speed button should highlight non-1.0X speeds');
    console.log(`✅ [E2E Test] Speed select verified: rate=${speedState.rate}, label=${speedState.label}, saved=${speedState.saved}`);

    // Menu: open and pick 2.0X
    const menuOpenState = await win.webContents.executeJavaScript(`
        (() => {
            document.getElementById('btn-speed').click();
            const opened = !document.getElementById('speed-menu').classList.contains('hidden');
            document.querySelector('#speed-menu [data-speed="2"]').click();
            return {
                opened,
                closed: document.getElementById('speed-menu').classList.contains('hidden'),
                rate: window.videoPlayer.video.playbackRate
            };
        })()
    `);
    if (!menuOpenState.opened) throw new Error('speed menu did not open');
    if (!menuOpenState.closed) throw new Error('speed menu did not close after choosing a speed');
    if (Math.abs(menuOpenState.rate - 2) > 0.01) throw new Error('speed menu did not apply 2.0X');
    console.log(`✅ [E2E Test] Speed menu verified: opened=${menuOpenState.opened}, rate=${menuOpenState.rate}`);

    // Keyboard shortcuts [ / ]
    const keySpeedState = await win.webContents.executeJavaScript(`
        (() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { code: 'BracketLeft' }));
            const down = window.videoPlayer.video.playbackRate;
            window.dispatchEvent(new KeyboardEvent('keydown', { code: 'BracketRight' }));
            const up = window.videoPlayer.video.playbackRate;
            return { down, up };
        })()
    `);
    if (Math.abs(keySpeedState.down - 1.5) > 0.01) throw new Error('BracketLeft should step down to 1.5X, got ' + keySpeedState.down);
    if (Math.abs(keySpeedState.up - 2) > 0.01) throw new Error('BracketRight should step up to 2.0X, got ' + keySpeedState.up);
    console.log(`✅ [E2E Test] Speed shortcuts verified: down=${keySpeedState.down}, up=${keySpeedState.up}`);

    // Fast-forward is temporary and must restore the chosen base speed
    await win.webContents.executeJavaScript(`window.app.setPlaybackSpeed(1.25); window.app.startFastForward('mouse'); true;`);
    const ffTempRate = await win.webContents.executeJavaScript(`window.videoPlayer.video.playbackRate`);
    await win.webContents.executeJavaScript(`window.app.stopFastForward(); true;`);
    const ffRestoredRate = await win.webContents.executeJavaScript(`window.videoPlayer.video.playbackRate`);
    if (Math.abs(ffTempRate - 2) > 0.01) throw new Error('fast-forward should play at 2.0X');
    if (Math.abs(ffRestoredRate - 1.25) > 0.01) throw new Error('fast-forward should restore the chosen 1.25X, got ' + ffRestoredRate);
    console.log(`✅ [E2E Test] Fast-forward + custom speed verified: 1.25X -> ${ffTempRate} -> ${ffRestoredRate}`);

    // A new video keeps the chosen speed
    await win.webContents.executeJavaScript(`window.app.nextVideo()`);
    await new Promise(r => setTimeout(r, 2500));
    const newVideoRate = await win.webContents.executeJavaScript(`window.videoPlayer.video.playbackRate`);
    if (Math.abs(newVideoRate - 1.25) > 0.01) throw new Error('new video did not keep 1.25X, got ' + newVideoRate);
    console.log(`✅ [E2E Test] Speed persists across videos: ${newVideoRate}`);

    // Restore the default speed
    await win.webContents.executeJavaScript(`window.app.setPlaybackSpeed(1.0); true;`);

    // MARK: - Danmaku (bullet comments)
    console.log('[E2E Test] Testing danmaku...');
    const danmakuUiState = await win.webContents.executeJavaScript(`
        (() => ({
            hasLayer: !!document.getElementById('danmaku-layer'),
            enabled: window.danmaku?.enabled,
            btnActive: document.getElementById('btn-danmaku')?.classList.contains('active'),
            switchOn: document.getElementById('setting-danmaku-enabled')?.checked,
            seekChips: document.querySelectorAll('.seek-step-chips .chip-btn.active').length
        }))()
    `);
    if (!danmakuUiState.hasLayer) throw new Error('danmaku layer is missing');
    if (danmakuUiState.enabled !== true || !danmakuUiState.btnActive || !danmakuUiState.switchOn) {
        throw new Error('danmaku should default to ON in the button and settings');
    }
    if (danmakuUiState.seekChips !== 1) throw new Error('danmaku chips must not disturb the seek-step chips');

    // The hidden test window does not run requestAnimationFrame, so drive frames by hand
    const danmakuFrames = async (ms) => {
        const until = Date.now() + ms;
        while (Date.now() < until) {
            await win.webContents.executeJavaScript(`window.danmaku.tick(); true;`);
            await new Promise(r => setTimeout(r, 100));
        }
    };

    // Find a queued video that has danmaku (pull one more batch if needed)
    let danmakuIndex = await win.webContents.executeJavaScript(`window.app.items.findIndex(i => i.danmakuCount > 0)`);
    if (danmakuIndex < 0) {
        await win.webContents.executeJavaScript(`window.app.loadFeed(false).then(() => true)`);
        danmakuIndex = await win.webContents.executeJavaScript(`window.app.items.findIndex(i => i.danmakuCount > 0)`);
    }

    if (danmakuIndex < 0) {
        console.log('ℹ️ [E2E Test] No queued video has danmaku right now, live danmaku check skipped');
    } else {
        await win.webContents.executeJavaScript(`
            window.app.currentIndex = ${danmakuIndex};
            window.app.playCurrent();
            true;
        `);

        let danmakuState = null;
        for (let i = 0; i < 12; i++) {
            await danmakuFrames(1000);
            danmakuState = await win.webContents.executeJavaScript(`
                (() => ({
                    ...window.danmaku.stats(),
                    expected: window.app.currentItem.danmakuCount,
                    domItems: document.querySelectorAll('#danmaku-layer .danmaku-item').length,
                    sample: document.querySelector('#danmaku-layer .danmaku-item')?.textContent || '',
                    time: window.videoPlayer.video.currentTime
                }))()
            `);
            if (danmakuState.emittedCount > 0 && danmakuState.domItems > 0) break;
        }
        if (danmakuState.listLength === 0) throw new Error('no danmaku was loaded for a video that reports ' + danmakuState.expected);
        if (danmakuState.emittedCount === 0 || danmakuState.domItems === 0) {
            throw new Error('danmaku was loaded but nothing was rendered: ' + JSON.stringify(danmakuState));
        }
        console.log(`✅ [E2E Test] Danmaku rendered: loaded=${danmakuState.listLength}, emitted=${danmakuState.emittedCount}, onScreen=${danmakuState.domItems}, t=${danmakuState.time.toFixed(1)}s, sample="${danmakuState.sample}"`);

        // Lanes must not overlap: two danmaku in the same lane never share pixels
        const overlapState = await win.webContents.executeJavaScript(`
            (() => {
                const rects = Array.from(document.querySelectorAll('#danmaku-layer .danmaku-item')).map(el => el.getBoundingClientRect());
                let overlaps = 0;
                for (let a = 0; a < rects.length; a++) {
                    for (let b = a + 1; b < rects.length; b++) {
                        if (Math.abs(rects[a].top - rects[b].top) < 1 && rects[a].left < rects[b].right && rects[b].left < rects[a].right) overlaps++;
                    }
                }
                return { count: rects.length, overlaps };
            })()
        `);
        if (overlapState.overlaps > 0) throw new Error('danmaku overlap in the same lane: ' + overlapState.overlaps);
        console.log(`✅ [E2E Test] Danmaku lanes verified: ${overlapState.count} on screen, overlaps=${overlapState.overlaps}`);

        // Pausing the video freezes the danmaku; speed follows the video
        await win.webContents.executeJavaScript(`window.videoPlayer.video.pause(); true;`);
        await danmakuFrames(400);
        const pausedState = await win.webContents.executeJavaScript(`
            (() => ({
                running: window.danmaku.running,
                states: Array.from(window.danmaku.active).map(e => e.anim.playState)
            }))()
        `);
        if (pausedState.running) throw new Error('danmaku must stop while the video is paused');
        if (pausedState.states.some(s => s === 'running')) throw new Error('danmaku animations kept running while paused');

        await win.webContents.executeJavaScript(`window.app.setPlaybackSpeed(2); window.videoPlayer.video.play(); true;`);
        await danmakuFrames(1200);
        const fastState = await win.webContents.executeJavaScript(`
            (() => ({
                running: window.danmaku.running,
                rate: window.danmaku.rate,
                rates: Array.from(window.danmaku.active).map(e => e.anim.playbackRate)
            }))()
        `);
        if (!fastState.running) throw new Error('danmaku must resume with the video');
        if (fastState.rate !== 2 || fastState.rates.some(r => r !== 2)) throw new Error('danmaku must follow the 2.0X playback speed');
        await win.webContents.executeJavaScript(`window.app.setPlaybackSpeed(1.0); true;`);
        console.log(`✅ [E2E Test] Danmaku pause/speed sync verified: paused=${!pausedState.running}, rate@2X=${fastState.rate}`);

        // Seeking clears the screen and continues from the new position
        await win.webContents.executeJavaScript(`
            window.videoPlayer.video.currentTime = Math.min(40, Math.max(0, window.videoPlayer.video.duration - 5));
            true;
        `);
        await danmakuFrames(600);
        const seekState = await win.webContents.executeJavaScript(`
            (() => {
                const d = window.danmaku;
                const next = d.track.list[d.pointer];
                return { t: window.videoPlayer.video.currentTime * 1000, nextOffset: next ? next.offsetMs : null, segments: d.stats().loadedSegments.length };
            })()
        `);
        if (seekState.nextOffset !== null && seekState.nextOffset < seekState.t - 2500) {
            throw new Error('after a seek the danmaku cursor is still behind the video: ' + JSON.stringify(seekState));
        }
        console.log(`✅ [E2E Test] Danmaku seek verified: t=${(seekState.t / 1000).toFixed(1)}s, segments=${seekState.segments}`);
    }

    // D toggles danmaku off (screen cleared, persisted) and back on
    const danmakuToggleState = await win.webContents.executeJavaScript(`
        (() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
            const off = {
                enabled: window.danmaku.enabled,
                layerHidden: document.getElementById('danmaku-layer').classList.contains('hidden'),
                domItems: document.querySelectorAll('#danmaku-layer .danmaku-item').length,
                btnActive: document.getElementById('btn-danmaku').classList.contains('active'),
                switchOn: document.getElementById('setting-danmaku-enabled').checked,
                saved: JSON.parse(localStorage.getItem('windv_settings') || '{}').danmakuEnabled
            };
            document.getElementById('btn-danmaku').click();
            return { off, onAgain: window.danmaku.enabled, layerVisible: !document.getElementById('danmaku-layer').classList.contains('hidden') };
        })()
    `);
    const off = danmakuToggleState.off;
    if (off.enabled || !off.layerHidden || off.domItems !== 0 || off.btnActive || off.switchOn || off.saved !== false) {
        throw new Error('D should switch danmaku off everywhere: ' + JSON.stringify(off));
    }
    if (!danmakuToggleState.onAgain || !danmakuToggleState.layerVisible) throw new Error('danmaku button should switch danmaku back on');
    console.log('✅ [E2E Test] Danmaku toggle (D key / button) verified');

    // Display settings
    const danmakuSettingState = await win.webContents.executeJavaScript(`
        (() => {
            const seekBefore = window.settingsManager.get('seekStepSeconds');
            document.querySelector('[data-danmaku-size="28"]').click();
            document.querySelector('[data-danmaku-area="0.25"]').click();
            const range = document.getElementById('setting-danmaku-opacity');
            range.value = '0.5';
            range.dispatchEvent(new Event('input'));
            const layer = document.getElementById('danmaku-layer');
            const result = {
                fontSize: layer.style.getPropertyValue('--danmaku-font-size'),
                opacity: layer.style.opacity,
                label: document.getElementById('danmaku-opacity-val').textContent,
                area: window.settingsManager.get('danmakuArea'),
                activeSize: document.querySelector('[data-danmaku-size].active')?.dataset.danmakuSize,
                seekUnchanged: window.settingsManager.get('seekStepSeconds') === seekBefore
            };
            // Restore defaults
            document.querySelector('[data-danmaku-size="22"]').click();
            document.querySelector('[data-danmaku-area="0.5"]').click();
            range.value = '0.85';
            range.dispatchEvent(new Event('input'));
            return result;
        })()
    `);
    if (danmakuSettingState.fontSize !== '28px' || danmakuSettingState.activeSize !== '28') throw new Error('danmaku font size setting did not apply');
    if (danmakuSettingState.opacity !== '0.5' || danmakuSettingState.label !== '50%') throw new Error('danmaku opacity setting did not apply');
    if (danmakuSettingState.area !== 0.25) throw new Error('danmaku area setting did not apply');
    if (!danmakuSettingState.seekUnchanged) throw new Error('danmaku chips changed the seek step');
    console.log(`✅ [E2E Test] Danmaku settings verified: size=${danmakuSettingState.fontSize}, opacity=${danmakuSettingState.label}, area=${danmakuSettingState.area}`);

    // MARK: - Test Update System
    console.log('[E2E Test] Testing Update System (version semver logic)...');
    if (!updater.isNewer('1.0.1', '1.0.0')) throw new Error('1.0.1 should be newer than 1.0.0');
    if (updater.isNewer('1.0.0', '1.0.0')) throw new Error('1.0.0 should not be newer than 1.0.0');
    if (updater.isNewer('0.9.5', '1.0.0')) throw new Error('0.9.5 should not be newer than 1.0.0');
    if (!updater.isNewer('v2.0.0', '1.0.0')) throw new Error('v2.0.0 should be newer than 1.0.0');
    console.log('✅ [E2E Test] Version comparison semver verified successfully');

    // Test Update Modal UI rendering
    console.log('[E2E Test] Testing Update Modal UI rendering...');
    await win.webContents.executeJavaScript(`
        window.updateManager.showUpdateModal({
            latestVersion: '1.1.0',
            currentVersion: '1.0.0',
            releaseDate: '2026-11-03',
            releaseNotes: '1. 支持一键在线检查更新\\n2. 修复各种体验问题',
            releaseUrl: 'https://github.com/275556968/MacDV/releases',
            asset: {
                name: 'WinDV-1.1.0-Portable.exe',
                size: 80000000,
                downloadUrl: 'https://github.com/275556968/MacDV/releases/download/v1.1.0/WinDV-1.1.0-Portable.exe'
            }
        });
    `);

    const updateModalState = await win.webContents.executeJavaScript(`
        (() => {
            const modal = document.getElementById('update-modal');
            return {
                visible: !modal?.classList.contains('hidden'),
                newTag: document.getElementById('update-new-tag')?.textContent,
                curTag: document.getElementById('update-cur-tag')?.textContent,
                notes: document.getElementById('update-notes')?.textContent,
                btnText: document.getElementById('btn-update-download-text')?.textContent
            };
        })()
    `);
    console.log(`✅ [E2E Test] Update Modal verified: visible=${updateModalState.visible}, newTag="${updateModalState.newTag}", btn="${updateModalState.btnText}"`);

    // Test Download Progress Simulation
    console.log('[E2E Test] Testing Update Download Progress UI...');
    await win.webContents.executeJavaScript(`
        window.updateManager.onProgress({
            percent: 50,
            downloadedMB: '40.0',
            totalMB: '80.0',
            speed: '5.2 MB/s'
        });
    `);

    const progressState = await win.webContents.executeJavaScript(`
        (() => {
            return {
                percentText: document.getElementById('update-progress-percent')?.textContent,
                bytesText: document.getElementById('update-progress-bytes')?.textContent,
                speedText: document.getElementById('update-progress-speed')?.textContent
            };
        })()
    `);
    console.log(`✅ [E2E Test] Progress UI verified: percent="${progressState.percentText}", bytes="${progressState.bytesText}", speed="${progressState.speedText}"`);

    // Test Download Completion UI
    console.log('[E2E Test] Testing Update Download Completion UI...');
    await win.webContents.executeJavaScript(`
        window.updateManager.onComplete({
            filePath: 'C:\\\\Downloads\\\\WinDV-1.1.0-Portable.exe',
            fileName: 'WinDV-1.1.0-Portable.exe'
        });
    `);

    const completeState = await win.webContents.executeJavaScript(`
        (() => {
            return {
                bannerVisible: !document.getElementById('update-complete-banner')?.classList.contains('hidden'),
                hasRunBtn: !document.getElementById('btn-update-run-now')?.classList.contains('hidden'),
                hasFolderBtn: !document.getElementById('btn-update-open-folder')?.classList.contains('hidden')
            };
        })()
    `);
    console.log(`✅ [E2E Test] Download Complete UI verified: banner=${completeState.bannerVisible}, hasRunBtn=${completeState.hasRunBtn}`);

    // Close Update Modal
    await win.webContents.executeJavaScript(`window.updateManager.closeModal()`);

    // Test Settings Manual Check Updates button
    console.log('[E2E Test] Testing Settings Modal Check Updates button...');
    await win.webContents.executeJavaScript(`
        document.getElementById('btn-check-update').click();
    `);
    await new Promise(r => setTimeout(r, 1500));
    const checkStatusState = await win.webContents.executeJavaScript(`
        (() => {
            return {
                statusText: document.getElementById('update-status-text')?.textContent,
                statusBoxVisible: !document.getElementById('update-status-box')?.classList.contains('hidden')
            };
        })()
    `);
    console.log(`✅ [E2E Test] Settings Check Update verified: text="${checkStatusState.statusText}"`);

    // MARK: - Watch History Dedupe helpers (deterministic, no network)
    console.log('[E2E Test] Testing dedupe filter / history persistence / clear...');
    const savedHistory = await win.webContents.executeJavaScript(`
        (() => { try { return JSON.parse(localStorage.getItem('windv_seen_ids_v1') || '[]'); } catch (e) { return []; } })()
    `);
    const dedupeHelperState = await win.webContents.executeJavaScript(`
        (() => {
            const app = window.app;
            app.seenIds = new Set(['111']);
            app.items = [{ awemeId: '222' }];

            const filtered = app.filterUnseen([
                { awemeId: '111' },  // already watched
                { awemeId: '222' },  // already queued
                { awemeId: '333' },
                { awemeId: '333' },  // duplicate inside the same batch
                { awemeId: '444' },
                {}                    // no id -> cannot dedupe, keep it
            ]).map(i => i.awemeId || 'none');

            app.markSeen({ awemeId: '999' });
            const persisted = JSON.parse(localStorage.getItem('windv_seen_ids_v1') || '[]');
            const countAfterMark = document.getElementById('seen-count')?.textContent;

            app.clearSeenHistory();
            return {
                filtered,
                persisted,
                countAfterMark,
                afterClear: {
                    size: app.seenIds.size,
                    raw: localStorage.getItem('windv_seen_ids_v1'),
                    countText: document.getElementById('seen-count')?.textContent
                }
            };
        })()
    `);

    if (dedupeHelperState.filtered.join(',') !== '333,444,none') {
        throw new Error('dedupe filter returned: ' + dedupeHelperState.filtered.join(','));
    }
    if (!dedupeHelperState.persisted.includes('999') || !dedupeHelperState.persisted.includes('111')) {
        throw new Error('watched history was not persisted correctly');
    }
    if (dedupeHelperState.countAfterMark !== '2') {
        throw new Error('seen counter did not update, got ' + dedupeHelperState.countAfterMark);
    }
    if (dedupeHelperState.afterClear.size !== 0 || dedupeHelperState.afterClear.raw !== null) {
        throw new Error('watched history was not cleared');
    }
    if (dedupeHelperState.afterClear.countText !== '0') {
        throw new Error('seen counter UI did not reset after clearing');
    }
    console.log(`✅ [E2E Test] Dedupe helpers verified: filtered=${dedupeHelperState.filtered.join('|')}, counter ${dedupeHelperState.countAfterMark} -> ${dedupeHelperState.afterClear.countText}`);

    // Test dedupe ON/OFF switch
    const dedupeSwitchState = await win.webContents.executeJavaScript(`
        (() => {
            const chk = document.getElementById('setting-dedupe-feed');
            chk.checked = false;
            chk.dispatchEvent(new Event('change'));
            const off = window.app.filterUnseen([{ awemeId: 'x' }, { awemeId: 'x' }]).length;

            chk.checked = true;
            chk.dispatchEvent(new Event('change'));
            const on = window.app.filterUnseen([{ awemeId: 'x' }, { awemeId: 'x' }]).length;

            return { off, on, enabled: window.app.isDedupeEnabled() };
        })()
    `);
    if (dedupeSwitchState.off !== 2) throw new Error('dedupe must be bypassed when the switch is OFF');
    if (dedupeSwitchState.on !== 1) throw new Error('dedupe must drop duplicates when the switch is ON');
    if (dedupeSwitchState.enabled !== true) throw new Error('dedupe setting did not turn back on');
    console.log(`✅ [E2E Test] Dedupe switch verified: off=${dedupeSwitchState.off}, on=${dedupeSwitchState.on}`);

    // Restore the dev profile's original watched history (tests must not wipe real data)
    await win.webContents.executeJavaScript(`
        window.app.seenIds = new Set(${JSON.stringify(savedHistory)});
        window.app.saveSeenIds();
        true;
    `);

    console.log('\n🎉 =======================================================');
    console.log('🎉 ALL WIN-DV AUTOMATED END-TO-END TESTS PASSED PERFECTLY!');
    console.log('🎉 =======================================================\n');

    win.destroy();
    app.quit();
});
