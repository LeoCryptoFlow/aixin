/**
 * 接口防刷和限频工具
 */

// 存储请求记录 { key: [timestamp1, timestamp2, ...] }
const requestLog = new Map();

// 存储黑名单 { key: expireTime }
const blacklist = new Map();

/**
 * 清理过期记录
 */
function cleanup() {
  const now = Date.now();
  // 清理请求日志
  for (const [key, timestamps] of requestLog.entries()) {
    const valid = timestamps.filter(t => now - t < 3600000); // 保留1小时内的
    if (valid.length === 0) {
      requestLog.delete(key);
    } else {
      requestLog.set(key, valid);
    }
  }
  // 清理黑名单
  for (const [key, expireTime] of blacklist.entries()) {
    if (now > expireTime) {
      blacklist.delete(key);
    }
  }
}

// 每5分钟清理一次
setInterval(cleanup, 300000);

/**
 * 限频中间件
 * @param {Object} options 配置选项
 * @param {number} options.windowMs 时间窗口（毫秒）
 * @param {number} options.maxRequests 最大请求数
 * @param {string} options.keyGenerator 生成限频key的函数
 * @param {number} options.blockDuration 封禁时长（毫秒）
 */
function rateLimit(options = {}) {
  const {
    windowMs = 60000, // 默认1分钟
    maxRequests = 10, // 默认10次
    keyGenerator = (req) => req.ip || req.connection.remoteAddress,
    blockDuration = 600000 // 默认封禁10分钟
  } = options;

  return (req, res, next) => {
    const key = keyGenerator(req);
    const now = Date.now();

    // 检查是否在黑名单中
    if (blacklist.has(key)) {
      const expireTime = blacklist.get(key);
      if (now < expireTime) {
        const remainingSeconds = Math.ceil((expireTime - now) / 1000);
        return res.status(429).json({
          ok: false,
          error: '请求过于频繁，已被临时封禁',
          retryAfter: remainingSeconds
        });
      } else {
        blacklist.delete(key);
      }
    }

    // 获取请求记录
    let timestamps = requestLog.get(key) || [];
    
    // 过滤时间窗口内的请求
    timestamps = timestamps.filter(t => now - t < windowMs);

    // 检查是否超过限制
    if (timestamps.length >= maxRequests) {
      // 加入黑名单
      blacklist.set(key, now + blockDuration);
      requestLog.delete(key);
      
      return res.status(429).json({
        ok: false,
        error: '请求过于频繁，请稍后再试',
        retryAfter: Math.ceil(blockDuration / 1000)
      });
    }

    // 记录本次请求
    timestamps.push(now);
    requestLog.set(key, timestamps);

    // 设置响应头
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', maxRequests - timestamps.length);
    res.setHeader('X-RateLimit-Reset', new Date(now + windowMs).toISOString());

    next();
  };
}

/**
 * 手动封禁IP
 */
function blockIP(ip, duration = 3600000) {
  blacklist.set(ip, Date.now() + duration);
}

/**
 * 解除封禁
 */
function unblockIP(ip) {
  blacklist.delete(ip);
}

/**
 * 获取统计信息
 */
function getStats() {
  return {
    activeKeys: requestLog.size,
    blockedIPs: blacklist.size,
    totalRequests: Array.from(requestLog.values()).reduce((sum, arr) => sum + arr.length, 0)
  };
}

module.exports = {
  rateLimit,
  blockIP,
  unblockIP,
  getStats
};
