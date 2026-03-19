/**
 * 爱信认证模块 — JWT Token 签发与验证
 * 修复安全漏洞：之前仅凭 AI-ID 号码即可操作任何账号
 */
const jwt = require('jsonwebtoken');

// JWT 密钥（生产环境应从环境变量读取）
const JWT_SECRET = process.env.AIXIN_JWT_SECRET || 'aixin_jwt_secret_2026_change_in_production';
const TOKEN_EXPIRY = '7d'; // token 有效期 7 天

/**
 * 签发 JWT Token
 * @param {string} axId - 用户的 AI-ID
 * @returns {string} JWT token
 */
function signToken(axId) {
  return jwt.sign({ axId }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

/**
 * 验证 JWT Token
 * @param {string} token
 * @returns {object|null} 解码后的 payload，失败返回 null
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

/**
 * Express 认证中间件
 * 从 Authorization: Bearer <token> 头部提取并验证 token
 * 验证通过后将 req.axId 设为当前用户的 AI-ID
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: '未登录，请先登录获取 token' });
  }

  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload || !payload.axId) {
    return res.status(401).json({ ok: false, error: 'Token 无效或已过期，请重新登录' });
  }

  req.axId = payload.axId;
  next();
}

/**
 * 权限校验：确保当前登录用户只能操作自己的资源
 * @param {string} reqAxId - 请求中声明的 axId（来自 body 或 params）
 * @param {string} tokenAxId - token 中的 axId
 * @returns {boolean}
 */
function isOwner(reqAxId, tokenAxId) {
  return reqAxId === tokenAxId;
}

module.exports = {
  signToken,
  verifyToken,
  authMiddleware,
  isOwner,
  JWT_SECRET
};
