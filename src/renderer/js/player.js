class VideoPlayerController {
    constructor() {
        this.videoA = document.getElementById('video-player');
        this.videoB = document.getElementById('video-player-next');
        // Active video is the one currently shown
        this.video = this.videoA;
        this.standby = this.videoB;

        // Mark initial states
        this.videoA.classList.add('video-player-active');
        this.videoB.classList.add('video-player-standby');

        this.centerIndicator = document.getElementById('center-play-indicator');
        this.progressFilled = document.getElementById('progress-filled');
        this.progressBuffer = document.getElementById('progress-buffer');
        this.progressThumb = document.getElementById('progress-thumb');
        this.progressBarBg = document.querySelector('.progress-bar-bg');
        this.timeCurrent = document.getElementById('time-current');
        this.timeTotal = document.getElementById('time-total');
        this.aspectLabel = document.getElementById('aspect-label');

        this.seekHud = document.getElementById('seek-hud');
        this.seekHudDirection = document.getElementById('seek-hud-direction');
        this.seekHudBarFilled = document.getElementById('seek-hud-bar-filled');
        this.seekHudTime = document.getElementById('seek-hud-time');

        this.pendingSeekDelta = 0;
        this.seekDebounceTimer = null;
        this.seekHudHideTimer = null;
        this.isScrubbing = false;
        this.playbackRate = 1.0;

        // Track pending preload URL to prevent stale callbacks
        this._pendingUrl = null;
        this._switching = false;

        this.initEvents();
        this.initEventsFor(this.videoA);
        this.initEventsFor(this.videoB);
    }

    /** Shared events (progress bar click, etc.) */
    initEvents() {
        // Click on progress bar to seek
        if (this.progressBarBg) {
            this.progressBarBg.addEventListener('click', (e) => {
                const rect = this.progressBarBg.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                if (this.video.duration && isFinite(this.video.duration)) {
                    this.video.currentTime = ratio * this.video.duration;
                    this.updateProgress();
                }
            });
        }
    }

    /** Per-video-element events */
    initEventsFor(vid) {
        // Loop video when finished
        vid.addEventListener('ended', () => {
            if (vid !== this.video) return;
            vid.currentTime = 0;
            vid.play().catch(() => {});
        });

        // Time updates
        vid.addEventListener('timeupdate', () => {
            if (vid !== this.video) return;
            if (!this.isScrubbing) {
                this.updateProgress();
            }
        });

        // Buffer progress
        vid.addEventListener('progress', () => {
            if (vid !== this.video) return;
            this.updateBuffer();
        });

        // Play/Pause state updates
        vid.addEventListener('play', () => {
            if (vid !== this.video) return;
            this.centerIndicator.classList.add('hidden');
            window.api?.sleep?.setPlaybackState(true);
        });

        vid.addEventListener('pause', () => {
            if (vid !== this.video) return;
            if (!window.app?.isPureMode) {
                this.centerIndicator.classList.remove('hidden');
            }
            window.api?.sleep?.setPlaybackState(false);
        });
    }

    /**
     * Load and play a new video URL.
     * Uses double-buffering: preload in the standby element, then swap.
     */
    load(url) {
        if (!url) return;

        this._pendingUrl = url;

        // If this is the very first video (no src on active), load directly
        if (!this.video.src || this.video.src === '' || this.video.src === window.location.href) {
            this._loadDirect(url);
            return;
        }

        // Preload in standby element
        this._preloadAndSwap(url);
    }

    /** Direct load into the active video (first video, no swap needed) */
    _loadDirect(url) {
        const autoSound = window.settingsManager.get('autoPlaySound');
        this.video.muted = !autoSound;
        const fill = window.settingsManager.get('fillScreen');
        this._applyAspectToElement(this.video, fill);

        this.video.src = url;
        this.video.playbackRate = this.playbackRate;
        const p = this.video.play();
        if (p !== undefined) {
            p.catch(err => {
                console.log('Autoplay muted fallback:', err.message);
                this.video.muted = true;
                this.video.play().catch(() => {});
            });
        }
    }

    /** Preload URL in standby video, then swap when ready */
    _preloadAndSwap(url) {
        if (this._switching) {
            // If a swap is already in progress, just update the standby src
            this.standby.src = url;
            return;
        }

        this._switching = true;
        const autoSound = window.settingsManager.get('autoPlaySound');
        const fill = window.settingsManager.get('fillScreen');

        // Configure standby
        this.standby.muted = !autoSound;
        this._applyAspectToElement(this.standby, fill);
        this.standby.src = url;
        this.standby.currentTime = 0;

        const onReady = () => {
            cleanup();
            // Check this URL is still the one we want
            if (this._pendingUrl !== url) {
                this._switching = false;
                return;
            }
            this._doSwap();
        };

        const onError = () => {
            cleanup();
            this._switching = false;
            // Fallback: load directly into active
            this._loadDirect(url);
        };

        // Timeout fallback — if preload takes too long, just swap anyway
        const timeout = setTimeout(() => {
            cleanup();
            if (this._pendingUrl === url) {
                this._doSwap();
            } else {
                this._switching = false;
            }
        }, 2000);

        const cleanup = () => {
            this.standby.removeEventListener('canplay', onReady);
            this.standby.removeEventListener('error', onError);
            clearTimeout(timeout);
        };

        this.standby.addEventListener('canplay', onReady, { once: true });
        this.standby.addEventListener('error', onError, { once: true });
    }

    /** Swap active and standby video elements */
    _doSwap() {
        const oldActive = this.video;
        const newActive = this.standby;

        // Start playback on new active
        newActive.playbackRate = this.playbackRate;
        const p = newActive.play();
        if (p !== undefined) {
            p.catch(err => {
                console.log('Swap autoplay muted fallback:', err.message);
                newActive.muted = true;
                newActive.play().catch(() => {});
            });
        }

        // CSS swap: new active comes to front
        newActive.classList.remove('video-player-standby');
        newActive.classList.add('video-player-active');
        newActive.style.opacity = '1';

        oldActive.classList.remove('video-player-active');
        oldActive.classList.add('video-player-standby');
        oldActive.style.opacity = '0';

        // Pause and clear old video after a brief delay (let CSS transition settle)
        setTimeout(() => {
            oldActive.pause();
            oldActive.removeAttribute('src');
            oldActive.load(); // release resources
        }, 300);

        // Swap references
        this.video = newActive;
        this.standby = oldActive;

        this._switching = false;

        // Update progress display immediately
        this.updateProgress();
        this.updateBuffer();
    }

    togglePlay() {
        if (this.video.paused) {
            this.video.play().catch(() => {});
        } else {
            this.video.pause();
        }
    }

    setPlaybackRate(rate) {
        this.playbackRate = Number(rate) || 1.0;
        if (this.video) {
            this.video.playbackRate = this.playbackRate;
        }
        if (this.standby) {
            this.standby.playbackRate = this.playbackRate;
        }
    }

    getPlaybackRate() {
        return this.video ? this.video.playbackRate : (this.playbackRate || 1.0);
    }

    toggleMute() {
        this.video.muted = !this.video.muted;
        window.app?.showToast(this.video.muted ? '🔇 已静音 (快捷键 M)' : '🔊 已开启声音');
    }

    toggleAspect() {
        const current = window.settingsManager.get('fillScreen');
        const next = !current;
        window.settingsManager.set('fillScreen', next);
        this.applyAspect(next);
        window.app?.showToast(next ? '画面模式: 铺满窗口' : '画面模式: 原始比例');
    }

    applyAspect(fill) {
        this._applyAspectToElement(this.video, fill);
        this._applyAspectToElement(this.standby, fill);
    }

    _applyAspectToElement(vid, fill) {
        if (fill) {
            vid.classList.remove('contain-mode');
            if (this.aspectLabel) this.aspectLabel.textContent = '铺满';
        } else {
            vid.classList.add('contain-mode');
            if (this.aspectLabel) this.aspectLabel.textContent = '比例';
        }
    }

    seekDelta(delta) {
        if (!this.video.duration || !isFinite(this.video.duration)) return;

        this.pendingSeekDelta += delta;
        const current = this.video.currentTime;
        const duration = this.video.duration;
        const target = Math.max(0, Math.min(duration, current + this.pendingSeekDelta));

        // Render HUD
        this.renderSeekHud(this.pendingSeekDelta, target, duration);

        clearTimeout(this.seekDebounceTimer);
        this.seekDebounceTimer = setTimeout(() => {
            this.video.currentTime = target;
            this.pendingSeekDelta = 0;
            if (this.video.paused) {
                this.video.play().catch(() => {});
            }
        }, 120);
    }

    renderSeekHud(delta, target, duration) {
        const isFwd = delta >= 0;
        const sign = isFwd ? '+' : '';
        this.seekHudDirection.textContent = `${isFwd ? '⏩' : '⏪'} ${sign}${delta}s`;
        this.seekHudDirection.style.color = isFwd ? 'var(--brand-cyan)' : '#f59e0b';

        const percent = Math.max(0, Math.min(100, (target / duration) * 100));
        this.seekHudBarFilled.style.width = `${percent}%`;
        this.seekHudBarFilled.style.backgroundColor = isFwd ? 'var(--brand-cyan)' : '#f59e0b';

        this.seekHudTime.textContent = `${this.formatTime(target)} / ${this.formatTime(duration)}`;

        this.seekHud.classList.remove('hidden');
        clearTimeout(this.seekHudHideTimer);
        this.seekHudHideTimer = setTimeout(() => {
            this.seekHud.classList.add('hidden');
        }, 1200);
    }

    updateProgress() {
        const cur = this.video.currentTime || 0;
        const dur = this.video.duration || 0;
        if (dur > 0 && isFinite(dur)) {
            const pct = (cur / dur) * 100;
            this.progressFilled.style.width = `${pct}%`;
            this.progressThumb.style.left = `${pct}%`;
            this.timeCurrent.textContent = this.formatTime(cur);
            this.timeTotal.textContent = this.formatTime(dur);
        } else {
            this.progressFilled.style.width = '0%';
            this.progressThumb.style.left = '0%';
            this.timeCurrent.textContent = '00:00';
            this.timeTotal.textContent = '00:00';
        }
    }

    updateBuffer() {
        const dur = this.video.duration;
        if (dur > 0 && this.video.buffered.length > 0) {
            const bufEnd = this.video.buffered.end(this.video.buffered.length - 1);
            const pct = (bufEnd / dur) * 100;
            this.progressBuffer.style.width = `${pct}%`;
        }
    }

    formatTime(sec) {
        if (!sec || isNaN(sec)) return '00:00';
        const total = Math.floor(sec);
        const m = Math.floor(total / 60);
        const s = total % 60;
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
}

window.videoPlayer = new VideoPlayerController();
