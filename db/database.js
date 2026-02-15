const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'flashcard.db');
let db = null;

// 初始化数据库
async function initDatabase() {
    const SQL = await initSqlJs();

    // 尝试加载现有数据库
    if (fs.existsSync(dbPath)) {
        const fileBuffer = fs.readFileSync(dbPath);
        db = new SQL.Database(fileBuffer);
    } else {
        db = new SQL.Database();
    }

    // 启用外键约束（sql.js 默认不启用）
    db.run('PRAGMA foreign_keys = ON');

    // 创建表结构
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 检查并添加 role 列（如果是旧数据库）
    try {
        db.run("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'");
    } catch (e) {
        // 列已存在
    }

    db.run(`
        CREATE TABLE IF NOT EXISTS wordbooks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            total_words INTEGER DEFAULT 0,
            is_public INTEGER DEFAULT 0,
            is_cloned INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    // 检查并添加 is_public 列
    try {
        db.run("ALTER TABLE wordbooks ADD COLUMN is_public INTEGER DEFAULT 0");
    } catch (e) {
        // 列已存在
    }

    // 检查并添加 is_cloned 列
    try {
        db.run("ALTER TABLE wordbooks ADD COLUMN is_cloned INTEGER DEFAULT 0");
    } catch (e) {
        // 列已存在
    }

    // 检查并添加 content_hash 列 (用于去重)
    try {
        db.run("ALTER TABLE wordbooks ADD COLUMN content_hash TEXT");
    } catch (e) {
        // 列已存在
    }

    db.run(`
        CREATE TABLE IF NOT EXISTS words (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            wordbook_id INTEGER NOT NULL,
            word TEXT NOT NULL,
            order_index INTEGER NOT NULL,
            FOREIGN KEY (wordbook_id) REFERENCES wordbooks(id) ON DELETE CASCADE
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS user_progress (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            word_id INTEGER NOT NULL,
            known INTEGER DEFAULT 0,
            last_reviewed DATETIME,
            UNIQUE(user_id, word_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS mistakes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            word_id INTEGER NOT NULL,
            added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, word_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
        )
    `);

    // 创建索引
    try {
        db.run('CREATE INDEX IF NOT EXISTS idx_words_wordbook ON words(wordbook_id)');
        db.run('CREATE INDEX IF NOT EXISTS idx_progress_user ON user_progress(user_id)');
        db.run('CREATE INDEX IF NOT EXISTS idx_mistakes_user ON mistakes(user_id)');
    } catch (e) {
        // 索引可能已存在
    }

    // 创建词典缓存表（使用 IF NOT EXISTS 保留缓存数据）
    db.run(`
        CREATE TABLE IF NOT EXISTS dictionary (
            word TEXT PRIMARY KEY,
            phonetic TEXT,
            translation TEXT,
            audio_path TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // [Stage 2] 创建用户-词书关联表 (订阅模式)
    db.run(`
        CREATE TABLE IF NOT EXISTS user_wordbooks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            wordbook_id INTEGER NOT NULL,
            role TEXT DEFAULT 'subscriber', -- 'owner' or 'subscriber'
            joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (wordbook_id) REFERENCES wordbooks(id) ON DELETE CASCADE,
            UNIQUE(user_id, wordbook_id)
        )
    `);

    // 数据迁移：为现有词书确保 owner 记录
    db.run(`
        INSERT OR IGNORE INTO user_wordbooks (user_id, wordbook_id, role, joined_at)
        SELECT user_id, id, 'owner', created_at
        FROM wordbooks
    `);

    await createAdminUser();

    saveDatabase();
    console.log('✅ 数据库初始化完成');

    return db;
}

// 保存数据库到文件
function saveDatabase() {
    try {
        if (db) {
            const data = db.export();
            const buffer = Buffer.from(data);
            fs.writeFileSync(dbPath, buffer);
        }
    } catch (err) {
        console.error('❌ 保存数据库失败:', err);
    }
}

// 查询单条记录
function get(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        return row;
    }
    stmt.free();
    return null;
}

// 查询多条记录
function all(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
        results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
}

// 执行SQL（插入、更新、删除）- 自动保存
function run(sql, params = []) {
    const stmt = db.prepare(sql);
    if (params.length > 0) {
        stmt.bind(params);
    }
    stmt.step();
    stmt.free();

    const lastId = db.exec("SELECT last_insert_rowid()")[0]?.values[0][0] || 0;
    const changes = db.getRowsModified();

    saveDatabase();
    console.log('执行SQL:', sql.substring(0, 50), '参数:', params, 'lastId:', lastId);

    return {
        lastInsertRowid: lastId,
        changes: changes
    };
}

// 执行SQL（不保存，用于事务内）
function runNoSave(sql, params = []) {
    db.run(sql, params);
    return {
        lastInsertRowid: db.exec("SELECT last_insert_rowid()")[0]?.values[0][0] || 0,
        changes: db.getRowsModified()
    };
}

// 批量插入（用于词书导入）
function batchInsert(wordbookId, words) {
    console.log('batchInsert收到的wordbookId:', wordbookId, '类型:', typeof wordbookId);

    const stmt = db.prepare('INSERT INTO words (wordbook_id, word, order_index) VALUES (?, ?, ?)');
    for (let i = 0; i < words.length; i++) {
        stmt.bind([wordbookId, words[i], i]);
        stmt.step();
        stmt.reset();
    }
    stmt.free();
    saveDatabase();

    // 验证插入结果
    const checkStmt = db.prepare('SELECT COUNT(*) as count FROM words WHERE wordbook_id = ?');
    checkStmt.bind([wordbookId]);
    checkStmt.step();
    const result = checkStmt.getAsObject();
    checkStmt.free();

    console.log('批量插入完成，共插入', words.length, '个单词，验证结果:', result.count);
}

// 创建默认管理员账户
async function createAdminUser() {
    const adminExists = db.exec("SELECT id FROM users WHERE username = 'admin'")[0];
    if (!adminExists) {
        const hashedPassword = await bcrypt.hash('admin', 10);
        db.run('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
            ['admin', hashedPassword, 'admin']);
        console.log('✅ 管理员账户(admin/admin)已创建');
        saveDatabase();
    }
}

module.exports = {
    initDatabase,
    get,
    all,
    run,
    runNoSave,
    batchInsert,
    saveDatabase
};
