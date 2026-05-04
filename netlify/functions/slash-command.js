'use strict';

require('dotenv').config();

const crypto = require('crypto');
const qs = require('querystring');

const { getTasksByAssignee, findTaskByName, updateTask } = require('../../src/services/airtable');
const { resolveUserEmail } = require('../../src/utils/userMap');
const { buildPersonalTaskBlocks } = require('../../src/utils/taskParser');

function verifySlackSignature(signingSecret, requestBody, timestamp, slackSignature) {
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
  if (parseInt(timestamp, 10) < fiveMinutesAgo) return false;
  const sigBaseString = `v0:${timestamp}:${requestBody}`;
  const mySignature = 'v0=' + crypto
    .createHmac('sha256', signingSecret)
    .update(sigBaseString, 'utf8')
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(mySignature, 'utf8'),
      Buffer.from(slackSignature, 'utf8')
    );
  } catch {
    return false;
  }
}

function ephemeral(text, extra = {}) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response_type: 'ephemeral', text, ...extra }),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const timestamp = event.headers['x-slack-request-timestamp'];
  const slackSignature = event.headers['x-slack-signature'];
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!timestamp || !slackSignature || !signingSecret) {
    return { statusCode: 400, body: 'Missing signature headers' };
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : (event.body || '');

  if (!verifySlackSignature(signingSecret, rawBody, timestamp, slackSignature)) {
    return { statusCode: 401, body: 'Invalid signature' };
  }

  const body = qs.parse(rawBody);
  const { command, user_id, text } = body;
  const taskQuery = (text || '').trim();

  console.log('SLASH-COMMAND:', command, 'user:', user_id, 'text:', taskQuery);

  let userEmail;
  try {
    userEmail = await resolveUserEmail(user_id);
  } catch (err) {
    console.error('resolveUserEmail failed:', err.message);
  }

  if (!userEmail) {
    return ephemeral('⚠️ Could not resolve your Slack account. Make sure your email is set in your Slack profile.');
  }

  // ── /done [task] ──────────────────────────────────────────────────────────
  if (command === '/done') {
    if (!taskQuery) return ephemeral('Usage: `/done [part of task name]`');
    let task;
    try {
      task = await findTaskByName(taskQuery, userEmail);
    } catch (err) {
      console.error('findTaskByName failed:', err.message);
      return ephemeral('⚠️ Could not search tasks. Please try again.');
    }
    if (!task) return ephemeral(`⚠️ No open task found matching "${taskQuery}".`);
    await updateTask(task.id, { status: 'Done', dateCompleted: new Date().toISOString().split('T')[0] }, task.table);
    return ephemeral(`✅ Marked done: *${task.taskName}*`);
  }

  // ── /seturgent [task] ─────────────────────────────────────────────────────
  if (command === '/seturgent') {
    if (!taskQuery) return ephemeral('Usage: `/seturgent [part of task name]`');
    let task;
    try {
      task = await findTaskByName(taskQuery, userEmail);
    } catch (err) {
      console.error('findTaskByName failed:', err.message);
      return ephemeral('⚠️ Could not search tasks. Please try again.');
    }
    if (!task) return ephemeral(`⚠️ No open task found matching "${taskQuery}".`);
    await updateTask(task.id, { priority: 'Urgent' }, task.table);
    return ephemeral(`🔴 Set to urgent: *${task.taskName}*`);
  }

  // ── list commands (/mylist, /inprogress, /urgent) ─────────────────────────
  let tasks;
  try {
    tasks = await getTasksByAssignee(userEmail);
  } catch (err) {
    console.error('getTasksByAssignee failed:', err.message);
    return ephemeral('⚠️ Could not fetch tasks. Please try again.');
  }

  let filtered = tasks;
  let title;

  if (command === '/urgent') {
    filtered = tasks.filter((t) => t.priority === 'Urgent' || t.priority === 'High');
    title = `Urgent & high priority tasks (${filtered.length})`;
  } else if (command === '/inprogress') {
    filtered = tasks.filter((t) => t.status === 'In Progress');
    title = `In-progress tasks (${filtered.length})`;
  } else {
    title = `Your open tasks (${filtered.length})`;
  }

  if (!filtered.length) {
    const empty = {
      '/mylist': 'You have no open tasks. 🎉',
      '/urgent': 'No urgent or high priority tasks.',
      '/inprogress': 'No tasks currently in progress.',
    };
    return ephemeral(empty[command] || 'No tasks found.');
  }

  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: `*${title}*` } },
    ...buildPersonalTaskBlocks(filtered, userEmail),
  ];

  return ephemeral(title, { blocks });
};
