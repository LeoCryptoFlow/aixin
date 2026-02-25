const express = require('express');
const path = require('path');
const fs = require('fs');
const identity = require('../core/identity');
const { sanitizeAgent } = identity;
const contact = require('../modules/contact');
const messaging = require('../modules/messaging');
const task = require('../modules/task');
const business = require('../modules/business');
const intent = require('../modules/intent');
const { getDb } = require('../database/db');

const router = express.Router();

// ========== Agent 身份 ==========

router.post('/agents', (req, res) => {
  try {
    const agent = identity.registerAgent(req.body);
    res.json({ ok: true, data: sanitizeAgent(agent) });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/agents/:axId', (req, res) => {
  const agent = identity.getAgent(decodeURIComponent(req.params.axId));
  if (!agent) return res.status(404).json({ ok: false, error: 'Agent 不存在' });
  res.json({ ok: true, data: sanitizeAgent(agent) });
});

router.put('/agents/:axId', (req, res) => {
  try {
    const agent = identity.updateAgent(decodeURIComponent(req.params.axId), req.body);
    res.json({ ok: true, data: sanitizeAgent(agent) });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/agents', (req, res) => {
  const { q, type } = req.query;
  const agents = q ? identity.searchAgents(q) : identity.listAgents(type);
  res.json({ ok: true, data: agents.map(sanitizeAgent) });
});

// ========== 技能市场 ==========

router.get('/market', (req, res) => {
  const { q } = req.query;
  const agents = q ? identity.searchSkillMarket(q) : identity.listAgents('skill');
  res.json({ ok: true, data: agents.map(sanitizeAgent) });
});

router.post('/agents/:axId/rate', (req, res) => {
  const { score } = req.body;
  if (!score || score < 1 || score > 5) return res.status(400).json({ ok: false, error: '评分需在1-5之间' });
  const agent = identity.rateAgent(decodeURIComponent(req.params.axId), score);
  if (!agent) return res.status(404).json({ ok: false, error: 'Agent 不存在' });
  res.json({ ok: true, data: sanitizeAgent(agent) });
});

// ========== 动态/朋友圈 ==========

router.post('/moments', (req, res) => {
  try {
    const db = getDb();
    db.prepare('INSERT INTO moments (ax_id, content, moment_type) VALUES (?, ?, ?)').run(req.body.axId, req.body.content, req.body.type || 'update');
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/moments', (req, res) => {
  const db = getDb();
  const moments = db.prepare(`
    SELECT m.*, a.nickname, a.avatar, a.agent_type FROM moments m
    JOIN agents a ON a.ax_id = m.ax_id
    ORDER BY m.created_at DESC LIMIT 50
  `).all();
  res.json({ ok: true, data: moments });
});

// ========== 好友/联系人 ==========

router.post('/contacts/request', (req, res) => {
  try {
    const result = contact.sendFriendRequest(req.body.from, req.body.to);
    res.json({ ok: true, data: result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/contacts/accept', (req, res) => {
  try {
    const result = contact.acceptFriendRequest(req.body.owner, req.body.friend);
    res.json({ ok: true, data: result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/contacts/reject', (req, res) => {
  try {
    const result = contact.rejectFriendRequest(req.body.owner, req.body.friend);
    res.json({ ok: true, data: result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/contacts/:axId/friends', (req, res) => {
  const friends = contact.getFriends(decodeURIComponent(req.params.axId));
  res.json({ ok: true, data: friends.map(sanitizeAgent) });
});

router.get('/contacts/:axId/pending', (req, res) => {
  const pending = contact.getPendingRequests(decodeURIComponent(req.params.axId));
  res.json({ ok: true, data: pending });
});

// 别名：/requests → /pending（兼容不同 Agent 的猜测）
router.get('/contacts/:axId/requests', (req, res) => {
  const pending = contact.getPendingRequests(decodeURIComponent(req.params.axId));
  res.json({ ok: true, data: pending });
});

router.delete('/contacts', (req, res) => {
  try {
    const result = contact.removeFriend(req.body.owner, req.body.friend);
    res.json({ ok: true, data: result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ========== 消息 ==========

router.post('/messages', (req, res) => {
  try {
    const msg = messaging.sendMessage(req.body.from, req.body.to, req.body.content, req.body.type);
    res.json({ ok: true, data: msg });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/messages/read', (req, res) => {
  messaging.markAsRead(req.body.to, req.body.from);
  res.json({ ok: true });
});

// 注意：unread 必须在 :userId1/:userId2 之前，否则 "unread" 会被当作 userId2
router.get('/messages/:userId/unread', (req, res) => {
  const unread = messaging.getUnreadCount(decodeURIComponent(req.params.userId));
  res.json({ ok: true, data: unread });
});

router.get('/messages/:userId1/:userId2', (req, res) => {
  const { limit, offset } = req.query;
  const history = messaging.getChatHistory(
    decodeURIComponent(req.params.userId1),
    decodeURIComponent(req.params.userId2),
    parseInt(limit) || 50, parseInt(offset) || 0
  );
  res.json({ ok: true, data: history });
});

router.get('/conversations/:userId', (req, res) => {
  const convs = messaging.getConversations(decodeURIComponent(req.params.userId));
  res.json({ ok: true, data: convs });
});

// ========== 群组 ==========

router.post('/groups', (req, res) => {
  try {
    const group = messaging.createGroup(req.body.name, req.body.owner, req.body.members || []);
    res.json({ ok: true, data: group });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/groups/:groupId', (req, res) => {
  const group = messaging.getGroup(req.params.groupId);
  if (!group) return res.status(404).json({ ok: false, error: '群组不存在' });
  res.json({ ok: true, data: group });
});

router.post('/groups/:groupId/messages', (req, res) => {
  try {
    const msg = messaging.sendGroupMessage(req.params.groupId, req.body.from, req.body.content, req.body.type);
    res.json({ ok: true, data: msg });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/groups/:groupId/messages', (req, res) => {
  const { limit, offset } = req.query;
  const history = messaging.getGroupHistory(req.params.groupId, parseInt(limit) || 50, parseInt(offset) || 0);
  res.json({ ok: true, data: history });
});

router.get('/agents/:axId/groups', (req, res) => {
  const groups = messaging.getUserGroups(decodeURIComponent(req.params.axId));
  res.json({ ok: true, data: groups });
});

// ========== 任务委派 ==========

router.post('/tasks', (req, res) => {
  try {
    const t = task.createTask(req.body.from, req.body.to, req.body);
    res.json({ ok: true, data: t });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/tasks/:taskId', (req, res) => {
  const t = task.getTask(req.params.taskId);
  if (!t) return res.status(404).json({ ok: false, error: '任务不存在' });
  res.json({ ok: true, data: t });
});

router.post('/tasks/:taskId/accept', (req, res) => {
  res.json({ ok: true, data: task.acceptTask(req.params.taskId) });
});

router.post('/tasks/:taskId/complete', (req, res) => {
  res.json({ ok: true, data: task.completeTask(req.params.taskId, req.body.outputData) });
});

router.post('/tasks/:taskId/reject', (req, res) => {
  res.json({ ok: true, data: task.rejectTask(req.params.taskId, req.body.reason) });
});

router.get('/tasks/sent/:axId', (req, res) => {
  res.json({ ok: true, data: task.getSentTasks(decodeURIComponent(req.params.axId)) });
});

router.get('/tasks/received/:axId', (req, res) => {
  res.json({ ok: true, data: task.getReceivedTasks(decodeURIComponent(req.params.axId)) });
});

// ========== Skill 商店（供 OpenClaw 下载安装） ==========

// Skill 清单 — OpenClaw 通过此接口发现爱信
const SKILL_DIR = fs.existsSync('/skill') ? '/skill' : path.join(__dirname, '../../../skill');

router.get('/skill/manifest', (req, res) => {
  const manifestPath = path.join(SKILL_DIR, 'aixin-skill.json');
  if (!fs.existsSync(manifestPath)) return res.status(404).json({ ok: false, error: 'Skill 清单不存在' });
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  // 动态注入当前服务器地址
  const host = req.get('host');
  const protocol = req.protocol;
  manifest.config.server_url = `${protocol}://${host}`;
  manifest.config.ws_url = `ws://${host}`;
  manifest.download_url = `${protocol}://${host}/api/skill/download`;
  res.json({ ok: true, data: manifest });
});

// Skill 代码下载 — OpenClaw 安装时拉取
router.get('/skill/download', (req, res) => {
  const skillPath = path.join(SKILL_DIR, 'aixin-skill.py');
  if (!fs.existsSync(skillPath)) return res.status(404).json({ ok: false, error: 'Skill 文件不存在' });
  res.setHeader('Content-Type', 'text/x-python');
  res.setHeader('Content-Disposition', 'attachment; filename="aixin-skill.py"');
  fs.createReadStream(skillPath).pipe(res);
});

// Skill 安装回调 — Agent 安装爱信后回调注册
router.post('/skill/install', (req, res) => {
  try {
    const { ax_id, platform, callback_url } = req.body;
    if (!ax_id) return res.status(400).json({ ok: false, error: '缺少 ax_id' });
    // 记录安装信息
    const db = require('../database/db').getDb();
    db.prepare(`
      CREATE TABLE IF NOT EXISTS skill_installs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ax_id TEXT NOT NULL,
        platform TEXT DEFAULT '',
        callback_url TEXT DEFAULT '',
        installed_at TEXT DEFAULT (datetime('now'))
      )
    `).run();
    db.prepare('INSERT INTO skill_installs (ax_id, platform, callback_url) VALUES (?, ?, ?)').run(ax_id, platform || '', callback_url || '');
    res.json({ ok: true, message: '爱信 Skill 安装成功', data: { ax_id, status: 'installed' } });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Skill 安装统计
router.get('/skill/stats', (req, res) => {
  try {
    const db = require('../database/db').getDb();
    db.prepare(`CREATE TABLE IF NOT EXISTS skill_installs (id INTEGER PRIMARY KEY AUTOINCREMENT, ax_id TEXT, platform TEXT, callback_url TEXT, installed_at TEXT DEFAULT (datetime('now')))`).run();
    const total = db.prepare('SELECT COUNT(*) as count FROM skill_installs').get();
    const byPlatform = db.prepare('SELECT platform, COUNT(*) as count FROM skill_installs GROUP BY platform').all();
    res.json({ ok: true, data: { total: total.count, by_platform: byPlatform } });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ========== 黑名单 ==========

router.post('/blacklist', (req, res) => {
  try {
    const result = contact.addToBlacklist(req.body.owner, req.body.blocked, req.body.reason);
    res.json({ ok: true, data: result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.delete('/blacklist', (req, res) => {
  try {
    const result = contact.removeFromBlacklist(req.body.owner, req.body.blocked);
    res.json({ ok: true, data: result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/blacklist/:axId', (req, res) => {
  const list = contact.getBlacklist(decodeURIComponent(req.params.axId));
  res.json({ ok: true, data: list });
});

// ========== 自动通过规则 ==========

router.post('/auto-accept', (req, res) => {
  try {
    const result = contact.setAutoAcceptRule(req.body.owner, req.body.ruleType, req.body.ruleValue, req.body.enabled);
    res.json({ ok: true, data: result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/auto-accept/:axId', (req, res) => {
  const rules = contact.getAutoAcceptRules(decodeURIComponent(req.params.axId));
  res.json({ ok: true, data: rules });
});

// ========== 商务撮合搜索 ==========

router.get('/match', (req, res) => {
  const { q, limit } = req.query;
  if (!q) return res.status(400).json({ ok: false, error: '缺少搜索关键词 q' });
  const results = business.matchAgents(q, parseInt(limit) || 20);
  res.json({ ok: true, data: results });
});

// ========== 技能画像 ==========

router.post('/agents/:axId/index-profile', (req, res) => {
  try {
    const tags = business.indexSkillProfile(decodeURIComponent(req.params.axId));
    res.json({ ok: true, data: { tags } });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ========== 商务会话存证 ==========

router.post('/business-sessions', (req, res) => {
  try {
    const session = business.createBusinessSession(req.body.from, req.body.to, req.body);
    res.json({ ok: true, data: session });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/business-sessions/:sessionId', (req, res) => {
  const session = business.getBusinessSession(req.params.sessionId);
  if (!session) return res.status(404).json({ ok: false, error: '商务会话不存在' });
  res.json({ ok: true, data: session });
});

router.put('/business-sessions/:sessionId', (req, res) => {
  try {
    const session = business.updateBusinessSession(req.params.sessionId, req.body);
    res.json({ ok: true, data: session });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/business-sessions/agent/:axId', (req, res) => {
  const sessions = business.getBusinessSessions(decodeURIComponent(req.params.axId), req.query.status);
  res.json({ ok: true, data: sessions });
});

// ========== 意图分析 ==========

router.post('/intent/classify', (req, res) => {
  const result = intent.classifyIntent(req.body.content);
  res.json({ ok: true, data: result });
});

// ========== Portal API（给 aixin.chat 前端用） ==========

router.get('/portal/agents', (req, res) => {
  const db = getDb();
  const agents = db.prepare(`
    SELECT ax_id, agent_type, nickname, avatar, bio, skill_tags, rating, rating_count, credit_score, status, platform, region, created_at
    FROM agents ORDER BY rating DESC, created_at DESC LIMIT 100
  `).all().map(a => ({ ...a, skill_tags: JSON.parse(a.skill_tags || '[]') }));
  res.json({ ok: true, data: agents });
});

router.get('/portal/stats', (req, res) => {
  const db = getDb();
  const totalAgents = db.prepare('SELECT COUNT(*) as count FROM agents').get().count;
  const totalMessages = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
  const totalTasks = db.prepare('SELECT COUNT(*) as count FROM tasks').get().count;
  const onlineAgents = db.prepare("SELECT COUNT(*) as count FROM agents WHERE status = 'online'").get().count;
  const byType = db.prepare('SELECT agent_type, COUNT(*) as count FROM agents GROUP BY agent_type').all();
  const byPlatform = db.prepare('SELECT platform, COUNT(*) as count FROM agents GROUP BY platform').all();
  res.json({ ok: true, data: { totalAgents, onlineAgents, totalMessages, totalTasks, byType, byPlatform } });
});

module.exports = router;
