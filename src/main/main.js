const { app, BrowserWindow, ipcMain, clipboard, shell } = require('electron');
const path = require('path');

// Allow autoplay with sound without requiring user interaction
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'PreloadMediaEngagementData,AutoplayIgnoreWebAudio');

const engine = require('./engine');
const sleepPreventer = require('./sleep-preventer');

let mainWindow = null;
let loginWindow = null;

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1120,
        height: 700,
        minWidth: 720,
        minHeight: 450,
        frame: false,
        backgroundColor: '#0a0a0c',
        icon: path.join(__dirname, '../../assets/icon.ico'),
        webPreferences: {
            preload: path.join(__dirname, '../preload/preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true
        }
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    mainWindow.on('maximize', () => {
        mainWindow.webContents.send('window:maximized-change', true);
    });

    mainWindow.on('unmaximize', () => {
        mainWindow.webContents.send('window:maximized-change', false);
    });

    mainWindow.on('enter-full-screen', () => {
        mainWindow.webContents.send('window:fullscreen-change', true);
    });

    mainWindow.on('leave-full-screen', () => {
        mainWindow.webContents.send('window:fullscreen-change', false);
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
        if (loginWindow) {
            loginWindow.destroy();
            loginWindow = null;
        }
        sleepPreventer.release();
    });
}

// Swallow custom schemes like bitbrowser://
app.setAsDefaultProtocolClient('windv');

app.whenReady().then(async () => {
    createMainWindow();

    // Start background Douyin engine
    try {
        await engine.init();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('engine:ready', {
                statusMessage: engine.statusMessage,
                isLoggedIn: engine.isLoggedIn
            });
        }
    } catch (err) {
        console.error('Failed to init engine:', err);
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
    });
});

app.on('window-all-closed', () => {
    sleepPreventer.release();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
    sleepPreventer.release();
});

// MARK: - IPC Handlers

// Window Controls
ipcMain.handle('window:minimize', () => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window:maximize', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    }
});

ipcMain.handle('window:close', () => {
    if (mainWindow) mainWindow.close();
});

ipcMain.handle('window:isMaximized', () => {
    return mainWindow ? mainWindow.isMaximized() : false;
});

ipcMain.handle('window:setAlwaysOnTop', (event, flag) => {
    if (mainWindow) {
        mainWindow.setAlwaysOnTop(!!flag, 'floating');
        return mainWindow.isAlwaysOnTop();
    }
    return false;
});

ipcMain.handle('window:setOpacity', (event, opacity) => {
    if (mainWindow) {
        const val = Math.max(0.25, Math.min(1.0, Number(opacity) || 1.0));
        mainWindow.setOpacity(val);
        return val;
    }
    return 1.0;
});

ipcMain.handle('window:setFullScreen', (event, flag) => {
    if (mainWindow) {
        mainWindow.setFullScreen(!!flag);
        return mainWindow.isFullScreen();
    }
    return false;
});

// Engine Operations
ipcMain.handle('engine:switchChannel', async (event, channelKey) => {
    await engine.switchChannel(channelKey);
    return {
        statusMessage: engine.statusMessage,
        currentChannel: engine.currentChannel
    };
});

ipcMain.handle('engine:fetchFeed', async (event, { count = 10, reset = false, horizontalOnly = true }) => {
    return await engine.fetchFeed(count, reset, horizontalOnly);
});

ipcMain.handle('engine:fetchComments', async (event, { awemeId, cursor = 0, count = 20 }) => {
    return await engine.fetchComments(awemeId, cursor, count);
});

ipcMain.handle('engine:checkLogin', async () => {
    return await engine.checkLoginStatus();
});

ipcMain.handle('engine:applyCookie', async (event, cookieStr) => {
    return await engine.applyCookieHeader(cookieStr);
});

ipcMain.handle('engine:logout', async () => {
    return await engine.logout();
});

// Douyin QR Code Web Login Window
ipcMain.handle('engine:openLoginWindow', async () => {
    if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.focus();
        return;
    }

    loginWindow = new BrowserWindow({
        width: 800,
        height: 650,
        parent: mainWindow,
        modal: true,
        title: '抖音账号登录',
        backgroundColor: '#161823',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: false
        }
    });

    loginWindow.setMenuBarVisibility(false);
    await loginWindow.loadURL('https://www.douyin.com');

    // Auto-click the login button on douyin.com
    loginWindow.webContents.on('did-finish-load', async () => {
        try {
            await loginWindow.webContents.executeJavaScript(`
                setTimeout(() => {
                    const btns = Array.from(document.querySelectorAll('button, div, span'));
                    const loginBtn = btns.find(b => b.textContent && b.textContent.trim() === '登录');
                    if (loginBtn) loginBtn.click();
                }, 1000);
            `);
        } catch (e) {}
    });

    // Monitor cookie changes for sessionid
    const ses = loginWindow.webContents.session;
    const cookieInterval = setInterval(async () => {
        try {
            const cookies = await ses.cookies.get({ domain: '.douyin.com' });
            const hasSession = cookies.some(c => (c.name === 'sessionid' || c.name === 'sessionid_ss') && c.value);
            if (hasSession) {
                clearInterval(cookieInterval);
                const status = await engine.checkLoginStatus();
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('engine:login-success', status);
                }
                setTimeout(() => {
                    if (loginWindow && !loginWindow.isDestroyed()) {
                        loginWindow.close();
                    }
                }, 1200);
            }
        } catch (e) {}
    }, 1500);

    loginWindow.on('closed', () => {
        clearInterval(cookieInterval);
        loginWindow = null;
    });
});

// Sleep Prevention
ipcMain.handle('sleep:setPlaybackState', (event, isPlaying) => {
    sleepPreventer.updatePlaybackState(isPlaying);
});

ipcMain.handle('sleep:setPreference', (event, enabled) => {
    sleepPreventer.setPreference(enabled);
});

// Utility
ipcMain.handle('clipboard:write', (event, text) => {
    clipboard.writeText(String(text || ''));
    return true;
});

ipcMain.handle('shell:openExternal', (event, url) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        shell.openExternal(url);
    }
});
