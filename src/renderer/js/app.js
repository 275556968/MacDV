const SEEN_IDS_STORAGE_KEY = 'windv_seen_ids_v1';
const SEEN_IDS_LIMIT = 3000;
const SPEED_PRESETS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0];

class AppController {
    constructor() {
        this.items = [];
        this.currentIndex = 0;
        this.isLoading = false;
        this.isPureMode = false;
        this.isPeeking = false;
        this.pureModeActivatedAt = 0;
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
        this.fastForwardWatchdog = null;
        this.speedMenu = null;

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

        // Author-space playback (can return to the exact feed position)
        this.isInSpace = false;
        this.spaceReturn = null;
        this.isLoadingSpace = false;

        // Watched-video dedupe (persisted, so restarts don't bring seen videos back)
        this.seenIds = this.loadSeenIds();
        this.emptyBatchStreak = 0;

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

        // Playback speed control (top-right)
        this.speedMenu = document.getElementById('speed-menu');
        document.getElementById('btn-speed')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleSpeedMenu();
        });
        this.speedMenu?.addEventListener('click', (e) => e.stopPropagation());
        this.speedMenu?.querySelectorAll('.speed-option').forEach(btn => {
            btn.addEventListener('click', () => {
                this.setPlaybackSpeed(parseFloat(btn.dataset.speed));
                this.closeSpeedMenu();
            });
        });
        document.addEventListener('click', () => this.closeSpeedMenu());
        this.updateSpeedUI();

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

        // Leave the author's space and go back to the recommendation feed
        document.getElementById('btn-exit-space')?.addEventListener('click', () => {
            this.exitSpacePlayback();
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

    // ==================== Playback speed ====================

    formatSpeed(rate) {
        const n = Number(rate) || 1;
        return `${Number.isInteger(n) ? n.toFixed(1) : n}X`;
    }

    setPlaybackSpeed(rate) {
        const speed = Math.min(4, Math.max(0.25, Number(rate) || 1));

        // A speed change wins over the temporary fast-forward rate
        if (this.isFastForwarding) {
            this.abortFastForward();
        }

        window.videoPlayer?.setPlaybackRate(speed);
        window.settingsManager.set('playbackSpeed', speed);
        this.updateSpeedUI();
        this.showToast(`▶ 播放速度: ${this.formatSpeed(speed)}`);
    }

    cyclePlaybackSpeed(direction) {
        const current = Number(window.settingsManager.get('playbackSpeed')) || 1;
        let idx = SPEED_PRESETS.findIndex((s) => Math.abs(s - current) < 0.001);
        if (idx < 0) idx = SPEED_PRESETS.findIndex((s) => s > current);
        if (idx < 0) idx = SPEED_PRESETS.length - 1;
        const next = SPEED_PRESETS[Math.min(SPEED_PRESETS.length - 1, Math.max(0, idx + direction))];
        if (Math.abs(next - current) > 0.001) {
            this.setPlaybackSpeed(next);
        }
    }

    updateSpeedUI() {
        const speed = Number(window.settingsManager.get('playbackSpeed')) || 1;
        const label = document.getElementById('speed-label');
        if (label) label.textContent = this.formatSpeed(speed);

        document.getElementById('speed-control')?.classList.toggle('at-speed', Math.abs(speed - 1) > 0.001);
        this.speedMenu?.querySelectorAll('.speed-option').forEach(btn => {
            btn.classList.toggle('active', Math.abs(parseFloat(btn.dataset.speed) - speed) < 0.001);
        });
    }

    toggleSpeedMenu() {
        if (!this.speedMenu) return;
        if (this.speedMenu.classList.contains('hidden')) {
            this.updateSpeedUI();
            this.speedMenu.classList.remove('hidden');
            document.getElementById('speed-control')?.classList.add('menu-open');
        } else {
            this.closeSpeedMenu();
        }
    }

    closeSpeedMenu() {
        this.speedMenu?.classList.add('hidden');
        document.getElementById('speed-control')?.classList.remove('menu-open');
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

        // Auto-hide controls & cursor when mouse/user is inactive, and detect screen edges
        window.addEventListener('mousemove', (e) => {
            this.handleUserActivity();
            this.handleEdgePeek(e);
        });
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

        // Tab hidden (minimize / app switch) — never leave playback stuck at 2.0X
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.abortFastForward();
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

        // Accelerate to 2.0X (temporary, without touching the user-selected speed)
        window.videoPlayer?.applyTemporaryRate(2.0);

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

        this.armFastForwardWatchdog();
        this.handleUserActivity();
    }

    /**
     * Safety net: if the release event is ever lost (e.g. the right button is
     * released outside the window), never leave playback stuck at 2.0X.
     */
    armFastForwardWatchdog() {
        clearTimeout(this.fastForwardWatchdog);
        this.fastForwardWatchdog = setTimeout(() => {
            console.warn('[WinDV] Fast-forward watchdog fired: restoring 1.0X');
            this.abortFastForward();
            this.handleUserActivity();
        }, 60000);
    }

    stopFastForward() {
        if (!this.isFastForwarding) return;

        const shouldRestorePause = this.wasPausedBeforeFastForward;
        this.resetFastForwardState();

        // If video was originally paused, pause it again
        if (shouldRestorePause) {
            window.videoPlayer?.video?.pause();
        }

        this.handleUserActivity();
    }

    /**
     * Force back to 1.0X without the "restore pause" / UI side effects.
     * Used when switching videos, hiding the window, or by the watchdog.
     */
    abortFastForward() {
        clearTimeout(this.rightPressTimer);
        clearTimeout(this.arrowRightTimer);

        if (!this.isFastForwarding) return;
        this.resetFastForwardState();
    }

    resetFastForwardState() {
        this.isFastForwarding = false;
        this.fastForwardSource = null;
        this.wasPausedBeforeFastForward = false;
        clearTimeout(this.fastForwardWatchdog);
        this.fastForwardWatchdog = null;

        // Restore the user-selected normal speed
        window.videoPlayer?.restoreRate();

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

        // Reveal UI chrome if not in pure mode, or while peeking from a screen edge
        if (!this.isPureMode || this.isPeeking) {
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
        // Do not auto-hide while fast-forwarding or while a dialog/drawer is open,
        // but keep the idle chain alive so the UI hides once they close/release.
        if (this.isFastForwarding) {
            this.restartIdleCheck();
            return;
        }

        const isInteractingWithDialog =
            window.spaceView?.isOpen ||
            window.commentDrawer?.isOpen ||
            !document.getElementById('login-modal')?.classList.contains('hidden') ||
            !document.getElementById('settings-modal')?.classList.contains('hidden');

        if (isInteractingWithDialog) {
            this.restartIdleCheck();
            return;
        }

        // Auto-hide mouse cursor
        this.isIdle = true;
        document.body.classList.add('cursor-hidden');

        // End any temporary pure-mode peek, then auto-hide UI chrome
        this.isPeeking = false;
        this.closeSpeedMenu();
        this.titlebar?.classList.add('hide-overlay');
        this.overlayLayer?.classList.add('hide-overlay');
        this.isControlsVisible = false;
    }

    restartIdleCheck() {
        clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => this.handleUserIdle(), 1000);
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

            // While the author space is open, only Esc is meaningful (close it)
            if (window.spaceView?.isOpen) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    window.spaceView.close();
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
                case 'BracketLeft':
                    e.preventDefault();
                    this.cyclePlaybackSpeed(-1);
                    break;
                case 'BracketRight':
                    e.preventDefault();
                    this.cyclePlaybackSpeed(1);
                    break;
                case 'KeyD':
                    e.preventDefault();
                    window.danmaku?.toggle();
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
                    // Close the speed menu first, then modals / drawer / fullscreen
                    if (!this.speedMenu?.classList.contains('hidden')) {
                        this.closeSpeedMenu();
                    } else if (window.spaceView?.isOpen) {
                        window.spaceView.close();
                    } else if (window.commentDrawer?.isOpen) {
                        window.commentDrawer.close();
                    } else if (!document.getElementById('update-modal')?.classList.contains('hidden')) {
                        document.getElementById('update-modal')?.classList.add('hidden');
                    } else if (!document.getElementById('login-modal')?.classList.contains('hidden')) {
                        window.loginModal?.close();
                    } else if (!document.getElementById('settings-modal')?.classList.contains('hidden')) {
                        document.getElementById('settings-modal')?.classList.add('hidden');
                    } else if (this.isInSpace) {
                        this.exitSpacePlayback();
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

        // Exit pure on four screen edges
        const chkEdgePure = document.getElementById('setting-exit-pure-edge');
        if (chkEdgePure) {
            chkEdgePure.checked = window.settingsManager.get('exitPureOnEdge');
            chkEdgePure.addEventListener('change', () => {
                window.settingsManager.set('exitPureOnEdge', chkEdgePure.checked);
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
        const chips = modal?.querySelectorAll('.seek-step-chips .chip-btn');
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

        // Watched-video dedupe
        const chkDedupe = document.getElementById('setting-dedupe-feed');
        if (chkDedupe) {
            chkDedupe.checked = this.isDedupeEnabled();
            chkDedupe.addEventListener('change', () => {
                window.settingsManager.set('dedupeFeed', chkDedupe.checked);
                this.showToast(chkDedupe.checked ? '🔁 已开启观看去重' : '已关闭观看去重');
            });
        }

        document.getElementById('btn-clear-seen')?.addEventListener('click', () => {
            this.clearSeenHistory();
        });

        this.updateSeenCountUI();
    }

    // ==================== Watched-video dedupe ====================

    loadSeenIds() {
        try {
            const raw = localStorage.getItem(SEEN_IDS_STORAGE_KEY);
            if (!raw) return new Set();
            const arr = JSON.parse(raw);
            if (!Array.isArray(arr)) return new Set();
            return new Set(arr.filter(Boolean).map(String));
        } catch (e) {
            console.warn('[WinDV] Failed to load watched history:', e.message);
            return new Set();
        }
    }

    saveSeenIds() {
        try {
            const ids = Array.from(this.seenIds);
            if (ids.length > SEEN_IDS_LIMIT) {
                // Set keeps insertion order, so drop the oldest entries
                this.seenIds = new Set(ids.slice(ids.length - SEEN_IDS_LIMIT));
            }
            localStorage.setItem(SEEN_IDS_STORAGE_KEY, JSON.stringify(Array.from(this.seenIds)));
        } catch (e) {
            console.warn('[WinDV] Failed to persist watched history:', e.message);
        }
        this.updateSeenCountUI();
    }

    itemId(item) {
        return item && item.awemeId ? String(item.awemeId) : '';
    }

    /** Record a video as watched (called when it is actually shown/played). */
    markSeen(item) {
        const id = this.itemId(item);
        if (!id || this.seenIds.has(id)) return;
        this.seenIds.add(id);
        this.saveSeenIds();
    }

    isDedupeEnabled() {
        return window.settingsManager.get('dedupeFeed') !== false;
    }

    /**
     * Drop videos that were already watched, already queued, or duplicated
     * inside the same batch.
     */
    filterUnseen(list, excludeQueued = true) {
        if (!Array.isArray(list)) return [];
        if (!this.isDedupeEnabled()) return list;

        const queuedIds = new Set();
        if (excludeQueued) {
            for (const item of this.items) {
                const id = this.itemId(item);
                if (id) queuedIds.add(id);
            }
        }

        const batchIds = new Set();
        return list.filter((item) => {
            const id = this.itemId(item);
            if (!id) return true; // no id -> cannot dedupe, keep it
            if (this.seenIds.has(id)) return false;
            if (queuedIds.has(id)) return false;
            if (batchIds.has(id)) return false;
            batchIds.add(id);
            return true;
        });
    }

    clearSeenHistory() {
        this.seenIds.clear();
        this.emptyBatchStreak = 0;
        try {
            localStorage.removeItem(SEEN_IDS_STORAGE_KEY);
        } catch (e) {}
        this.updateSeenCountUI();
        this.showToast('🧹 观看记录已清除，所有视频会重新参与推荐');
    }

    updateSeenCountUI() {
        const el = document.getElementById('seen-count');
        if (el) el.textContent = String(this.seenIds.size);
    }

    async loadFeed(reset = false, notifyEmpty = false) {
        if (this.isLoading) return;
        this.isLoading = true;

        // Refreshing the feed leaves the author space
        if (reset && this.isInSpace) {
            this.setSpaceMode(false);
        }

        if (reset) {
            this.loadingView.classList.remove('hidden');
            this.engineStatus.textContent = '正在获取推荐视频流...';
            this.btnRetryFeed.classList.add('hidden');
        }

        try {
            let list = await window.api.engine.fetchFeed({
                count: 10,
                reset: reset,
                horizontalOnly: true
            });
            let fresh = this.filterUnseen(list, !reset);

            // An all-watched batch is not an error: try a couple more batches
            // before telling the user there is nothing new.
            let retries = 0;
            while (fresh.length === 0 && list && list.length > 0 && retries < 2) {
                retries += 1;
                await new Promise((r) => setTimeout(r, 700));
                list = await window.api.engine.fetchFeed({
                    count: 10,
                    reset: reset,
                    horizontalOnly: true
                });
                fresh = this.filterUnseen(list, !reset);
            }

            if (list && list.length > 0) {
                const filteredOut = list.length - fresh.length;
                if (filteredOut > 0) {
                    console.log(`[WinDV] 去重: 本批 ${list.length} 个，过滤 ${filteredOut} 个看过的/重复的视频`);
                }
            }

            if (fresh.length > 0) {
                if (reset) {
                    this.items = fresh;
                    this.currentIndex = 0;
                } else {
                    this.items.push(...fresh);
                }
                this.emptyBatchStreak = 0;

                this.loadingView.classList.add('hidden');
                this.btnRetryFeed.classList.add('hidden');
                if (reset) {
                    this.playCurrent();
                }
                return;
            }

            if (!list || list.length === 0) {
                // API returned nothing at all
                if (this.items.length > 0) {
                    this.loadingView.classList.add('hidden');
                } else {
                    this.engineStatus.textContent = '未获取到视频，请检查网络或点击刷新';
                    this.btnRetryFeed.classList.remove('hidden');
                }
                return;
            }

            // Items came back, but every one of them has already been watched.
            // Keep the current queue playing instead of clearing it.
            this.emptyBatchStreak += 1;
            if (this.items.length > 0) {
                this.loadingView.classList.add('hidden');
                this.btnRetryFeed.classList.add('hidden');
                if (reset || notifyEmpty || this.emptyBatchStreak >= 2) {
                    this.showToast('🔄 这一批都看过了，可在设置里清除观看记录');
                    this.emptyBatchStreak = 0;
                }
            } else {
                this.engineStatus.textContent = '刷到的都是看过的视频，点刷新重试或清除观看记录';
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

        // A new video always starts at 1.0X, even if a release event was lost
        this.abortFastForward();

        // Vertical videos (from an author's space) are letterboxed instead of cropped
        const fill = item.isHorizontal === false ? false : window.settingsManager.get('fillScreen');
        window.videoPlayer?.load(item.playUrl, fill);
        window.videoOverlay?.render(item);
        window.danmaku?.setItem(item);
        this.markSeen(item);
        this.handleUserActivity();

        // Preload next batch if close to the end
        if (this.isInSpace) {
            if (this.items.length - this.currentIndex <= 3) {
                this.loadMoreSpace();
            }
        } else if (this.items.length - this.currentIndex <= 3 && !this.isLoading) {
            this.loadFeed(false);
        }

        // If comment drawer is open, refresh comments for the new video
        if (window.commentDrawer?.isOpen) {
            window.commentDrawer.loadComments();
        }
    }

    /**
     * Play a video picked from an author's space. The author's videos become
     * the current queue, while the recommendation feed (and its position) is
     * remembered so the user can jump back with the "返回推荐流" button.
     */
    playFromSpace(list, index) {
        if (!Array.isArray(list) || list.length === 0) return;
        const picked = list[index] || list[0];
        if (!picked) return;

        if (!this.isInSpace) {
            this.spaceReturn = {
                items: this.items.slice(),
                currentIndex: this.currentIndex
            };
        }

        this.items = list.slice();
        this.currentIndex = Math.max(0, Math.min(index || 0, this.items.length - 1));
        this.setSpaceMode(true);
        this.playCurrent();
    }

    setSpaceMode(enabled) {
        this.isInSpace = enabled;
        document.getElementById('btn-exit-space')?.classList.toggle('hidden', !enabled);
        if (!enabled) this.spaceReturn = null;
    }

    /** Stop browsing the author and restore the feed queue + position */
    exitSpacePlayback() {
        if (!this.isInSpace) return;

        const snapshot = this.spaceReturn;
        this.setSpaceMode(false);
        this.closeSpeedMenu();

        if (snapshot && Array.isArray(snapshot.items) && snapshot.items.length > 0) {
            this.items = snapshot.items;
            this.currentIndex = Math.max(0, Math.min(snapshot.currentIndex, snapshot.items.length - 1));
            this.playCurrent();
        } else {
            this.items = [];
            this.currentIndex = 0;
            this.loadFeed(true);
        }

        this.showToast('↩ 已退出博主主页，回到推荐流');
    }

    /** Continue loading the opened author's posts while swiping through them */
    async loadMoreSpace(notifyEmpty = false) {
        if (!this.isInSpace || this.isLoadingSpace) return;

        if (!window.spaceView?.hasMore) {
            if (notifyEmpty) this.showToast('👤 已看完该博主的作品');
            return;
        }

        this.isLoadingSpace = true;
        try {
            const more = await window.spaceView.loadMoreItems();
            if (!this.isInSpace) return;

            const queued = new Set(this.items.map((item) => this.itemId(item)).filter(Boolean));
            const fresh = (more || []).filter((item) => {
                const id = this.itemId(item);
                return id && !queued.has(id);
            });

            if (fresh.length > 0) {
                this.items.push(...fresh);

                // User swiped at the end: continue to the first newly loaded video
                if (notifyEmpty) {
                    this.currentIndex = Math.min(this.currentIndex + 1, this.items.length - 1);
                    this.playCurrent();
                }
            } else if (notifyEmpty && !window.spaceView.hasMore) {
                this.showToast('👤 已看完该博主的作品');
            }
        } catch (err) {
            console.error('[WinDV] Failed to load more author posts:', err);
        } finally {
            this.isLoadingSpace = false;
        }
    }

    nextVideo() {
        if (this.currentIndex < this.items.length - 1) {
            this.currentIndex += 1;
            this.playCurrent();
        } else if (this.isInSpace) {
            this.loadMoreSpace(true);
        } else if (!this.isLoading) {
            this.loadFeed(false, true);
        }
    }

    prevVideo() {
        if (this.currentIndex > 0) {
            this.currentIndex -= 1;
            this.playCurrent();
        }
    }

    /**
     * Pure mode: moving the cursor to any window edge temporarily reveals the UI
     * ("peek") instead of permanently leaving pure mode. The chrome auto-hides
     * again after 2.5s of inactivity, so pure mode stays on.
     */
    handleEdgePeek(e) {
        if (!this.isPureMode) return;
        if (!window.settingsManager.get('exitPureOnEdge')) return;

        // Ignore edge detection immediately after entering pure mode (600ms cooldown)
        if (this.pureModeActivatedAt && (Date.now() - this.pureModeActivatedAt < 600)) {
            return;
        }

        const threshold = 22; // 22px margin from window edge
        const x = e.clientX;
        const y = e.clientY;
        const w = window.innerWidth;
        const h = window.innerHeight;

        const isTop = y <= threshold;
        const isBottom = y >= h - threshold;
        const isLeft = x <= threshold;
        const isRight = x >= w - threshold;

        if (isTop || isBottom || isLeft || isRight) {
            this.peekControls();
        }
    }

    peekControls() {
        this.isPeeking = true;

        if (this.isIdle) {
            this.isIdle = false;
            document.body.classList.remove('cursor-hidden');
        }

        this.titlebar?.classList.remove('hide-overlay');
        this.overlayLayer?.classList.remove('hide-overlay');
        this.isControlsVisible = true;

        clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => this.handleUserIdle(), 2500);
    }

    setPureMode(enabled) {
        this.isPureMode = enabled;
        this.isPeeking = false;
        this.pureModeActivatedAt = Date.now();
        document.getElementById('btn-pure-mode')?.classList.toggle('active', enabled);
        if (enabled) {
            this.closeSpeedMenu();
            this.titlebar?.classList.add('hide-overlay');
            this.overlayLayer?.classList.add('hide-overlay');
            document.getElementById('center-play-indicator')?.classList.add('hidden');
            this.showToast('✨ 纯净模式: 已开启 (碰触四边可临时唤出界面，按 H 退出)');
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
