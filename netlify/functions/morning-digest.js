'use strict';

require('dotenv').config();

const { schedule } = require('@netlify/functions');
const { getAllOpenTasks } = require('../../src/services/airtable');
const { postMessage } = require('../../src/services/slack');
const { groupTasksByAssignee, buildPriorityBlocks, formatPriorityEmoji } = require('../../src/utils/taskParser');

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function formatDate(date) {
  return `${DAYS[date.getUTCDay()]}, ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

async function sendDigest() {
  const channel = process.env.DIGEST_CHANNEL_ID;
  if (!channel) {
    console.error('DIGEST_CHANNEL_ID not set — skipping digest');
    return;
  }

  const tasks = await getAllOpenTasks();
  const today = new Date();
  const dateStr = formatDate(today);

  if (!tasks.length) {
    await postMessage(channel, `📋 *Daily Task Digest — ${dateStr}*\n\nNo open tasks today. 🎉`);
    return;
  }

  const grouped = groupTasksByAssignee(tasks);

  // Build Block Kit blocks
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `📋 Daily Task Digest — ${dateStr}`, emoji: true },
    },
    { type: 'divider' },
  ];

  for (const [assigneeEmail, assigneeTasks] of Object.entries(grouped)) {
    const displayName = assigneeEmail !== 'Unassigned'
      ? capitalize(assigneeEmail.split('@')[0])
      : 'Unassigned';

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*${displayName}'s Tasks (${assigneeTasks.length})*` },
    });

    // Group by priority and render
    const priorityGroups = { Urgent: [], High: [], Medium: [], Low: [] };
    for (const task of assigneeTasks) {
      const p = task.priority || 'Medium';
      if (priorityGroups[p]) priorityGroups[p].push(task);
    }

    for (const [priority, items] of Object.entries(priorityGroups)) {
      if (!items.length) continue;
      const emoji = formatPriorityEmoji(priority);
      const lines = items.map((t) => `  • ${t.taskName}`).join('\n');
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `${emoji} *${priority}*\n${lines}` },
      });
    }

    blocks.push({ type: 'divider' });
  }

  const fallbackText = `📋 Daily Task Digest — ${dateStr} | ${tasks.length} open tasks`;

  await postMessage(channel, fallbackText, { blocks });
  console.log(`Morning digest sent: ${tasks.length} tasks across ${Object.keys(grouped).length} assignees`);
}

// Netlify Scheduled Function — runs weekdays at 8:00 AM EST / 9:00 AM EDT (1:00 PM UTC)
exports.handler = schedule('0 13 * * 1-5', async () => {
  try {
    await sendDigest();
  } catch (err) {
    console.error('Morning digest failed:', err);
  }
  return { statusCode: 200 };
});

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
