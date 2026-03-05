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
 * 生成 AI-ID
 * 格式: AI-[n位数字]，默认6位
 * 例如: AI-012833, AI-735912
 */
function generateAxId(agentType, region, length = 6) {
  const seed = `${agentType}.${region || 'CN'}.${Date.now()}.${Math.random()}`;
  const hash = uuidv5(seed, AIXIN_NAMESPACE).replace(/-/g, '');
  const modulo = Math.pow(10, length);
  const num = parseInt(hash.substring(0, 10), 16) % modulo;
  const id = String(num).padStart(length, '0');
  return `AI-${id}`;
}

/**
 * 解析 AI-ID
 */
function parseAxId(axId) {
  // 支持新格式 AI-XXXX(多位数字)
  const newMatch = axId.match(/^AI-(\d+)$/);
  if (newMatch) {
    return { type: 'personal', region: 'CN', number: newMatch[1] };
  }
  // 兼容旧格式 AX-U-CN-XXXX
  const oldMatch = axId.match(/^AX-([US])-([A-Z]{2})-(\d{4})$/);
  if (oldMatch) {
    return {
      type: oldMatch[1] === 'U' ? 'personal' : 'skill',
      region: oldMatch[2],
      number: oldMatch[3]
    };
  }
  return null;
}

/**
 * 注册新 Agent
 */
function registerAgent({ nickname, password, agentType, platform, region, avatar, ownerName, bio, skillTags, modelBase, capabilities, email }) {
  const type = agentType || AGENT_TYPES.PERSONAL;
  const db = getDb();

  // 邮箱唯一性校验
  if (email) {
    const existing = db.prepare("SELECT ax_id FROM agents WHERE email = ? AND email != ''").get(email);
    if (existing) throw new Error('该邮箱已被注册');
  }

  // 检查是否 ID 冲突并重试，添加 try-catch 处理并发插入
  let finalId;
  let attempts = 0;
  let inserted = false;

  while (!inserted && attempts < 20) {
    // 超过3次重试后，增加ID长度（每次+1位数），以防ID池被极度耗尽，保持纯数字
    const idLength = attempts >= 3 ? 6 + Math.floor(attempts / 3) : 6;
    finalId = generateAxId(type, region, idLength);
    
    // 如果发生冲突重试，我们只需再次调用 generateAxId() 获取由时间戳新生成的即可
    // 由于 generateAxId 包含了 Date.now() 和 Math.random()，重试时天然会生成不同的值
    
    // 乐观查询，若已存在则直接重试
    if (db.prepare('SELECT ax_id FROM agents WHERE ax_id = ?').get(finalId)) {
      attempts++;
      continue;
    }

    try {
      db.prepare(`
        INSERT INTO agents (ax_id, agent_type, nickname, password, email, email_verified, platform, region, avatar, owner_name, bio, skill_tags, model_base, capabilities)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        finalId,
        type,
        nickname,
        password || '',
        email || '',
        email ? 1 : 0,  // 通过验证码注册的视为已验证
        platform || 'openclaw',
        (region || 'CN').toUpperCase(),
        avatar || '',
        ownerName || '',
        bio || '',
        JSON.stringify(skillTags || []),
        modelBase || '',
        JSON.stringify(capabilities || [])
      );
      inserted = true;
    } catch (err) {
      // 若发生 UNIQUE constraint 冲突说明被并发占用，继续重试
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        attempts++;
      } else {
        throw err;
      }
    }
  }

  if (!inserted) {
    throw new Error('服务器繁忙，生成 ID 冲突，请稍后再试');
  }

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
 * 获取所有 Agent（支持分页，避免全量返回）
 */
function listAgents(agentType, limit = 50, offset = 0) {
  const db = getDb();
  const parse = (a) => {
    a.capabilities = JSON.parse(a.capabilities || '[]');
    a.skill_tags = JSON.parse(a.skill_tags || '[]');
    return a;
  };
  if (agentType) {
    return db.prepare(
      'SELECT * FROM agents WHERE agent_type = ? ORDER BY rating DESC, created_at DESC LIMIT ? OFFSET ?'
    ).all(agentType, limit, offset).map(parse);
  }
  return db.prepare(
    'SELECT * FROM agents ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(limit, offset).map(parse);
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
