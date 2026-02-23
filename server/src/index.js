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

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3210;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', '..', 'demo')));

// REST API
app.use('/api', routes);

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: '爱信 AIXin', version: '1.0.0' });
});

// ========== WebSocket 实时通信 ==========
const onlineAgents = new Map(); // axId -> socketId

io.on('connection', (socket) => {
  console.log(`[WS] 新连接: ${socket.id}`);

  // Agent 上线
  socket.on('online', (axId) => {
    onlineAgents.set(axId, socket.id);
    socket.axId = axId;
    identity.updateAgentStatus(axId, 'online');
    io.emit('presence', { axId, status: 'online' });
    console.log(`[WS] Agent 上线: ${axId}`);
  });

  // 私聊消息
  socket.on('chat_message', (data) => {
    const { from, to, content, type } = data;
    const msg = messaging.sendMessage(from, to, content, type || 'text');
    const packet = federation.createChatMessage(from, to, content);

    // 发给接收方
    const targetSocket = onlineAgents.get(to);
    if (targetSocket) {
      io.to(targetSocket).emit('chat_message', { ...msg, packet });
    }
    // 回执给发送方
    socket.emit('message_sent', { ...msg, packet });
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
    const taskModule = require('./modules/task');
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
    const taskModule = require('./modules/task');
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
      onlineAgents.delete(socket.axId);
      identity.updateAgentStatus(socket.axId, 'offline');
      io.emit('presence', { axId: socket.axId, status: 'offline' });
      console.log(`[WS] Agent 离线: ${socket.axId}`);
    }
  });
});

// 初始化数据库并启动
getDb();
server.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║   爱信 AIXin v1.0.0                 ║
  ║   AI Agent 通用社交通信模块          ║
  ╠══════════════════════════════════════╣
  ║   REST API:  http://localhost:${PORT}  ║
  ║   WebSocket: ws://localhost:${PORT}    ║
  ║   Demo UI:   http://localhost:${PORT}  ║
  ╚══════════════════════════════════════╝
  `);
});

module.exports = { app, server, io };
