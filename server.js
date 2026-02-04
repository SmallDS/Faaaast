const express = require('express');
const session = require('express-session');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { initDatabase, get, all, run, batchInsert } = require('./db/database');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件配置
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// 会话配置
app.use(session({
    secret: 'flashcard-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7天
    }
}));

// 文件上传配置
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// 认证中间件
const requireAuth = (req, res, next) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: '请先登录' });
    }
    next();
};

// 管理员中间件
const requireAdmin = (req, res, next) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: '请先登录' });
    }
    const user = get('SELECT role FROM users WHERE id = ?', [req.session.userId]);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: '需要管理员权限' });
    }
    next();
};

// ==================== 用户API ====================

// 注册
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: '用户名和密码不能为空' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: '密码至少6位' });
        }

        const existingUser = get('SELECT id FROM users WHERE username = ?', [username]);
        if (existingUser) {
            return res.status(400).json({ error: '用户名已存在' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const result = run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, passwordHash]);

        req.session.userId = result.lastInsertRowid;
        res.json({ success: true, message: '注册成功' });
    } catch (error) {
        console.error('注册错误:', error);
        res.status(500).json({ error: '服务器错误' });
    }
});

// 登录
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = get('SELECT id, password_hash, role FROM users WHERE username = ?', [username]);

        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ error: '用户名或密码错误' });
        }

        req.session.userId = user.id;
        res.json({ success: true, message: '登录成功', role: user.role });
    } catch (error) {
        console.error('登录错误:', error);
        res.status(500).json({ error: '服务器错误' });
    }
});

// 获取用户信息
app.get('/api/auth/me', requireAuth, (req, res) => {
    const user = get('SELECT id, username, role FROM users WHERE id = ?', [req.session.userId]);
    res.json(user);
});

// 更新用户信息
app.post('/api/auth/profile', requireAuth, async (req, res) => {
    try {
        const { username, password } = req.body;
        const userId = req.session.userId;

        // 1. 检查用户名是否重复 (如果改了用户名)
        if (username) {
            const current = get('SELECT username FROM users WHERE id = ?', [userId]);
            if (current.username !== username) {
                const existing = get('SELECT id FROM users WHERE username = ?', [username]);
                if (existing) {
                    return res.status(400).json({ error: '用户名已存在' });
                }
                run('UPDATE users SET username = ? WHERE id = ?', [username, userId]);
            }
        }

        // 2. 更新密码
        if (password) {
            if (password.length < 6) {
                return res.status(400).json({ error: '密码至少6位' });
            }
            const hash = await bcrypt.hash(password, 10);
            run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, userId]);
        }

        res.json({ success: true, message: '个人信息已更新' });
    } catch (e) {
        console.error('更新信息失败:', e);
        res.status(500).json({ error: '更新失败' });
    }
});

// 退出登录
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// 检查登录状态
app.get('/api/check-auth', (req, res) => {
    res.json({ authenticated: !!req.session.userId });
});

// ==================== 词书API ====================

// 上传TXT词书
// 上传TXT词书
app.post('/api/wordbooks/upload', requireAuth, upload.single('txt'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '请上传TXT文件' });
        }

        const bookName = req.body.name || '未命名词书';
        // 读取TXT文件内容
        const textContent = req.file.buffer.toString('utf-8');

        // 解析单词（每行一个单词/词组）
        const words = textContent
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0 && line.length < 100);

        if (words.length === 0) {
            return res.status(400).json({ error: 'TXT文件中未找到有效单词' });
        }

        // 创建词书 (user_id 仍作为 创建者 记录，但权限看 user_wordbooks)
        const result = run('INSERT INTO wordbooks (user_id, name, total_words) VALUES (?, ?, ?)',
            [req.session.userId, bookName, words.length]);
        const wordbookId = result.lastInsertRowid;

        // [Stage 2] 添加所有者关联
        run('INSERT INTO user_wordbooks (user_id, wordbook_id, role) VALUES (?, ?, ?)',
            [req.session.userId, wordbookId, 'owner']);

        // 批量插入单词
        batchInsert(wordbookId, words);

        res.json({ success: true, wordbookId, wordCount: words.length });
    } catch (error) {
        console.error('上传词书错误:', error);
        res.status(500).json({ error: '解析TXT文件失败' });
    }
});

// 获取用户的词书列表 (查询 user_wordbooks)
app.get('/api/wordbooks', requireAuth, (req, res) => {
    try {
        // 联合查询：只查用户订阅/拥有的词书
        // 显式选择 wb.id 确保 ID 正确
        const wordbooks = all(`
            SELECT wb.id, wb.name, wb.total_words, wb.is_public, wb.created_at, 
                   uw.role, uw.joined_at, 
                   (SELECT COUNT(*) FROM user_progress up 
                    JOIN words w ON up.word_id = w.id 
                    WHERE w.wordbook_id = wb.id AND up.user_id = ? AND up.known = 1) as learned_count
            FROM wordbooks wb 
            JOIN user_wordbooks uw ON wb.id = uw.wordbook_id
            WHERE uw.user_id = ? 
            ORDER BY uw.joined_at DESC
        `, [req.session.userId, req.session.userId]);

        console.log(`用户 ${req.session.userId} 获取词书列表，共 ${wordbooks.length} 本`);
        res.json(wordbooks);
    } catch (error) {
        console.error('获取词书列表失败:', error);
        res.status(500).json({ error: '获取失败' });
    }
});

// 获取当前词书信息 (鉴权变更)
app.get('/api/wordbooks/:id', requireAuth, (req, res) => {
    // 检查是否有权访问（在 user_wordbooks 中有记录）
    const wordbook = get(`
        SELECT wb.*, uw.role,
               (SELECT COUNT(*) FROM user_progress up 
                JOIN words w ON up.word_id = w.id 
                WHERE w.wordbook_id = wb.id AND up.user_id = ? AND up.known = 1) as learned_count
        FROM wordbooks wb 
        JOIN user_wordbooks uw ON wb.id = uw.wordbook_id
        WHERE wb.id = ? AND uw.user_id = ?
    `, [req.session.userId, req.params.id, req.session.userId]);

    if (!wordbook) {
        return res.status(404).json({ error: '词书不存在或未添加' });
    }
    res.json(wordbook);
});

// 重置词书进度
app.post('/api/wordbooks/:id/reset', requireAuth, (req, res) => {
    const wordbookId = req.params.id;

    // 验证词书归属/订阅
    const rel = get('SELECT id FROM user_wordbooks WHERE wordbook_id = ? AND user_id = ?',
        [wordbookId, req.session.userId]);
    if (!rel) {
        return res.status(404).json({ error: '词书不存在' });
    }

    try {
        // 删除该词书相关的进度和错词
        run(`DELETE FROM user_progress 
             WHERE user_id = ? AND word_id IN (SELECT id FROM words WHERE wordbook_id = ?)`,
            [req.session.userId, wordbookId]);

        run(`DELETE FROM mistakes 
             WHERE user_id = ? AND word_id IN (SELECT id FROM words WHERE wordbook_id = ?)`,
            [req.session.userId, wordbookId]);

        res.json({ success: true, message: '进度已重置' });
    } catch (error) {
        console.error('重置进度失败:', error);
        res.status(500).json({ error: '重置失败' });
    }
});

// 重命名词书 (仅所有者)
app.post('/api/wordbooks/:id/rename', requireAuth, (req, res) => {
    const wordbookId = req.params.id;
    const { name } = req.body;

    if (!name) return res.status(400).json({ error: '名称不能为空' });

    const rel = get('SELECT role FROM user_wordbooks WHERE wordbook_id = ? AND user_id = ?',
        [wordbookId, req.session.userId]);

    if (!rel || rel.role !== 'owner') {
        return res.status(403).json({ error: '只有创建者可以重命名词书' });
    }

    run('UPDATE wordbooks SET name = ? WHERE id = ?', [name, wordbookId]);
    res.json({ success: true });
});

// 删除词书 (所有者:删除全部; 订阅者:取消订阅)
app.delete('/api/wordbooks/:id', requireAuth, (req, res) => {
    const wordbookId = req.params.id;

    const rel = get('SELECT role FROM user_wordbooks WHERE wordbook_id = ? AND user_id = ?',
        [wordbookId, req.session.userId]);

    if (!rel) {
        return res.status(404).json({ error: '词书不存在' });
    }

    try {
        if (rel.role === 'owner') {
            // 是所有者，物理删除词书 (级联会删除 words, progress 等)
            run('DELETE FROM wordbooks WHERE id = ?', [wordbookId]);
            res.json({ success: true, message: '词书已永久删除' });
        } else {
            // 是订阅者，仅删除关联
            run('DELETE FROM user_wordbooks WHERE wordbook_id = ? AND user_id = ?',
                [wordbookId, req.session.userId]);
            res.json({ success: true, message: '已取消关注该词书' });
        }
    } catch (e) {
        console.error('删除词书失败:', e);
        res.status(500).json({ error: '删除失败' });
    }
});

// ==================== 刷词API ====================
// 获取下一个待刷单词
app.get('/api/study/next', requireAuth, (req, res) => {
    const wordbookId = parseInt(req.query.wordbookId, 10);

    // 1. 鉴权：检查是否订阅/拥有
    const rel = get('SELECT id FROM user_wordbooks WHERE wordbook_id = ? AND user_id = ?',
        [wordbookId, req.session.userId]);
    if (!rel) {
        return res.status(403).json({ error: '未订阅该词书' });
    }

    // 2. 查询总词数
    const totalWords = get('SELECT COUNT(*) as count FROM words WHERE wordbook_id = ?', [wordbookId]).count;

    if (totalWords === 0) {
        return res.json({ completed: true });
    }

    // 3. 获取已学习的单词ID (user_progress 中 known=1 或 known=0 均视为已刷过，但通常我们只过滤 known=1 还是全部？)
    // 逻辑：
    // - known=1: 已掌握 -> 不再出现
    // - known=0: 不认识 -> 存入 mistakes 表，这里不再作为"新词"出现 (除非是复习模式，但这是新词模式)
    // 所以只要在 user_progress 里有记录，就不算新词
    const learnedWords = all('SELECT word_id FROM user_progress WHERE user_id = ?', [req.session.userId]);
    const learnedIdSet = new Set(learnedWords.map(r => r.word_id));

    // 4. 找第一个未学习的单词
    // 性能优化：直接 SQL 排除 (当 user_progress 很大时，NOT IN 可能慢，但目前量级均可)
    // const word = get(`
    //    SELECT * FROM words 
    //    WHERE wordbook_id = ? 
    //      AND id NOT IN (SELECT word_id FROM user_progress WHERE user_id = ?)
    //    ORDER BY order_index ASC LIMIT 1
    // `, [wordbookId, req.session.userId]);
    // 既然用了 Set，且 words 可能几千条，全查出来 filter 内存也够用，且顺序可控
    const allWords = all('SELECT * FROM words WHERE wordbook_id = ? ORDER BY order_index', [wordbookId]);
    const word = allWords.find(w => !learnedIdSet.has(w.id));

    if (!word) {
        return res.json({ completed: true });
    }

    res.json({
        word,
        progress: {
            current: learnedIdSet.size + 1,
            total: totalWords
        }
    });
});

// 标记单词为认识
app.post('/api/study/known', requireAuth, (req, res) => {
    const { wordId } = req.body;

    const existing = get('SELECT id FROM user_progress WHERE user_id = ? AND word_id = ?',
        [req.session.userId, wordId]);

    if (existing) {
        run('UPDATE user_progress SET known = 1, last_reviewed = datetime("now", "localtime") WHERE user_id = ? AND word_id = ?',
            [req.session.userId, wordId]);
    } else {
        run('INSERT INTO user_progress (user_id, word_id, known, last_reviewed) VALUES (?, ?, 1, datetime("now", "localtime"))',
            [req.session.userId, wordId]);
    }

    // 从错词本移除（如果之前不认识）
    run('DELETE FROM mistakes WHERE user_id = ? AND word_id = ?', [req.session.userId, wordId]);

    res.json({ success: true });
});

// 标记单词为不认识（加入错词本）
app.post('/api/study/unknown', requireAuth, (req, res) => {
    const { wordId } = req.body;

    const existing = get('SELECT id FROM user_progress WHERE user_id = ? AND word_id = ?',
        [req.session.userId, wordId]);

    if (existing) {
        run('UPDATE user_progress SET known = 0, last_reviewed = datetime("now", "localtime") WHERE user_id = ? AND word_id = ?',
            [req.session.userId, wordId]);
    } else {
        run('INSERT INTO user_progress (user_id, word_id, known, last_reviewed) VALUES (?, ?, 0, datetime("now", "localtime"))',
            [req.session.userId, wordId]);
    }

    // 加入错词本
    run('INSERT OR IGNORE INTO mistakes (user_id, word_id) VALUES (?, ?)',
        [req.session.userId, wordId]);

    res.json({ success: true });
});

// ==================== 错词本API ====================

app.get('/api/mistakes/count', requireAuth, (req, res) => {
    const count = get('SELECT COUNT(*) as count FROM mistakes WHERE user_id = ?', [req.session.userId]);
    res.json(count || { count: 0 });
});

// 获取错词列表
app.get('/api/mistakes', requireAuth, (req, res) => {
    try {
        const mistakes = all(`
            SELECT w.word, w.id as word_id, m.added_at 
            FROM mistakes m 
            JOIN words w ON m.word_id = w.id 
            WHERE m.user_id = ? 
            ORDER BY m.added_at DESC
        `, [req.session.userId]);
        res.json(mistakes);
    } catch (e) {
        console.error('获取错词列表失败', e);
        res.status(500).json({ error: '获取失败' });
    }
});

// 刷错词 - 获取下一个
app.get('/api/mistakes/next', requireAuth, (req, res) => {
    // 按加入时间排序，最早的先复习
    const mistake = get(`
        SELECT w.*, m.id as mistake_id
        FROM mistakes m 
        JOIN words w ON m.word_id = w.id 
        WHERE m.user_id = ? 
        ORDER BY m.added_at ASC
        LIMIT 1
    `, [req.session.userId]);

    if (!mistake) {
        return res.json({ completed: true });
    }

    const count = get('SELECT COUNT(*) as count FROM mistakes WHERE user_id = ?', [req.session.userId]);
    res.json({ word: mistake, remaining: count?.count || 0 });
});

app.post('/api/mistakes/known', requireAuth, (req, res) => {
    const { wordId } = req.body;
    run('DELETE FROM mistakes WHERE user_id = ? AND word_id = ?', [req.session.userId, wordId]);

    // 更新 progress 为 known
    const existing = get('SELECT id FROM user_progress WHERE user_id = ? AND word_id = ?', [req.session.userId, wordId]);
    if (existing) {
        run('UPDATE user_progress SET known = 1, last_reviewed = datetime("now") WHERE id = ?', [existing.id]);
    }

    res.json({ success: true });
});

app.post('/api/mistakes/skip', requireAuth, (req, res) => {
    const { wordId } = req.body;
    // 更新时间，沉底
    run('UPDATE mistakes SET added_at = datetime("now") WHERE user_id = ? AND word_id = ?',
        [req.session.userId, wordId]);
    res.json({ success: true });
});

// ==================== 统计API ====================
app.get('/api/stats', requireAuth, (req, res) => {
    const learned = get('SELECT COUNT(*) as count FROM user_progress WHERE user_id = ? AND known = 1', [req.session.userId]);
    const mistakes = get('SELECT COUNT(*) as count FROM mistakes WHERE user_id = ?', [req.session.userId]);
    res.json({
        total_learned: learned?.count || 0,
        total_mistakes: mistakes?.count || 0
    });
});

// 市场：获取公开词书列表
// 市场：获取公开词书列表
app.get('/api/market', requireAuth, (req, res) => {
    try {
        const books = all(`
            SELECT wb.id, wb.name, wb.total_words, wb.created_at, u.username as creator_name,
                   (SELECT COUNT(*) FROM user_wordbooks uw WHERE uw.wordbook_id = wb.id AND uw.user_id = ?) as has_added
            FROM wordbooks wb
            JOIN users u ON wb.user_id = u.id
            WHERE wb.is_public = 1 AND wb.is_cloned = 0
            ORDER BY wb.created_at DESC
        `, [req.session.userId]);
        res.json(books);
    } catch (error) {
        console.error('获取市场词书失败:', error);
        res.status(500).json({ error: '获取失败' });
    }
});

// 市场：克隆词书 -> 改为 [订阅词书]
app.post('/api/market/clone', requireAuth, (req, res) => {
    const { wordbookId } = req.body;

    try {
        // 1. 检查是否已经订阅/拥有
        const existing = get('SELECT id FROM user_wordbooks WHERE user_id = ? AND wordbook_id = ?',
            [req.session.userId, wordbookId]);

        if (existing) {
            return res.status(400).json({ error: '您已经添加过该词书了' });
        }

        // 2. 验证源词书存在且公开
        const sourceBook = get('SELECT id FROM wordbooks WHERE id = ? AND is_public = 1', [wordbookId]);
        if (!sourceBook) {
            return res.status(404).json({ error: '词书不存在或未公开' });
        }

        // 3. [Stage 2] 建立订阅关系 (不在复制单词!)
        run('INSERT INTO user_wordbooks (user_id, wordbook_id, role) VALUES (?, ?, ?)',
            [req.session.userId, wordbookId, 'subscriber']);

        res.json({ success: true, message: '已添加到我的词书', newBookId: wordbookId });

    } catch (error) {
        console.error('订阅词书失败:', error);
        res.status(500).json({ error: '添加失败' });
    }
});

// 管理员：统计数据
app.get('/api/admin/stats', requireAdmin, (req, res) => {
    const userCount = get('SELECT COUNT(*) as count FROM users').count;
    const wordbookCount = get('SELECT COUNT(*) as count FROM wordbooks').count;
    const wordCount = get('SELECT COUNT(*) as count FROM words').count;
    const progressCount = get('SELECT COUNT(*) as count FROM user_progress').count;

    res.json({
        userCount,
        wordbookCount,
        wordCount,
        progressCount
    });
});

// 管理员：获取用户列表
app.get('/api/admin/users', requireAdmin, (req, res) => {
    const users = all('SELECT id, username, role, created_at FROM users ORDER BY created_at DESC');
    res.json(users);
});

// 管理员：重置用户密码
app.post('/api/admin/users/:id/reset', requireAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        const newPassword = 'password123'; // 默认重置密码
        const hash = await bcrypt.hash(newPassword, 10);

        run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, userId]);
        res.json({ success: true, message: `密码已重置为: ${newPassword}` });
    } catch (e) {
        res.status(500).json({ error: '重置失败' });
    }
});

// 管理员：删除用户
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
    const userId = req.params.id;
    if (userId == req.session.userId) {
        return res.status(400).json({ error: '不能删除自己' });
    }

    // 级联删除会处理相关数据，但为了保险可以手动清理，这里依赖外键级联
    run('DELETE FROM users WHERE id = ?', [userId]);
    res.json({ success: true });
});

// 管理员：删除词书 (物理删除)
app.delete('/api/admin/wordbooks/:id', requireAdmin, (req, res) => {
    const bookId = req.params.id;
    run('DELETE FROM wordbooks WHERE id = ?', [bookId]);
    res.json({ success: true });
});

// 管理员：获取所有词书（排除克隆的）
app.get('/api/admin/wordbooks', requireAdmin, (req, res) => {
    const wordbooks = all(`
        SELECT wb.*, u.username as creator_name 
        FROM wordbooks wb
        JOIN users u ON wb.user_id = u.id
        WHERE wb.is_cloned = 0
        ORDER BY wb.created_at DESC
    `);
    res.json(wordbooks);
});

// 管理员：切换公开状态
app.post('/api/admin/toggle-public', requireAdmin, (req, res) => {
    const { wordbookId, isPublic } = req.body;
    run('UPDATE wordbooks SET is_public = ? WHERE id = ?', [isPublic ? 1 : 0, wordbookId]);
    res.json({ success: true });
});

// 词典API

// 有道词典查词（中文释义）
// 辅助函数：下载音频
async function downloadAudio(word, url) {
    if (!url) return null;

    try {
        const audioDir = path.join(__dirname, 'public', 'audio');
        if (!fs.existsSync(audioDir)) {
            fs.mkdirSync(audioDir, { recursive: true });
        }

        const fileName = `${word}.mp3`;
        const filePath = path.join(audioDir, fileName);

        // 如果文件已存在，直接返回相对路径
        if (fs.existsSync(filePath)) {
            return `/audio/${fileName}`;
        }

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        if (!response.ok) {
            console.error(`下载失败: ${url}, status: ${response.status}`);
            return null;
        }

        const buffer = await response.arrayBuffer();
        fs.writeFileSync(filePath, Buffer.from(buffer));

        return `/audio/${fileName}`;
    } catch (error) {
        console.error('音频下载失败:', error);
        return null;
    }
}

// 词典查询（优先查本地缓存 -> 有道API + 音频下载）
app.get('/api/dict/:word', async (req, res) => {
    const word = req.params.word.toLowerCase(); // 统一小写

    try {
        // 1. 查本地缓存
        const cached = get('SELECT * FROM dictionary WHERE word = ?', [word]);

        // 检查音频文件是否物理存在（有时缓存有记录但文件被删）
        let audioValid = false;
        if (cached && cached.audio_path) {
            const absPath = path.join(__dirname, 'public', cached.audio_path);
            if (fs.existsSync(absPath)) {
                audioValid = true;
            }
        }

        if (cached && audioValid) {
            console.log(`词典缓存命中: ${word}`);
            return res.json({
                word: cached.word,
                phonetic: cached.phonetic,
                translation: JSON.parse(cached.translation),
                audio: cached.audio_path
            });
        }

        // 2. 调用有道 API
        console.log(`词典缓存未命中，调用API: ${word}`);

        // 简明释义 + 详细释义
        const suggestUrl = `https://dict.youdao.com/suggest?num=1&ver=3.0&doctype=json&cache=false&le=en&q=${encodeURIComponent(word)}`;
        const dictUrl = `https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}`;

        const [suggestRes, dictRes] = await Promise.all([
            fetch(suggestUrl).then(r => r.json()),
            fetch(dictUrl).then(r => r.json())
        ]);

        let phonetic = '';
        let translation = [];
        let audioUrl = '';

        // 解析音标
        if (dictRes.ec?.word?.[0]?.usphone) {
            phonetic = `/${dictRes.ec.word[0].usphone}/`;
        } else if (dictRes.simple?.word?.[0]?.phone) {
            phonetic = `/${dictRes.simple.word[0].phone}/`;
        }

        // 解析释义
        if (dictRes.ec?.word?.[0]?.trs) {
            translation = dictRes.ec.word[0].trs.map(t => t.tr?.[0]?.l?.i?.[0] || '').filter(t => t);
        }
        if (translation.length === 0 && dictRes.fanyi?.tran) {
            translation = [dictRes.fanyi.tran];
        }

        // 解析发音 URL (优先美音 type=2)
        // 有道 API 通常不直接返回 mp3 url，而是通过 dictvoice 接口
        // 我们直接构建官方发音链接
        audioUrl = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=2`;

        // 3. 下载音频到本地
        const localAudioPath = await downloadAudio(word, audioUrl);

        // 4. 存入数据库
        // 如果已存在（可能是音频丢失导致没命中），则更新；否则插入
        // 为简单起见，使用 REPLACE INTO 或者先删后插
        run('DELETE FROM dictionary WHERE word = ?', [word]);

        run(`INSERT INTO dictionary (word, phonetic, translation, audio_path, updated_at) 
             VALUES (?, ?, ?, ?, datetime('now'))`,
            [word, phonetic, JSON.stringify(translation), localAudioPath]);

        res.json({
            word: word,
            phonetic: phonetic,
            translation: translation,
            audio: localAudioPath
        });

    } catch (error) {
        console.error('词典查询错误:', error);
        res.status(500).json({ error: '词典查询失败' });
    }
});

// 页面路由
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/flashcard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'flashcard.html'));
});

app.get('/mistakes', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'mistakes.html'));
});

app.get('/mistake_review', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'mistake_flashcard.html'));
});

app.get('/preview', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'wordbook_preview.html'));
});

// 获取词书的单词列表（预览用）
app.get('/api/wordbooks/:id/words', requireAuth, (req, res) => {
    const wordbookId = req.params.id;
    // 检查权限：公开的或者是自己的
    const book = get('SELECT id, is_public, user_id FROM wordbooks WHERE id = ?', [wordbookId]);
    if (!book) return res.status(404).json({ error: '词书不存在' });

    // 如果是私有且不是自己的
    if (!book.is_public && book.user_id !== req.session.userId) {
        // 检查是否订阅了
        const sub = get('SELECT id FROM user_wordbooks WHERE user_id = ? AND wordbook_id = ?', [req.session.userId, wordbookId]);
        if (!sub) return res.status(403).json({ error: '无权查看' });
    }

    const words = all('SELECT word, id FROM words WHERE wordbook_id = ? ORDER BY order_index ASC', [wordbookId]);
    res.json({ words });
});

// 初始化数据库并启动服务器
initDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 服务器运行在 http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('数据库初始化失败:', err);
    process.exit(1);
});
