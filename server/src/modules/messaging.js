const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database/db');

/**
 * 发送私聊消息
 */
function sendMessage(fromId, toId, content, type = 'text', payload = {}) {
  const db = getDb();
  const msgId = uuidv4();
  db.prepare(`
    INSERT INTO messages (msg_id, from_id, to_id, content_type, content, payload)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(msgId, fromId, toId, type, content, JSON.stringify(payload));
  return getMessage(msgId);
}

/**
 * 获取单条消息
 */
function getMessage(msgId) {
  const db = getDb();
  const msg = db.prepare('SELECT * FROM messages WHERE msg_id = ?').get(msgId);
  if (msg) msg.payload = JSON.parse(msg.payload || '{}');
  return msg;
}

/**
 * 获取两人之间的聊天记录
 */
function getChatHistory(userId1, userId2, limit = 50, offset = 0) {
  const db = getDb();
  const msgs = db.prepare(`
    SELECT * FROM messages
    WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(userId1, userId2, userId2, userId1, limit, offset);
  return msgs.map(m => ({ ...m, payload: JSON.parse(m.payload || '{}') })).reverse();
}

/**
 * 标记消息已读
 */
function markAsRead(toId, fromId) {
  const db = getDb();
  db.prepare(
    'UPDATE messages SET read = 1 WHERE to_id = ? AND from_id = ? AND read = 0'
  ).run(toId, fromId);
}

/**
 * 获取未读消息数
 */
function getUnreadCount(userId) {
  const db = getDb();
  const result = db.prepare(
    'SELECT from_id, COUNT(*) as count FROM messages WHERE to_id = ? AND read = 0 GROUP BY from_id'
  ).all(userId);
  return result;
}

/**
 * 创建群组
 */
function createGroup(name, ownerId, memberIds = []) {
  const db = getDb();
  const groupId = `group_${uuidv4().substring(0, 8)}`;

  db.prepare('INSERT INTO groups (group_id, name, owner_id) VALUES (?, ?, ?)').run(groupId, name, ownerId);

  const addMember = db.prepare('INSERT INTO group_members (group_id, member_id, role) VALUES (?, ?, ?)');
  const addAll = db.transaction((members) => {
    addMember.run(groupId, ownerId, 'owner');
    for (const mid of members) {
      if (mid !== ownerId) addMember.run(groupId, mid, 'member');
    }
  });
  addAll(memberIds);

  return getGroup(groupId);
}

/**
 * 获取群组信息
 */
function getGroup(groupId) {
  const db = getDb();
  const group = db.prepare('SELECT * FROM groups WHERE group_id = ?').get(groupId);
  if (group) {
    group.members = db.prepare(`
      SELECT a.*, gm.role FROM group_members gm
      JOIN agents a ON a.ax_id = gm.member_id
      WHERE gm.group_id = ?
    `).all(groupId);
  }
  return group;
}

/**
 * 发送群消息
 */
function sendGroupMessage(groupId, fromId, content, type = 'text', payload = {}) {
  const db = getDb();
  const msgId = uuidv4();
  db.prepare(`
    INSERT INTO group_messages (msg_id, group_id, from_id, content_type, content, payload)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(msgId, groupId, fromId, type, content, JSON.stringify(payload));
  return getGroupMessage(msgId);
}

/**
 * 获取群消息
 */
function getGroupMessage(msgId) {
  const db = getDb();
  const msg = db.prepare('SELECT * FROM group_messages WHERE msg_id = ?').get(msgId);
  if (msg) msg.payload = JSON.parse(msg.payload || '{}');
  return msg;
}

/**
 * 获取群聊天记录
 */
function getGroupHistory(groupId, limit = 50, offset = 0) {
  const db = getDb();
  const msgs = db.prepare(`
    SELECT gm.*, a.nickname as sender_name FROM group_messages gm
    JOIN agents a ON a.ax_id = gm.from_id
    WHERE gm.group_id = ?
    ORDER BY gm.created_at DESC
    LIMIT ? OFFSET ?
  `).all(groupId, limit, offset);
  return msgs.map(m => ({ ...m, payload: JSON.parse(m.payload || '{}') })).reverse();
}

/**
 * 获取用户的所有群组
 */
function getUserGroups(userId) {
  const db = getDb();
  return db.prepare(`
    SELECT g.* FROM groups g
    JOIN group_members gm ON g.group_id = gm.group_id
    WHERE gm.member_id = ?
  `).all(userId);
}

/**
 * 获取会话列表（最近联系人）
 */
function getConversations(userId) {
  const db = getDb();
  // 私聊会话
  const chats = db.prepare(`
    SELECT 
      CASE WHEN from_id = ? THEN to_id ELSE from_id END as contact_id,
      content as last_message,
      created_at as last_time,
      'chat' as conv_type
    FROM messages
    WHERE from_id = ? OR to_id = ?
    GROUP BY contact_id
    ORDER BY created_at DESC
  `).all(userId, userId, userId);

  // 群聊会话
  const groups = db.prepare(`
    SELECT 
      g.group_id as contact_id,
      g.name as group_name,
      'group' as conv_type
    FROM groups g
    JOIN group_members gm ON g.group_id = gm.group_id
    WHERE gm.member_id = ?
  `).all(userId);

  return { chats, groups };
}

module.exports = {
  sendMessage,
  getMessage,
  getChatHistory,
  markAsRead,
  getUnreadCount,
  createGroup,
  getGroup,
  sendGroupMessage,
  getGroupHistory,
  getUserGroups,
  getConversations
};
