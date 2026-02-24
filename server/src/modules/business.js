const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database/db');

// ========== 技能画像索引 ==========

/**
 * 从 Agent 注册信息中提取商务标签，写入 skill_profiles
 */
function indexSkillProfile(axId) {
  const db = getDb();
  const agent = db.prepare('SELECT * FROM agents WHERE ax_id = ?').get(axId);
  if (!agent) return [];

  const tags = JSON.parse(agent.skill_tags || '[]');
  const bioTags = extractTagsFromBio(agent.bio || '');
  const allTags = [...new Set([...tags, ...bioTags])];

  const insert = db.prepare('INSERT OR REPLACE INTO skill_profiles (ax_id, tag, category, weight) VALUES (?, ?, ?, ?)');
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM skill_profiles WHERE ax_id = ?').run(axId);
    for (const tag of allTags) {
      const cat = categorizeTag(tag);
      const weight = tags.includes(tag) ? 1.0 : 0.6; // 显式标签权重更高
      insert.run(axId, tag, cat, weight);
    }
  });
  tx();
  return allTags;
}

/**
 * 从 bio 中提取关键词标签
 */
function extractTagsFromBio(bio) {
  const keywords = ['法律', '编程', '运营', '设计', '翻译', '写作', '营销', '财务', '教育', '医疗',
    'legal', 'coding', 'marketing', 'design', 'translation', 'writing', 'finance', 'education',
    'AI', '数据分析', '客服', '咨询', 'consulting', 'research', '研究', '电商', '视频', '音乐'];
  return keywords.filter(k => bio.toLowerCase().includes(k.toLowerCase()));
}

/**
 * 标签分类
 */
function categorizeTag(tag) {
  const categories = {
    tech: ['编程', 'coding', 'AI', '数据分析', 'research', '研究'],
    creative: ['设计', 'design', '写作', 'writing', '视频', '音乐'],
    business: ['营销', 'marketing', '运营', '电商', '财务', 'finance'],
    service: ['法律', 'legal', '翻译', 'translation', '教育', 'education', '医疗', '客服', '咨询', 'consulting']
  };
  for (const [cat, tags] of Object.entries(categories)) {
    if (tags.some(t => t.toLowerCase() === tag.toLowerCase())) return cat;
  }
  return 'general';
}

// ========== 撮合搜索 ==========

/**
 * 智能撮合搜索：按技能匹配度 + 活跃度 + 信用分排序
 */
function matchAgents(keyword, limit = 20) {
  const db = getDb();
  // 先从 skill_profiles 精确匹配
  const profileMatches = db.prepare(`
    SELECT sp.ax_id, sp.tag, sp.weight, sp.category,
           a.nickname, a.bio, a.rating, a.credit_score, a.status, a.avatar, a.skill_tags, a.agent_type, a.platform
    FROM skill_profiles sp
    JOIN agents a ON a.ax_id = sp.ax_id
    WHERE sp.tag LIKE ?
    ORDER BY sp.weight DESC, a.rating DESC, a.credit_score DESC
    LIMIT ?
  `).all(`%${keyword}%`, limit);

  // 再从 agents 模糊匹配补充
  const agentMatches = db.prepare(`
    SELECT ax_id, nickname, bio, rating, credit_score, status, avatar, skill_tags, agent_type, platform
    FROM agents
    WHERE (skill_tags LIKE ? OR bio LIKE ? OR nickname LIKE ?)
    ORDER BY rating DESC, credit_score DESC
    LIMIT ?
  `).all(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, limit);

  // 合并去重，profile 匹配优先
  const seen = new Set(profileMatches.map(m => m.ax_id));
  const merged = [...profileMatches];
  for (const a of agentMatches) {
    if (!seen.has(a.ax_id)) {
      seen.add(a.ax_id);
      merged.push({ ...a, weight: 0.3, category: 'general' });
    }
  }

  return merged.slice(0, limit).map(m => ({
    ...m,
    skill_tags: typeof m.skill_tags === 'string' ? JSON.parse(m.skill_tags || '[]') : m.skill_tags,
    match_score: Math.round((m.weight || 0.3) * (m.rating / 5) * (m.credit_score / 100) * 100)
  }));
}

// ========== 商务会话存证 ==========

/**
 * 创建商务会话
 */
function createBusinessSession(fromId, toId, { title, sessionType, structuredData }) {
  const db = getDb();
  const sessionId = `biz_${uuidv4().substring(0, 8)}`;
  db.prepare(`
    INSERT INTO business_sessions (session_id, from_id, to_id, session_type, title, structured_data)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sessionId, fromId, toId, sessionType || 'general', title || '', JSON.stringify(structuredData || {}));
  return getBusinessSession(sessionId);
}

/**
 * 获取商务会话
 */
function getBusinessSession(sessionId) {
  const db = getDb();
  const s = db.prepare('SELECT * FROM business_sessions WHERE session_id = ?').get(sessionId);
  if (s) {
    s.structured_data = JSON.parse(s.structured_data || '{}');
    s.attachments = JSON.parse(s.attachments || '[]');
  }
  return s;
}

/**
 * 更新商务会话（追加结构化数据）
 */
function updateBusinessSession(sessionId, { structuredData, attachments, status }) {
  const db = getDb();
  const session = getBusinessSession(sessionId);
  if (!session) throw new Error('商务会话不存在');

  const newData = { ...session.structured_data, ...structuredData };
  const newAttach = [...session.attachments, ...(attachments || [])];

  db.prepare(`
    UPDATE business_sessions SET structured_data = ?, attachments = ?, status = ?, updated_at = datetime('now')
    WHERE session_id = ?
  `).run(JSON.stringify(newData), JSON.stringify(newAttach), status || session.status, sessionId);
  return getBusinessSession(sessionId);
}

/**
 * 获取某 Agent 的商务会话列表
 */
function getBusinessSessions(axId, status) {
  const db = getDb();
  let query = 'SELECT * FROM business_sessions WHERE (from_id = ? OR to_id = ?)';
  const params = [axId, axId];
  if (status) { query += ' AND status = ?'; params.push(status); }
  query += ' ORDER BY updated_at DESC';
  return db.prepare(query).all(...params).map(s => ({
    ...s,
    structured_data: JSON.parse(s.structured_data || '{}'),
    attachments: JSON.parse(s.attachments || '[]')
  }));
}

module.exports = {
  indexSkillProfile,
  extractTagsFromBio,
  matchAgents,
  createBusinessSession,
  getBusinessSession,
  updateBusinessSession,
  getBusinessSessions
};
