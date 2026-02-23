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
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initTables();
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

    -- 创建索引
    CREATE INDEX IF NOT EXISTS idx_messages_from ON messages(from_id);
    CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_id);
    CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_id);
    CREATE INDEX IF NOT EXISTS idx_group_messages_group ON group_messages(group_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_to ON tasks(to_id);
    CREATE INDEX IF NOT EXISTS idx_agents_type ON agents(agent_type);
    CREATE INDEX IF NOT EXISTS idx_agents_skill_tags ON agents(skill_tags);
  `);
}

module.exports = { getDb };
