const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const routes = require('./api/routes');
const { getDb } = require('./database/db');
const identity = require('./core/identity');
const federation = require('./core/federation');
const messaging = require('./modules/messaging');
const contact = require('./modules/contact');
const business = require('./modules/business');
const intentModule = require('./modules/intent');
// 提前 require，避免每次 socket 事件触发时重新解析模块
const taskModule = require('./modules/task');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3210;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', '..', 'website')));

// REST API
app.use('/api', routes);

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: '爱信 AIXin', version: '2.0.0' });
});

// ========== WebSocket 实时通信 ==========
const onlineAgents = new Map(); // axId -> socketId

io.on('connection', (socket) => {
  console.log(`[WS] 新连接: ${socket.id}`);

  // Agent 上线（只广播给好友，不是所有连接）
  socket.on('online', (axId) => {
    onlineAgents.set(axId, socket.id);
    socket.axId = axId;
    identity.updateAgentStatus(axId, 'online');
    // 定向通知好友，而非全局广播
    _notifyFriendsPresence(axId, 'online');
    console.log(`[WS] Agent 上线: ${axId}`);
  });

  // 私聊消息（含意图分拣）
  socket.on('chat_message', (data) => {
    const { from, to, content, type } = data;
    const msg = messaging.sendMessage(from, to, content, type || 'text');
    const packet = federation.createChatMessage(from, to, content);
    const intentTag = intentModule.classifyIntent(content);

    const enrichedMsg = { ...msg, packet, intent: intentTag };

    // 发给接收方
    const targetSocket = onlineAgents.get(to);
    if (targetSocket) {
      io.to(targetSocket).emit('chat_message', enrichedMsg);
    }
    // 回执给发送方
    socket.emit('message_sent', enrichedMsg);
  });

  // 群聊消息
  socket.on('group_message', (data) => {
    const { groupId, from, content, type } = data;
    const msg = messaging.sendGroupMessage(groupId, from, content, type || 'text');
    const group = messaging.getGroup(groupId);

    if (group) {
      group.members.forEach(member => {
        if (member.ax_id !== from) {
          const targetSocket = onlineAgents.get(member.ax_id);
          if (targetSocket) {
            io.to(targetSocket).emit('group_message', { ...msg, groupId, senderName: identity.getAgent(from)?.nickname });
          }
        }
      });
    }
    socket.emit('message_sent', msg);
  });

  // 好友请求
  socket.on('friend_request', (data) => {
    const { from, to, message } = data;
    try {
      contact.sendFriendRequest(from, to);
      const packet = federation.createFriendRequest(from, to, message);
      const targetSocket = onlineAgents.get(to);
      if (targetSocket) {
        io.to(targetSocket).emit('friend_request', { from, message, packet });
      }
      socket.emit('friend_request_sent', { to });
    } catch (e) {
      socket.emit('error', { message: e.message });
    }
  });

  // 接受好友
  socket.on('friend_accept', (data) => {
    const { owner, friend } = data;
    contact.acceptFriendRequest(owner, friend);
    const targetSocket = onlineAgents.get(friend);
    if (targetSocket) {
      io.to(targetSocket).emit('friend_accepted', { by: owner });
    }
  });

  // 任务委派
  socket.on('task_delegate', (data) => {
    const { from, to, title, description, inputData, priority } = data;
    const t = taskModule.createTask(from, to, { title, description, inputData, priority });
    const packet = federation.createTaskDelegation(from, to, { taskId: t.task_id, title, description, inputData, priority });

    const targetSocket = onlineAgents.get(to);
    if (targetSocket) {
      io.to(targetSocket).emit('task_received', { ...t, packet });
    }
    socket.emit('task_sent', t);
  });

  // 任务结果
  socket.on('task_result', (data) => {
    const { taskId, outputData, status } = data;
    const t = taskModule.updateTaskStatus(taskId, status || 'completed', outputData);
    if (t) {
      const targetSocket = onlineAgents.get(t.from_id);
      if (targetSocket) {
        io.to(targetSocket).emit('task_result', t);
      }
    }
  });

  // 断开连接
  socket.on('disconnect', () => {
    if (socket.axId) {
      const axId = socket.axId;
      onlineAgents.delete(axId);
      identity.updateAgentStatus(axId, 'offline');
      // 定向通知好友，而非全局广播
      _notifyFriendsPresence(axId, 'offline');
      console.log(`[WS] Agent 离线: ${axId}`);
    }
  });
});

/**
 * 定向通知好友在线状态（替代 io.emit 全局广播）
 * io.emit 是 O(n)，连接数多时性能差
 */
function _notifyFriendsPresence(axId, status) {
  try {
    const friends = contact.getFriends(axId);
    friends.forEach(f => {
      const friendSocket = onlineAgents.get(f.ax_id);
      if (friendSocket) {
        io.to(friendSocket).emit('presence', { axId, status });
      }
    });
  } catch (e) {
    // 好友查询失败不影响主流程
  }
}

// 初始化数据库并启动
getDb();
server.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║   爱信 AIXin v2.0.0                 ║
  ║   AI Agent 通用社交通信模块          ║
  ╠══════════════════════════════════════╣
  ║   REST API:  http://localhost:${PORT}  ║
  ║   WebSocket: ws://localhost:${PORT}    ║
  ║   Demo UI:   http://localhost:${PORT}  ║
  ╚══════════════════════════════════════╝
  `);
});

module.exports = { app, server, io };
