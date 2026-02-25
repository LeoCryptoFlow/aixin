const { getDb } = require('../database/db');
const { getAgent } = require('../core/identity');

// ========== 黑名单 ==========

function addToBlacklist(ownerId, blockedId, reason = '') {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO blacklist (owner_id, blocked_id, reason) VALUES (?, ?, ?)').run(ownerId, blockedId, reason);
  // 同时删除好友关系
  db.prepare('DELETE FROM contacts WHERE owner_id = ? AND friend_id = ?').run(ownerId, blockedId);
  db.prepare('DELETE FROM contacts WHERE owner_id = ? AND friend_id = ?').run(blockedId, ownerId);
  return { blocked: true };
}

function removeFromBlacklist(ownerId, blockedId) {
  const db = getDb();
  db.prepare('DELETE FROM blacklist WHERE owner_id = ? AND blocked_id = ?').run(ownerId, blockedId);
  return { unblocked: true };
}

function getBlacklist(ownerId) {
  const db = getDb();
  return db.prepare(`
    SELECT b.*, a.nickname, a.avatar FROM blacklist b
    JOIN agents a ON a.ax_id = b.blocked_id
    WHERE b.owner_id = ?
  `).all(ownerId);
}

function isBlocked(ownerId, targetId) {
  const db = getDb();
  return !!db.prepare('SELECT 1 FROM blacklist WHERE owner_id = ? AND blocked_id = ?').get(ownerId, targetId);
}

// ========== 自动通过规则 ==========

function setAutoAcceptRule(ownerId, ruleType, ruleValue = '', enabled = 1) {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO auto_accept_rules (owner_id, rule_type, rule_value, enabled) VALUES (?, ?, ?, ?)').run(ownerId, ruleType, ruleValue, enabled);
  return { set: true };
}

function getAutoAcceptRules(ownerId) {
  const db = getDb();
  return db.prepare('SELECT * FROM auto_accept_rules WHERE owner_id = ? AND enabled = 1').all(ownerId);
}

function shouldAutoAccept(targetId, requesterId) {
  const rules = getAutoAcceptRules(targetId);
  if (rules.length === 0) return false;
  const requester = getAgent(requesterId);
  if (!requester) return false;
  for (const rule of rules) {
    if (rule.rule_type === 'all') return true;
    if (rule.rule_type === 'platform' && requester.platform === rule.rule_value) return true;
    if (rule.rule_type === 'region' && requester.region === rule.rule_value) return true;
    if (rule.rule_type === 'type' && requester.agent_type === rule.rule_value) return true;
  }
  return false;
}

/**
 * 发送好友请求（含黑名单检查 + 自动通过）
 */
function sendFriendRequest(ownerId, friendId) {
  if (ownerId === friendId) throw new Error('不能添加自己为好友');
  if (!getAgent(ownerId)) throw new Error(`Agent 不存在: ${ownerId}`);
  if (!getAgent(friendId)) throw new Error(`Agent 不存在: ${friendId}`);

  // 黑名单检查
  if (isBlocked(friendId, ownerId)) throw new Error('对方已将你拉黑');
  if (isBlocked(ownerId, friendId)) throw new Error('你已拉黑对方，请先解除');

  const db = getDb();
  const existing = db.prepare(
    'SELECT * FROM contacts WHERE owner_id = ? AND friend_id = ?'
  ).get(ownerId, friendId);

  if (existing) {
    if (existing.status === 'accepted') throw new Error('已经是好友');
    if (existing.status === 'pending') throw new Error('好友请求已发送');
  }

  // 检查自动通过规则
  if (shouldAutoAccept(friendId, ownerId)) {
    db.prepare('INSERT OR REPLACE INTO contacts (owner_id, friend_id, status) VALUES (?, ?, ?)').run(ownerId, friendId, 'accepted');
    db.prepare('INSERT OR REPLACE INTO contacts (owner_id, friend_id, status) VALUES (?, ?, ?)').run(friendId, ownerId, 'accepted');
    return { from: ownerId, to: friendId, status: 'accepted', auto: true };
  }

  db.prepare(
    'INSERT OR REPLACE INTO contacts (owner_id, friend_id, status) VALUES (?, ?, ?)'
  ).run(ownerId, friendId, 'pending');

  return { from: ownerId, to: friendId, status: 'pending' };
}

/**
 * 接受好友请求
 */
function acceptFriendRequest(ownerId, friendId) {
  const db = getDb();
  // 更新对方发来的请求
  db.prepare(
    "UPDATE contacts SET status = 'accepted' WHERE owner_id = ? AND friend_id = ?"
  ).run(friendId, ownerId);

  // 双向添加
  db.prepare(
    "INSERT OR REPLACE INTO contacts (owner_id, friend_id, status) VALUES (?, ?, 'accepted')"
  ).run(ownerId, friendId);

  return { from: friendId, to: ownerId, status: 'accepted' };
}

/**
 * 拒绝好友请求
 */
function rejectFriendRequest(ownerId, friendId) {
  const db = getDb();
  db.prepare(
    "UPDATE contacts SET status = 'rejected' WHERE owner_id = ? AND friend_id = ?"
  ).run(friendId, ownerId);
  return { from: friendId, to: ownerId, status: 'rejected' };
}

/**
 * 获取好友列表
 */
function getFriends(ownerId) {
  const db = getDb();
  return db.prepare(`
    SELECT a.*, c.alias, c.status as friendship_status
    FROM contacts c
    JOIN agents a ON a.ax_id = c.friend_id
    WHERE c.owner_id = ? AND c.status = 'accepted'
    ORDER BY a.nickname
  `).all(ownerId);
}

/**
 * 获取待处理的好友请求
 */
function getPendingRequests(ownerId) {
  const db = getDb();
  return db.prepare(`
    SELECT a.ax_id, a.agent_type, a.nickname, a.platform, a.region, a.avatar, a.owner_name, a.bio, a.skill_tags, a.rating, a.status, a.created_at, c.created_at as request_time
    FROM contacts c
    JOIN agents a ON a.ax_id = c.owner_id
    WHERE c.friend_id = ? AND c.status = 'pending'
    ORDER BY c.created_at DESC
  `).all(ownerId);
}

/**
 * 删除好友
 */
function removeFriend(ownerId, friendId) {
  const db = getDb();
  db.prepare('DELETE FROM contacts WHERE owner_id = ? AND friend_id = ?').run(ownerId, friendId);
  db.prepare('DELETE FROM contacts WHERE owner_id = ? AND friend_id = ?').run(friendId, ownerId);
  return { removed: true };
}

module.exports = {
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  getFriends,
  getPendingRequests,
  removeFriend,
  addToBlacklist,
  removeFromBlacklist,
  getBlacklist,
  isBlocked,
  setAutoAcceptRule,
  getAutoAcceptRules
};
