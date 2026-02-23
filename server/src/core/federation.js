/**
 * AIXP - AIXin Protocol (爱信联邦通信协议)
 * 跨平台 Agent 间的标准化消息格式
 */

const { v4: uuidv4 } = require('uuid');

// 协议版本
const AIXP_VERSION = '1.0';

// 消息类型
const MSG_TYPES = {
  FRIEND_REQUEST: 'friend_request',
  FRIEND_ACCEPT: 'friend_accept',
  FRIEND_REJECT: 'friend_reject',
  CHAT_MESSAGE: 'chat_message',
  GROUP_MESSAGE: 'group_message',
  TASK_DELEGATE: 'task_delegate',
  TASK_RESULT: 'task_result',
  RESOURCE_SHARE: 'resource_share',
  PRESENCE: 'presence',
  ACK: 'ack'
};

// 内容类型
const CONTENT_TYPES = {
  TEXT: 'text',
  JSON: 'json',
  FILE: 'file',
  TASK: 'task',
  CAPABILITY_QUERY: 'capability_query',
  CAPABILITY_RESPONSE: 'capability_response'
};

/**
 * 构建 AIXP 消息包
 */
function createPacket({ type, from, to, content, payload, contentType }) {
  return {
    aixp: AIXP_VERSION,
    id: uuidv4(),
    type,
    from,
    to,
    content: content || '',
    contentType: contentType || CONTENT_TYPES.TEXT,
    payload: payload || {},
    timestamp: new Date().toISOString()
  };
}

/**
 * 验证 AIXP 消息包
 */
function validatePacket(packet) {
  if (!packet.aixp || !packet.type || !packet.from || !packet.to) {
    return { valid: false, error: '缺少必要字段: aixp, type, from, to' };
  }
  if (packet.aixp !== AIXP_VERSION) {
    return { valid: false, error: `不支持的协议版本: ${packet.aixp}` };
  }
  if (!Object.values(MSG_TYPES).includes(packet.type)) {
    return { valid: false, error: `未知消息类型: ${packet.type}` };
  }
  return { valid: true };
}

/**
 * 创建好友请求包
 */
function createFriendRequest(from, to, message) {
  return createPacket({
    type: MSG_TYPES.FRIEND_REQUEST,
    from, to,
    content: message || '请求添加好友',
    payload: { action: 'add' }
  });
}

/**
 * 创建聊天消息包
 */
function createChatMessage(from, to, content, contentType) {
  return createPacket({
    type: MSG_TYPES.CHAT_MESSAGE,
    from, to, content,
    contentType: contentType || CONTENT_TYPES.TEXT
  });
}

/**
 * 创建群聊消息包
 */
function createGroupMessage(from, groupId, content, contentType) {
  return createPacket({
    type: MSG_TYPES.GROUP_MESSAGE,
    from, to: groupId, content,
    contentType: contentType || CONTENT_TYPES.TEXT
  });
}

/**
 * 创建任务委派包
 */
function createTaskDelegation(from, to, task) {
  return createPacket({
    type: MSG_TYPES.TASK_DELEGATE,
    from, to,
    content: task.title,
    contentType: CONTENT_TYPES.TASK,
    payload: {
      taskId: task.taskId || uuidv4(),
      title: task.title,
      description: task.description || '',
      inputData: task.inputData || {},
      priority: task.priority || 'normal',
      deadline: task.deadline || null
    }
  });
}

/**
 * 创建任务结果包
 */
function createTaskResult(from, to, taskId, result) {
  return createPacket({
    type: MSG_TYPES.TASK_RESULT,
    from, to,
    content: `任务 ${taskId} 完成`,
    contentType: CONTENT_TYPES.JSON,
    payload: {
      taskId,
      status: result.status || 'completed',
      outputData: result.outputData || {},
      message: result.message || ''
    }
  });
}

module.exports = {
  AIXP_VERSION,
  MSG_TYPES,
  CONTENT_TYPES,
  createPacket,
  validatePacket,
  createFriendRequest,
  createChatMessage,
  createGroupMessage,
  createTaskDelegation,
  createTaskResult
};
