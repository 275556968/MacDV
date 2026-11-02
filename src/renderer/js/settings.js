class SettingsManager {
    constructor() {
        this.defaults = {
            isAlwaysOnTop: false,
            windowOpacity: 1.0,
            startInPureMode: false,
            autoPureInFullscreen: true,
            preferHighestQuality: true,
            autoPlaySound: true,
            preventDisplaySleep: true,
            seekStepSeconds: 10,
            fillScreen: true,
            autoCheckUpdate: true
        };
        this.state = this.load();
    }

    load() {
        try {
            const saved = localStorage.getItem('windv_settings');
            if (saved) {
                return { ...this.defaults, ...JSON.parse(saved) };
            }
        } catch (e) {}
        return { ...this.defaults };
    }

    save() {
        try {
            localStorage.setItem('windv_settings', JSON.stringify(this.state));
        } catch (e) {}
    }

    get(key) {
        return this.state[key] !== undefined ? this.state[key] : this.defaults[key];
    }

    set(key, value) {
        this.state[key] = value;
        this.save();
        this.apply(key, value);
    }

    apply(key, value) {
        if (key === 'isAlwaysOnTop') {
            window.api?.window?.setAlwaysOnTop(value);
        } else if (key === 'windowOpacity') {
            window.api?.window?.setOpacity(value);
        } else if (key === 'preventDisplaySleep') {
            window.api?.sleep?.setPreference(value);
        }
    }

    applyAll() {
        this.apply('isAlwaysOnTop', this.get('isAlwaysOnTop'));
        this.apply('windowOpacity', this.get('windowOpacity'));
        this.apply('preventDisplaySleep', this.get('preventDisplaySleep'));
    }
}

window.settingsManager = new SettingsManager();
