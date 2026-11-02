const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    window: {
        minimize: () => ipcRenderer.invoke('window:minimize'),
        maximize: () => ipcRenderer.invoke('window:maximize'),
        close: () => ipcRenderer.invoke('window:close'),
        isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
        setAlwaysOnTop: (flag) => ipcRenderer.invoke('window:setAlwaysOnTop', flag),
        setOpacity: (val) => ipcRenderer.invoke('window:setOpacity', val),
        setFullScreen: (flag) => ipcRenderer.invoke('window:setFullScreen', flag),
        isFullScreen: () => ipcRenderer.invoke('window:isFullScreen'),
        onMaximizedChange: (cb) => {
            ipcRenderer.on('window:maximized-change', (e, val) => cb(val));
        },
        onFullscreenChange: (cb) => {
            ipcRenderer.on('window:fullscreen-change', (e, val) => cb(val));
        }
    },
    engine: {
        getStatus: () => ipcRenderer.invoke('engine:getStatus'),
        switchChannel: (channelKey) => ipcRenderer.invoke('engine:switchChannel', channelKey),
        fetchFeed: (opts) => ipcRenderer.invoke('engine:fetchFeed', opts || {}),
        fetchComments: (opts) => ipcRenderer.invoke('engine:fetchComments', opts || {}),
        checkLogin: () => ipcRenderer.invoke('engine:checkLogin'),
        applyCookie: (cookieStr) => ipcRenderer.invoke('engine:applyCookie', cookieStr),
        logout: () => ipcRenderer.invoke('engine:logout'),
        openLoginWindow: () => ipcRenderer.invoke('engine:openLoginWindow'),
        onEngineReady: (cb) => {
            ipcRenderer.on('engine:ready', (e, data) => cb(data));
        },
        onLoginSuccess: (cb) => {
            ipcRenderer.on('engine:login-success', (e, data) => cb(data));
        }
    },
    sleep: {
        setPlaybackState: (isPlaying) => ipcRenderer.invoke('sleep:setPlaybackState', isPlaying),
        setPreference: (enabled) => ipcRenderer.invoke('sleep:setPreference', enabled)
    },
    clipboard: {
        writeText: (text) => ipcRenderer.invoke('clipboard:write', text)
    },
    shell: {
        openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
    }
});
