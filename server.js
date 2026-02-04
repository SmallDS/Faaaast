const express = require('express');
const session = require('express-session');
const path = require('path');
const multer = require('multer');
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

        // 创建词书
        const result = run('INSERT INTO wordbooks (user_id, name, total_words) VALUES (?, ?, ?)',
            [req.session.userId, bookName, words.length]);
        const wordbookId = result.lastInsertRowid;

        // 批量插入单词
        batchInsert(wordbookId, words);

        res.json({ success: true, wordbookId, wordCount: words.length });
    } catch (error) {
        console.error('上传词书错误:', error);
        res.status(500).json({ error: '解析TXT文件失败' });
    }
});

// 获取用户的词书列表
app.get('/api/wordbooks', requireAuth, (req, res) => {
    const wordbooks = all(`
        SELECT wb.*, 
               (SELECT COUNT(*) FROM user_progress up 
                JOIN words w ON up.word_id = w.id 
                WHERE w.wordbook_id = wb.id AND up.user_id = ? AND up.known = 1) as learned_count
        FROM wordbooks wb 
        WHERE wb.user_id = ? 
        ORDER BY wb.created_at DESC
    `, [req.session.userId, req.session.userId]);

    res.json(wordbooks);
});

// 获取当前词书信息
app.get('/api/wordbooks/:id', requireAuth, (req, res) => {
    const wordbook = get(`
        SELECT wb.*, 
               (SELECT COUNT(*) FROM user_progress up 
                JOIN words w ON up.word_id = w.id 
                WHERE w.wordbook_id = wb.id AND up.user_id = ? AND up.known = 1) as learned_count
        FROM wordbooks wb 
        WHERE wb.id = ? AND wb.user_id = ?
    `, [req.session.userId, req.params.id, req.session.userId]);

    if (!wordbook) {
        return res.status(404).json({ error: '词书不存在' });
    }
    res.json(wordbook);
});

// 重置词书进度
app.post('/api/wordbooks/:id/reset', requireAuth, (req, res) => {
    const wordbookId = req.params.id;

    // 验证词书归属
    const wordbook = get('SELECT id FROM wordbooks WHERE id = ? AND user_id = ?', [wordbookId, req.session.userId]);
    if (!wordbook) {
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

// ==================== 刷词API ====================
// 获取下一个待刷单词
app.get('/api/study/next', requireAuth, (req, res) => {
    const wordbookId = parseInt(req.query.wordbookId, 10);

    console.log('===== 刷词请求 =====');
    console.log('用户ID:', req.session.userId, '词书ID:', wordbookId);

    // 查询words表总数
    const totalInTable = get('SELECT COUNT(*) as count FROM words', []);
    console.log('words表总记录数:', totalInTable?.count);

    // 查询该词书的单词
    const allWords = all('SELECT * FROM words WHERE wordbook_id = ? ORDER BY order_index', [wordbookId]);
    console.log('该词书单词数:', allWords.length);

    if (allWords.length === 0) {
        console.log('词书为空，返回completed');
        return res.json({ completed: true });
    }

    // 获取已交互的单词ID（无论认识还是不认识，只要交互过就不再作为新词出现）
    const learnedWords = all('SELECT word_id FROM user_progress WHERE user_id = ?', [req.session.userId]);
    const learnedIdSet = new Set(learnedWords.map(r => r.word_id));
    console.log('已交互单词数:', learnedIdSet.size);

    // 找第一个未掌握的单词
    const word = allWords.find(w => !learnedIdSet.has(w.id));

    if (!word) {
        console.log('所有单词已掌握');
        return res.json({ completed: true });
    }

    console.log('下一个单词:', word.word);

    res.json({
        word,
        progress: {
            current: learnedIdSet.size + 1,
            total: allWords.length
        }
    });
});

// 标记单词为认识
app.post('/api/study/known', requireAuth, (req, res) => {
    const { wordId } = req.body;

    // 先检查是否存在
    const existing = get('SELECT id FROM user_progress WHERE user_id = ? AND word_id = ?',
        [req.session.userId, wordId]);

    if (existing) {
        run('UPDATE user_progress SET known = 1, last_reviewed = datetime("now") WHERE user_id = ? AND word_id = ?',
            [req.session.userId, wordId]);
    } else {
        run('INSERT INTO user_progress (user_id, word_id, known, last_reviewed) VALUES (?, ?, 1, datetime("now"))',
            [req.session.userId, wordId]);
    }

    res.json({ success: true });
});

// 标记单词为不认识（加入错词本）
app.post('/api/study/unknown', requireAuth, (req, res) => {
    const { wordId } = req.body;

    // 更新进度
    const existing = get('SELECT id FROM user_progress WHERE user_id = ? AND word_id = ?',
        [req.session.userId, wordId]);

    if (existing) {
        run('UPDATE user_progress SET known = 0, last_reviewed = datetime("now") WHERE user_id = ? AND word_id = ?',
            [req.session.userId, wordId]);
    } else {
        run('INSERT INTO user_progress (user_id, word_id, known, last_reviewed) VALUES (?, ?, 0, datetime("now"))',
            [req.session.userId, wordId]);
    }

    // 加入错词本（忽略重复）
    const existingMistake = get('SELECT id FROM mistakes WHERE user_id = ? AND word_id = ?',
        [req.session.userId, wordId]);
    if (!existingMistake) {
        run('INSERT INTO mistakes (user_id, word_id) VALUES (?, ?)',
            [req.session.userId, wordId]);
    }

    res.json({ success: true });
});

// ==================== 错词本API ====================

// 获取错词列表
app.get('/api/mistakes', requireAuth, (req, res) => {
    const mistakes = all(`
        SELECT w.*, m.added_at 
        FROM mistakes m 
        JOIN words w ON m.word_id = w.id 
        WHERE m.user_id = ? 
        ORDER BY m.added_at DESC
    `, [req.session.userId]);

    res.json(mistakes);
});

// 获取错词数量
app.get('/api/mistakes/count', requireAuth, (req, res) => {
    const count = get('SELECT COUNT(*) as count FROM mistakes WHERE user_id = ?',
        [req.session.userId]);
    res.json(count || { count: 0 });
});

// 刷错词 - 获取下一个错词
app.get('/api/mistakes/next', requireAuth, (req, res) => {
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

    const count = get('SELECT COUNT(*) as count FROM mistakes WHERE user_id = ?',
        [req.session.userId]);

    res.json({ word: mistake, remaining: count?.count || 0 });
});

// 刷错词 - 标记为认识（从错词本移除）
app.post('/api/mistakes/known', requireAuth, (req, res) => {
    const { wordId } = req.body;

    run('DELETE FROM mistakes WHERE user_id = ? AND word_id = ?',
        [req.session.userId, wordId]);

    // 同时标记为已掌握
    const existing = get('SELECT id FROM user_progress WHERE user_id = ? AND word_id = ?',
        [req.session.userId, wordId]);

    if (existing) {
        run('UPDATE user_progress SET known = 1, last_reviewed = datetime("now") WHERE user_id = ? AND word_id = ?',
            [req.session.userId, wordId]);
    } else {
        run('INSERT INTO user_progress (user_id, word_id, known, last_reviewed) VALUES (?, ?, 1, datetime("now"))',
            [req.session.userId, wordId]);
    }

    res.json({ success: true });
});

// 刷错词 - 跳过本轮（保留在错词本，但移到队列末尾）
app.post('/api/mistakes/skip', requireAuth, (req, res) => {
    const { wordId } = req.body;

    // 更新added_at为当前时间，使其排到末尾
    run('UPDATE mistakes SET added_at = datetime("now") WHERE user_id = ? AND word_id = ?',
        [req.session.userId, wordId]);

    res.json({ success: true });
});

// ==================== 统计API ====================

// 获取学习统计
app.get('/api/stats', requireAuth, (req, res) => {
    const learned = get('SELECT COUNT(*) as count FROM user_progress WHERE user_id = ? AND known = 1',
        [req.session.userId]);
    const mistakes = get('SELECT COUNT(*) as count FROM mistakes WHERE user_id = ?',
        [req.session.userId]);

    res.json({
        total_learned: learned?.count || 0,
        total_mistakes: mistakes?.count || 0
    });
});

// ==================== 词书市场 & 管理API ====================

// 市场：获取公开词书列表
app.get('/api/market', requireAuth, (req, res) => {
    const wordbooks = all(`
        SELECT wb.*, u.username as creator_name 
        FROM wordbooks wb
        JOIN users u ON wb.user_id = u.id
        WHERE wb.is_public = 1
        ORDER BY wb.created_at DESC
    `);
    res.json(wordbooks);
});

// 市场：克隆词书
app.post('/api/market/clone', requireAuth, (req, res) => {
    const { wordbookId } = req.body;

    try {
        // 1. 获取源词书信息
        const sourceBook = get('SELECT * FROM wordbooks WHERE id = ? AND is_public = 1', [wordbookId]);
        if (!sourceBook) {
            return res.status(404).json({ error: '词书不存在或未公开' });
        }

        // 2. 检查是否已经是自己的词书（这里允许克隆自己的，或者加上判定）
        // 这里设计为：即便是自己的公开词书，也可以克隆一份副本

        // 3. 创建新词书
        const newName = `${sourceBook.name} (Copy)`;
        const insertRes = run('INSERT INTO wordbooks (user_id, name, total_words, is_cloned) VALUES (?, ?, ?, 1)',
            [req.session.userId, newName, sourceBook.total_words]);
        const newBookId = insertRes.lastInsertRowid;

        // 4. 获取源单词并批量插入
        const words = all('SELECT word, order_index FROM words WHERE wordbook_id = ?', [wordbookId]);

        // 批量插入单词
        const placeholder = words.map(() => '(?, ?, ?, ?)').join(',');
        const params = [];
        words.forEach(w => {
            params.push(newBookId, w.word, w.order_index);
        });

        // 这里简单处理，如果单词量很大可能需要分批。但目前 limits 是 50 in batchInsert，这里我们手动处理一下
        // 重用 database.js 的 batchInsert 逻辑比较好，但 batchInsert 接收的是对象数组。
        // 这里我们直接用 batchInsert 函数

        // 构造 batchInsert 需要的格式
        const wordsForInsert = words.map(w => ({ word: w.word })); // order_index 会自动生成? 不，这里我们要保持顺序
        // 实际上 database.js 的 batchInsert 会自动处理 order_index。
        // 为了保持原顺序，可能需要修改 batchInsert 或者在这里手动插入。
        // 考虑到 batchInsert 是为了上传文件设计的，这里从数据库复制，手动拼 SQL 更快。

        // 分批插入防止 SQL 过长
        const BATCH_SIZE = 50;
        for (let i = 0; i < words.length; i += BATCH_SIZE) {
            const batch = words.slice(i, i + BATCH_SIZE);
            const placeholders = batch.map(() => '(?, ?, ?)').join(',');
            const batchParams = [];
            batch.forEach(w => {
                batchParams.push(newBookId, w.word, w.order_index);
            });
            run(`INSERT INTO words (wordbook_id, word, order_index) VALUES ${placeholders}`, batchParams);
        }

        res.json({ success: true, message: '获取成功', newBookId });

    } catch (error) {
        console.error('克隆词书失败:', error);
        res.status(500).json({ error: '获取失败' });
    }
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
app.get('/api/dict/:word', async (req, res) => {
    const word = req.params.word;

    try {
        // 使用有道词典的查词接口
        const url = `https://dict.youdao.com/suggest?num=1&ver=3.0&doctype=json&cache=false&le=en&q=${encodeURIComponent(word)}`;

        const response = await fetch(url);
        const data = await response.json();

        // 尝试获取更详细的释义
        const dictUrl = `https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}`;
        const dictRes = await fetch(dictUrl);
        const dictData = await dictRes.json();

        let phonetic = '';
        let translation = [];

        // 获取音标
        if (dictData.ec?.word?.[0]?.usphone) {
            phonetic = `/${dictData.ec.word[0].usphone}/`;
        }

        // 获取中文释义
        if (dictData.ec?.word?.[0]?.trs) {
            translation = dictData.ec.word[0].trs.map(t => t.tr?.[0]?.l?.i?.[0] || '').filter(t => t);
        }

        // 如果没有找到释义，尝试使用简单翻译
        if (translation.length === 0 && dictData.fanyi?.tran) {
            translation = [dictData.fanyi.tran];
        }

        res.json({
            word: word,
            phonetic: phonetic,
            translation: translation
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

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/flashcard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'flashcard.html'));
});

app.get('/mistakes', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'mistakes.html'));
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
