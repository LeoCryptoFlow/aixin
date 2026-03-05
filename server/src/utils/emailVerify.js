/**
 * 邮箱验证码工具
 */

// 存储验证码 { email: { code, expireTime, attempts } }
const verificationCodes = new Map();

/**
 * 生成6位数字验证码
 */
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * 发送验证码
 * @param {string} email 邮箱地址
 * @returns {Object} { ok, code, error }
 */
function sendVerificationCode(email) {
  const now = Date.now();
  
  // 检查是否频繁发送
  if (verificationCodes.has(email)) {
    const existing = verificationCodes.get(email);
    if (now - existing.sentTime < 60000) { // 1分钟内不能重复发送
      return {
        ok: false,
        error: '验证码发送过于频繁，请稍后再试',
        retryAfter: Math.ceil((60000 - (now - existing.sentTime)) / 1000)
      };
    }
  }

  const code = generateCode();
  const expireTime = now + 300000; // 5分钟有效期

  verificationCodes.set(email, {
    code,
    expireTime,
    sentTime: now,
    attempts: 0
  });

  // TODO: 实际项目中应该调用邮件服务发送验证码
  console.log(`[邮箱验证码] ${email}: ${code} (5分钟内有效)`);

  return {
    ok: true,
    code, // 开发环境返回code，生产环境应该删除
    message: '验证码已发送'
  };
}

/**
 * 验证验证码
 * @param {string} email 邮箱地址
 * @param {string} code 验证码
 * @returns {Object} { ok, error }
 */
function verifyCode(email, code) {
  if (!verificationCodes.has(email)) {
    return { ok: false, error: '验证码不存在或已过期' };
  }

  const record = verificationCodes.get(email);
  const now = Date.now();

  // 检查是否过期
  if (now > record.expireTime) {
    verificationCodes.delete(email);
    return { ok: false, error: '验证码已过期' };
  }

  // 检查尝试次数
  if (record.attempts >= 5) {
    verificationCodes.delete(email);
    return { ok: false, error: '验证失败次数过多，请重新获取验证码' };
  }

  // 验证码错误
  if (record.code !== code) {
    record.attempts++;
    return { ok: false, error: '验证码错误', remaining: 5 - record.attempts };
  }

  // 验证成功，删除记录
  verificationCodes.delete(email);
  return { ok: true };
}

/**
 * 清理过期验证码
 */
function cleanup() {
  const now = Date.now();
  for (const [email, record] of verificationCodes.entries()) {
    if (now > record.expireTime) {
      verificationCodes.delete(email);
    }
  }
}

// 每分钟清理一次
setInterval(cleanup, 60000);

module.exports = {
  sendVerificationCode,
  verifyCode
};
