'use strict';

require('dotenv').config();

const { extractTasksFromText, extractTasksFromImage, parseCommand } = require('../../src/services/claude');
const { createTask, updateTask, getTasksByAssignee, getAllOpenTasks, findTaskByName } = require('../../src/services/airtable');
const { postMessage, postThreadReply, getChannelHistory, downloadFile, joinChannel, getChannelIdByName } = require('../../src/services/slack');
const { resolveUserEmail, resolveUserByDisplayName } = require('../../src/utils/userMap');
const { matchProject, groupTasksByAssignee, buildPriorityBlocks } = require('../../src/utils/taskParser');

const IMAGE_TYPES = ['jpg', 'jpeg', 'png', 'heic', 'webp'];
const MIME_MAP = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', webp: 'image/webp' };

exports.handler = async (event) => {
  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 200 };
  }

  const slackEvent = payload.event;
  if (!slackEvent) return { statusCode: 200 };

  // Skip bot messages to prevent infinite loops
  if (slackEvent.bot_id || slackEvent.subtype === 'bot_message') return { statusCode: 200 };

  try {
    if (slackEvent.type === 'app_mention') {
      await handleAppMention(slackEvent);
    } else if (slackEvent.type === 'message' && !slackEvent.subtype) {
      await handleMessage(slackEvent);
    }
  } catch (err) {
    console.error('Background function error:', err);
    const channel = slackEvent.channel;
    const ts = slackEvent.ts;
    if (channel) {
      await postThreadReply(channel, ts, '⚠️ Something went wrong logging that task. Please try again or log it manually in Airtable.').catch(() => {});
    }
  }

  return { statusCode: 200 };
};

// ─── Message handler ──────────────────────────────────────────────────────────

async function handleMessage(event) {
  const { channel, ts, user, files, text } = event;

  // Handle image uploads
  if (files && files.length > 0) {
    const imageFiles = files.filter((f) => {
      const ext = (f.filetype || '').toLowerCase();
      return IMAGE_TYPES.includes(ext);
    });
    if (imageFiles.length > 0) {
      await processImageFiles(imageFiles, channel, ts, user, text);
      return;
    }
  }

  // Handle text messages — skip messages that start with a bot mention
  // (those are handled exclusively by the app_mention event handler)
  if (text && text.trim() && !text.trim().startsWith('<@')) {
    await processTextMessage(text, channel, ts, user, 'Slack message', `#${channel}`);
  }
}

// ─── App mention handler ──────────────────────────────────────────────────────

async function handleAppMention(event) {
  const { channel, ts, user, text } = event;

  // Strip the bot mention from the text
  const cleanText = (text || '').replace(/<@[A-Z0-9]+>/g, '').trim();

  if (!cleanText) {
    await postThreadReply(channel, ts, buildHelpMessage(), { mrkdwn: true });
    return;
  }

  const userEmail = await resolveUserEmail(user);

  // Detect scan commands before full parse to handle them quickly
  const scanMatch = cleanText.match(/^scan\s+(.+)$/i);
  if (scanMatch) {
    await handleScanCommand(scanMatch[1].trim(), channel, ts, user, userEmail);
    return;
  }

  const command = await parseCommand(cleanText, userEmail || user);

  switch (command.intent) {
    case 'show_my_tasks':
      await handleShowTasks(userEmail, null, channel, ts);
      break;
    case 'show_user_tasks':
      await handleShowTasks(null, command.targetUser, channel, ts);
      break;
    case 'show_all_tasks':
      await handleShowAllTasks(channel, ts);
      break;
    case 'mark_done':
      await handleMarkDone(command.taskDescription, channel, ts);
      break;
    case 'set_priority':
      await handleSetPriority(command.taskDescription, command.priority, channel, ts);
      break;
    case 'assign_task':
      await handleAssignTask(command.taskDescription, command.targetUser, channel, ts);
      break;
    case 'add_task':
      await processTextMessage(command.taskDescription || cleanText, channel, ts, user, 'Slack message', `#${channel}`);
      break;
    case 'help':
      await postThreadReply(channel, ts, buildHelpMessage(), { mrkdwn: true });
      break;
    default:
      // Not a recognized command — treat the text as a task list
      await processTextMessage(cleanText, channel, ts, user, 'Slack message', `#${channel}`);
  }
}

// ─── Task extraction helpers ──────────────────────────────────────────────────

async function processTextMessage(text, channel, ts, userId, source, sourceDetail) {
  const tasks = await extractTasksFromText(text);
  if (!tasks || tasks.length === 0) {
    await postThreadReply(channel, ts, 'No tasks found in that message.');
    return;
  }

  const assigneeEmail = userId ? await resolveUserEmail(userId) : null;
  const created = await logTasksToAirtable(tasks, { source, sourceDetail, rawInput: text, fallbackAssigneeEmail: assigneeEmail });

  const names = created.map((t) => `"${t.taskName}"`).join(', ');
  await postThreadReply(channel, ts, `✅ Logged ${created.length} task${created.length !== 1 ? 's' : ''}: ${names}`);
}

async function processImageFiles(files, channel, ts, userId, caption) {
  const assigneeEmail = userId ? await resolveUserEmail(userId) : null;
  let totalLogged = 0;
  const allNames = [];

  for (const file of files) {
    const ext = (file.filetype || 'jpg').toLowerCase();
    const mediaType = MIME_MAP[ext] || 'image/jpeg';
    const url = file.url_private_download || file.url_private;

    let buffer;
    try {
      buffer = await downloadFile(url);
    } catch (err) {
      console.error('Failed to download image:', err.message);
      continue;
    }

    const base64 = buffer.toString('base64');
    const tasks = await extractTasksFromImage(base64, mediaType);

    if (!tasks || tasks.length === 0) continue;

    const rawInput = caption || `Image upload: ${file.name}`;
    const created = await logTasksToAirtable(tasks, {
      source: 'Handwritten note',
      sourceDetail: `#${channel}`,
      rawInput,
      fallbackAssigneeEmail: assigneeEmail,
    });

    totalLogged += created.length;
    allNames.push(...created.map((t) => t.taskName));
  }

  if (totalLogged === 0) {
    await postThreadReply(channel, ts, 'No tasks found in that image.');
  } else {
    const names = allNames.map((n) => `"${n}"`).join(', ');
    await postThreadReply(channel, ts, `✅ Logged ${totalLogged} task${totalLogged !== 1 ? 's' : ''} from image: ${names}`);
  }
}

async function logTasksToAirtable(tasks, opts) {
  const { source, sourceDetail, rawInput, fallbackAssigneeEmail } = opts;
  const created = [];

  for (const task of tasks) {
    const assigneeEmail = task.assigneeEmail || fallbackAssigneeEmail || null;
    const projectRecordId = await matchProject(task.projectName);

    try {
      await createTask({
        taskName: task.taskName,
        description: task.description || null,
        assigneeEmail,
        priority: task.priority || 'Medium',
        category: task.category || null,
        source,
        sourceDetail,
        dueDate: task.dueDate || null,
        rawInput,
        projectRecordId,
      });
      created.push(task);
    } catch (err) {
      console.error('Airtable createTask failed:', err.message, JSON.stringify(task));
    }
  }

  return created;
}

// ─── Command handlers ─────────────────────────────────────────────────────────

async function handleShowTasks(email, nameOrEmail, channel, ts) {
  let resolvedEmail = email;

  if (nameOrEmail && !email) {
    // Try to resolve by email or display name
    if (nameOrEmail.includes('@')) {
      resolvedEmail = nameOrEmail;
    } else {
      const user = await resolveUserByDisplayName(nameOrEmail);
      resolvedEmail = user ? user.email : null;
    }
  }

  if (!resolvedEmail) {
    await postThreadReply(channel, ts, `⚠️ Could not find a user matching "${nameOrEmail}".`);
    return;
  }

  const tasks = await getTasksByAssignee(resolvedEmail);

  if (!tasks.length) {
    await postThreadReply(channel, ts, `No open tasks found for ${resolvedEmail}.`);
    return;
  }

  const displayName = resolvedEmail.split('@')[0];
  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: `*Open tasks for ${displayName} (${tasks.length})*` } },
    ...buildPriorityBlocks(tasks.slice(0, 20)),
  ];

  await postThreadReply(channel, ts, `Open tasks for ${displayName}`, { blocks });
}

async function handleShowAllTasks(channel, ts) {
  const tasks = await getAllOpenTasks();

  if (!tasks.length) {
    await postThreadReply(channel, ts, 'No open tasks found.');
    return;
  }

  const grouped = groupTasksByAssignee(tasks);
  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: `*All Open Tasks (${tasks.length})*` } },
    { type: 'divider' },
  ];

  for (const [assignee, assigneeTasks] of Object.entries(grouped)) {
    const displayName = assignee !== 'Unassigned' ? assignee.split('@')[0] : 'Unassigned';
    blocks.push(...buildPriorityBlocks(assigneeTasks.slice(0, 20), displayName));
    blocks.push({ type: 'divider' });
  }

  await postThreadReply(channel, ts, 'All open tasks:', { blocks });
}

async function handleMarkDone(taskDescription, channel, ts) {
  if (!taskDescription) {
    await postThreadReply(channel, ts, '⚠️ Please specify which task to mark as done.');
    return;
  }

  const task = await findTaskByName(taskDescription);
  if (!task) {
    await postThreadReply(channel, ts, `⚠️ Could not find a task matching "${taskDescription}".`);
    return;
  }

  await updateTask(task.id, {
    status: 'Done',
    dateCompleted: new Date().toISOString().split('T')[0],
  });

  await postThreadReply(channel, ts, `✅ Marked "${task.taskName}" as done.`);
}

async function handleSetPriority(taskDescription, priority, channel, ts) {
  if (!taskDescription || !priority) {
    await postThreadReply(channel, ts, '⚠️ Please specify the task and new priority.');
    return;
  }

  const task = await findTaskByName(taskDescription);
  if (!task) {
    await postThreadReply(channel, ts, `⚠️ Could not find a task matching "${taskDescription}".`);
    return;
  }

  await updateTask(task.id, { priority });
  await postThreadReply(channel, ts, `✅ Set "${task.taskName}" to ${priority} priority.`);
}

async function handleAssignTask(taskDescription, targetUser, channel, ts) {
  if (!taskDescription || !targetUser) {
    await postThreadReply(channel, ts, '⚠️ Please specify the task and the user to assign it to.');
    return;
  }

  const task = await findTaskByName(taskDescription);
  if (!task) {
    await postThreadReply(channel, ts, `⚠️ Could not find a task matching "${taskDescription}".`);
    return;
  }

  let assigneeEmail = targetUser.includes('@') ? targetUser : null;
  if (!assigneeEmail) {
    const user = await resolveUserByDisplayName(targetUser);
    assigneeEmail = user ? user.email : null;
  }

  if (!assigneeEmail) {
    await postThreadReply(channel, ts, `⚠️ Could not find a Slack user matching "${targetUser}".`);
    return;
  }

  await updateTask(task.id, { assigneeEmail });
  await postThreadReply(channel, ts, `✅ Assigned "${task.taskName}" to ${assigneeEmail.split('@')[0]}.`);
}

async function handleScanCommand(commandText, channel, ts, userId, userEmail) {
  let targetChannelId = channel;
  let filterToUser = null;
  let channelLabel = 'this channel';

  if (/^this channel$/i.test(commandText)) {
    targetChannelId = channel;
  } else if (/^my recent messages$/i.test(commandText)) {
    targetChannelId = channel;
    filterToUser = userId;
    channelLabel = 'your recent messages';
  } else {
    const channelName = commandText.replace(/^#/, '');
    const foundId = await getChannelIdByName(channelName);
    if (!foundId) {
      await postThreadReply(channel, ts, `⚠️ Could not find channel "${commandText}". Make sure the bot is a member.`);
      return;
    }
    targetChannelId = foundId;
    channelLabel = `#${channelName}`;
  }

  await postThreadReply(channel, ts, `🔍 Scanning ${channelLabel} for tasks...`);

  try {
    await joinChannel(targetChannelId);
  } catch {}

  let messages = await getChannelHistory(targetChannelId, 100);

  // Filter out bot messages
  messages = messages.filter((m) => !m.bot_id && m.subtype !== 'bot_message' && m.text);

  if (filterToUser) {
    messages = messages.filter((m) => m.user === filterToUser);
  }

  if (!messages.length) {
    await postThreadReply(channel, ts, `No messages found to scan in ${channelLabel}.`);
    return;
  }

  const combined = messages.map((m) => m.text).join('\n---\n');
  const assigneeEmail = userEmail || null;

  const tasks = await extractTasksFromText(combined);

  if (!tasks || tasks.length === 0) {
    await postThreadReply(channel, ts, `No tasks found in ${channelLabel}.`);
    return;
  }

  const created = await logTasksToAirtable(tasks, {
    source: 'Slack message',
    sourceDetail: channelLabel,
    rawInput: `Scanned from ${channelLabel}`,
    fallbackAssigneeEmail: assigneeEmail,
  });

  await postThreadReply(
    channel,
    ts,
    `✅ Scanned ${channelLabel} — logged ${created.length} task${created.length !== 1 ? 's' : ''}: ${created.map((t) => `"${t.taskName}"`).join(', ')}`
  );
}

// ─── Help message ─────────────────────────────────────────────────────────────

function buildHelpMessage() {
  return `*Oakley Task Bot — Commands*

*View tasks*
• \`@bot what's my list\` — show your open tasks
• \`@bot what's Dan working on\` — show someone else's tasks
• \`@bot show all open tasks\` — all open tasks grouped by assignee

*Manage tasks*
• \`@bot mark [task] as done\` — mark a task complete
• \`@bot set [task] to high priority\` — change priority
• \`@bot assign [task] to Dan\` — reassign a task
• \`@bot add task: [description]\` — create a task immediately

*Scan channels*
• \`@bot scan #channel-name\` — scan a channel for tasks
• \`@bot scan this channel\` — scan the current channel
• \`@bot scan my recent messages\` — scan your recent messages here

*Automatic logging*
• Post any message in this channel → tasks are extracted and logged
• Upload a photo of handwritten notes → tasks are extracted and logged

*Note:* The bot cannot be added to 1:1 DMs. Use a group DM or post to #task-inbox instead.`;
}
