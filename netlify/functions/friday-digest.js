'use strict';

require('dotenv').config();

const { schedule } = require('@netlify/functions');
const { getAllOpenTasks, getCompletedThisWeekAll } = require('../../src/services/airtable');
const { postMessage } = require('../../src/services/slack');
const { getPersonalTaskChannels } = require('../../src/utils/channelMap');
const { groupTasksByAssignee } = require('../../src/utils/taskParser');
const { isSteve } = require('../../src/utils/userMap');

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function formatDate(date) {
  return `${DAYS[date.getUTCDay()]}, ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function getMondayDate() {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + diff);
  return formatDate(monday);
}

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

async function postCentralFridaySummary(completedTasks, openTasks, weekLabel) {
  const channel = process.env.CENTRAL_CHANNEL_ID;
  if (!channel) {
    console.error('CENTRAL_CHANNEL_ID not set - skipping central Friday summary');
    return;
  }

  const completedGrouped = groupTasksByAssignee(completedTasks);
  const openGrouped = groupTasksByAssignee(openTasks);
  const allEmails = new Set([
    ...Object.keys(completedGrouped),
    ...Object.keys(openGrouped),
  ]);

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `Week of ${weekLabel} - What Got Done`, emoji: true },
    },
    { type: 'divider' },
  ];

  for (const email of allEmails) {
    if (email === 'Unassigned' || isSteve(email)) continue;
    const name = capitalize(email.split('@')[0]);
    const completed = completedGrouped[email] || [];
    const open = openGrouped[email] || [];

    if (completed.length) {
      const lines = completed.map((t) => `  - ${t.taskName} ✓`).join('\n');
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*${name} completed ${completed.length} task${completed.length !== 1 ? 's' : ''}*\n${lines}` },
      });
    }

    if (open.length) {
      blocks.push({
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `Still open for ${name}: ${open.length} task${open.length !== 1 ? 's' : ''}`,
        }],
      });
    }

    blocks.push({ type: 'divider' });
  }

  await postMessage(channel, `Week of ${weekLabel} - End of Week Summary`, { blocks });
  console.log(`Friday central summary posted`);
}

async function postPersonalFridaySummaries(completedTasks, openTasks, weekLabel) {
  const personalChannels = await getPersonalTaskChannels();
  const completedGrouped = groupTasksByAssignee(completedTasks);
  const openGrouped = groupTasksByAssignee(openTasks);

  for (const ch of personalChannels) {
    const ownerName = ch.ownerFirstName;
    const ownerEmail = [...new Set([
      ...Object.keys(completedGrouped),
      ...Object.keys(openGrouped),
    ])].find((e) => e.split('@')[0].toLowerCase() === ownerName.toLowerCase());

    const completed = ownerEmail ? (completedGrouped[ownerEmail] || []) : [];
    const open = ownerEmail ? (openGrouped[ownerEmail] || []) : [];

    if (!completed.length && !open.length) continue;

    const displayName = capitalize(ownerName);
    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${displayName}'s Week - ${weekLabel}`, emoji: true },
      },
      { type: 'divider' },
    ];

    if (completed.length) {
      const lines = completed.map((t) => `  - ${t.taskName} ✓`).join('\n');
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*Completed this week (${completed.length})*\n${lines}` },
      });
    }

    if (open.length) {
      const lines = open.map((t) => `  - ${t.taskName}`).join('\n');
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*Still open (${open.length})*\n${lines}` },
      });
    }

    try {
      await postMessage(ch.id, `${displayName}'s end-of-week summary`, { blocks });
      console.log(`Friday summary posted to #${ch.name}`);
    } catch (err) {
      console.error(`Failed to post Friday summary to #${ch.name}:`, err.message);
    }
  }
}

async function runFridayDigest() {
  const [completedTasks, openTasks] = await Promise.all([
    getCompletedThisWeekAll(),
    getAllOpenTasks(),
  ]);

  const weekLabel = getMondayDate();

  await Promise.all([
    postCentralFridaySummary(completedTasks, openTasks, weekLabel),
    postPersonalFridaySummaries(completedTasks, openTasks, weekLabel),
  ]);
}

// Friday at 5:00 PM EDT (9:00 PM UTC)
exports.handler = schedule('0 21 * * 5', async () => {
  try {
    await runFridayDigest();
  } catch (err) {
    console.error('Friday digest failed:', err);
  }
  return { statusCode: 200 };
});
