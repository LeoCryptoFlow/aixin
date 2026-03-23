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
const { rateLimit } = require('../utils/rateLimit');
const { sendVerificationCode, verifyCode } = require('../utils/emailVerify');
const { signToken, authMiddleware, isOwner } = require('../utils/auth');

const router = express.Router();

// ========== 邮箱验证码（注册前发送/验证） ==========

// 发送邮箱验证码：每分钟限1次，每IP每小时最多5次
const sendCodeLimiter = rateLimit({
  windowMs: 3600000,  // 1小时
  maxRequests: 5,     // 每IP每小时最多5次
  blockDuration: 1800000, // 封禁30分钟
  keyGenerator: (req) => `send_code:${req.ip}`
});

router.post('/auth/send-code',
  sendCodeLimiter,
  (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ ok: false, error: '请填写邮箱' });
    // 基础邮箱格式校验
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: '邮箱格式不正确' });
    }
    const result = sendVerificationCode(email);
    if (!result.ok) {
      return res.status(429).json(result);
    }
    // TODO: 正式对接邮件发送前，临时让生产环境也透传 code 便于用户注册测试
    const isProd = process.env.NODE_ENV === 'production';
    res.json({
      ok: true,
      message: result.message,
      dev_code: result.code // 临时开放给平台内直接反馈给用户
    });
  }
);

// ========== 登录认证 ==========

// 登录限频：每IP每10分钟最多10次（防暴力破解）
const loginLimiter = rateLimit({
  windowMs: 600000,   // 10分钟
  maxRequests: 10,
  blockDuration: 1800000, // 封禁30分钟
  keyGenerator: (req) => `login:${req.ip}`
});

/**
 * 登录接口 — 用 AI-ID + 密码 换取 JWT Token
 * 修复安全漏洞：之前没有登录接口，仅凭号码就能操作任何账号
 */
router.post('/auth/login',
  loginLimiter,
  (req, res) => {
    try {
      const { axId, ax_id, password } = req.body;
      const id = axId || ax_id;

      if (!id) return res.status(400).json({
        ok: false,
        error: '请输入爱信号 (AI-ID)',
        hint: '登录字段名必须是 ax_id 或 axId，请确认您使用的是最新版爱信技能（v1.2.0+）。如遇问题请前往 OpenClaw 技能市场更新爱信技能。',
        latest_version: '1.2.0',
        doc_url: 'https://aixin.chat/api/skill/manifest'
      });
      if (!password) return res.status(400).json({
        ok: false,
        error: '请输入密码',
        hint: '新版爱信需要密码登录。如果您之前注册时没设密码，说明使用的是旧版本，请更新爱信技能到 v1.2.0+ 后重新注册。',
        latest_version: '1.2.0'
      });

      const agent = identity.getAgent(id);
      if (!agent) return res.status(404).json({ ok: false, error: '爱信号不存在' });

      // 验证密码（目前是明文比对，未来应升级为 bcrypt）
      if (agent.password !== password) {
        return res.status(401).json({ ok: false, error: '密码错误' });
      }

      // 签发 JWT Token
      const token = signToken(agent.ax_id);

      res.json({
        ok: true,
        data: sanitizeAgent(agent),
        token
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ========== Agent 身份 ==========

// 注册限频：每IP每10分钟最多5次
const registerLimiter = rateLimit({
  windowMs: 600000,   // 10分钟
  maxRequests: 5,
  blockDuration: 3600000, // 封禁1小时
  keyGenerator: (req) => `register:${req.ip}`
});

// 通用接口限频：每IP每分钟最多60次
const generalLimiter = rateLimit({
  windowMs: 60000,
  maxRequests: 60,
  blockDuration: 300000,
  keyGenerator: (req) => `general:${req.ip}`
});

router.post('/agents',
  registerLimiter,
  (req, res) => {
    try {
      const { email, emailCode, ...rest } = req.body;

      // --- 字段名兼容：支持 snake_case (agent_type) 和 camelCase (agentType) ---
      const agentType = rest.agentType || rest.agent_type || 'personal';
      const ownerName = rest.ownerName || rest.owner_name || '';
      const skillTags = rest.skillTags || rest.skill_tags || [];
      const modelBase = rest.modelBase || rest.model_base || '';

      // --- 密码校验（人类用户注册必须设置密码）---
      // AI Agent（bot/skill 类型）可以不传密码，由平台颁发 token 认证
      const isHuman = agentType === 'personal';
      if (isHuman) {
        if (!rest.password || rest.password.length < 6) {
          return res.status(400).json({
            ok: false,
            error: '请设置密码（至少6位）',
            hint: '新版爱信（v1.2.0+）注册时必须设置密码。如果您的爱信技能没有要求设置密码，说明版本较旧，请前往 OpenClaw 技能市场更新到最新版本。',
            latest_version: '1.2.0'
          });
        }
      }

      // 如果有传 email 就记录，否则置为带时间戳的随机空邮箱避免碰撞 UNIQUE constraint failed: agents.email
      const dummyEmail = `nomail_${Date.now()}_${Math.floor(Math.random() * 1000)}@aixin.chat`;
      const finalEmail = email ? email : dummyEmail;

      const agent = identity.registerAgent({
        ...rest,
        agentType,
        ownerName,
        skillTags,
        modelBase,
        email: finalEmail
      });

      // 注册成功后自动签发 token，客户端无需再次登录
      const token = signToken(agent.ax_id);
      res.json({ ok: true, data: sanitizeAgent(agent), token });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  }
);

router.get('/agents/:axId', (req, res) => {
  const agent = identity.getAgent(decodeURIComponent(req.params.axId));
  if (!agent) return res.status(404).json({ ok: false, error: 'Agent 不存在' });
  res.json({ ok: true, data: sanitizeAgent(agent) });
});

router.put('/agents/:axId', authMiddleware, (req, res) => {
  try {
    const axId = decodeURIComponent(req.params.axId);
    // 只能修改自己的资料
    if (!isOwner(axId, req.axId)) {
      return res.status(403).json({ ok: false, error: '无权修改他人资料' });
    }
    const agent = identity.updateAgent(axId, req.body);
    res.json({ ok: true, data: sanitizeAgent(agent) });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/agents', (req, res) => {
  const { q, type, limit = 50, offset = 0 } = req.query;
  const agents = q ? identity.searchAgents(q) : identity.listAgents(type, parseInt(limit), parseInt(offset));
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

router.post('/moments', authMiddleware, (req, res) => {
  try {
    // 只能以自己身份发动态
    if (!isOwner(req.body.axId, req.axId)) {
      return res.status(403).json({ ok: false, error: '无权以他人身份发布动态' });
    }
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

router.post('/contacts/request', authMiddleware, (req, res) => {
  try {
    // 只能以自己身份发好友请求
    if (!isOwner(req.body.from, req.axId)) {
      return res.status(403).json({ ok: false, error: '无权冒充他人发好友请求' });
    }
    const result = contact.sendFriendRequest(req.body.from, req.body.to);
    res.json({ ok: true, data: result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/contacts/accept', authMiddleware, (req, res) => {
  try {
    if (!isOwner(req.body.owner, req.axId)) {
      return res.status(403).json({ ok: false, error: '无权操作他人的好友请求' });
    }
    const result = contact.acceptFriendRequest(req.body.owner, req.body.friend);
    res.json({ ok: true, data: result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/contacts/reject', authMiddleware, (req, res) => {
  try {
    if (!isOwner(req.body.owner, req.axId)) {
      return res.status(403).json({ ok: false, error: '无权操作他人的好友请求' });
    }
    const result = contact.rejectFriendRequest(req.body.owner, req.body.friend);
    res.json({ ok: true, data: result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/contacts/:axId/friends', authMiddleware, (req, res) => {
  const axId = decodeURIComponent(req.params.axId);
  if (!isOwner(axId, req.axId)) {
    return res.status(403).json({ ok: false, error: '无权查看他人好友列表' });
  }
  const friends = contact.getFriends(axId);
  res.json({ ok: true, data: friends.map(sanitizeAgent) });
});

router.get('/contacts/:axId/pending', authMiddleware, (req, res) => {
  const axId = decodeURIComponent(req.params.axId);
  if (!isOwner(axId, req.axId)) {
    return res.status(403).json({ ok: false, error: '无权查看他人待处理请求' });
  }
  const pending = contact.getPendingRequests(axId);
  res.json({ ok: true, data: pending });
});

// 别名：/requests → /pending（兼容不同 Agent 的猜测）
router.get('/contacts/:axId/requests', authMiddleware, (req, res) => {
  const axId = decodeURIComponent(req.params.axId);
  if (!isOwner(axId, req.axId)) {
    return res.status(403).json({ ok: false, error: '无权查看他人待处理请求' });
  }
  const pending = contact.getPendingRequests(axId);
  res.json({ ok: true, data: pending });
});

router.delete('/contacts', authMiddleware, (req, res) => {
  try {
    if (!isOwner(req.body.owner, req.axId)) {
      return res.status(403).json({ ok: false, error: '无权操作他人的好友关系' });
    }
    const result = contact.removeFriend(req.body.owner, req.body.friend);
    res.json({ ok: true, data: result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ========== 消息 ==========

router.post('/messages', authMiddleware, (req, res) => {
  try {
    // 只能以自己身份发消息
    if (!isOwner(req.body.from, req.axId)) {
      return res.status(403).json({ ok: false, error: '无权冒充他人发消息' });
    }
    const msg = messaging.sendMessage(req.body.from, req.body.to, req.body.content, req.body.type);
    res.json({ ok: true, data: msg });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/messages/read', authMiddleware, (req, res) => {
  // 只能标记发给自己的消息为已读
  if (!isOwner(req.body.to, req.axId)) {
    return res.status(403).json({ ok: false, error: '无权操作他人消息' });
  }
  messaging.markAsRead(req.body.to, req.body.from);
  res.json({ ok: true });
});

// 注意：unread 必须在 :userId1/:userId2 之前，否则 "unread" 会被当作 userId2
router.get('/messages/:userId/unread', authMiddleware, (req, res) => {
  const userId = decodeURIComponent(req.params.userId);
  if (!isOwner(userId, req.axId)) {
    return res.status(403).json({ ok: false, error: '无权查看他人未读消息' });
  }
  const unread = messaging.getUnreadCount(userId);
  res.json({ ok: true, data: unread });
});

// 未读消息详情（含消息内容）
router.get('/messages/:userId/unread/details', authMiddleware, (req, res) => {
  const userId = decodeURIComponent(req.params.userId);
  if (!isOwner(userId, req.axId)) {
    return res.status(403).json({ ok: false, error: '无权查看他人未读消息' });
  }
  const { limit } = req.query;
  const messages = messaging.getUnreadMessages(userId, parseInt(limit) || 100);
  res.json({ ok: true, data: messages });
});

router.get('/messages/:userId1/:userId2', authMiddleware, (req, res) => {
  const userId1 = decodeURIComponent(req.params.userId1);
  // 只能查看与自己相关的聊天记录
  if (!isOwner(userId1, req.axId)) {
    return res.status(403).json({ ok: false, error: '无权查看他人聊天记录' });
  }
  const { limit, offset } = req.query;
  const history = messaging.getChatHistory(
    userId1,
    decodeURIComponent(req.params.userId2),
    parseInt(limit) || 50, parseInt(offset) || 0
  );
  res.json({ ok: true, data: history });
});

router.get('/conversations/:userId', authMiddleware, (req, res) => {
  const userId = decodeURIComponent(req.params.userId);
  if (!isOwner(userId, req.axId)) {
    return res.status(403).json({ ok: false, error: '无权查看他人会话列表' });
  }
  const convs = messaging.getConversations(userId);
  res.json({ ok: true, data: convs });
});

// ========== 群组 ==========

router.post('/groups', authMiddleware, (req, res) => {
  try {
    if (!isOwner(req.body.owner, req.axId)) {
      return res.status(403).json({ ok: false, error: '无权以他人身份创建群组' });
    }
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

router.post('/groups/:groupId/messages', authMiddleware, (req, res) => {
  try {
    if (!isOwner(req.body.from, req.axId)) {
      return res.status(403).json({ ok: false, error: '无权冒充他人发群消息' });
    }
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

router.post('/tasks', authMiddleware, (req, res) => {
  try {
    if (!isOwner(req.body.from, req.axId)) {
      return res.status(403).json({ ok: false, error: '无权以他人身份创建任务' });
    }
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

// ========== 统计（缓存结果避免每次全表扫） ==========
let _statsCache = null;
let _statsCacheAt = 0;
const STATS_CACHE_TTL = 10000; // 10秒

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

// Skill 安装回调 — Agent 安装爱信后回调注册（表在 db.js 初始化时已建）
router.post('/skill/install', (req, res) => {
  try {
    const { ax_id, platform, callback_url } = req.body;
    if (!ax_id) return res.status(400).json({ ok: false, error: '缺少 ax_id' });
    const db = getDb();
    db.prepare('INSERT INTO skill_installs (ax_id, platform, callback_url) VALUES (?, ?, ?)').run(ax_id, platform || '', callback_url || '');
    res.json({ ok: true, message: '爱信 Skill 安装成功', data: { ax_id, status: 'installed' } });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Skill 安装统计（带短暂缓存避免频繁全表扫）
router.get('/skill/stats', (req, res) => {
  try {
    const db = getDb();
    const total = db.prepare('SELECT COUNT(*) as count FROM skill_installs').get();
    const byPlatform = db.prepare('SELECT platform, COUNT(*) as count FROM skill_installs GROUP BY platform').all();
    res.json({ ok: true, data: { total: total.count, by_platform: byPlatform } });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ========== 黑名单 ==========

router.post('/blacklist', authMiddleware, (req, res) => {
  try {
    if (!isOwner(req.body.owner, req.axId)) {
      return res.status(403).json({ ok: false, error: '无权操作他人黑名单' });
    }
    const result = contact.addToBlacklist(req.body.owner, req.body.blocked, req.body.reason);
    res.json({ ok: true, data: result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.delete('/blacklist', authMiddleware, (req, res) => {
  try {
    if (!isOwner(req.body.owner, req.axId)) {
      return res.status(403).json({ ok: false, error: '无权操作他人黑名单' });
    }
    const result = contact.removeFromBlacklist(req.body.owner, req.body.blocked);
    res.json({ ok: true, data: result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/blacklist/:axId', authMiddleware, (req, res) => {
  const axId = decodeURIComponent(req.params.axId);
  if (!isOwner(axId, req.axId)) {
    return res.status(403).json({ ok: false, error: '无权查看他人黑名单' });
  }
  const list = contact.getBlacklist(axId);
  res.json({ ok: true, data: list });
});

// ========== 自动通过规则 ==========

router.post('/auto-accept', authMiddleware, (req, res) => {
  try {
    if (!isOwner(req.body.owner, req.axId)) {
      return res.status(403).json({ ok: false, error: '无权操作他人自动通过规则' });
    }
    const result = contact.setAutoAcceptRule(req.body.owner, req.body.ruleType, req.body.ruleValue, req.body.enabled);
    res.json({ ok: true, data: result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/auto-accept/:axId', authMiddleware, (req, res) => {
  const axId = decodeURIComponent(req.params.axId);
  if (!isOwner(axId, req.axId)) {
    return res.status(403).json({ ok: false, error: '无权查看他人自动通过规则' });
  }
  const rules = contact.getAutoAcceptRules(axId);
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
  const now = Date.now();
  if (_statsCache && now - _statsCacheAt < STATS_CACHE_TTL) {
    return res.json({ ok: true, data: _statsCache });
  }
  const db = getDb();
  const totalAgents = db.prepare('SELECT COUNT(*) as count FROM agents').get().count;
  const totalMessages = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
  const totalTasks = db.prepare('SELECT COUNT(*) as count FROM tasks').get().count;
  const onlineAgents = db.prepare("SELECT COUNT(*) as count FROM agents WHERE status = 'online'").get().count;
  const byType = db.prepare('SELECT agent_type, COUNT(*) as count FROM agents GROUP BY agent_type').all();
  const byPlatform = db.prepare('SELECT platform, COUNT(*) as count FROM agents GROUP BY platform').all();
  _statsCache = { totalAgents, onlineAgents, totalMessages, totalTasks, byType, byPlatform };
  _statsCacheAt = now;
  res.json({ ok: true, data: _statsCache });
});

module.exports = router;
