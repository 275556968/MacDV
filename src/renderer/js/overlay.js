class VideoOverlayController {
    constructor() {
        this.authorName = document.getElementById('author-name');
        this.qualityBadge = document.getElementById('quality-badge');
        this.videoDesc = document.getElementById('video-desc');
        this.musicTitle = document.getElementById('music-title');
        this.actionAvatar = document.getElementById('action-avatar');

        this.btnLike = document.getElementById('btn-like');
        this.likeCount = document.getElementById('like-count');
        this.btnComment = document.getElementById('btn-comment');
        this.commentCount = document.getElementById('comment-count');
        this.btnCollect = document.getElementById('btn-collect');
        this.collectCount = document.getElementById('collect-count');
        this.btnShare = document.getElementById('btn-share');
        this.btnAspect = document.getElementById('btn-aspect');
        this.btnFullscreen = document.getElementById('btn-fullscreen');

        this.currentItem = null;
        this.isLiked = false;
        this.isCollected = false;

        this.initEvents();
    }

    initEvents() {
        this.btnLike?.addEventListener('click', () => this.toggleLike());
        this.btnComment?.addEventListener('click', () => window.commentDrawer?.toggle());
        this.btnCollect?.addEventListener('click', () => this.toggleCollect());
        this.btnShare?.addEventListener('click', () => this.copyShareLink());
        this.btnAspect?.addEventListener('click', () => window.videoPlayer?.toggleAspect());
        this.btnFullscreen?.addEventListener('click', () => window.app?.toggleFullScreen());
    }

    render(item) {
        this.currentItem = item;
        this.isLiked = false;
        this.isCollected = false;
        this.btnLike?.classList.remove('liked');
        this.btnCollect?.classList.remove('collected');

        if (!item) return;

        // Meta info
        this.authorName.textContent = `@${item.author?.nickname || '抖音用户'}`;
        this.qualityBadge.textContent = item.qualityLabel || '1080P 超清';
        this.videoDesc.textContent = item.desc || '';
        this.musicTitle.textContent = item.music?.title || `原声 - ${item.author?.nickname || '抖音'}`;

        // Avatar
        if (item.author?.avatarUrl) {
            this.actionAvatar.src = item.author.avatarUrl;
        } else {
            this.actionAvatar.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="%23888"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>';
        }

        // Stats
        this.likeCount.textContent = this.formatNumber(item.stats?.diggCount || 0);
        this.commentCount.textContent = this.formatNumber(item.stats?.commentCount || 0);
        this.collectCount.textContent = this.formatNumber(item.stats?.collectCount || 0);
    }

    toggleLike() {
        if (!this.currentItem) return;
        this.isLiked = !this.isLiked;
        this.btnLike.classList.toggle('liked', this.isLiked);
        let count = this.currentItem.stats?.diggCount || 0;
        if (this.isLiked) count += 1;
        this.likeCount.textContent = this.formatNumber(count);
    }

    toggleCollect() {
        if (!this.currentItem) return;
        this.isCollected = !this.isCollected;
        this.btnCollect.classList.toggle('collected', this.isCollected);
        let count = this.currentItem.stats?.collectCount || 0;
        if (this.isCollected) count += 1;
        this.collectCount.textContent = this.formatNumber(count);
        window.app?.showToast(this.isCollected ? '⭐ 已收藏该作品' : '已取消收藏');
    }

    copyShareLink() {
        if (!this.currentItem) return;
        const link = `https://www.douyin.com/video/${this.currentItem.awemeId}`;
        window.api?.clipboard?.writeText(link);
        window.app?.showToast('🔗 视频链接已复制到剪贴板！');
    }

    formatNumber(n) {
        n = Number(n) || 0;
        if (n >= 100000000) {
            return (n / 100000000).toFixed(1) + '亿';
        } else if (n >= 10000) {
            return (n / 10000).toFixed(1) + '万';
        }
        return String(n);
    }
}

window.videoOverlay = new VideoOverlayController();
