const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database/db');

/**
 * 创建任务委派
 */
function createTask(fromId, toId, { title, description, inputData, priority }) {
  const db = getDb();
  const taskId = `task_${uuidv4().substring(0, 8)}`;
  db.prepare(`
    INSERT INTO tasks (task_id, from_id, to_id, title, description, input_data, priority)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(taskId, fromId, toId, title, description || '', JSON.stringify(inputData || {}), priority || 'normal');
  return getTask(taskId);
}

/**
 * 获取任务详情
 */
function getTask(taskId) {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE task_id = ?').get(taskId);
  if (task) {
    task.input_data = JSON.parse(task.input_data || '{}');
    task.output_data = JSON.parse(task.output_data || '{}');
  }
  return task;
}

/**
 * 更新任务状态
 */
function updateTaskStatus(taskId, status, outputData) {
  const db = getDb();
  db.prepare(`
    UPDATE tasks SET status = ?, output_data = ?, updated_at = datetime('now')
    WHERE task_id = ?
  `).run(status, JSON.stringify(outputData || {}), taskId);
  return getTask(taskId);
}

/**
 * 接受任务
 */
function acceptTask(taskId) {
  return updateTaskStatus(taskId, 'in_progress', {});
}

/**
 * 完成任务
 */
function completeTask(taskId, outputData) {
  return updateTaskStatus(taskId, 'completed', outputData);
}

/**
 * 拒绝任务
 */
function rejectTask(taskId, reason) {
  return updateTaskStatus(taskId, 'rejected', { reason });
}

/**
 * 获取发出的任务
 */
function getSentTasks(fromId) {
  const db = getDb();
  return db.prepare('SELECT * FROM tasks WHERE from_id = ? ORDER BY created_at DESC').all(fromId)
    .map(t => ({ ...t, input_data: JSON.parse(t.input_data || '{}'), output_data: JSON.parse(t.output_data || '{}') }));
}

/**
 * 获取收到的任务
 */
function getReceivedTasks(toId) {
  const db = getDb();
  return db.prepare('SELECT * FROM tasks WHERE to_id = ? ORDER BY created_at DESC').all(toId)
    .map(t => ({ ...t, input_data: JSON.parse(t.input_data || '{}'), output_data: JSON.parse(t.output_data || '{}') }));
}

module.exports = {
  createTask,
  getTask,
  updateTaskStatus,
  acceptTask,
  completeTask,
  rejectTask,
  getSentTasks,
  getReceivedTasks
};
