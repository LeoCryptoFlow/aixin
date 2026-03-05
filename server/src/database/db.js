const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'aixin.db');

let db;

function getDb() {
  if (!db) {
    const fs = require('fs');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    db = new Database(DB_PATH);

    // ========== 性能关键 PRAGMA ==========
    // WAL 模式：读写并发，不互相阻塞
    db.pragma('journal_mode = WAL');
    // WAL 模式下 NORMAL 足够安全，且比 FULL 快 5-10x
    db.pragma('synchronous = NORMAL');
    // 32MB 页缓存（负数=KB，减少磁盘 I/O）
    db.pragma('cache_size = -32000');
    // 256MB 内存映射，大幅减少系统调用
    db.pragma('mmap_size = 268435456');
    // 临时表放内存
    db.pragma('temp_store = MEMORY');
    // 外键约束
    db.pragma('foreign_keys = ON');
    // WAL 自动 checkpoint 阈值（页数）
    db.pragma('wal_autocheckpoint = 1000');
    // 页大小优化（需要在建表前设置，已有 DB 无效但无害）
    db.pragma('page_size = 4096');

    initTables();
    migrateDb();
  }
  return db;
}

function initTables() {
  db.exec(`
    -- AI Agent 身份表（双轨制：个人助理 AX-U / 技能Agent AX-S）
    CREATE TABLE IF NOT EXISTS agents (
      ax_id TEXT PRIMARY KEY,
      agent_type TEXT NOT NULL DEFAULT 'personal',
      nickname TEXT NOT NULL,
      password TEXT DEFAULT '',
      email TEXT DEFAULT '',
      email_verified INTEGER DEFAULT 0,
      platform TEXT NOT NULL,
      region TEXT DEFAULT 'CN',
      avatar TEXT DEFAULT '',
      owner_name TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      skill_tags TEXT DEFAULT '[]',
      model_base TEXT DEFAULT '',
      capabilities TEXT DEFAULT '[]',
      rating REAL DEFAULT 5.0,
      rating_count INTEGER DEFAULT 0,
      credit_score INTEGER DEFAULT 100,
      status TEXT DEFAULT 'online',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- 好友关系表（支持分组）
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id TEXT NOT NULL,
      friend_id TEXT NOT NULL,
      alias TEXT DEFAULT '',
      group_tag TEXT DEFAULT '未分组',
      status TEXT DEFAULT 'pending',
      auto_accept INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (owner_id) REFERENCES agents(ax_id),
      UNIQUE(owner_id, friend_id)
    );

    -- 私聊消息表
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      msg_id TEXT UNIQUE NOT NULL,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      msg_type TEXT DEFAULT 'chat',
      content_type TEXT DEFAULT 'text',
      content TEXT NOT NULL,
      payload TEXT DEFAULT '{}',
      read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 群组表
    CREATE TABLE IF NOT EXISTS groups (
      group_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      avatar TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 群成员表
    CREATE TABLE IF NOT EXISTS group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      joined_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (group_id) REFERENCES groups(group_id),
      UNIQUE(group_id, member_id)
    );

    -- 群消息表
    CREATE TABLE IF NOT EXISTS group_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      msg_id TEXT UNIQUE NOT NULL,
      group_id TEXT NOT NULL,
      from_id TEXT NOT NULL,
      content_type TEXT DEFAULT 'text',
      content TEXT NOT NULL,
      payload TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (group_id) REFERENCES groups(group_id)
    );

    -- 任务委派表
    CREATE TABLE IF NOT EXISTS tasks (
      task_id TEXT PRIMARY KEY,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      input_data TEXT DEFAULT '{}',
      output_data TEXT DEFAULT '{}',
      status TEXT DEFAULT 'pending',
      priority TEXT DEFAULT 'normal',
      callback_url TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- 技能市场动态/朋友圈
    CREATE TABLE IF NOT EXISTS moments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ax_id TEXT NOT NULL,
      content TEXT NOT NULL,
      moment_type TEXT DEFAULT 'update',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (ax_id) REFERENCES agents(ax_id)
    );

    -- 黑名单表
    CREATE TABLE IF NOT EXISTS blacklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id TEXT NOT NULL,
      blocked_id TEXT NOT NULL,
      reason TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (owner_id) REFERENCES agents(ax_id),
      UNIQUE(owner_id, blocked_id)
    );

    -- 自动通过规则表
    CREATE TABLE IF NOT EXISTS auto_accept_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id TEXT NOT NULL,
      rule_type TEXT NOT NULL DEFAULT 'all',
      rule_value TEXT DEFAULT '',
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (owner_id) REFERENCES agents(ax_id)
    );

    -- 商务会话存证表
    CREATE TABLE IF NOT EXISTS business_sessions (
      session_id TEXT PRIMARY KEY,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      session_type TEXT DEFAULT 'general',
      title TEXT DEFAULT '',
      structured_data TEXT DEFAULT '{}',
      attachments TEXT DEFAULT '[]',
      status TEXT DEFAULT 'open',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- 技能画像索引表
    CREATE TABLE IF NOT EXISTS skill_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ax_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      weight REAL DEFAULT 1.0,
      FOREIGN KEY (ax_id) REFERENCES agents(ax_id),
      UNIQUE(ax_id, tag)
    );

    -- Skill 安装记录表（从 routes.js 中移出，避免每次请求重建）
    CREATE TABLE IF NOT EXISTS skill_installs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ax_id TEXT NOT NULL,
      platform TEXT DEFAULT '',
      callback_url TEXT DEFAULT '',
      installed_at TEXT DEFAULT (datetime('now'))
    );

    -- ========== 基础索引 ==========
    CREATE INDEX IF NOT EXISTS idx_messages_from ON messages(from_id);
    CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_id);
    CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_id);
    CREATE INDEX IF NOT EXISTS idx_group_messages_group ON group_messages(group_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_to ON tasks(to_id);
    CREATE INDEX IF NOT EXISTS idx_agents_type ON agents(agent_type);
    CREATE INDEX IF NOT EXISTS idx_agents_skill_tags ON agents(skill_tags);
    CREATE INDEX IF NOT EXISTS idx_blacklist_owner ON blacklist(owner_id);
    CREATE INDEX IF NOT EXISTS idx_skill_profiles_tag ON skill_profiles(tag);
    CREATE INDEX IF NOT EXISTS idx_business_sessions_from ON business_sessions(from_id);
    CREATE INDEX IF NOT EXISTS idx_business_sessions_to ON business_sessions(to_id);

    -- ========== 复合索引（高频查询优化）==========
    -- 未读消息查询：SELECT * FROM messages WHERE to_id=? AND read=0
    CREATE INDEX IF NOT EXISTS idx_messages_to_unread ON messages(to_id, read);
    -- 聊天记录查询：SELECT * FROM messages WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(from_id, to_id, created_at);
    -- 好友列表查询：SELECT * FROM contacts WHERE owner_id=? AND status='accepted'
    CREATE INDEX IF NOT EXISTS idx_contacts_owner_status ON contacts(owner_id, status);
    -- 任务查询：SELECT * FROM tasks WHERE from_id=? ORDER BY created_at DESC
    CREATE INDEX IF NOT EXISTS idx_tasks_from ON tasks(from_id);
    -- agent 搜索优化
    CREATE INDEX IF NOT EXISTS idx_agents_nickname ON agents(nickname);
    -- 群成员查询
    CREATE INDEX IF NOT EXISTS idx_group_members_member ON group_members(member_id);
  `);
}

/**
 * 数据库迁移：给旧表添加新字段（ALTER TABLE 幂等操作）
 */
function migrateDb() {
  const cols = db.pragma('table_info(agents)').map(c => c.name);
  if (!cols.includes('email')) {
    db.exec("ALTER TABLE agents ADD COLUMN email TEXT DEFAULT ''");
    console.log('[DB迁移] agents 表添加 email 字段');
  }
  if (!cols.includes('email_verified')) {
    db.exec('ALTER TABLE agents ADD COLUMN email_verified INTEGER DEFAULT 0');
    console.log('[DB迁移] agents 表添加 email_verified 字段');
  }
  // email 唯一索引（允许空）
  try {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_email ON agents(email) WHERE email != ''");
  } catch (e) {
    // 索引已存在时忽略
  }
}

module.exports = { getDb };
