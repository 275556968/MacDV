const { app, BrowserWindow, session } = require('electron');

app.whenReady().then(async () => {
    // Intercept headers for douyin video domains
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
        if (details.url.includes('douyinvod.com') || details.url.includes('douyin.com')) {
            details.requestHeaders['Referer'] = 'https://www.douyin.com/';
        }
        details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
        callback({ requestHeaders: details.requestHeaders });
    });

    const engineWin = new BrowserWindow({ width: 800, height: 600, show: false });
    await engineWin.loadURL('https://www.douyin.com/jingxuan');
    await new Promise(r => setTimeout(r, 3000));

    // Fetch feed
    const feedRes = await engineWin.webContents.executeJavaScript(`
        fetch('/aweme/v1/web/tab/feed/?device_platform=webapp&aid=6383&channel=channel_pc_web&count=2', { credentials: 'include' }).then(r => r.json())
    `);
    const item = feedRes.aweme_list[0];
    console.log('[TestPlayback] Got video title:', item.desc?.slice(0, 30));

    // Choose highest bitrate
    let bestUrl = null;
    if (item.video?.bit_rate && item.video.bit_rate.length > 0) {
        const sorted = item.video.bit_rate.slice().sort((a, b) => (b.bit_rate || 0) - (a.bit_rate || 0));
        for (const b of sorted) {
            if (b.play_addr?.url_list && b.play_addr.url_list.length > 0) {
                const found = b.play_addr.url_list.find(u => u.includes('/aweme/v1/play/')) || b.play_addr.url_list[0];
                if (found) {
                    bestUrl = found;
                    break;
                }
            }
        }
    }
    if (!bestUrl && item.video?.play_addr?.url_list) {
        bestUrl = item.video.play_addr.url_list[0];
    }
    console.log('[TestPlayback] Best stream URL:', bestUrl);

    // Now test video playback in a renderer window
    const playerWin = new BrowserWindow({
        width: 800,
        height: 600,
        show: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    const html = `
    <!DOCTYPE html>
    <html>
    <body>
        <video id="v" autoplay muted></video>
        <script>
            const video = document.getElementById('v');
            video.src = ${JSON.stringify(bestUrl)};
            window.playbackPromise = new Promise((resolve, reject) => {
                video.onloadeddata = () => {
                    resolve({
                        duration: video.duration,
                        videoWidth: video.videoWidth,
                        videoHeight: video.videoHeight,
                        ready: true
                    });
                };
                video.onerror = (e) => {
                    reject(video.error ? video.error.message || video.error.code : 'unknown error');
                };
                setTimeout(() => reject('timeout waiting for video loadeddata'), 8000);
            });
        </script>
    </body>
    </html>
    `;

    await playerWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

    try {
        const info = await playerWin.webContents.executeJavaScript('window.playbackPromise');
        console.log('[TestPlayback] SUCCESS! Video loaded perfectly:');
        console.log(`  Duration: ${info.duration}s`);
        console.log(`  Resolution: ${info.videoWidth}x${info.videoHeight}`);
    } catch (err) {
        console.error('[TestPlayback] Video load error:', err);
    } finally {
        engineWin.destroy();
        playerWin.destroy();
        app.quit();
    }
});
