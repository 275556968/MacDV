const { app, shell } = require('electron');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

class AppUpdater {
    constructor() {
        this.owner = '275556968';
        this.repo = 'MacDV';
        this.currentDownload = null;
        this.isDownloading = false;
    }

    get currentVersion() {
        try {
            const pkg = require('../../package.json');
            return pkg.version || (app ? app.getVersion() : '1.0.0');
        } catch (e) {
            return app ? app.getVersion() : '1.0.0';
        }
    }

    parseVersion(vStr) {
        if (!vStr) return [0, 0, 0];
        const clean = String(vStr).replace(/^[^\d]*/i, '').trim();
        const parts = clean.split('.').map(p => parseInt(p, 10) || 0);
        while (parts.length < 3) parts.push(0);
        return parts;
    }

    isNewer(remoteVersion, currentVersion) {
        const [rMajor, rMinor, rPatch] = this.parseVersion(remoteVersion);
        const [cMajor, cMinor, cPatch] = this.parseVersion(currentVersion || this.currentVersion);
        if (rMajor !== cMajor) return rMajor > cMajor;
        if (rMinor !== cMinor) return rMinor > cMinor;
        return rPatch > cPatch;
    }

    fetchJson(url) {
        return new Promise((resolve, reject) => {
            const reqUrl = new URL(url);
            const client = reqUrl.protocol === 'http:' ? http : https;
            const req = client.get(url, {
                headers: {
                    'User-Agent': `WinDV-App/${this.currentVersion}`,
                    'Accept': 'application/vnd.github.v3+json'
                },
                timeout: 10000
            }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    this.fetchJson(res.headers.location).then(resolve).catch(reject);
                    return;
                }
                if (res.statusCode !== 200) {
                    res.resume();
                    reject(new Error(`GitHub API HTTP ${res.statusCode}: ${res.statusMessage || '请求失败'}`));
                    return;
                }
                let raw = '';
                res.setEncoding('utf8');
                res.on('data', chunk => { raw += chunk; });
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(raw));
                    } catch (e) {
                        reject(new Error('解析更新信息失败'));
                    }
                });
            });
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('检查更新超时，请稍后重试'));
            });
            req.on('error', (err) => {
                reject(new Error(`网络连接失败: ${err.message}`));
            });
        });
    }

    async checkForUpdates(manual = false) {
        try {
            const apiUrl = `https://api.github.com/repos/${this.owner}/${this.repo}/releases/latest`;
            const release = await this.fetchJson(apiUrl);

            const tagName = release.tag_name || '';
            const remoteVersion = tagName.replace(/^v/i, '').trim();
            const curVersion = this.currentVersion;
            const hasUpdate = this.isNewer(remoteVersion, curVersion);

            // Locate Windows compatible asset
            let targetAsset = null;
            if (Array.isArray(release.assets) && release.assets.length > 0) {
                // Priority 1: Portable .exe
                targetAsset = release.assets.find(a => 
                    a.name && (a.name.toLowerCase().endsWith('-portable.exe') || a.name.toLowerCase().endsWith('.exe'))
                );
                // Priority 2: Windows zip
                if (!targetAsset) {
                    targetAsset = release.assets.find(a => 
                        a.name && a.name.toLowerCase().includes('win') && a.name.toLowerCase().endsWith('.zip')
                    );
                }
            }

            return {
                success: true,
                hasUpdate,
                currentVersion: curVersion,
                latestVersion: remoteVersion,
                tagName: tagName,
                releaseName: release.name || `WinDV v${remoteVersion}`,
                releaseNotes: release.body || '本次更新包含功能优化与性能稳定性提升。',
                releaseDate: release.published_at ? release.published_at.slice(0, 10) : '',
                releaseUrl: release.html_url || `https://github.com/${this.owner}/${this.repo}/releases/latest`,
                manual,
                asset: targetAsset ? {
                    name: targetAsset.name,
                    size: targetAsset.size,
                    downloadUrl: targetAsset.browser_download_url
                } : null
            };
        } catch (err) {
            console.error('Check for updates failed:', err.message);
            return {
                success: false,
                hasUpdate: false,
                currentVersion: this.currentVersion,
                error: err.message,
                manual,
                releaseUrl: `https://github.com/${this.owner}/${this.repo}/releases/latest`
            };
        }
    }

    downloadUpdate(downloadUrl, assetName, webContents) {
        if (this.isDownloading) {
            return { started: false, message: '已有更新包正在下载中' };
        }

        const downloadsDir = app.getPath('downloads');
        const fileName = assetName || `WinDV-Latest-Portable.exe`;
        const finalPath = path.join(downloadsDir, fileName);
        const tempPath = path.join(downloadsDir, `${fileName}.downloading`);

        this.isDownloading = true;

        const downloadWithRedirect = (targetUrl, redirectCount = 0) => {
            if (redirectCount > 5) {
                this.isDownloading = false;
                webContents?.send('updater:download-error', { error: '下载重定向次数过多' });
                return;
            }

            const reqUrl = new URL(targetUrl);
            const client = reqUrl.protocol === 'http:' ? http : https;

            const req = client.get(targetUrl, {
                headers: {
                    'User-Agent': `WinDV-App/${this.currentVersion}`,
                    'Accept': 'application/octet-stream'
                }
            }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    downloadWithRedirect(res.headers.location, redirectCount + 1);
                    return;
                }

                if (res.statusCode !== 200) {
                    this.isDownloading = false;
                    webContents?.send('updater:download-error', { error: `服务器返回状态码 ${res.statusCode}` });
                    return;
                }

                const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
                let downloadedBytes = 0;
                let lastUpdateTime = Date.now();
                let lastDownloadedBytes = 0;

                const fileStream = fs.createWriteStream(tempPath);
                this.currentDownload = { req, fileStream, tempPath };

                res.on('data', (chunk) => {
                    downloadedBytes += chunk.length;
                    const now = Date.now();
                    // Throttle updates to renderer (every 180ms)
                    if (now - lastUpdateTime >= 180 || downloadedBytes === totalBytes) {
                        const elapsedSec = (now - lastUpdateTime) / 1000;
                        const speedBps = elapsedSec > 0 ? (downloadedBytes - lastDownloadedBytes) / elapsedSec : 0;
                        const speedMBs = (speedBps / (1024 * 1024)).toFixed(1);
                        const percent = totalBytes > 0 ? Math.min(100, Math.floor((downloadedBytes / totalBytes) * 100)) : 0;

                        webContents?.send('updater:download-progress', {
                            percent,
                            downloadedBytes,
                            totalBytes,
                            downloadedMB: (downloadedBytes / (1024 * 1024)).toFixed(1),
                            totalMB: (totalBytes / (1024 * 1024)).toFixed(1),
                            speed: `${speedMBs} MB/s`
                        });

                        lastUpdateTime = now;
                        lastDownloadedBytes = downloadedBytes;
                    }
                });

                res.pipe(fileStream);

                fileStream.on('finish', () => {
                    fileStream.close(() => {
                        this.isDownloading = false;
                        this.currentDownload = null;
                        try {
                            if (fs.existsSync(finalPath)) {
                                fs.unlinkSync(finalPath);
                            }
                            fs.renameSync(tempPath, finalPath);
                            webContents?.send('updater:download-complete', {
                                filePath: finalPath,
                                fileName: fileName
                            });
                        } catch (err) {
                            webContents?.send('updater:download-error', { error: `重命名下载文件失败: ${err.message}` });
                        }
                    });
                });

                fileStream.on('error', (err) => {
                    this.isDownloading = false;
                    this.currentDownload = null;
                    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (e) {}
                    webContents?.send('updater:download-error', { error: `保存文件失败: ${err.message}` });
                });
            });

            req.on('error', (err) => {
                this.isDownloading = false;
                this.currentDownload = null;
                try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (e) {}
                webContents?.send('updater:download-error', { error: `下载网络错误: ${err.message}` });
            });
        };

        downloadWithRedirect(downloadUrl);
        return { started: true, savePath: finalPath };
    }

    cancelDownload() {
        if (this.currentDownload) {
            try {
                this.currentDownload.req.destroy();
                this.currentDownload.fileStream.close();
                if (fs.existsSync(this.currentDownload.tempPath)) {
                    fs.unlinkSync(this.currentDownload.tempPath);
                }
            } catch (e) {}
            this.currentDownload = null;
        }
        this.isDownloading = false;
        return true;
    }

    installAndRestart(filePath) {
        if (!filePath || !fs.existsSync(filePath)) {
            return false;
        }
        try {
            const child = spawn(filePath, [], {
                detached: true,
                stdio: 'ignore'
            });
            child.unref();
            setTimeout(() => {
                app.quit();
            }, 600);
            return true;
        } catch (e) {
            console.error('Failed to spawn new version executable:', e);
            return false;
        }
    }

    openFolder(filePath) {
        if (filePath && fs.existsSync(filePath)) {
            shell.showItemInFolder(filePath);
            return true;
        } else {
            shell.openPath(app.getPath('downloads'));
            return true;
        }
    }
}

module.exports = new AppUpdater();
