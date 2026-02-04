document.addEventListener('DOMContentLoaded', async () => {
    // 状态管理
    const state = {
        users: [],
        wordbooks: [],
        currentTab: 'dashboard'
    };

    // 1. 检查权限
    try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) throw new Error('未授权');
        const user = await res.json();
        if (user.role !== 'admin') {
            alert('您不是管理员，无权访问');
            window.location.href = '/dashboard';
            return;
        }
        document.getElementById('admin-username').textContent = user.username;
    } catch (e) {
        window.location.href = '/';
        return;
    }

    // 2. 导航逻辑
    const navItems = document.querySelectorAll('.nav-item[data-tab]');
    const pageTitle = document.getElementById('page-title');
    const contentArea = document.getElementById('content-area');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();

            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            const tab = item.dataset.tab;
            loadTab(tab);
        });
    });

    // 默认加载概览
    loadTab('dashboard');

    // 退出登录
    document.getElementById('logout-btn').addEventListener('click', async () => {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/';
    });

    // 3. 页面加载器
    async function loadTab(tab) {
        state.currentTab = tab;
        contentArea.innerHTML = '<div class="loading">加载中...</div>';

        switch (tab) {
            case 'dashboard':
                pageTitle.textContent = '系统概览';
                await renderDashboard();
                break;
            case 'users':
                pageTitle.textContent = '用户管理';
                await renderUsers();
                break;
            case 'wordbooks':
                pageTitle.textContent = '词书管理';
                await renderWordbooks();
                break;
        }
    }

    // --- 渲染函数 ---

    async function renderDashboard() {
        try {
            const res = await fetch('/api/admin/stats');
            const stats = await res.json();

            contentArea.innerHTML = `
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-title">总用户数</div>
                        <div class="stat-value">${stats.userCount}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-title">词书总数</div>
                        <div class="stat-value">${stats.wordbookCount}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-title">总单词量</div>
                        <div class="stat-value">${stats.wordCount}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-title">刷词总记录</div>
                        <div class="stat-value">${stats.progressCount}</div>
                    </div>
                </div>
            `;
        } catch (e) {
            contentArea.innerHTML = `<p class="error">加载失败: ${e.message}</p>`;
        }
    }

    async function renderUsers() {
        try {
            // 首次加载或刷新数据
            const res = await fetch('/api/admin/users');
            state.users = await res.json();

            displayUsers(state.users);
        } catch (e) {
            contentArea.innerHTML = `<p class="error">加载失败</p>`;
        }
    }

    function displayUsers(users) {
        let html = `
            <div class="search-bar">
                <input type="text" id="userCearchInput" class="search-input" placeholder="搜索用户名..." oninput="filterUsers(this.value)">
            </div>
            <div class="table-container">
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>用户名</th>
                            <th>角色</th>
                            <th>注册时间</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody id="usersTableBody">
        `;

        if (users.length === 0) {
            html += `<tr><td colspan="5" style="text-align:center;color:#999;padding:30px;">无数据</td></tr>`;
        } else {
            users.forEach(user => {
                const date = new Date(user.created_at).toLocaleString();
                const roleTag = `<span class="tag ${user.role === 'admin' ? 'tag-admin' : 'tag-user'}">${user.role}</span>`;

                html += `
                    <tr>
                        <td>#${user.id}</td>
                        <td>${user.username}</td>
                        <td>${roleTag}</td>
                        <td>${date}</td>
                        <td>
                            <button class="btn-sm" onclick="resetPassword(${user.id})">重置密码</button>
                            ${user.role !== 'admin' ? `<button class="btn-sm btn-danger" onclick="deleteUser(${user.id})">删除</button>` : ''}
                        </td>
                    </tr>
                `;
            });
        }

        html += `</tbody></table></div>`;
        contentArea.innerHTML = html;

        // 重新绑定输入框焦点(简单重绘会导致失焦，这里使用 innerHTML 简单处理，更佳是 DOM diff)
        // 实际上 filterUsers 更新 tbody 内容即可
    }

    window.filterUsers = (query) => {
        const filtered = state.users.filter(u => u.username.toLowerCase().includes(query.toLowerCase()));
        const tbody = document.getElementById('usersTableBody');
        if (!tbody) return; // tab changed

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#999;padding:30px;">无匹配用户</td></tr>`;
            return;
        }

        tbody.innerHTML = filtered.map(user => {
            const date = new Date(user.created_at).toLocaleString();
            const roleTag = `<span class="tag ${user.role === 'admin' ? 'tag-admin' : 'tag-user'}">${user.role}</span>`;
            return `
                <tr>
                    <td>#${user.id}</td>
                    <td>${user.username}</td>
                    <td>${roleTag}</td>
                    <td>${date}</td>
                    <td>
                        <button class="btn-sm" onclick="resetPassword(${user.id})">重置密码</button>
                        ${user.role !== 'admin' ? `<button class="btn-sm btn-danger" onclick="deleteUser(${user.id})">删除</button>` : ''}
                    </td>
                </tr>
            `;
        }).join('');
    };

    async function renderWordbooks() {
        try {
            const res = await fetch('/api/admin/wordbooks');
            state.wordbooks = await res.json();
            displayWordbooks(state.wordbooks);
        } catch (e) {
            contentArea.innerHTML = `<p class="error">加载失败</p>`;
        }
    }

    function displayWordbooks(books) {
        let html = `
            <div class="search-bar">
                 <input type="text" id="bookSearchInput" class="search-input" placeholder="搜索词书名称或作者..." oninput="filterBooks(this.value)">
            </div>
            <div class="table-container">
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>名称</th>
                            <th>创建者</th>
                            <th>词数</th>
                            <th>公开状态</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody id="booksTableBody">
        `;

        if (books.length === 0) {
            html += `<tr><td colspan="6" style="text-align:center;color:#999;padding:30px;">无数据</td></tr>`;
        } else {
            html += renderBooksRows(books);
        }

        html += `</tbody></table></div>`;
        contentArea.innerHTML = html;
    }

    function renderBooksRows(books) {
        return books.map(book => `
            <tr>
                <td>#${book.id}</td>
                <td>${book.name}</td>
                <td>${book.creator_name}</td>
                <td>${book.total_words}</td>
                <td>
                    <label class="btn-switch">
                        <input type="checkbox" ${book.is_public ? 'checked' : ''} onchange="togglePublic(${book.id}, this.checked)">
                        <span class="slider"></span>
                    </label>
                </td>
                <td>
                    <button class="btn-sm btn-danger" onclick="deleteWordbook(${book.id})">删除</button>
                </td>
            </tr>
        `).join('');
    }

    window.filterBooks = (query) => {
        const q = query.toLowerCase();
        const filtered = state.wordbooks.filter(b =>
            b.name.toLowerCase().includes(q) ||
            b.creator_name.toLowerCase().includes(q)
        );
        const tbody = document.getElementById('booksTableBody');
        if (!tbody) return;

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#999;padding:30px;">无匹配词书</td></tr>`;
        } else {
            tbody.innerHTML = renderBooksRows(filtered);
        }
    }

    // --- 全局操作函数 ---

    window.resetPassword = async (id) => {
        if (!confirm('确定要将该用户密码重置为 "password123" 吗？')) return;
        try {
            const res = await fetch(`/api/admin/users/${id}/reset`, { method: 'POST' });
            const data = await res.json();
            if (data.success) alert(data.message);
            else alert(data.error);
        } catch (e) {
            alert('操作失败');
        }
    };

    window.deleteUser = async (id) => {
        if (!confirm('危险！删除用户将连带删除其所有数据，确定继续？')) return;
        try {
            const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
            if (res.ok) {
                alert('用户已删除');
                loadTab('users'); // 刷新
            } else {
                alert('删除失败');
            }
        } catch (e) {
            alert('操作失败');
        }
    };

    window.togglePublic = async (id, isPublic) => {
        try {
            await fetch('/api/admin/toggle-public', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ wordbookId: id, isPublic })
            });
            // Update local state
            const book = state.wordbooks.find(b => b.id === id);
            if (book) book.is_public = isPublic ? 1 : 0;
        } catch (e) {
            alert('操作失败');
        }
    };

    window.deleteWordbook = async (id) => {
        if (!confirm('确定删除该词书吗？')) return;
        try {
            const res = await fetch(`/api/admin/wordbooks/${id}`, { method: 'DELETE' });
            if (res.ok) {
                loadTab('wordbooks');
            } else {
                alert('删除失败');
            }
        } catch (e) {
            alert('操作失败');
        }
    };
});
