'use strict';

require('dotenv').config();

const { schedule } = require('@netlify/functions');
const { getAllOpenOperationalTasks, getAllOpenTechTasks, isIzzy } = require('../../src/services/airtable');
const { postMessage, openDirectMessage, getUserIdByEmail } = require('../../src/services/slack');
const { groupTasksByAssignee, buildPersonalTaskBlocks } = require('../../src/utils/taskParser');
const { isSteve } = require('../../src/utils/userMap');

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function formatDate(date) {
  return `${DAYS[date.getUTCDay()]}, ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function buildMorningDigestBlocks(tasks, email, displayName, dateStr) {
  const label = isIzzy(email) ? 'Tech & Innovation' : 'Operations';
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `Good morning ${displayName} — ${dateStr}`, emoji: true },
    },
    { type: 'divider' },
    ...buildPersonalTaskBlocks(tasks, email),
    {
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `${tasks.length} open ${label} task${tasks.length !== 1 ? 's' : ''} — reply to me to manage your list.`,
      }],
    },
  ];
  return blocks;
}

async function sendPersonalDMs(dateStr) {
  // Get tasks from both tables
  const [opTasks, techTasks] = await Promise.all([
    getAllOpenOperationalTasks(),
    getAllOpenTechTasks(),
  ]);

  const allTasks = [...opTasks, ...techTasks];
  const grouped = groupTasksByAssignee(allTasks);

  for (const [email, tasks] of Object.entries(grouped)) {
    if (email === 'Unassigned' || isSteve(email)) continue;

    const userId = await getUserIdByEmail(email);
    if (!userId) {
      console.error(`Could not find Slack user for ${email} - skipping DM`);
      continue;
    }

    const dmChannel = await openDirectMessage(userId);
    const displayName = capitalize(email.split('@')[0]);
    const blocks = buildMorningDigestBlocks(tasks, email, displayName, dateStr);

    try {
      await postMessage(dmChannel, `Your tasks for ${dateStr}`, { blocks });
      console.log(`Morning DM sent to ${email} (${tasks.length} tasks)`);
    } catch (err) {
      console.error(`Failed to DM ${email}:`, err.message);
    }
  }
}

async function runMorningDigest() {
  const today = new Date();
  const dateStr = formatDate(today);
  await sendPersonalDMs(dateStr);
}

// Weekdays at 8:00 AM EST / 9:00 AM EDT
exports.handler = schedule('0 13 * * 1-5', async () => {
  try {
    await runMorningDigest();
  } catch (err) {
    console.error('Morning digest failed:', err);
  }
  return { statusCode: 200 };
});
