'use strict';

require('dotenv').config();

const { schedule } = require('@netlify/functions');
const { getAllOpenTasks } = require('../../src/services/airtable');
const { postMessage, openDirectMessage, getUserIdByEmail } = require('../../src/services/slack');
const { groupTasksByAssignee, groupTasksByPriority, formatPriorityEmoji } = require('../../src/utils/taskParser');
const { isSteve } = require('../../src/utils/userMap');

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function formatDate(date) {
  return `${DAYS[date.getUTCDay()]}, ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function buildPersonalDigestBlocks(tasks, name, dateStr) {
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `Good morning ${name} — your tasks for ${dateStr}`, emoji: true },
    },
    { type: 'divider' },
  ];

  const groups = groupTasksByPriority(tasks);
  for (const [priority, items] of Object.entries(groups)) {
    if (!items.length) continue;
    const emoji = formatPriorityEmoji(priority);
    const lines = items.map((t) => `  - ${t.taskName}`).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `${emoji} *${priority}*\n${lines}` },
    });
  }

  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `${tasks.length} open task${tasks.length !== 1 ? 's' : ''} - reply to me to manage your list.`,
    }],
  });

  return blocks;
}

async function sendPersonalDMs(tasks, dateStr) {
  const grouped = groupTasksByAssignee(tasks);

  for (const [assigneeEmail, assigneeTasks] of Object.entries(grouped)) {
    if (assigneeEmail === 'Unassigned' || isSteve(assigneeEmail)) continue;

    const userId = await getUserIdByEmail(assigneeEmail);
    if (!userId) {
      console.error(`Could not find Slack user for ${assigneeEmail} - skipping DM`);
      continue;
    }

    const dmChannel = await openDirectMessage(userId);
    const displayName = capitalize(assigneeEmail.split('@')[0]);
    const blocks = buildPersonalDigestBlocks(assigneeTasks, displayName, dateStr);

    try {
      await postMessage(dmChannel, `Your tasks for ${dateStr}`, { blocks });
      console.log(`Morning DM sent to ${assigneeEmail} (${assigneeTasks.length} tasks)`);
    } catch (err) {
      console.error(`Failed to DM ${assigneeEmail}:`, err.message);
    }
  }
}

async function runMorningDigest() {
  const tasks = await getAllOpenTasks();
  if (!tasks.length) {
    console.log('No open tasks - skipping morning digest');
    return;
  }
  const today = new Date();
  const dateStr = formatDate(today);
  await sendPersonalDMs(tasks, dateStr);
}

// Personal DMs only — weekdays at 8:00 AM EST / 9:00 AM EDT
exports.handler = schedule('0 13 * * 1-5', async () => {
  try {
    await runMorningDigest();
  } catch (err) {
    console.error('Morning digest failed:', err);
  }
  return { statusCode: 200 };
});
