'use strict';

require('dotenv').config();

const { schedule } = require('@netlify/functions');
const { getAllOpenTasks } = require('../../src/services/airtable');
const { postMessage, openDirectMessage, getUserIdByEmail } = require('../../src/services/slack');
const { groupTasksByAssignee, groupTasksByPriority, formatPriorityEmoji } = require('../../src/utils/taskParser');

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function formatDate(date) {
  return `${DAYS[date.getUTCDay()]}, ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function buildPriorityBlocks(tasks) {
  const blocks = [];
  const priorityGroups = groupTasksByPriority(tasks);
  for (const [priority, items] of Object.entries(priorityGroups)) {
    if (!items.length) continue;
    const emoji = formatPriorityEmoji(priority);
    const lines = items.map((t) => `  - ${t.taskName}`).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `${emoji} *${priority}*\n${lines}` },
    });
  }
  return blocks;
}

async function sendPersonalDMs(tasks, dateStr) {
  const grouped = groupTasksByAssignee(tasks);

  for (const [assigneeEmail, assigneeTasks] of Object.entries(grouped)) {
    if (assigneeEmail === 'Unassigned') continue;

    const userId = await getUserIdByEmail(assigneeEmail);
    if (!userId) {
      console.error(`Could not find Slack user for ${assigneeEmail} - skipping DM`);
      continue;
    }

    const dmChannel = await openDirectMessage(userId);
    const displayName = capitalize(assigneeEmail.split('@')[0]);

    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `Good morning! Your tasks for ${dateStr}`, emoji: true },
      },
      { type: 'divider' },
      ...buildPriorityBlocks(assigneeTasks),
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `${assigneeTasks.length} open task${assigneeTasks.length !== 1 ? 's' : ''} - reply to @TaskMate to manage your tasks`,
        }],
      },
    ];

    try {
      await postMessage(dmChannel, `Your tasks for ${dateStr}`, { blocks });
      console.log(`DM sent to ${assigneeEmail} (${assigneeTasks.length} tasks)`);
    } catch (err) {
      console.error(`Failed to DM ${assigneeEmail}:`, err.message);
    }
  }
}

async function sendGroupDigest(tasks, dateStr) {
  const channel = process.env.DIGEST_CHANNEL_ID;
  if (!channel) {
    console.error('DIGEST_CHANNEL_ID not set - skipping group digest');
    return;
  }

  const grouped = groupTasksByAssignee(tasks);

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `Weekly Task Overview - ${dateStr}`, emoji: true },
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
    blocks.push(...buildPriorityBlocks(assigneeTasks));
    blocks.push({ type: 'divider' });
  }

  await postMessage(channel, `Weekly Task Overview - ${dateStr} | ${tasks.length} open tasks`, { blocks });
  console.log(`Weekly group digest sent: ${tasks.length} tasks`);
}

async function runDigest() {
  const tasks = await getAllOpenTasks();
  const today = new Date();
  const dateStr = formatDate(today);
  const isMonday = today.getUTCDay() === 1;

  if (!tasks.length) {
    console.log('No open tasks - skipping digest');
    return;
  }

  // Send personal DMs every weekday
  await sendPersonalDMs(tasks, dateStr);

  // Send group overview on Mondays only
  if (isMonday) {
    await sendGroupDigest(tasks, dateStr);
  }
}

// Runs weekdays at 8:00 AM EST / 9:00 AM EDT (1:00 PM UTC)
exports.handler = schedule('0 13 * * 1-5', async () => {
  try {
    await runDigest();
  } catch (err) {
    console.error('Morning digest failed:', err);
  }
  return { statusCode: 200 };
});
