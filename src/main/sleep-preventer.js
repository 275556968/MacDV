const { powerSaveBlocker } = require('electron');

class SleepPreventer {
    constructor() {
        this.blockerId = null;
        this.isPlaying = false;
        this.preventSleepPref = true;
    }

    setPreference(enabled) {
        this.preventSleepPref = !!enabled;
        this.evaluate();
    }

    updatePlaybackState(isPlaying) {
        this.isPlaying = !!isPlaying;
        this.evaluate();
    }

    evaluate() {
        if (this.isPlaying && this.preventSleepPref) {
            this.acquire();
        } else {
            this.release();
        }
    }

    acquire() {
        if (this.blockerId !== null && powerSaveBlocker.isStarted(this.blockerId)) {
            return;
        }
        try {
            this.blockerId = powerSaveBlocker.start('prevent-display-sleep');
            console.log(`💡 [SleepPreventer] 已阻止屏幕休眠 (Blocker ID: ${this.blockerId})`);
        } catch (err) {
            console.warn('⚠️ [SleepPreventer] 启动防休眠失败:', err);
        }
    }

    release() {
        if (this.blockerId !== null) {
            try {
                if (powerSaveBlocker.isStarted(this.blockerId)) {
                    powerSaveBlocker.stop(this.blockerId);
                    console.log(`💤 [SleepPreventer] 已释放防休眠 (ID: ${this.blockerId})，恢复系统正常休眠`);
                }
            } catch (err) {
                console.warn('⚠️ [SleepPreventer] 停止防休眠失败:', err);
            }
            this.blockerId = null;
        }
    }
}

module.exports = new SleepPreventer();
