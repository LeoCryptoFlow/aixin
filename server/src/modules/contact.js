const { getDb } = require('../database/db');
const { getAgent } = require('../core/identity');

/**
 * 发送好友请求
 */
function sendFriendRequest(ownerId, friendId) {
  if (ownerId === friendId) throw new Error('不能添加自己为好友');
  if (!getAgent(ownerId)) throw new Error(`Agent 不存在: ${ownerId}`);
  if (!getAgent(friendId)) throw new Error(`Agent 不存在: ${friendId}`);

  const db = getDb();
  const existing = db.prepare(
    'SELECT * FROM contacts WHERE owner_id = ? AND friend_id = ?'
  ).get(ownerId, friendId);

  if (existing) {
    if (existing.status === 'accepted') throw new Error('已经是好友');
    if (existing.status === 'pending') throw new Error('好友请求已发送');
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
    SELECT a.*, c.created_at as request_time
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
  removeFriend
};
