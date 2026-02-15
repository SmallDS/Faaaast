
// 全局 Settings 模块
const Settings = {
    isOpen: false,
    activeTab: 'account',

    init() {
        this.renderModal();
        this.bindEvents();
    },

    bindEvents() {
        // 绑定打开按钮
        const settingsBtn = document.querySelector('button[onclick*="settings"]');
        if (settingsBtn) {
            settingsBtn.onclick = (e) => {
                e.preventDefault();
                this.open();
            };
        } else {
            // 尝试找 material icon
            const btns = document.querySelectorAll('button');
            btns.forEach(btn => {
                if (btn.innerText.includes('settings')) {
                    btn.onclick = () => this.open();
                }
            });
        }
    },

    open() {
        this.isOpen = true;
        document.getElementById('settingsModal').classList.remove('hidden');
        this.loadTab(this.activeTab);
    },

    close() {
        this.isOpen = false;
        document.getElementById('settingsModal').classList.add('hidden');
    },

    switchTab(tab) {
        this.activeTab = tab;
        // 更新 UI active 状态
        document.querySelectorAll('.settings-tab-btn').forEach(btn => {
            if (btn.dataset.tab === tab) {
                btn.classList.add('bg-slate-700', 'text-white');
                btn.classList.remove('text-slate-400', 'hover:text-white');
            } else {
                btn.classList.remove('bg-slate-700', 'text-white');
                btn.classList.add('text-slate-400', 'hover:text-white');
            }
        });
        this.loadTab(tab);
    },

    async loadTab(tab) {
        const container = document.getElementById('settingsContent');
        container.innerHTML = '<div class="text-center text-slate-500 py-10">加载中...</div>';

        if (tab === 'account') {
            await this.renderAccount(container);
        } else if (tab === 'wordbooks') {
            await this.renderWordbooks(container);
        }
    },

    async renderAccount(container) {
        try {
            const res = await fetch('/api/auth/me');
            const user = await res.json();

            container.innerHTML = `
                <form id="profileForm" class="space-y-4">
                    <div>
                        <label class="block text-sm text-slate-400 mb-1">用户名</label>
                        <input type="text" name="username" value="${user.username}" required
                            class="w-full bg-surface-dark border border-slate-700 rounded-lg px-4 py-2 text-white focus:border-primary outline-none transition-colors">
                    </div>
                    <div>
                        <label class="block text-sm text-slate-400 mb-1">新密码 <span class="text-xs text-slate-500">(留空则不修改)</span></label>
                        <input type="password" name="password" placeholder="至少6位"
                            class="w-full bg-surface-dark border border-slate-700 rounded-lg px-4 py-2 text-white focus:border-primary outline-none transition-colors">
                    </div>
                    <div class="pt-2">
                        <button type="submit" 
                            class="w-full bg-primary hover:brightness-110 text-white font-medium py-2.5 rounded-lg shadow-lg shadow-primary/20 transition-all active:scale-[0.98]">
                            保存修改
                        </button>
                    </div>
                </form>
            `;

            document.getElementById('profileForm').onsubmit = async (e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                const data = Object.fromEntries(formData);
                if (!data.password) delete data.password;

                try {
                    const res = await fetch('/api/auth/profile', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                    });
                    const result = await res.json();
                    if (res.ok) {
                        alert('保存成功');
                        if (data.username !== user.username) {
                            // 如果改名了，刷新页面或更新显示
                            location.reload();
                        }
                    } else {
                        alert(result.error);
                    }
                } catch (err) {
                    alert('操作失败');
                }
            };

        } catch (e) {
            container.innerHTML = '<div class="text-rose-400">加载失败</div>';
        }
    },

    async renderWordbooks(container) {
        // 使用 window.allWordbooks (Dashboard 中已加载) 或重新获取
        let books = window.allWordbooks;

        if (!books) {
            const res = await fetch('/api/wordbooks');
            books = await res.json();
            window.allWordbooks = books; // 更新缓存
        }

        if (books.length === 0) {
            container.innerHTML = '<div class="text-center text-slate-500 py-10">暂无词书</div>';
            return;
        }

        let html = '<div class="space-y-3 max-h-[400px] overflow-y-auto pr-2">';

        books.forEach(book => {
            const isOwner = book.role === 'owner';

            html += `
                <div class="bg-surface-dark p-4 rounded-xl border border-white/5 flex items-center justify-between">
                    <div class="flex-1 min-w-0 mr-4">
                        <div class="font-medium text-white truncate flex items-center gap-2">
                            ${book.name}
                            ${!isOwner ? '<span class="text-[10px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded">订阅</span>' : ''}
                        </div>
                        <div class="text-xs text-slate-500 mt-0.5">${book.total_words} 词 • 可见性: ${book.is_public ? '公开' : '私有'}</div>
                    </div>
                    <div class="flex items-center gap-2">
                        ${isOwner ? `
                            <button onclick="Settings.renameBook(${book.id}, '${book.name}')" 
                                class="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors" title="重命名">
                                <span class="material-icons-round text-base">edit</span>
                            </button>
                        ` : ''}
                        <button onclick="Settings.deleteBook(${book.id}, ${isOwner}, '${book.name}')" 
                            class="p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-400/10 rounded-lg transition-colors" title="删除">
                            <span class="material-icons-round text-base">delete</span>
                        </button>
                    </div>
                </div>
            `;
        });

        html += '</div>';

        // Add Reset Current Button
        /*
        if (window.currentWordbook) {
             html += `
                <div class="mt-6 pt-6 border-t border-slate-700">
                    <h4 class="text-sm font-medium text-slate-300 mb-3">当前学习进度</h4>
                    <button onclick="Settings.resetCurrent()" 
                        class="w-full py-2.5 border border-rose-500/30 text-rose-400 rounded-lg hover:bg-rose-500/10 transition-colors text-sm font-medium">
                        重置当前词书进度
                    </button>
                </div>
             `;
        }
        */

        container.innerHTML = html;
    },

    async renameBook(id, oldName) {
        const newName = prompt('请输入新名称:', oldName);
        if (newName && newName !== oldName) {
            try {
                const res = await fetch(`/api/wordbooks/${id}/rename`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: newName })
                });
                if (res.ok) {
                    // 刷新
                    window.allWordbooks = null; // 清缓存
                    this.loadTab('wordbooks');
                    loadData(); // 刷新 Dashboard
                } else {
                    alert('命名失败');
                }
            } catch (e) {
                alert('系统错误');
            }
        }
    },

    async deleteBook(id, isOwner, name) {
        const msg = isOwner
            ? `确定要永久删除词书 "${name}" 吗？\n删除后无法恢复！`
            : `确定要取消订阅 "${name}" 吗？`;

        if (confirm(msg)) {
            try {
                const res = await fetch(`/api/wordbooks/${id}`, { method: 'DELETE' });
                if (res.ok) {
                    window.allWordbooks = null;
                    this.loadTab('wordbooks');

                    // 如果删除了当前正在学的书
                    if (window.currentWordbook && window.currentWordbook.id === id) {
                        window.currentWordbook = null;
                    }
                    loadData(); // Dashboard 刷新
                } else {
                    alert('删除失败');
                }
            } catch (e) {
                alert('系统错误');
            }
        }
    },

    async resetCurrent() {
        if (window.currentWordbook) {
            if (confirm('确定要重置当前词书的所有进度吗？此操作无法撤销。')) {
                try {
                    const res = await fetch(`/api/wordbooks/${window.currentWordbook.id}/reset`, { method: 'POST' });
                    if (res.ok) {
                        alert('进度已重置');
                        window.allWordbooks = null;
                        this.loadTab('wordbooks');
                        if (typeof loadData === 'function') loadData();
                    } else {
                        alert('重置失败');
                    }
                } catch (e) {
                    alert('系统错误');
                }
            }
        }
    },

    renderModal() {
        const div = document.createElement('div');
        div.id = 'settingsModal';
        div.className = 'hidden fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50';
        div.innerHTML = `
            <div class="bg-card-dark rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
                <div class="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-surface-dark">
                    <h3 class="text-lg font-bold">设置</h3>
                    <button onclick="Settings.close()" class="text-slate-400 hover:text-white">
                        <span class="material-icons-round">close</span>
                    </button>
                </div>
                
                <div class="flex p-2 gap-2 border-b border-white/5 bg-background-dark/50">
                    <button onclick="Settings.switchTab('account')" data-tab="account"
                        class="settings-tab-btn flex-1 py-2 rounded-lg text-sm font-medium transition-colors bg-slate-700 text-white">
                        账户
                    </button>
                    <button onclick="Settings.switchTab('wordbooks')" data-tab="wordbooks"
                        class="settings-tab-btn flex-1 py-2 rounded-lg text-sm font-medium transition-colors text-slate-400 hover:text-white">
                        词书管理
                    </button>
                </div>

                <div id="settingsContent" class="p-6 overflow-y-auto flex-1 bg-card-dark">
                    <!-- Dynamic Content -->
                </div>
            </div>
        `;
        document.body.appendChild(div);
    }
};

// 立即初始化
Settings.init();
