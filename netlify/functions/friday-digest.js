'use strict';

require('dotenv').config();

const { schedule } = require('@netlify/functions');
const {
  getAllOpenOperationalTasks, getAllOpenTechTasks,
  getCompletedThisWeekAll, isIzzy,
} = require('../../src/services/airtable');
const { rewriteTasksForReport } = require('../../src/services/claude');
const { postMessage } = require('../../src/services/slack');
const { getPersonalTaskChannels } = require('../../src/utils/channelMap');
const { groupTasksByAssignee, buildPersonalTaskBlocks } = require('../../src/utils/taskParser');
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

// ─── Central Friday summary ───────────────────────────────────────────────────

async function postCentralFridaySummary(completedGrouped, openGrouped, weekLabel) {
  const channel = process.env.CENTRAL_CHANNEL_ID;
  if (!channel) {
    console.error('CENTRAL_CHANNEL_ID not set - skipping central Friday summary');
    return;
  }

  const allEmails = new Set([...Object.keys(completedGrouped), ...Object.keys(openGrouped)]);

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `Week of ${weekLabel} - What Got Done`, emoji: true },
    },
    { type: 'divider' },
  ];

  let totalCompletedCount = 0;

  for (const email of allEmails) {
    if (email === 'Unassigned' || isSteve(email)) continue;
    const name = capitalize(email.split('@')[0]);
    const label = isIzzy(email) ? 'Tech & Innovation' : 'Operations';
    const completed = completedGrouped[email] || [];
    const open = openGrouped[email] || [];

    if (completed.length) {
      totalCompletedCount += completed.length;
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*${name} completed ${completed.length} ${label} task${completed.length !== 1 ? 's' : ''}*` },
      });
      blocks.push(...buildPersonalTaskBlocks(completed.map((t) => ({ ...t, taskName: `${t.taskName} ✓` })), email));
    }

    if (open.length) {
      blocks.push({
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `Still open for ${name}: ${open.length} ${label} task${open.length !== 1 ? 's' : ''}`,
        }],
      });
    }

    if (completed.length || open.length) {
      blocks.push({ type: 'divider' });
    }
  }

  await postMessage(channel, `Week of ${weekLabel} - End of Week Summary`, { blocks });
  console.log(`Friday central summary posted (${totalCompletedCount} completed)`);
}

// ─── Personal channel Friday summaries ───────────────────────────────────────

async function postPersonalFridaySummaries(completedGrouped, openGrouped, weekLabel) {
  const personalChannels = await getPersonalTaskChannels();

  for (const ch of personalChannels) {
    const ownerName = ch.ownerFirstName;
    const allEmails = new Set([...Object.keys(completedGrouped), ...Object.keys(openGrouped)]);
    const ownerEmail = [...allEmails].find(
      (e) => e.split('@')[0].toLowerCase() === ownerName.toLowerCase()
    );

    const completed = ownerEmail ? (completedGrouped[ownerEmail] || []) : [];
    const open = ownerEmail ? (openGrouped[ownerEmail] || []) : [];

    if (!completed.length && !open.length) continue;

    const displayName = capitalize(ownerName);
    const label = ownerEmail && isIzzy(ownerEmail) ? 'Tech & Innovation' : 'Operations';

    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${displayName}'s Week - ${weekLabel}`, emoji: true },
      },
      { type: 'divider' },
    ];

    if (completed.length) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*Completed this week (${completed.length} ${label} task${completed.length !== 1 ? 's' : ''})*` },
      });
      blocks.push(...buildPersonalTaskBlocks(completed.map((t) => ({ ...t, taskName: `${t.taskName} ✓` })), ownerEmail || ''));
    }

    if (open.length) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*Still open (${open.length})*` },
      });
      blocks.push(...buildPersonalTaskBlocks(open, ownerEmail || ''));
    }

    try {
      await postMessage(ch.id, `${displayName}'s end-of-week summary`, { blocks });
      console.log(`Friday summary posted to #${ch.name}`);
    } catch (err) {
      console.error(`Failed to post Friday summary to #${ch.name}:`, err.message);
    }
  }
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function runFridayDigest() {
  const [completedTasks, opTasks, techTasks] = await Promise.all([
    getCompletedThisWeekAll(),
    getAllOpenOperationalTasks(),
    getAllOpenTechTasks(),
  ]);

  const allOpenTasks = [...opTasks, ...techTasks];
  const weekLabel = getMondayDate();

  // Rewrite task names for report tone — one Claude call for the whole digest
  const rewrittenMap = await rewriteTasksForReport(completedTasks, allOpenTasks);
  const applyRewrites = (tasks) => tasks.map((t) => ({
    ...t,
    taskName: rewrittenMap.get(t.id) || t.taskName,
  }));

  const completedGrouped = groupTasksByAssignee(applyRewrites(completedTasks));
  const openGrouped = groupTasksByAssignee(applyRewrites(allOpenTasks));

  await Promise.all([
    postCentralFridaySummary(completedGrouped, openGrouped, weekLabel),
    postPersonalFridaySummaries(completedGrouped, openGrouped, weekLabel),
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
