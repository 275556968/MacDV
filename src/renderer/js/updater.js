class UpdateManager {
    constructor() {
        this.updateModal = document.getElementById('update-modal');
        this.btnCheckUpdate = document.getElementById('btn-check-update');
        this.btnCheckUpdateText = document.getElementById('btn-check-update-text');
        this.statusBox = document.getElementById('update-status-box');
        this.statusText = document.getElementById('update-status-text');
        this.chkAutoCheck = document.getElementById('setting-auto-check-update');
        this.currentVersionText = document.getElementById('current-version-text');

        // Modal elements
        this.newTag = document.getElementById('update-new-tag');
        this.curTag = document.getElementById('update-cur-tag');
        this.releaseDate = document.getElementById('update-date');
        this.releaseNotes = document.getElementById('update-notes');
        this.btnDownload = document.getElementById('btn-update-download');
        this.btnDownloadText = document.getElementById('btn-update-download-text');
        this.btnWeb = document.getElementById('btn-update-web');
        this.btnOpenFolder = document.getElementById('btn-update-open-folder');
        this.btnRunNow = document.getElementById('btn-update-run-now');
        this.btnLater = document.getElementById('btn-update-later');

        // Progress elements
        this.progressWrap = document.getElementById('update-progress-wrap');
        this.progressStatus = document.getElementById('update-progress-status');
        this.progressPercent = document.getElementById('update-progress-percent');
        this.progressBar = document.getElementById('update-progress-bar');
        this.progressBytes = document.getElementById('update-progress-bytes');
        this.progressSpeed = document.getElementById('update-progress-speed');
        this.completeBanner = document.getElementById('update-complete-banner');
        this.filePathEl = document.getElementById('update-file-path');

        this.currentUpdateInfo = null;
        this.savedFilePath = null;
        this.isChecking = false;

        this.init();
    }

    async init() {
        // Fetch current version from main process
        try {
            const ver = await window.api?.updater?.getVersion();
            if (ver && this.currentVersionText) {
                this.currentVersionText.textContent = `v${ver} (Windows 原生横屏版)`;
            }
        } catch (e) {}

        // Bind Settings toggle
        if (this.chkAutoCheck) {
            this.chkAutoCheck.checked = window.settingsManager.get('autoCheckUpdate');
            this.chkAutoCheck.addEventListener('change', () => {
                window.settingsManager.set('autoCheckUpdate', this.chkAutoCheck.checked);
            });
        }

        // Bind Manual Check button
        this.btnCheckUpdate?.addEventListener('click', () => {
            this.checkForUpdates(true);
        });

        // Bind Modal buttons
        this.updateModal?.querySelectorAll('[data-close="update-modal"]').forEach(btn => {
            btn.addEventListener('click', () => this.closeModal());
        });

        this.btnWeb?.addEventListener('click', () => {
            if (this.currentUpdateInfo?.releaseUrl) {
                window.api?.shell?.openExternal(this.currentUpdateInfo.releaseUrl);
            }
        });

        this.btnDownload?.addEventListener('click', () => {
            this.startDownload();
        });

        this.btnOpenFolder?.addEventListener('click', () => {
            if (this.savedFilePath) {
                window.api?.updater?.openFolder(this.savedFilePath);
            }
        });

        this.btnRunNow?.addEventListener('click', () => {
            if (this.savedFilePath) {
                window.api?.updater?.install(this.savedFilePath);
            }
        });

        // Listen for IPC download events
        window.api?.updater?.onDownloadProgress((data) => {
            this.onProgress(data);
        });

        window.api?.updater?.onDownloadComplete((data) => {
            this.onComplete(data);
        });

        window.api?.updater?.onDownloadError((err) => {
            this.onError(err);
        });

        window.api?.updater?.onUpdateFound((info) => {
            if (info && info.hasUpdate) {
                this.showUpdateModal(info);
            }
        });

        // Auto-check on startup if enabled
        if (window.settingsManager.get('autoCheckUpdate')) {
            setTimeout(() => {
                this.checkForUpdates(false);
            }, 4500);
        }
    }

    async checkForUpdates(manual = false) {
        if (this.isChecking) return;
        this.isChecking = true;

        if (manual) {
            this.btnCheckUpdate?.classList.add('loading');
            if (this.btnCheckUpdateText) this.btnCheckUpdateText.textContent = '检查中...';
            this.showStatus('正在连接 GitHub 检查新版本...', 'default');
        }

        try {
            const res = await window.api?.updater?.check(manual);
            if (!res || !res.success) {
                if (manual) {
                    this.showStatus(`检查失败: ${res?.error || '网络连接异常'}`, 'info');
                }
                return;
            }

            if (res.hasUpdate) {
                if (manual) {
                    this.showStatus(`发现新版本 v${res.latestVersion}！`, 'success');
                }
                this.showUpdateModal(res);
            } else {
                if (manual) {
                    this.showStatus(`当前已是最新版本 (v${res.currentVersion})`, 'success');
                    window.app?.showToast(`✅ 当前 WinDV 已是最新版 (v${res.currentVersion})`);
                }
            }
        } catch (err) {
            if (manual) {
                this.showStatus(`检查出错: ${err.message}`, 'info');
            }
        } finally {
            this.isChecking = false;
            if (manual) {
                this.btnCheckUpdate?.classList.remove('loading');
                if (this.btnCheckUpdateText) this.btnCheckUpdateText.textContent = '检查新版本';
            }
        }
    }

    showStatus(msg, type = 'default') {
        if (!this.statusBox || !this.statusText) return;
        this.statusBox.classList.remove('hidden', 'success', 'info');
        if (type !== 'default') {
            this.statusBox.classList.add(type);
        }
        this.statusText.textContent = msg;
    }

    showUpdateModal(info) {
        this.currentUpdateInfo = info;
        this.savedFilePath = null;

        // Reset UI state
        if (this.newTag) this.newTag.textContent = `v${info.latestVersion}`;
        if (this.curTag) this.curTag.textContent = `当前: v${info.currentVersion}`;
        if (this.releaseDate) this.releaseDate.textContent = info.releaseDate || '最新发布';
        if (this.releaseNotes) {
            this.releaseNotes.textContent = info.releaseNotes || '功能体验优化与稳定性修复。';
        }

        // Reset download progress & actions
        this.progressWrap?.classList.add('hidden');
        this.completeBanner?.classList.add('hidden');
        this.btnOpenFolder?.classList.add('hidden');
        this.btnRunNow?.classList.add('hidden');

        if (this.btnDownload) {
            this.btnDownload.classList.remove('hidden', 'disabled');
            if (info.asset && info.asset.downloadUrl) {
                const sizeMB = info.asset.size ? ` (${(info.asset.size / (1024 * 1024)).toFixed(1)} MB)` : '';
                this.btnDownloadText.textContent = `⚡ 立即下载更新${sizeMB}`;
            } else {
                this.btnDownloadText.textContent = `🌐 前往网页下载`;
            }
        }

        this.updateModal?.classList.remove('hidden');
    }

    closeModal() {
        this.updateModal?.classList.add('hidden');
    }

    async startDownload() {
        const info = this.currentUpdateInfo;
        if (!info) return;

        // If no direct exe asset, redirect to browser
        if (!info.asset || !info.asset.downloadUrl) {
            if (info.releaseUrl) {
                window.api?.shell?.openExternal(info.releaseUrl);
            }
            return;
        }

        // Show progress wrap
        this.btnDownload?.classList.add('disabled');
        this.progressWrap?.classList.remove('hidden');
        this.completeBanner?.classList.add('hidden');

        if (this.progressBar) this.progressBar.style.width = '0%';
        if (this.progressPercent) this.progressPercent.textContent = '0%';
        if (this.progressStatus) this.progressStatus.textContent = '正在连接下载节点...';
        if (this.progressBytes) this.progressBytes.textContent = '0 MB / 0 MB';
        if (this.progressSpeed) this.progressSpeed.textContent = '0 MB/s';

        try {
            await window.api?.updater?.download({
                url: info.asset.downloadUrl,
                assetName: info.asset.name
            });
        } catch (e) {
            this.onError({ error: e.message });
        }
    }

    onProgress(data) {
        if (this.progressBar) this.progressBar.style.width = `${data.percent}%`;
        if (this.progressPercent) this.progressPercent.textContent = `${data.percent}%`;
        if (this.progressStatus) this.progressStatus.textContent = '正在极速下载新版本...';
        if (this.progressBytes) this.progressBytes.textContent = `${data.downloadedMB} MB / ${data.totalMB} MB`;
        if (this.progressSpeed) this.progressSpeed.textContent = data.speed || '';
    }

    onComplete(data) {
        this.savedFilePath = data.filePath;

        if (this.progressBar) this.progressBar.style.width = '100%';
        if (this.progressPercent) this.progressPercent.textContent = '100%';
        if (this.progressStatus) this.progressStatus.textContent = '下载完成！';

        // Show completed UI
        this.completeBanner?.classList.remove('hidden');
        if (this.filePathEl) {
            this.filePathEl.textContent = `文件已保存: ${data.fileName} (下载目录)`;
        }

        this.btnDownload?.classList.add('hidden');
        this.btnOpenFolder?.classList.remove('hidden');
        this.btnRunNow?.classList.remove('hidden');

        window.app?.showToast('🎉 新版本下载完成，可直接一键运行！');
    }

    onError(data) {
        this.btnDownload?.classList.remove('disabled');
        if (this.progressStatus) {
            this.progressStatus.textContent = `下载异常: ${data.error || '网络中断'}`;
        }
        window.app?.showToast(`⚠️ 下载失败: ${data.error || '网络超时'}，可尝试网页下载`);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.updateManager = new UpdateManager();
});
