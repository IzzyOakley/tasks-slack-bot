'use strict';

require('dotenv').config();

const { schedule } = require('@netlify/functions');
const { getAllOpenTasks } = require('../../src/services/airtable');
const { postMessage } = require('../../src/services/slack');
const { getPersonalTaskChannels } = require('../../src/utils/channelMap');
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

function buildPrioritySection(tasks) {
  const blocks = [];
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
  return blocks;
}

async function postCentralDigest(tasks, dateStr) {
  const channel = process.env.CENTRAL_CHANNEL_ID;
  if (!channel) {
    console.error('CENTRAL_CHANNEL_ID not set - skipping central Monday digest');
    return;
  }

  const grouped = groupTasksByAssignee(tasks);

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `Week of ${dateStr} - Team Task Overview`, emoji: true },
    },
    { type: 'divider' },
  ];

  for (const [email, personTasks] of Object.entries(grouped)) {
    if (email === 'Unassigned' || isSteve(email)) continue;
    const name = capitalize(email.split('@')[0]);
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*${name} (${personTasks.length} open task${personTasks.length !== 1 ? 's' : ''})*` },
    });
    blocks.push(...buildPrioritySection(personTasks));
    blocks.push({ type: 'divider' });
  }

  await postMessage(channel, `Week of ${dateStr} - Team Task Overview`, { blocks });
  console.log(`Monday central digest posted: ${tasks.length} tasks`);
}

async function postPersonalChannelDigests(tasks, dateStr) {
  const personalChannels = await getPersonalTaskChannels();
  const grouped = groupTasksByAssignee(tasks);

  for (const ch of personalChannels) {
    const ownerName = ch.ownerFirstName;
    const ownerEmail = Object.keys(grouped).find(
      (e) => e.split('@')[0].toLowerCase() === ownerName.toLowerCase()
    );

    const ownerTasks = ownerEmail ? grouped[ownerEmail] : [];
    if (!ownerTasks.length) continue;

    const displayName = capitalize(ownerName);
    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `Week of ${dateStr} - ${displayName}'s Tasks`, emoji: true },
      },
      { type: 'divider' },
      ...buildPrioritySection(ownerTasks),
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `${ownerTasks.length} open task${ownerTasks.length !== 1 ? 's' : ''}` }],
      },
    ];

    try {
      await postMessage(ch.id, `${displayName}'s tasks for the week`, { blocks });
      console.log(`Monday personal digest posted to #${ch.name}`);
    } catch (err) {
      console.error(`Failed to post Monday digest to #${ch.name}:`, err.message);
    }
  }
}

async function runMondayDigest() {
  const tasks = await getAllOpenTasks();
  const today = new Date();
  const dateStr = formatDate(today);

  if (!tasks.length) {
    console.log('No open tasks for Monday digest');
    return;
  }

  await Promise.all([
    postCentralDigest(tasks, dateStr),
    postPersonalChannelDigests(tasks, dateStr),
  ]);
}

// Monday at 8:00 AM EST / 9:00 AM EDT
exports.handler = schedule('0 13 * * 1', async () => {
  try {
    await runMondayDigest();
  } catch (err) {
    console.error('Monday digest failed:', err);
  }
  return { statusCode: 200 };
});
