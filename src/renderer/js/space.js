class SpaceController {
    constructor() {
        this.modal = document.getElementById('space-modal');
        this.grid = document.getElementById('space-grid');
        this.avatar = document.getElementById('space-avatar');
        this.nickname = document.getElementById('space-nickname');
        this.signature = document.getElementById('space-signature');
        this.follower = document.getElementById('space-follower');
        this.awemeCount = document.getElementById('space-aweme-count');
        this.videoCount = document.getElementById('space-video-count');
        this.loading = document.getElementById('space-loading');
        this.empty = document.getElementById('space-empty');
        this.loadMoreBtn = document.getElementById('space-load-more');

        this.isOpen = false;
        this.secUid = null;
        this.author = null;
        this.items = [];
        this.cursor = 0;
        this.hasMore = false;
        this.isLoading = false;

        this.initEvents();
    }

    initEvents() {
        document.getElementById('space-close')?.addEventListener('click', () => this.close());

        this.modal?.addEventListener('click', (e) => {
            if (e.target === this.modal) this.close();
        });

        this.grid?.addEventListener('click', (e) => {
            const card = e.target.closest('.space-card-item');
            if (!card) return;
            const index = parseInt(card.dataset.index, 10);
            if (Number.isInteger(index)) this.playIndex(index);
        });

        this.grid?.addEventListener('scroll', () => {
            if (!this.isOpen || !this.hasMore || this.isLoading) return;
            const remaining = this.grid.scrollHeight - this.grid.scrollTop - this.grid.clientHeight;
            if (remaining < 160) this.loadMore();
        });

        this.loadMoreBtn?.addEventListener('click', () => this.loadMore());
    }

    async open(author) {
        if (!author || !author.secUid) {
            window.app?.showToast('该作品没有可进入的博主主页');
            return;
        }

        this.author = author;
        this.secUid = author.secUid;
        this.items = [];
        this.cursor = 0;
        this.hasMore = false;
        this.isLoading = false;
        this.autoFillCount = 0;
        this.isOpen = true;

        this.avatar.src = author.avatarUrl || this.fallbackAvatar();
        this.nickname.textContent = `@${author.nickname || '抖音用户'}`;
        this.signature.textContent = '';
        this.follower.textContent = '—';
        this.awemeCount.textContent = '—';
        this.videoCount.textContent = '0';
        this.grid.innerHTML = '';
        this.grid.scrollTop = 0;
        this.empty.textContent = '该博主暂时没有可播放的作品';
        this.empty.classList.add('hidden');
        this.loadMoreBtn.classList.add('hidden');
        this.loadMoreBtn.disabled = false;
        this.loadMoreBtn.textContent = '加载更多作品';
        this.loading.classList.remove('hidden');
        this.modal.classList.remove('hidden');

        const profilePromise = window.api?.engine?.fetchUserProfile
            ? window.api.engine.fetchUserProfile(this.secUid).catch(() => null)
            : Promise.resolve(null);

        await Promise.all([
            profilePromise.then((profile) => {
                if (profile && this.isOpen) this.renderProfile(profile);
            }),
            this.loadPage(true)
        ]);

        if (!this.isOpen) return;
        this.loading.classList.add('hidden');
        this.empty.classList.toggle('hidden', this.items.length > 0);
        this.ensureGridFilled();
    }

    close() {
        this.isOpen = false;
        this.modal?.classList.add('hidden');
    }

    fallbackAvatar() {
        return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="%23888"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>';
    }

    renderProfile(profile) {
        this.nickname.textContent = `@${profile.nickname || '抖音用户'}`;
        if (profile.avatarUrl) this.avatar.src = profile.avatarUrl;
        this.signature.textContent = profile.signature || '';
        this.signature.title = profile.signature || '';
        this.follower.textContent = this.formatNumber(profile.followerCount);
        this.awemeCount.textContent = this.formatNumber(profile.awemeCount);
    }

    async loadPage(reset = false) {
        if (this.isLoading || !this.secUid) return;
        this.isLoading = true;

        try {
            const res = await window.api?.engine?.fetchUserPosts?.({
                secUid: this.secUid,
                maxCursor: reset ? 0 : this.cursor,
                count: 18
            });

            if (reset) this.items = [];
            const seen = new Set(this.items.map((item) => String(item.awemeId)));
            for (const item of (res?.items || [])) {
                const id = String(item.awemeId || '');
                if (!id || seen.has(id)) continue;
                seen.add(id);
                this.items.push(item);
            }

            this.hasMore = !!res?.hasMore;
            this.cursor = res?.maxCursor || 0;
            this.renderGrid();
        } catch (err) {
            console.error('[WinDV] Failed to load user posts:', err);
            if (this.isOpen && this.items.length === 0) {
                this.empty.textContent = '加载博主作品失败，请稍后重试';
                this.empty.classList.remove('hidden');
            }
        } finally {
            this.isLoading = false;
            if (this.isOpen) {
                this.loading.classList.add('hidden');
                this.loadMoreBtn.classList.toggle('hidden', !this.hasMore);
                this.loadMoreBtn.disabled = false;
                this.loadMoreBtn.textContent = '加载更多作品';
                this.videoCount.textContent = String(this.items.length);
                this.empty.classList.toggle('hidden', this.items.length > 0);
                this.ensureGridFilled();
            }
        }
    }

    /**
     * Fetch the next page and return only the newly appended items.
     * Works after the space modal is closed, so playback can keep loading.
     */
    async loadMoreItems() {
        if (!this.hasMore || this.isLoading) return [];
        const before = this.items.length;
        await this.loadPage(false);
        return this.items.slice(before);
    }

    /** If the first page doesn't fill the grid, keep loading until it can scroll */
    ensureGridFilled() {
        if (!this.isOpen || !this.hasMore || this.isLoading) return;
        if (!this.grid) return;
        if (this.grid.scrollHeight > this.grid.clientHeight + 40) return;
        if (this.autoFillCount >= 3) return;
        this.autoFillCount += 1;
        this.loadMore();
    }

    async loadMore() {
        if (!this.hasMore || this.isLoading) return;
        this.loadMoreBtn.textContent = '正在加载…';
        this.loadMoreBtn.disabled = true;
        await this.loadPage(false);
    }

    playIndex(index) {
        const item = this.items[index];
        if (!item) return;

        const list = this.items.slice();
        const nickname = item.author?.nickname || this.author?.nickname || '博主';
        this.close();
        window.app?.playFromSpace(list, index);
        window.app?.showToast(`👤 正在播放 @${nickname} 的作品`);
    }

    renderGrid() {
        if (!this.grid) return;
        this.grid.innerHTML = '';

        this.items.forEach((item, index) => {
            const card = document.createElement('button');
            card.className = 'space-card-item';
            card.dataset.index = String(index);
            card.title = item.desc || '';

            const coverWrap = document.createElement('div');
            coverWrap.className = 'space-cover-wrap';

            const cover = document.createElement('img');
            cover.className = 'space-cover';
            cover.loading = 'lazy';
            cover.alt = item.desc || '';
            cover.src = item.coverUrl || '';
            coverWrap.appendChild(cover);

            if (item.isHorizontal === false) {
                const badge = document.createElement('span');
                badge.className = 'space-badge';
                badge.textContent = '竖屏';
                coverWrap.appendChild(badge);
            }

            const duration = document.createElement('span');
            duration.className = 'space-duration';
            duration.textContent = window.videoPlayer?.formatTime(item.duration || 0) || '00:00';
            coverWrap.appendChild(duration);

            const body = document.createElement('div');
            body.className = 'space-card-body';

            const desc = document.createElement('span');
            desc.className = 'space-card-desc';
            desc.textContent = item.desc || '无标题作品';

            const stats = document.createElement('span');
            stats.className = 'space-card-stats';

            const likes = document.createElement('span');
            likes.textContent = `❤ ${this.formatNumber(item.stats?.diggCount || 0)}`;

            const quality = document.createElement('span');
            quality.textContent = item.qualityLabel || '1080P';

            stats.append(likes, quality);
            body.append(desc, stats);
            card.append(coverWrap, body);
            this.grid.appendChild(card);
        });
    }

    formatNumber(n) {
        n = Number(n) || 0;
        if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿';
        if (n >= 10000) return (n / 10000).toFixed(1) + '万';
        return String(n);
    }
}

window.spaceView = new SpaceController();