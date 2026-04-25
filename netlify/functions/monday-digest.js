'use strict';

require('dotenv').config();

const { schedule } = require('@netlify/functions');
const { getAllOpenOperationalTasks, getAllOpenTechTasks, isIzzy } = require('../../src/services/airtable');
const { postMessage } = require('../../src/services/slack');
const { getPersonalTaskChannels } = require('../../src/utils/channelMap');
const { groupTasksByAssignee, buildPersonalTaskBlocks } = require('../../src/utils/taskParser');
const { isSteve, resolveUserByDisplayName } = require('../../src/utils/userMap');

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function formatDate(date) {
  return `${DAYS[date.getUTCDay()]}, ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

// ─── Personal channel digests ─────────────────────────────────────────────────

async function postPersonalChannelDigests(grouped, dateStr) {
  const personalChannels = await getPersonalTaskChannels();

  for (const ch of personalChannels) {
    const ownerName = ch.ownerFirstName;
    const resolved = await resolveUserByDisplayName(ownerName);
    const ownerEmail = resolved ? resolved.email : null;

    const ownerTasks = ownerEmail ? grouped[ownerEmail] : [];
    if (!ownerTasks.length) continue;

    const displayName = capitalize(ownerName);
    const label = ownerEmail && isIzzy(ownerEmail) ? 'Tech & Innovation' : 'Operations';

    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `Week of ${dateStr} - ${displayName}'s Tasks`, emoji: true },
      },
      { type: 'divider' },
      ...buildPersonalTaskBlocks(ownerTasks, ownerEmail || ''),
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `${ownerTasks.length} open ${label} task${ownerTasks.length !== 1 ? 's' : ''}` }],
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

// ─── Runner ───────────────────────────────────────────────────────────────────

async function runMondayDigest() {
  const [opTasks, techTasks] = await Promise.all([
    getAllOpenOperationalTasks(),
    getAllOpenTechTasks(),
  ]);

  const allTasks = [...opTasks, ...techTasks];
  if (!allTasks.length) {
    console.log('No open tasks for Monday digest');
    return;
  }

  const today = new Date();
  const dateStr = formatDate(today);
  const grouped = groupTasksByAssignee(allTasks);

  await postPersonalChannelDigests(grouped, dateStr);
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
