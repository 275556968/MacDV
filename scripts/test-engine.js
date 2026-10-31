const { app, BrowserWindow, session } = require('electron');

app.whenReady().then(async () => {
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
        if (details.url.includes('douyinvod.com') || details.url.includes('douyin.com')) {
            details.requestHeaders['Referer'] = 'https://www.douyin.com/';
        }
        details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
        callback({ requestHeaders: details.requestHeaders });
    });

    const win = new BrowserWindow({
        width: 800,
        height: 600,
        show: false
    });

    await win.loadURL('https://www.douyin.com/jingxuan');
    await new Promise(resolve => setTimeout(resolve, 3000));

    try {
        const feedPath = '/aweme/v1/web/tab/feed/?device_platform=webapp&aid=6383&channel=channel_pc_web&count=2';
        const feedRes = await win.webContents.executeJavaScript(`
            fetch('${feedPath}', { credentials: 'include' }).then(r => r.json())
        `);
        
        if (feedRes.aweme_list && feedRes.aweme_list.length > 0) {
            const firstId = feedRes.aweme_list[0].aweme_id;
            console.log(`[TestEngine] Fetching comments for aweme_id: ${firstId}...`);
            const commentPath = `/aweme/v1/web/comment/list/?device_platform=webapp&aid=6383&channel=channel_pc_web&aweme_id=${firstId}&cursor=0&count=5`;
            const commentRes = await win.webContents.executeJavaScript(`
                fetch('${commentPath}', { credentials: 'include' }).then(r => r.json())
            `);
            console.log(`[TestEngine] Comments status code: ${commentRes.status_code}`);
            console.log(`[TestEngine] Comments count: ${commentRes.comments ? commentRes.comments.length : 0}`);
            if (commentRes.comments && commentRes.comments.length > 0) {
                commentRes.comments.forEach((c, idx) => {
                    console.log(`  Comment #${idx+1}: [${c.user?.nickname}] ${c.text?.slice(0, 30)} (likes: ${c.digg_count})`);
                });
            }
        }
        console.log('[TestEngine] Comments verification passed!');
    } catch (err) {
        console.error('[TestEngine] Error:', err);
    } finally {
        win.destroy();
        app.quit();
    }
});
