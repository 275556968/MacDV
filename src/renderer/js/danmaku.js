// Douyin serves danmaku in fixed 32-second windows
const DANMAKU_WINDOW_MS = 32000;
// Start fetching the next window this long before the current one ends
const DANMAKU_PREFETCH_MS = 6000;
// A window that arrives late still shows what was posted in the last 2s
const DANMAKU_LATE_MS = 2000;
const DANMAKU_CACHE_LIMIT = 8;
const DANMAKU_MAX_ON_SCREEN = 150;
const DANMAKU_RETRY_MS = 8000;
const DANMAKU_LANE_GAP_PX = 28;

// Douyin's text emoji codes -> closest unicode emoji. Unknown codes are dropped.
const DANMAKU_EMOJI = {
    '赞': '👍', '弱': '👎', '鼓掌': '👏', '比心': '🫶', '爱心': '❤️', '心': '❤️', '玫瑰': '🌹',
    '捂脸': '🤦', '泣不成声': '😭', '流泪': '😢', '大哭': '😭', '哭': '😭', '笑哭': '😂',
    '大笑': '😆', '呲牙': '😁', '微笑': '🙂', '偷笑': '🤭', '憨笑': '😄', '可爱': '🥰',
    '色': '😍', '送心': '🥰', '感谢': '🙏', '祈祷': '🙏', '看': '👀', '惊讶': '😮',
    '震惊': '😱', '发怒': '😡', '生气': '😠', '吐': '🤮', '晕': '😵', '思考': '🤔',
    '疑问': '❓', '尬笑': '😅', '汗': '😓', '流汗': '😓', '酷拽': '😎', '耶': '✌️',
    '强': '💪', '加油': '💪', '握手': '🤝', '抱拳': '🙏', '狗头': '🐶', '二哈': '🐶',
    '火': '🔥', '炸弹': '💣', '蛋糕': '🎂', '礼物': '🎁', '烟花': '🎆', '撒花': '🎉',
    '庆祝': '🎉', '太阳': '☀️', '月亮': '🌙', '啤酒': '🍺', '干杯': '🍻', '吻': '😘',
    '亲亲': '😘', '飞吻': '😘', '闭嘴': '🤐', '睡': '😴', '困': '😪', '白眼': '🙄',
    '翻白眼': '🙄', '鄙视': '😒', '奸笑': '😏', '坏笑': '😏', '害羞': '😊', '舔屏': '🤤',
    '馋': '🤤', '听歌': '🎧', '666': '666', '给力': '💪', '胜利': '✌️', 'OK': '👌', 'ok': '👌'
};

class DanmakuController {
    constructor() {
        this.layer = document.getElementById('danmaku-layer');
        this.toggleBtn = document.getElementById('btn-danmaku');

        this.cache = new Map();   // awemeId -> track
        this.item = null;
        this.track = null;

        this.pointer = 0;         // next index in track.list to emit
        this.emittedUntilMs = -1; // everything at or before this video time was handled
        this.lastTimeMs = 0;

        this.active = new Set();  // danmaku currently on screen
        this.lanes = [];
        this.running = false;
        this.rate = 1;
        this.emittedCount = 0;

        this.width = 0;
        this.height = 0;

        if (!this.layer) return;

        const measure = () => {
            this.width = this.layer.clientWidth;
            this.height = this.layer.clientHeight;
        };
        measure();
        new ResizeObserver(measure).observe(this.layer);

        this.initControls();
        this.applySettings();

        this.tick = this.tick.bind(this);
        requestAnimationFrame(this.tick);
    }

    get enabled() {
        return window.settingsManager.get('danmakuEnabled') !== false;
    }

    // ==================== Settings & controls ====================

    initControls() {
        this.toggleBtn?.addEventListener('click', () => this.toggle());

        const chk = document.getElementById('setting-danmaku-enabled');
        chk?.addEventListener('change', () => this.setEnabled(chk.checked, false));

        const range = document.getElementById('setting-danmaku-opacity');
        range?.addEventListener('input', () => {
            window.settingsManager.set('danmakuOpacity', parseFloat(range.value));
            this.applySettings();
        });

        document.querySelectorAll('[data-danmaku-area]').forEach((chip) => {
            chip.addEventListener('click', () => {
                window.settingsManager.set('danmakuArea', parseFloat(chip.dataset.danmakuArea));
                this.applySettings();
            });
        });

        document.querySelectorAll('[data-danmaku-size]').forEach((chip) => {
            chip.addEventListener('click', () => {
                window.settingsManager.set('danmakuFontSize', parseInt(chip.dataset.danmakuSize, 10));
                // Lane height changed: restart cleanly instead of overlapping old lanes
                this.clearScreen();
                this.applySettings();
            });
        });
    }

    /** Push the saved settings into the layer and the settings UI. */
    applySettings() {
        const s = window.settingsManager;
        const enabled = this.enabled;
        const opacity = Math.min(1, Math.max(0.1, Number(s.get('danmakuOpacity')) || 0.85));
        const area = Number(s.get('danmakuArea')) || 0.5;
        const size = Number(s.get('danmakuFontSize')) || 22;

        this.layer.classList.toggle('hidden', !enabled);
        this.layer.style.opacity = String(opacity);
        this.layer.style.setProperty('--danmaku-font-size', `${size}px`);
        this.toggleBtn?.classList.toggle('active', enabled);

        const chk = document.getElementById('setting-danmaku-enabled');
        if (chk) chk.checked = enabled;
        const range = document.getElementById('setting-danmaku-opacity');
        if (range) range.value = String(opacity);
        const val = document.getElementById('danmaku-opacity-val');
        if (val) val.textContent = `${Math.round(opacity * 100)}%`;

        document.querySelectorAll('[data-danmaku-area]').forEach((chip) => {
            chip.classList.toggle('active', Math.abs(parseFloat(chip.dataset.danmakuArea) - area) < 0.001);
        });
        document.querySelectorAll('[data-danmaku-size]').forEach((chip) => {
            chip.classList.toggle('active', parseInt(chip.dataset.danmakuSize, 10) === size);
        });
    }

    setEnabled(enabled, notify = true) {
        window.settingsManager.set('danmakuEnabled', !!enabled);
        this.clearScreen();
        if (enabled) {
            // Pick up from the current position, not from where it was switched off
            this.resync((window.videoPlayer?.video?.currentTime || 0) * 1000);
        }
        this.applySettings();
        if (notify) {
            window.app?.showToast(enabled ? '💬 弹幕: 已开启 (快捷键 D)' : '弹幕: 已关闭');
        }
    }

    toggle() {
        this.setEnabled(!this.enabled);
    }

    // ==================== Per-video state ====================

    /** Called by the app whenever a different video starts. */
    setItem(item) {
        this.clearScreen();
        this.item = item || null;
        this.track = item && item.awemeId ? this.getTrack(String(item.awemeId)) : null;
        this.pointer = 0;
        this.emittedUntilMs = -1;
        this.lastTimeMs = 0;
    }

    getTrack(awemeId) {
        let track = this.cache.get(awemeId);
        if (track) {
            // Refresh recency
            this.cache.delete(awemeId);
            this.cache.set(awemeId, track);
            return track;
        }

        track = { awemeId, list: [], ids: new Set(), segments: new Map(), empty: false };
        this.cache.set(awemeId, track);
        while (this.cache.size > DANMAKU_CACHE_LIMIT) {
            this.cache.delete(this.cache.keys().next().value);
        }
        return track;
    }

    hasDanmaku() {
        const item = this.item;
        if (!item || !this.track || this.track.empty) return false;
        if (item.danmakuEnabled === false || item.danmakuCount === 0) return false;
        return true;
    }

    /** Make sure the window around `tMs` (and soon the next one) is loaded. */
    ensureSegments(tMs) {
        if (!this.hasDanmaku()) return;
        const idx = Math.floor(tMs / DANMAKU_WINDOW_MS);
        this.loadSegment(this.track, idx);

        const durationMs = this.item.duration || 0;
        const nextStart = (idx + 1) * DANMAKU_WINDOW_MS;
        const closeToEnd = nextStart - tMs <= DANMAKU_PREFETCH_MS;
        if (closeToEnd && (!durationMs || nextStart < durationMs)) {
            this.loadSegment(this.track, idx + 1);
        }
    }

    async loadSegment(track, idx) {
        if (idx < 0 || track.segments.has(idx)) return;
        track.segments.set(idx, 'loading');

        const item = this.item;
        const segStart = idx * DANMAKU_WINDOW_MS;
        let res = null;
        try {
            res = await window.api?.engine?.fetchDanmaku({
                awemeId: track.awemeId,
                startMs: segStart,
                durationMs: item?.duration || 0
            });
        } catch (err) {
            console.warn('[WinDV] Danmaku fetch failed:', err.message);
        }

        if (!res || !res.ok) {
            // Allow a later retry instead of hammering the API every frame
            track.segments.set(idx, 'failed');
            setTimeout(() => {
                if (track.segments.get(idx) === 'failed') track.segments.delete(idx);
            }, DANMAKU_RETRY_MS);
            return;
        }

        track.segments.set(idx, 'done');
        if (res.total === 0) track.empty = true;

        let added = 0;
        for (const d of res.items || []) {
            const key = d.id || `${d.offsetMs}:${d.text}`;
            if (track.ids.has(key)) continue;
            const text = this.normalizeText(d.text);
            if (!text) continue;
            track.ids.add(key);
            track.list.push({ offsetMs: d.offsetMs, text });
            added += 1;
        }
        if (added === 0) return;

        track.list.sort((a, b) => a.offsetMs - b.offsetMs);

        // The list changed under the cursor: re-place it. If this window is the
        // one being played, it arrived late, so also show its last 2 seconds.
        if (track === this.track) {
            const t = this.emittedUntilMs;
            const isCurrentWindow = t >= segStart && t < segStart + DANMAKU_WINDOW_MS;
            this.pointer = isCurrentWindow
                ? this.firstIndexFrom(Math.max(t - DANMAKU_LATE_MS, segStart))
                : this.firstIndexFrom(t + 0.001);
        }
    }

    /** First index in the current list whose offset is >= ms (binary search). */
    firstIndexFrom(ms) {
        const list = this.track ? this.track.list : [];
        let lo = 0;
        let hi = list.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (list[mid].offsetMs < ms) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }

    normalizeText(raw) {
        return String(raw || '')
            .replace(/\[([^\[\]\s]{1,6})\]/g, (m, name) => DANMAKU_EMOJI[name] || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 60);
    }

    resync(tMs) {
        this.pointer = this.firstIndexFrom(tMs);
        this.emittedUntilMs = tMs;
        this.lastTimeMs = tMs;
    }

    // ==================== Frame loop ====================

    tick() {
        requestAnimationFrame(this.tick);
        if (!this.enabled || !this.item) return;

        // While the next video is still preloading, the player keeps showing the
        // previous one: wait until the element on screen is really this item.
        const video = window.videoPlayer?.video;
        if (!video || video.getAttribute('src') !== this.item.playUrl) {
            this.syncPlayback(false, this.rate);
            return;
        }

        const running = !video.paused && !video.seeking && video.readyState >= 3;
        this.syncPlayback(running, video.playbackRate || 1);

        const tMs = video.currentTime * 1000;
        const delta = tMs - this.lastTimeMs;
        if (delta < -300 || delta > 1500) {
            // Seek, loop restart, or the window was hidden for a while
            this.clearScreen();
            this.resync(tMs);
        }
        this.lastTimeMs = tMs;

        this.ensureSegments(tMs);
        if (!running || !this.track) return;

        const list = this.track.list;
        while (this.pointer < list.length && list[this.pointer].offsetMs <= tMs) {
            this.spawn(list[this.pointer]);
            this.pointer += 1;
        }
        this.emittedUntilMs = tMs;
    }

    /** Keep the scrolling animations in step with the video (pause / speed). */
    syncPlayback(running, rate) {
        if (running === this.running && rate === this.rate) return;
        this.running = running;
        this.rate = rate;
        for (const entry of this.active) {
            entry.anim.playbackRate = rate;
            if (running) entry.anim.play();
            else entry.anim.pause();
        }
    }

    // ==================== Rendering ====================

    spawn(d) {
        if (this.active.size >= DANMAKU_MAX_ON_SCREEN || this.width <= 0) return;

        const fontSize = Number(window.settingsManager.get('danmakuFontSize')) || 22;
        const laneHeight = Math.round(fontSize * 1.55);
        const area = Number(window.settingsManager.get('danmakuArea')) || 0.5;
        const laneCount = Math.max(1, Math.floor((this.height * area) / laneHeight));

        const el = document.createElement('div');
        el.className = 'danmaku-item';
        el.textContent = d.text;
        this.layer.appendChild(el);

        const itemWidth = el.offsetWidth;
        // Wider windows get a little more time so the pace stays readable
        const duration = Math.min(13000, Math.max(8000, 7000 + this.width * 2));
        const speed = (this.width + itemWidth) / duration; // px per animation-ms

        const lane = this.pickLane(laneCount, speed, duration);
        if (lane < 0) {
            // Screen is full: drop it rather than stacking text on text
            el.remove();
            return;
        }

        el.style.top = `${lane * laneHeight}px`;
        const anim = el.animate(
            [
                { transform: `translateX(${this.width}px)` },
                { transform: `translateX(${-itemWidth}px)` }
            ],
            { duration, easing: 'linear', fill: 'forwards' }
        );
        anim.playbackRate = this.rate;
        if (!this.running) anim.pause();

        const entry = { el, anim, width: itemWidth, speed, duration };
        this.active.add(entry);
        this.lanes[lane] = entry;
        this.emittedCount += 1;

        anim.onfinish = () => {
            el.remove();
            this.active.delete(entry);
        };
    }

    /**
     * A lane is free when its last danmaku has fully entered the screen and the
     * new one cannot catch up with it before it leaves.
     */
    pickLane(laneCount, speed, duration) {
        for (let i = 0; i < laneCount; i++) {
            const last = this.lanes[i];
            if (!last || !this.active.has(last)) return i;

            const elapsed = Number(last.anim.currentTime) || 0;
            const tailEntered = last.speed * elapsed >= last.width + DANMAKU_LANE_GAP_PX;
            if (!tailEntered) continue;

            const lastRemaining = last.duration - elapsed;
            const timeToReachLeftEdge = this.width / speed;
            if (speed <= last.speed || timeToReachLeftEdge >= lastRemaining) return i;
        }
        return -1;
    }

    clearScreen() {
        for (const entry of this.active) {
            entry.anim.onfinish = null;
            entry.anim.cancel();
            entry.el.remove();
        }
        this.active.clear();
        this.lanes = [];
    }

    /** Snapshot used by the automated tests. */
    stats() {
        const track = this.track;
        return {
            enabled: this.enabled,
            awemeId: track ? track.awemeId : null,
            loadedSegments: track ? Array.from(track.segments.entries()) : [],
            listLength: track ? track.list.length : 0,
            pointer: this.pointer,
            onScreen: this.active.size,
            emittedCount: this.emittedCount,
            running: this.running,
            rate: this.rate
        };
    }
}

window.danmaku = new DanmakuController();
