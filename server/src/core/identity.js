const { v4: uuidv4, v5: uuidv5 } = require('uuid');
const { getDb } = require('../database/db');

// AIXin 命名空间 UUID
const AIXIN_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/**
 * 从 Agent 对象中移除敏感字段
 */
function sanitizeAgent(agent) {
  if (!agent) return agent;
  const { password, ...safe } = agent;
  return safe;
}

// 支持的平台列表
const PLATFORMS = ['openclaw', 'youdao-lobster', 'easyclaw', 'generic'];

// Agent 类型
const AGENT_TYPES = {
  PERSONAL: 'personal',  // 个人中枢助理 AX-U-
  SKILL: 'skill'         // 技能Agent AX-S-
};

/**
 * 生成 AX-ID
 * 格式: AX-[U/S]-[地区码]-[4位数字]
 * 个人助理: AX-U-CN-8899
 * 技能Agent: AX-S-CN-1234
 */
function generateAxId(agentType, region) {
  const prefix = agentType === AGENT_TYPES.SKILL ? 'S' : 'U';
  const reg = (region || 'CN').toUpperCase();
  const seed = `${prefix}.${reg}.${Date.now()}.${Math.random()}`;
  const hash = uuidv5(seed, AIXIN_NAMESPACE).replace(/-/g, '');
  const num = parseInt(hash.substring(0, 8), 16) % 10000;
  const id = String(num).padStart(4, '0');
  return `AX-${prefix}-${reg}-${id}`;
}

/**
 * 解析 AX-ID
 */
function parseAxId(axId) {
  const match = axId.match(/^AX-([US])-([A-Z]{2})-(\d{4})$/);
  if (!match) return null;
  return {
    type: match[1] === 'U' ? 'personal' : 'skill',
    region: match[2],
    number: match[3]
  };
}

/**
 * 注册新 Agent
 */
function registerAgent({ nickname, password, agentType, platform, region, avatar, ownerName, bio, skillTags, modelBase, capabilities }) {
  const type = agentType || AGENT_TYPES.PERSONAL;
  const axId = generateAxId(type, region);
  const db = getDb();

  // 检查是否 ID 冲突，极小概率，重试
  let finalId = axId;
  let attempts = 0;
  while (db.prepare('SELECT ax_id FROM agents WHERE ax_id = ?').get(finalId) && attempts < 10) {
    finalId = generateAxId(type, region);
    attempts++;
  }

  db.prepare(`
    INSERT INTO agents (ax_id, agent_type, nickname, password, platform, region, avatar, owner_name, bio, skill_tags, model_base, capabilities)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    finalId,
    type,
    nickname,
    password || '',
    platform || 'openclaw',
    (region || 'CN').toUpperCase(),
    avatar || '',
    ownerName || '',
    bio || '',
    JSON.stringify(skillTags || []),
    modelBase || '',
    JSON.stringify(capabilities || [])
  );
  return getAgent(finalId);
}

/**
 * 获取 Agent 信息
 */
function getAgent(axId) {
  const db = getDb();
  const agent = db.prepare('SELECT * FROM agents WHERE ax_id = ?').get(axId);
  if (agent) {
    agent.capabilities = JSON.parse(agent.capabilities || '[]');
    agent.skill_tags = JSON.parse(agent.skill_tags || '[]');
  }
  return agent;
}

/**
 * 更新 Agent 状态
 */
function updateAgentStatus(axId, status) {
  const db = getDb();
  db.prepare("UPDATE agents SET status = ?, updated_at = datetime('now') WHERE ax_id = ?").run(status, axId);
}

/**
 * 更新 Agent 资料
 */
function updateAgent(axId, fields) {
  const db = getDb();
  const allowed = ['nickname', 'avatar', 'bio', 'owner_name', 'skill_tags', 'model_base', 'capabilities'];
  const sets = [];
  const values = [];
  for (const [key, val] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      sets.push(`${key} = ?`);
      values.push(typeof val === 'object' ? JSON.stringify(val) : val);
    }
  }
  if (sets.length === 0) return getAgent(axId);
  sets.push("updated_at = datetime('now')");
  values.push(axId);
  db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE ax_id = ?`).run(...values);
  return getAgent(axId);
}

/**
 * 搜索 Agent（支持技能关键词搜索）
 */
function searchAgents(keyword) {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM agents WHERE nickname LIKE ? OR ax_id LIKE ? OR bio LIKE ? OR skill_tags LIKE ? LIMIT 20"
  ).all(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`).map(a => {
    a.capabilities = JSON.parse(a.capabilities || '[]');
    a.skill_tags = JSON.parse(a.skill_tags || '[]');
    return a;
  });
}

/**
 * 获取所有 Agent
 */
function listAgents(agentType) {
  const db = getDb();
  if (agentType) {
    return db.prepare('SELECT * FROM agents WHERE agent_type = ? ORDER BY rating DESC, created_at DESC').all(agentType).map(a => {
      a.capabilities = JSON.parse(a.capabilities || '[]');
      a.skill_tags = JSON.parse(a.skill_tags || '[]');
      return a;
    });
  }
  return db.prepare('SELECT * FROM agents ORDER BY created_at DESC').all().map(a => {
    a.capabilities = JSON.parse(a.capabilities || '[]');
    a.skill_tags = JSON.parse(a.skill_tags || '[]');
    return a;
  });
}

/**
 * 技能市场：按技能标签搜索
 */
function searchSkillMarket(skillKeyword) {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM agents WHERE agent_type = 'skill' AND (skill_tags LIKE ? OR bio LIKE ?) ORDER BY rating DESC LIMIT 20"
  ).all(`%${skillKeyword}%`, `%${skillKeyword}%`).map(a => {
    a.capabilities = JSON.parse(a.capabilities || '[]');
    a.skill_tags = JSON.parse(a.skill_tags || '[]');
    return a;
  });
}

/**
 * 给 Agent 评分
 */
function rateAgent(axId, score) {
  const db = getDb();
  const agent = getAgent(axId);
  if (!agent) return null;
  const newCount = agent.rating_count + 1;
  const newRating = ((agent.rating * agent.rating_count) + score) / newCount;
  db.prepare("UPDATE agents SET rating = ?, rating_count = ?, updated_at = datetime('now') WHERE ax_id = ?")
    .run(Math.round(newRating * 10) / 10, newCount, axId);
  return getAgent(axId);
}

module.exports = {
  generateAxId,
  parseAxId,
  registerAgent,
  getAgent,
  updateAgent,
  updateAgentStatus,
  searchAgents,
  listAgents,
  searchSkillMarket,
  rateAgent,
  sanitizeAgent,
  PLATFORMS,
  AGENT_TYPES
};
