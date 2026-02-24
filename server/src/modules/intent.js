/**
 * 意图分拣器 — 预处理消息，区分"闲聊社交"和"商务协作指令"
 */

// 商务关键词
const BUSINESS_KEYWORDS = [
  '需求', '报价', '合同', '委托', '任务', '项目', '合作', '对接', '交付', '付款',
  '需要你帮', '能不能做', '多少钱', '怎么收费', '接单', '外包',
  'task', 'project', 'quote', 'contract', 'deliver', 'payment', 'hire', 'outsource'
];

// 社交关键词
const SOCIAL_KEYWORDS = [
  '你好', '在吗', '哈哈', '嗯嗯', '好的', '谢谢', '再见', '早上好', '晚安',
  'hi', 'hello', 'thanks', 'bye', 'lol', '😊', '👍', '🎉'
];

// 指令模式
const COMMAND_PATTERNS = [
  /^\/task\s/i,
  /^\/search\s/i,
  /^\/match\s/i,
  /^\/rate\s/i,
  /^\/biz\s/i
];

/**
 * 分析消息意图
 * @returns {{ intent: string, confidence: number, keywords: string[] }}
 * intent: 'social' | 'business' | 'command' | 'mixed'
 */
function classifyIntent(content) {
  if (!content || typeof content !== 'string') {
    return { intent: 'social', confidence: 0.5, keywords: [] };
  }

  const text = content.trim().toLowerCase();

  // 1. 先检查是否是指令
  for (const pattern of COMMAND_PATTERNS) {
    if (pattern.test(text)) {
      return { intent: 'command', confidence: 1.0, keywords: [text.split(/\s/)[0]] };
    }
  }

  // 2. 计算商务/社交得分
  const bizHits = BUSINESS_KEYWORDS.filter(k => text.includes(k.toLowerCase()));
  const socHits = SOCIAL_KEYWORDS.filter(k => text.includes(k.toLowerCase()));

  const bizScore = bizHits.length;
  const socScore = socHits.length;

  if (bizScore === 0 && socScore === 0) {
    // 长文本更可能是商务
    return {
      intent: text.length > 100 ? 'business' : 'social',
      confidence: 0.4,
      keywords: []
    };
  }

  if (bizScore > 0 && socScore === 0) {
    return { intent: 'business', confidence: Math.min(0.5 + bizScore * 0.15, 1.0), keywords: bizHits };
  }

  if (socScore > 0 && bizScore === 0) {
    return { intent: 'social', confidence: Math.min(0.5 + socScore * 0.15, 1.0), keywords: socHits };
  }

  // 混合
  return {
    intent: bizScore >= socScore ? 'business' : 'mixed',
    confidence: 0.6,
    keywords: [...bizHits, ...socHits]
  };
}

/**
 * 为消息附加意图标签（中间件用）
 */
function tagMessage(message) {
  const analysis = classifyIntent(message.content);
  return {
    ...message,
    intent: analysis.intent,
    intent_confidence: analysis.confidence,
    intent_keywords: analysis.keywords
  };
}

module.exports = { classifyIntent, tagMessage };
