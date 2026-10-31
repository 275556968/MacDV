class CommentDrawerController {
    constructor() {
        this.drawer = document.getElementById('comment-drawer');
        this.title = document.getElementById('comment-drawer-title');
        this.body = document.getElementById('comment-body');
        this.loading = document.getElementById('comment-loading');
        this.empty = document.getElementById('comment-empty');
        this.list = document.getElementById('comment-list');
        this.btnClose = document.getElementById('btn-close-comment');

        this.isOpen = false;
        this.currentAwemeId = null;

        this.initEvents();
    }

    initEvents() {
        this.btnClose?.addEventListener('click', () => this.close());
    }

    open() {
        this.isOpen = true;
        this.drawer?.classList.add('open');
        this.loadComments();
    }

    close() {
        this.isOpen = false;
        this.drawer?.classList.remove('open');
    }

    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    async loadComments() {
        const item = window.app?.currentItem;
        if (!item || !item.awemeId) return;

        this.currentAwemeId = item.awemeId;
        this.title.textContent = `评论 (${item.stats?.commentCount || 0})`;
        this.loading.classList.remove('hidden');
        this.empty.classList.add('hidden');
        this.list.innerHTML = '';

        try {
            const comments = await window.api.engine.fetchComments({
                awemeId: item.awemeId,
                cursor: 0,
                count: 30
            });

            this.loading.classList.add('hidden');

            if (!comments || comments.length === 0) {
                this.empty.classList.remove('hidden');
                return;
            }

            this.renderList(comments);
        } catch (err) {
            console.error('Failed to load comments:', err);
            this.loading.classList.add('hidden');
            this.empty.classList.remove('hidden');
            this.empty.querySelector('span').textContent = '加载评论失败，请重试';
        }
    }

    renderList(comments) {
        this.list.innerHTML = '';
        for (const c of comments) {
            const row = document.createElement('div');
            row.className = 'comment-row';

            const avatarSrc = c.user?.avatarUrl || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="%23888"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>';

            row.innerHTML = `
                <div class="comment-avatar">
                    <img src="${avatarSrc}" alt="avatar" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'36\\' height=\\'36\\' viewBox=\\'0 0 24 24\\' fill=\\'%23888\\'><circle cx=\\'12\\' cy=\\'8\\' r=\\'4\\'/><path d=\\'M4 20c0-4 4-6 8-6s8 2 8 6\\'/></svg>'">
                </div>
                <div class="comment-content">
                    <span class="comment-user-name">${this.escapeHtml(c.user?.nickname || '抖音用户')}</span>
                    <span class="comment-text">${this.escapeHtml(c.text || '')}</span>
                    <div class="comment-meta">
                        <span>${this.formatTime(c.createTime)}</span>
                        <div class="comment-digg">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                            </svg>
                            <span>${c.diggCount || 0}</span>
                        </div>
                    </div>
                </div>
            `;
            this.list.appendChild(row);
        }
    }

    formatTime(timestamp) {
        if (!timestamp) return '';
        const now = Math.floor(Date.now() / 1000);
        const diff = now - timestamp;
        if (diff < 60) return '刚刚';
        if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
        if (diff < 259200) return `${Math.floor(diff / 86400)}天前`;

        const d = new Date(timestamp * 1000);
        return `${d.getMonth() + 1}-${d.getDate()}`;
    }

    escapeHtml(str) {
        return (str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}

window.commentDrawer = new CommentDrawerController();
