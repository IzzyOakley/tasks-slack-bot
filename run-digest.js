'use strict';

require('dotenv').config();

const which = process.argv[2];

if (!which) {
  console.log('Usage: node run-digest.js [friday|monday|morning]');
  process.exit(1);
}

(async () => {
  try {
    if (which === 'friday') {
      const { getAllOpenOperationalTasks, getAllOpenTechTasks, getCompletedThisWeekAll, isIzzy } = require('./src/services/airtable');
      const { rewriteTasksForReport } = require('./src/services/claude');
      const { postMessage } = require('./src/services/slack');
      const { getPersonalTaskChannels } = require('./src/utils/channelMap');
      const { groupTasksByAssignee, buildPersonalTaskBlocks } = require('./src/utils/taskParser');
      const { isSteve, resolveUserByDisplayName } = require('./src/utils/userMap');

      const [completedTasks, opTasks, techTasks] = await Promise.all([
        getCompletedThisWeekAll(),
        getAllOpenOperationalTasks(),
        getAllOpenTechTasks(),
      ]);
      const allOpenTasks = [...opTasks, ...techTasks];
      const today = new Date();
      const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const weekLabel = `${DAYS[today.getUTCDay()]}, ${MONTHS[today.getUTCMonth()]} ${today.getUTCDate()}`;

      const rewrittenMap = await rewriteTasksForReport(completedTasks, allOpenTasks);
      const applyRewrites = (tasks) => tasks.map((t) => ({ ...t, taskName: rewrittenMap.get(t.id) || t.taskName }));

      const completedGrouped = groupTasksByAssignee(applyRewrites(completedTasks));
      const openGrouped = groupTasksByAssignee(applyRewrites(allOpenTasks));

      const personalChannels = await getPersonalTaskChannels();
      const capitalize = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

      for (const ch of personalChannels) {
        const ownerName = ch.ownerFirstName;
        const resolved = await resolveUserByDisplayName(ownerName);
        const ownerEmail = resolved ? resolved.email : null;

        const completed = ownerEmail ? (completedGrouped[ownerEmail] || []) : [];
        const open = ownerEmail ? (openGrouped[ownerEmail] || []) : [];

        if (!completed.length && !open.length) { console.log(`No tasks for ${ownerName} — skipping`); continue; }

        const displayName = capitalize(ownerName);
        const label = ownerEmail && isIzzy(ownerEmail) ? 'Tech & Innovation' : 'Operations';

        const blocks = [
          { type: 'header', text: { type: 'plain_text', text: `${displayName}'s Week — ${weekLabel}`, emoji: true } },
          { type: 'divider' },
        ];

        if (completed.length) {
          blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Completed this week (${completed.length})*` } });
          blocks.push(...buildPersonalTaskBlocks(completed.map((t) => ({ ...t, taskName: `${t.taskName} ✓` })), ownerEmail || ''));
        }

        if (open.length) {
          blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Still open (${open.length})*` } });
          blocks.push(...buildPersonalTaskBlocks(open, ownerEmail || ''));
        }

        await postMessage(ch.id, `${displayName}'s end-of-week summary`, { blocks });
        console.log(`✅ Friday digest posted to #${ch.name}`);
      }

    } else if (which === 'monday') {
      const { getAllOpenOperationalTasks, getAllOpenTechTasks, isIzzy } = require('./src/services/airtable');
      const { postMessage } = require('./src/services/slack');
      const { getPersonalTaskChannels } = require('./src/utils/channelMap');
      const { groupTasksByAssignee, buildPersonalTaskBlocks } = require('./src/utils/taskParser');
      const { isSteve, resolveUserByDisplayName } = require('./src/utils/userMap');

      const [opTasks, techTasks] = await Promise.all([getAllOpenOperationalTasks(), getAllOpenTechTasks()]);
      const allTasks = [...opTasks, ...techTasks];
      const today = new Date();
      const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const dateStr = `${DAYS[today.getUTCDay()]}, ${MONTHS[today.getUTCMonth()]} ${today.getUTCDate()}`;
      const grouped = groupTasksByAssignee(allTasks);
      const capitalize = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
      const personalChannels = await getPersonalTaskChannels();

      for (const ch of personalChannels) {
        const ownerName = ch.ownerFirstName;
        const resolved = await resolveUserByDisplayName(ownerName);
        const ownerEmail = resolved ? resolved.email : null;
        const ownerTasks = ownerEmail ? grouped[ownerEmail] : [];
        if (!ownerTasks.length) { console.log(`No tasks for ${ownerName} — skipping`); continue; }

        const displayName = capitalize(ownerName);
        const label = ownerEmail && isIzzy(ownerEmail) ? 'Tech & Innovation' : 'Operations';

        const blocks = [
          { type: 'header', text: { type: 'plain_text', text: `Week of ${dateStr} — ${displayName}'s Tasks`, emoji: true } },
          { type: 'divider' },
          ...buildPersonalTaskBlocks(ownerTasks, ownerEmail || ''),
          { type: 'context', elements: [{ type: 'mrkdwn', text: `${ownerTasks.length} open ${label} task${ownerTasks.length !== 1 ? 's' : ''}` }] },
        ];

        await postMessage(ch.id, `${displayName}'s tasks for the week`, { blocks });
        console.log(`✅ Monday digest posted to #${ch.name}`);
      }

    } else if (which === 'morning') {
      const { getAllOpenOperationalTasks, getAllOpenTechTasks, isIzzy } = require('./src/services/airtable');
      const { postMessage, openDirectMessage, getUserIdByEmail } = require('./src/services/slack');
      const { groupTasksByAssignee, buildPersonalTaskBlocks } = require('./src/utils/taskParser');
      const { isSteve } = require('./src/utils/userMap');

      const [opTasks, techTasks] = await Promise.all([getAllOpenOperationalTasks(), getAllOpenTechTasks()]);
      const allTasks = [...opTasks, ...techTasks];
      const today = new Date();
      const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const dateStr = `${DAYS[today.getUTCDay()]}, ${MONTHS[today.getUTCMonth()]} ${today.getUTCDate()}`;
      const grouped = groupTasksByAssignee(allTasks);
      const capitalize = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

      for (const [email, tasks] of Object.entries(grouped)) {
        if (email === 'Unassigned' || isSteve(email)) continue;
        const userId = await getUserIdByEmail(email);
        if (!userId) { console.error(`Could not find Slack user for ${email}`); continue; }
        const dmChannel = await openDirectMessage(userId);
        const displayName = capitalize(email.split('@')[0]);
        const label = isIzzy(email) ? 'Tech & Innovation' : 'Operations';
        const blocks = [
          { type: 'header', text: { type: 'plain_text', text: `Good morning ${displayName} — ${dateStr}`, emoji: true } },
          { type: 'divider' },
          ...buildPersonalTaskBlocks(tasks, email),
          { type: 'context', elements: [{ type: 'mrkdwn', text: `${tasks.length} open ${label} task${tasks.length !== 1 ? 's' : ''} — reply to me to manage your list.` }] },
        ];
        await postMessage(dmChannel, `Your tasks for ${dateStr}`, { blocks });
        console.log(`✅ Morning digest DM sent to ${email}`);
      }

    } else {
      console.log('Unknown digest. Use: friday, monday, or morning');
      process.exit(1);
    }
  } catch (err) {
    console.error('Digest failed:', err);
    process.exit(1);
  }
})();
