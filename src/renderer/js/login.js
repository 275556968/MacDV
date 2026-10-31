class LoginModalController {
    constructor() {
        this.modal = document.getElementById('login-modal');
        this.btnLogin = document.getElementById('btn-login');
        this.btnTriggerWin = document.getElementById('btn-trigger-login-win');
        this.btnLogout = document.getElementById('btn-logout');
        this.loginStatusText = document.getElementById('login-status-text');
        this.cookieInput = document.getElementById('cookie-input');
        this.btnApplyCookie = document.getElementById('btn-apply-cookie');

        this.userAvatarWrap = document.getElementById('user-avatar-wrap');
        this.userAvatarImg = document.getElementById('user-avatar-img');
        this.userNameText = document.getElementById('user-name');

        this.tabBtns = this.modal?.querySelectorAll('.modal-tab-btn');
        this.tabPanes = this.modal?.querySelectorAll('.tab-pane');

        this.initEvents();
    }

    initEvents() {
        this.btnLogin?.addEventListener('click', () => this.open());

        this.modal?.querySelectorAll('[data-close="login-modal"]').forEach(btn => {
            btn.addEventListener('click', () => this.close());
        });

        // Tab switching
        this.tabBtns?.forEach(btn => {
            btn.addEventListener('click', () => {
                const target = btn.getAttribute('data-tab');
                this.tabBtns.forEach(b => b.classList.remove('active'));
                this.tabPanes.forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(target)?.classList.add('active');
            });
        });

        // Trigger QR Window
        this.btnTriggerWin?.addEventListener('click', () => {
            window.api?.engine?.openLoginWindow();
        });

        // Logout
        this.btnLogout?.addEventListener('click', async () => {
            await window.api?.engine?.logout();
            this.updateLoginUI({ isLoggedIn: false, statusMessage: '未登录（游客模式浏览）' });
            window.app?.showToast('已退出当前账号');
            window.app?.loadFeed(true);
        });

        // Apply Cookie
        this.btnApplyCookie?.addEventListener('click', async () => {
            const val = this.cookieInput?.value?.trim();
            if (!val) {
                window.app?.showToast('请粘贴包含 sessionid 的 Cookie 字符串');
                return;
            }
            if (!val.includes('sessionid')) {
                window.app?.showToast('⚠️ Cookie 中未找到 sessionid 字段，无法保持登录态');
                return;
            }

            this.btnApplyCookie.textContent = '正在应用...';
            const ok = await window.api?.engine?.applyCookie(val);
            this.btnApplyCookie.textContent = '应用并登录';

            if (ok) {
                this.close();
                window.app?.showToast('🎉 Cookie 导入成功！已登录');
                await this.checkStatus();
                window.app?.loadFeed(true);
            } else {
                window.app?.showToast('❌ Cookie 登录验证失败，请确认是否有效');
            }
        });

        // Login success listener
        window.api?.engine?.onLoginSuccess((data) => {
            this.updateLoginUI(data);
            this.close();
            window.app?.showToast('🎉 扫码登录成功！正在载入个性化推荐流...');
            window.app?.loadFeed(true);
        });
    }

    open() {
        this.modal?.classList.remove('hidden');
        this.checkStatus();
    }

    close() {
        this.modal?.classList.add('hidden');
    }

    async checkStatus() {
        const status = await window.api?.engine?.checkLogin();
        if (status) {
            this.updateLoginUI(status);
        }
    }

    updateLoginUI(status) {
        const isLogged = !!status.isLoggedIn;
        if (isLogged) {
            this.loginStatusText.textContent = `已登录: ${status.userInfo?.nickname || '抖音用户'}`;
            this.loginStatusText.style.color = 'var(--brand-cyan)';
            this.btnLogout?.classList.remove('hidden');
            this.btnTriggerWin?.classList.add('hidden');

            this.userNameText.textContent = status.userInfo?.nickname || '已登录';
            if (status.userInfo?.avatarUrl) {
                this.userAvatarImg.src = status.userInfo.avatarUrl;
                this.userAvatarImg.classList.remove('hidden');
                this.userAvatarWrap.querySelector('.avatar-default')?.classList.add('hidden');
            }
        } else {
            this.loginStatusText.textContent = '未登录（游客模式浏览）';
            this.loginStatusText.style.color = 'var(--text-muted)';
            this.btnLogout?.classList.add('hidden');
            this.btnTriggerWin?.classList.remove('hidden');

            this.userNameText.textContent = '登录';
            this.userAvatarImg.classList.add('hidden');
            this.userAvatarWrap.querySelector('.avatar-default')?.classList.remove('hidden');
        }
    }
}

window.loginModal = new LoginModalController();
