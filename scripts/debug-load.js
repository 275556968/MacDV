const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false });
    try {
        console.log('Loading douyin jingxuan...');
        await win.loadURL('https://www.douyin.com/jingxuan');
        console.log('Successfully loaded douyin!');
    } catch (e) {
        console.error('Error loading douyin:', e);
    } finally {
        win.destroy();
        app.quit();
    }
});
