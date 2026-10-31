class VideoPlayerController {
    constructor() {
        this.video = document.getElementById('video-player');
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

        this.initEvents();
    }

    initEvents() {
        // Loop video when finished
        this.video.addEventListener('ended', () => {
            this.video.currentTime = 0;
            this.video.play().catch(() => {});
        });

        // Time updates
        this.video.addEventListener('timeupdate', () => {
            if (!this.isScrubbing) {
                this.updateProgress();
            }
        });

        // Buffer progress
        this.video.addEventListener('progress', () => {
            this.updateBuffer();
        });

        // Play/Pause state updates
        this.video.addEventListener('play', () => {
            this.centerIndicator.classList.add('hidden');
            window.api?.sleep?.setPlaybackState(true);
        });

        this.video.addEventListener('pause', () => {
            if (!window.app?.isPureMode) {
                this.centerIndicator.classList.remove('hidden');
            }
            window.api?.sleep?.setPlaybackState(false);
        });

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

    load(url) {
        if (!url) return;
        this.video.src = url;
        const autoSound = window.settingsManager.get('autoPlaySound');
        this.video.muted = !autoSound;
        
        // Aspect ratio
        const fill = window.settingsManager.get('fillScreen');
        this.applyAspect(fill);

        const p = this.video.play();
        if (p !== undefined) {
            p.catch(err => {
                console.log('Autoplay muted fallback:', err.message);
                this.video.muted = true;
                this.video.play().catch(() => {});
            });
        }
    }

    togglePlay() {
        if (this.video.paused) {
            this.video.play().catch(() => {});
        } else {
            this.video.pause();
        }
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
        if (fill) {
            this.video.classList.remove('contain-mode');
            if (this.aspectLabel) this.aspectLabel.textContent = '铺满';
        } else {
            this.video.classList.add('contain-mode');
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
