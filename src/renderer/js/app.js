class AppController {
    constructor() {
        this.items = [];
        this.currentIndex = 0;
        this.isLoading = false;
        this.isPureMode = false;
        this.isFullScreen = false;
        this.isControlsVisible = true;

        // Unified idle auto-hide (cursor + titlebar + overlays)
        this.idleTimer = null;
        this.isIdle = false;

        // Long-press fast forward (2.0X - Mouse Right Button & ArrowRight key)
        this.isFastForwarding = false;
        this.rightPressTimer = null;
        this.arrowRightTimer = null;
        this.fastForwardSource = null;
        this.wasPausedBeforeFastForward = false;
        this.speedHud = null;

        // Wheel gesture debounce
        this.scrollAccumulator = 0;
        this.hasTriggeredGesture = false;
        this.gestureResetTimer = null;

        // Elements
        this.loadingView = document.getElementById('loading-view');
        this.engineStatus = document.getElementById('engine-status');
        this.btnRetryFeed = document.getElementById('btn-retry-feed');
        this.titlebar = document.getElementById('titlebar');
        this.overlayLayer = document.getElementById('overlay-layer');
        this.toast = document.getElementById('toast');
        this.toastMessage = document.getElementById('toast-message');
        this.toastTimer = null;

        this.init();
    }

    get currentItem() {
        if (this.currentIndex >= 0 && this.currentIndex < this.items.length) {
            return this.items[this.currentIndex];
        }
        return null;
    }

    async init() {
        window.settingsManager.applyAll();

        // Check if start in pure mode
        if (window.settingsManager.get('startInPureMode')) {
            this.setPureMode(true);
        }

        this.initTitlebar();
        this.initGestures();
        this.initKeyboard();
        this.initSettingsModal();

        // Proactively check engine status on startup
        const initFeedIfReady = async () => {
            try {
                const status = await window.api?.engine?.getStatus();
                if (status && status.isReady) {
                    this.engineStatus.textContent = status.statusMessage || '引擎就绪，正在获取视频流...';
                    this.loadFeed(true);
                    window.loginModal?.checkStatus();
                    return true;
                }
            } catch (e) {}
            return false;
        };

        // Engine ready listener
        window.api?.engine?.onEngineReady((data) => {
            this.engineStatus.textContent = data.statusMessage || '引擎就绪，正在获取视频流...';
            this.loadFeed(true);
            window.loginModal?.checkStatus();
        });

        // Trigger immediate check in case engine was already ready before renderer loaded
        initFeedIfReady().then(ready => {
            if (!ready) {
                setTimeout(async () => {
                    const ok = await initFeedIfReady();
                    if (!ok && this.items.length === 0) {
                        this.engineStatus.textContent = '初始化等待中，若长时间未响应请点击刷新';
                        this.btnRetryFeed?.classList.remove('hidden');
                    }
                }, 4000);
            }
        });

        // Retry button
        this.btnRetryFeed?.addEventListener('click', () => {
            this.loadFeed(true);
        });

        // Window maximize listener
        window.api?.window?.onMaximizedChange((isMax) => {
            const iconMax = document.getElementById('icon-max');
            const iconRestore = document.getElementById('icon-restore');
            if (isMax) {
                iconMax?.classList.add('hidden');
                iconRestore?.classList.remove('hidden');
            } else {
                iconMax?.classList.remove('hidden');
                iconRestore?.classList.add('hidden');
            }
        });

        // Window fullscreen listener
        window.api?.window?.onFullscreenChange((isFull) => {
            this.handleFullscreenChange(isFull);
        });

        // Start initial idle timer
        this.handleUserActivity();
    }

    initTitlebar() {
        // Channel Switching
        const btnJingxuan = document.getElementById('channel-jingxuan');
        const btnRecommend = document.getElementById('channel-recommend');

        btnJingxuan?.addEventListener('click', async () => {
            if (btnJingxuan.classList.contains('active')) return;
            btnJingxuan.classList.add('active');
            btnRecommend.classList.remove('active');
            await window.api?.engine?.switchChannel('jingxuan');
            this.loadFeed(true);
        });

        btnRecommend?.addEventListener('click', async () => {
            if (btnRecommend.classList.contains('active')) return;
            btnRecommend.classList.add('active');
            btnJingxuan.classList.remove('active');
            await window.api?.engine?.switchChannel('recommend');
            this.loadFeed(true);
        });

        // Pure mode button
        document.getElementById('btn-pure-mode')?.addEventListener('click', () => {
            this.togglePureMode();
        });

        // Always on top button
        const btnAlwaysTop = document.getElementById('btn-always-top');
        const updateAlwaysTopUI = (on) => {
            btnAlwaysTop?.classList.toggle('active', on);
        };
        updateAlwaysTopUI(window.settingsManager.get('isAlwaysOnTop'));
        btnAlwaysTop?.addEventListener('click', () => {
            const cur = window.settingsManager.get('isAlwaysOnTop');
            const next = !cur;
            window.settingsManager.set('isAlwaysOnTop', next);
            updateAlwaysTopUI(next);
            this.showToast(next ? '📌 已开启窗口置顶' : '已取消窗口置顶');
        });

        // Refresh button
        document.getElementById('btn-refresh')?.addEventListener('click', () => {
            this.loadFeed(true);
            this.showToast('🔄 正在刷新推荐视频流...');
        });

        // Settings button
        document.getElementById('btn-settings')?.addEventListener('click', () => {
            document.getElementById('settings-modal')?.classList.remove('hidden');
        });

        // Window controls
        document.getElementById('win-min')?.addEventListener('click', () => {
            window.api?.window?.minimize();
        });
        document.getElementById('win-max')?.addEventListener('click', () => {
            window.api?.window?.maximize();
        });
        document.getElementById('win-close')?.addEventListener('click', () => {
            window.api?.window?.close();
        });
    }

    initGestures() {
        const gestureLayer = document.getElementById('gesture-layer');
        let clickTimer = null;

        gestureLayer?.addEventListener('click', (e) => {
            if (clickTimer) {
                // Double click -> Toggle Fullscreen
                clearTimeout(clickTimer);
                clickTimer = null;
                this.toggleFullScreen();
            } else {
                // Single click -> Play/Pause
                clickTimer = setTimeout(() => {
                    clickTimer = null;
                    window.videoPlayer?.togglePlay();
                    this.showControls();
                }, 220);
            }
        });

        // Trackpad & Mouse wheel scrolling (单次滑动防连跳)
        window.addEventListener('wheel', (e) => {
            // Ignore scrolling inside modal or comment drawer
            if (e.target.closest('#comment-drawer') || e.target.closest('.modal-card')) {
                return;
            }

            this.scrollAccumulator += e.deltaY;
            clearTimeout(this.gestureResetTimer);
            this.gestureResetTimer = setTimeout(() => {
                this.scrollAccumulator = 0;
                this.hasTriggeredGesture = false;
            }, 300);

            if (!this.hasTriggeredGesture) {
                if (this.scrollAccumulator > 50) {
                    this.hasTriggeredGesture = true;
                    this.nextVideo();
                } else if (this.scrollAccumulator < -50) {
                    this.hasTriggeredGesture = true;
                    this.prevVideo();
                }
            }
        }, { passive: true });

        // Auto-hide controls & cursor when mouse/user is inactive
        window.addEventListener('mousemove', () => this.handleUserActivity());
        window.addEventListener('pointerdown', () => this.handleUserActivity());

        // Right-click long-press 2X fast forward
        window.addEventListener('contextmenu', (e) => {
            if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
            e.preventDefault();
        });

        window.addEventListener('mousedown', (e) => {
            if (e.button === 2) { // Right mouse button
                // Ignore right click on modals, comment drawer, buttons, inputs
                if (e.target.closest('.modal-card') ||
                    e.target.closest('#comment-drawer') ||
                    e.target.closest('.titlebar') ||
                    e.target.closest('.action-column') ||
                    e.target.closest('.progress-container') ||
                    ['INPUT', 'TEXTAREA', 'BUTTON'].includes(e.target.tagName)) {
                    return;
                }

                e.preventDefault();
                clearTimeout(this.rightPressTimer);
                this.rightPressTimer = setTimeout(() => {
                    this.startFastForward('mouse');
                }, 120);
            }
        });

        const cancelMouseFastForward = (e) => {
            clearTimeout(this.rightPressTimer);
            if (this.isFastForwarding && this.fastForwardSource === 'mouse') {
                this.stopFastForward();
            }
        };

        window.addEventListener('mouseup', cancelMouseFastForward);
        window.addEventListener('pointerup', cancelMouseFastForward);
        window.addEventListener('pointercancel', cancelMouseFastForward);
        window.addEventListener('blur', () => {
            clearTimeout(this.rightPressTimer);
            clearTimeout(this.arrowRightTimer);
            if (this.isFastForwarding) {
                this.stopFastForward();
            }
        });

        // Safety release if right mouse button was let go during mouse movement
        window.addEventListener('mousemove', (e) => {
            if (this.isFastForwarding && this.fastForwardSource === 'mouse' && (e.buttons & 2) === 0) {
                cancelMouseFastForward(e);
            }
        });
    }

    startFastForward(source = 'general') {
        if (this.isFastForwarding) return;
        this.isFastForwarding = true;
        this.fastForwardSource = source;

        const video = window.videoPlayer?.video;
        this.wasPausedBeforeFastForward = video ? video.paused : false;

        // Accelerate to 2.0X
        window.videoPlayer?.setPlaybackRate(2.0);

        // If paused, temporarily play while holding
        if (this.wasPausedBeforeFastForward && video) {
            video.play().catch(() => {});
        }

        // Show 2.0X HUD
        if (!this.speedHud) {
            this.speedHud = document.getElementById('speed-hud');
        }
        if (this.speedHud) {
            this.speedHud.classList.remove('hidden', 'hiding');
        }

        this.handleUserActivity();
    }

    stopFastForward() {
        if (!this.isFastForwarding) return;
        this.isFastForwarding = false;
        this.fastForwardSource = null;

        // Restore 1.0X normal playback
        window.videoPlayer?.setPlaybackRate(1.0);

        // If video was originally paused, pause it again
        if (this.wasPausedBeforeFastForward) {
            window.videoPlayer?.video?.pause();
            this.wasPausedBeforeFastForward = false;
        }

        // Hide HUD with smooth fade-out
        if (this.speedHud) {
            this.speedHud.classList.add('hiding');
            setTimeout(() => {
                if (!this.isFastForwarding && this.speedHud.classList.contains('hiding')) {
                    this.speedHud.classList.add('hidden');
                    this.speedHud.classList.remove('hiding');
                }
            }, 180);
        }

        this.handleUserActivity();
    }

    showControls() {
        this.handleUserActivity();
    }

    handleUserActivity() {
        // Reveal mouse cursor if it was hidden
        if (this.isIdle) {
            this.isIdle = false;
            document.body.classList.remove('cursor-hidden');
        }

        // Reveal UI chrome if not in pure mode
        if (!this.isPureMode) {
            this.titlebar?.classList.remove('hide-overlay');
            this.overlayLayer?.classList.remove('hide-overlay');
            this.isControlsVisible = true;
        }

        // Restart idle timer (2.5 seconds)
        clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => {
            this.handleUserIdle();
        }, 2500);
    }

    handleUserIdle() {
        // Do not auto-hide if fast-forwarding or if a dialog/drawer is open
        if (this.isFastForwarding) return;

        const isInteractingWithDialog =
            window.commentDrawer?.isOpen ||
            !document.getElementById('login-modal')?.classList.contains('hidden') ||
            !document.getElementById('settings-modal')?.classList.contains('hidden');

        if (isInteractingWithDialog) return;

        // Auto-hide mouse cursor
        this.isIdle = true;
        document.body.classList.add('cursor-hidden');

        // Auto-hide UI chrome (titlebar and bottom overlay)
        if (!this.isPureMode) {
            this.titlebar?.classList.add('hide-overlay');
            this.overlayLayer?.classList.add('hide-overlay');
            this.isControlsVisible = false;
        }
    }

    initKeyboard() {
        window.addEventListener('keydown', (e) => {
            this.handleUserActivity();

            // If typing in input or textarea, ignore shortcuts
            if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
                if (e.key === 'Escape') {
                    document.activeElement.blur();
                }
                return;
            }

            const step = window.settingsManager.get('seekStepSeconds') || 10;

            if (e.code === 'ArrowRight') {
                e.preventDefault();
                if (e.repeat) {
                    if (!this.isFastForwarding) {
                        clearTimeout(this.arrowRightTimer);
                        this.startFastForward('keyboard');
                    }
                    return;
                }

                clearTimeout(this.arrowRightTimer);
                this.arrowRightTimer = setTimeout(() => {
                    this.startFastForward('keyboard');
                }, 180);
                return;
            }

            switch (e.code) {
                case 'Space':
                    e.preventDefault();
                    window.videoPlayer?.togglePlay();
                    this.showControls();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    window.videoPlayer?.seekDelta(-step);
                    break;
                case 'ArrowDown':
                case 'KeyJ':
                    e.preventDefault();
                    this.nextVideo();
                    break;
                case 'ArrowUp':
                case 'KeyK':
                    e.preventDefault();
                    this.prevVideo();
                    break;
                case 'KeyH':
                    e.preventDefault();
                    this.togglePureMode();
                    break;
                case 'KeyS':
                    e.preventDefault();
                    window.videoPlayer?.toggleAspect();
                    break;
                case 'F11':
                case 'KeyF':
                    e.preventDefault();
                    this.toggleFullScreen();
                    break;
                case 'KeyM':
                    e.preventDefault();
                    window.videoPlayer?.toggleMute();
                    break;
                case 'KeyC':
                    e.preventDefault();
                    window.commentDrawer?.toggle();
                    break;
                case 'KeyR':
                    e.preventDefault();
                    this.loadFeed(true);
                    this.showToast('🔄 正在刷新视频流...');
                    break;
                case 'KeyT':
                    e.preventDefault();
                    document.getElementById('btn-always-top')?.click();
                    break;
                case 'Escape':
                    // Close open modals / drawer / exit fullscreen
                    if (window.commentDrawer?.isOpen) {
                        window.commentDrawer.close();
                    } else if (!document.getElementById('update-modal')?.classList.contains('hidden')) {
                        document.getElementById('update-modal')?.classList.add('hidden');
                    } else if (!document.getElementById('login-modal')?.classList.contains('hidden')) {
                        window.loginModal?.close();
                    } else if (!document.getElementById('settings-modal')?.classList.contains('hidden')) {
                        document.getElementById('settings-modal')?.classList.add('hidden');
                    } else if (this.isFullScreen) {
                        this.toggleFullScreen();
                    }
                    break;
            }
        });

        // Keyup listener: detect release of ArrowRight (tap vs long-press)
        window.addEventListener('keyup', (e) => {
            if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
                return;
            }

            if (e.code === 'ArrowRight') {
                e.preventDefault();
                clearTimeout(this.arrowRightTimer);

                if (this.isFastForwarding && this.fastForwardSource === 'keyboard') {
                    // Release long-press -> restore normal speed
                    this.stopFastForward();
                } else if (!this.isFastForwarding) {
                    // Short tap -> seek delta forward
                    const step = window.settingsManager.get('seekStepSeconds') || 10;
                    window.videoPlayer?.seekDelta(step);
                }
            }
        });
    }

    initSettingsModal() {
        const modal = document.getElementById('settings-modal');
        modal?.querySelectorAll('[data-close="settings-modal"]').forEach(btn => {
            btn.addEventListener('click', () => modal.classList.add('hidden'));
        });

        // Always on top
        const chkTop = document.getElementById('setting-always-top');
        if (chkTop) {
            chkTop.checked = window.settingsManager.get('isAlwaysOnTop');
            chkTop.addEventListener('change', () => {
                window.settingsManager.set('isAlwaysOnTop', chkTop.checked);
                document.getElementById('btn-always-top')?.classList.toggle('active', chkTop.checked);
            });
        }

        // Opacity
        const rangeOpacity = document.getElementById('setting-opacity');
        const txtOpacity = document.getElementById('opacity-val');
        if (rangeOpacity) {
            const cur = window.settingsManager.get('windowOpacity');
            rangeOpacity.value = cur;
            txtOpacity.textContent = `${Math.round(cur * 100)}%`;
            rangeOpacity.addEventListener('input', () => {
                const val = parseFloat(rangeOpacity.value);
                txtOpacity.textContent = `${Math.round(val * 100)}%`;
                window.settingsManager.set('windowOpacity', val);
            });
        }

        // Start pure
        const chkStartPure = document.getElementById('setting-start-pure');
        if (chkStartPure) {
            chkStartPure.checked = window.settingsManager.get('startInPureMode');
            chkStartPure.addEventListener('change', () => {
                window.settingsManager.set('startInPureMode', chkStartPure.checked);
            });
        }

        // Auto pure in fullscreen
        const chkAutoPureFull = document.getElementById('setting-auto-pure-fullscreen');
        if (chkAutoPureFull) {
            chkAutoPureFull.checked = window.settingsManager.get('autoPureInFullscreen');
            chkAutoPureFull.addEventListener('change', () => {
                window.settingsManager.set('autoPureInFullscreen', chkAutoPureFull.checked);
            });
        }

        // High quality
        const chkHighQuality = document.getElementById('setting-high-quality');
        if (chkHighQuality) {
            chkHighQuality.checked = window.settingsManager.get('preferHighestQuality');
            chkHighQuality.addEventListener('change', () => {
                window.settingsManager.set('preferHighestQuality', chkHighQuality.checked);
            });
        }

        // Autoplay sound
        const chkAutoSound = document.getElementById('setting-autoplay-sound');
        if (chkAutoSound) {
            chkAutoSound.checked = window.settingsManager.get('autoPlaySound');
            chkAutoSound.addEventListener('change', () => {
                window.settingsManager.set('autoPlaySound', chkAutoSound.checked);
            });
        }

        // Prevent sleep
        const chkSleep = document.getElementById('setting-prevent-sleep');
        if (chkSleep) {
            chkSleep.checked = window.settingsManager.get('preventDisplaySleep');
            chkSleep.addEventListener('change', () => {
                window.settingsManager.set('preventDisplaySleep', chkSleep.checked);
            });
        }

        // Seek step chips
        const chips = modal?.querySelectorAll('.chip-btn');
        const curStep = window.settingsManager.get('seekStepSeconds');
        chips?.forEach(chip => {
            const step = parseInt(chip.getAttribute('data-step'), 10);
            chip.classList.toggle('active', step === curStep);
            chip.addEventListener('click', () => {
                chips.forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                window.settingsManager.set('seekStepSeconds', step);
            });
        });
    }

    async loadFeed(reset = false) {
        if (this.isLoading) return;
        this.isLoading = true;

        if (reset) {
            this.loadingView.classList.remove('hidden');
            this.engineStatus.textContent = '正在获取推荐视频流...';
            this.btnRetryFeed.classList.add('hidden');
        }

        try {
            const list = await window.api.engine.fetchFeed({
                count: 10,
                reset: reset,
                horizontalOnly: true
            });

            if (reset) {
                this.items = list;
                this.currentIndex = 0;
            } else {
                this.items.push(...list);
            }

            if (this.items.length > 0) {
                this.loadingView.classList.add('hidden');
                if (reset) {
                    this.playCurrent();
                }
            } else {
                this.engineStatus.textContent = '未获取到视频，请检查网络或点击刷新';
                this.btnRetryFeed.classList.remove('hidden');
            }
        } catch (err) {
            console.error('Fetch feed failed:', err);
            this.engineStatus.textContent = `获取失败: ${err.message || '网络异常'}`;
            this.btnRetryFeed.classList.remove('hidden');
        } finally {
            this.isLoading = false;
        }
    }

    playCurrent() {
        const item = this.currentItem;
        if (!item) return;

        window.videoPlayer?.load(item.playUrl);
        window.videoOverlay?.render(item);
        this.handleUserActivity();

        // Preload next batch if close to the end
        if (this.items.length - this.currentIndex <= 3 && !this.isLoading) {
            this.loadFeed(false);
        }

        // If comment drawer is open, refresh comments for the new video
        if (window.commentDrawer?.isOpen) {
            window.commentDrawer.loadComments();
        }
    }

    nextVideo() {
        if (this.currentIndex < this.items.length - 1) {
            this.currentIndex += 1;
            this.playCurrent();
        } else if (!this.isLoading) {
            this.loadFeed(false);
        }
    }

    prevVideo() {
        if (this.currentIndex > 0) {
            this.currentIndex -= 1;
            this.playCurrent();
        }
    }

    setPureMode(enabled) {
        this.isPureMode = enabled;
        document.getElementById('btn-pure-mode')?.classList.toggle('active', enabled);
        if (enabled) {
            this.titlebar?.classList.add('hide-overlay');
            this.overlayLayer?.classList.add('hide-overlay');
            document.getElementById('center-play-indicator')?.classList.add('hidden');
            this.showToast('✨ 纯净模式: 已开启 (按 H 恢复)');
        } else {
            this.titlebar?.classList.remove('hide-overlay');
            this.overlayLayer?.classList.remove('hide-overlay');
            this.showToast('纯净模式: 已关闭');
            this.showControls();
        }
    }

    togglePureMode() {
        this.setPureMode(!this.isPureMode);
    }

    async toggleFullScreen() {
        const wantFull = !this.isFullScreen;
        const isFull = await window.api.window.setFullScreen(wantFull);
        this.handleFullscreenChange(isFull);
    }

    handleFullscreenChange(isFull) {
        this.isFullScreen = isFull;
        document.body.classList.toggle('is-fullscreen', isFull);

        const iconMax = document.getElementById('icon-max');
        const iconRestore = document.getElementById('icon-restore');
        const fsLabel = document.querySelector('#btn-fullscreen .action-count');

        if (isFull) {
            iconMax?.classList.add('hidden');
            iconRestore?.classList.remove('hidden');
            if (fsLabel) fsLabel.textContent = '退出';
            this.showToast('🖥️ 已进入真全屏模式 (按 F 或 Esc 退出)');
            // Quickly auto-hide overlays in fullscreen
            clearTimeout(this.idleTimer);
            this.idleTimer = setTimeout(() => this.handleUserIdle(), 1200);
        } else {
            iconMax?.classList.remove('hidden');
            iconRestore?.classList.add('hidden');
            if (fsLabel) fsLabel.textContent = '全屏';
            this.showToast('已退出全屏模式');
            this.handleUserActivity();
        }
    }

    showToast(message) {
        if (!this.toast || !this.toastMessage) return;
        this.toastMessage.textContent = message;
        this.toast.classList.remove('hidden');
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => {
            this.toast.classList.add('hidden');
        }, 2500);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.app = new AppController();
});
