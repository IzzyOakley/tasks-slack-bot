'use strict';

require('dotenv').config();

const {
  extractTasksFromText, extractTasksFromImage, parseCommand, parseManagementCommand,
} = require('../../src/services/claude');
const {
  createOperationalTask, createTechTask, updateTask,
  getTasksByAssignee, getAllOpenOperationalTasks, getAllOpenTechTasks, getAllOpenTasks,
  findTaskByName, getCompletedThisWeek,
  isIzzy, OPERATIONAL_TABLE, TECH_TABLE,
} = require('../../src/services/airtable');
const {
  postMessage, postThreadReply, getChannelHistory, downloadFile,
  joinChannel, getChannelIdByName, getChannelInfo,
  openDirectMessage, getUserIdByEmail, getUserDisplayName,
} = require('../../src/services/slack');
const { resolveUserEmail, resolveUserByDisplayName, isSteve } = require('../../src/utils/userMap');
const {
  matchProjectForEmail, groupTasksByAssignee,
  buildPersonalTaskBlocks, buildTechTaskBlocks, buildOperationalTaskBlocks,
  formatPriorityEmoji,
} = require('../../src/utils/taskParser');
const { isPersonalTaskChannel, getChannelOwnerName } = require('../../src/utils/channelMap');

const IMAGE_TYPES = ['jpg', 'jpeg', 'png', 'heic', 'webp'];
const MIME_MAP = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', webp: 'image/webp' };

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function tableLabel(table) {
  return table === TECH_TABLE ? 'Tech' : 'Operational';
}

async function reply(channel, ts, text, options = {}) {
  if (ts) return postThreadReply(channel, ts, text, options);
  return postMessage(channel, text, options);
}

// ─── Main handler ─────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 200 };
  }

  const slackEvent = payload.event;
  console.log('EVENT:', JSON.stringify({
    type: slackEvent?.type,
    subtype: slackEvent?.subtype,
    bot_id: slackEvent?.bot_id,
    channel_type: slackEvent?.channel_type,
    has_text: !!slackEvent?.text,
  }));

  if (!slackEvent) return { statusCode: 200 };
  if (slackEvent.bot_id || slackEvent.subtype === 'bot_message') return { statusCode: 200 };

  try {
    if (slackEvent.type === 'app_mention') {
      if (slackEvent.channel_type === 'im') {
        await handleDMMessage(slackEvent);
      } else {
        await handleAppMention(slackEvent);
      }
    } else if (slackEvent.type === 'message' && !slackEvent.subtype) {
      if ((slackEvent.text || '').trim().startsWith('<@')) return { statusCode: 200 };
      if (slackEvent.channel_type === 'im') {
        await handleDMMessage(slackEvent);
      } else {
        await handleChannelMessage(slackEvent);
      }
    }
  } catch (err) {
    console.error('Background function error:', err);
    const { channel, ts, channel_type } = slackEvent;
    if (channel) {
      await reply(channel, channel_type === 'im' ? null : ts,
        '⚠️ Something went wrong. Please try again or log it manually in Airtable.').catch(() => {});
    }
  }

  return { statusCode: 200 };
};

// ─── Channel message router ───────────────────────────────────────────────────

async function handleChannelMessage(event) {
  const { channel, ts, user, files, text } = event;

  let channelName = '';
  try {
    const info = await getChannelInfo(channel);
    channelName = info.name || '';
  } catch (err) {
    console.error('Could not get channel info:', err.message);
  }

  if (isPersonalTaskChannel(channelName)) {
    const userEmail = await resolveUserEmail(user);
    if (isSteve(userEmail)) {
      await handleSteveCommand(event, channelName);
      return;
    }
  }

  if (files && files.length > 0) {
    const imageFiles = files.filter((f) => IMAGE_TYPES.includes((f.filetype || '').toLowerCase()));
    if (imageFiles.length > 0) {
      await processImageFiles(imageFiles, channel, ts, user, text);
      return;
    }
  }

  if (text && text.trim()) {
    const sourceDetail = channelName ? `#${channelName}` : `#${channel}`;
    await processTextMessage(text, channel, ts, user, 'Slack message', sourceDetail);
  }
}

// ─── DM handler ───────────────────────────────────────────────────────────────

async function handleDMMessage(event) {
  const { channel, user, text } = event;
  const userEmail = await resolveUserEmail(user);

  if (isSteve(userEmail)) {
    await postMessage(channel, 'Hi Steve — use the personal task channels (e.g. #dan-tasks, #izzy-tasks) to manage each team member\'s priorities.');
    return;
  }

  const cleanText = (text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
  if (!cleanText) return;

  const command = await parseCommand(cleanText, userEmail);

  switch (command.intent) {
    case 'show_my_tasks':
    case 'show_urgent': {
      const tasks = await getTasksByAssignee(userEmail);
      if (!tasks.length) {
        await postMessage(channel, 'You have no open tasks right now. 🎉');
        return;
      }
      const blocks = buildPersonalDigestBlocks(tasks, userEmail);
      await postMessage(channel, 'Your open tasks', { blocks });
      break;
    }

    case 'show_completed': {
      const tableKey = isIzzy(userEmail) ? 'tech' : 'operational';
      const completed = await getCompletedThisWeek(tableKey);
      const mine = completed.filter((t) => t.assigneeEmail === userEmail);
      if (!mine.length) {
        await postMessage(channel, 'No completed tasks found for this week.');
        return;
      }
      const blocks = buildPersonalTaskBlocks(mine, userEmail);
      await postMessage(channel, `Completed this week (${mine.length})`, { blocks });
      break;
    }

    case 'mark_done': {
      const task = await findTaskByName(command.taskDescription || '', userEmail);
      if (!task) {
        await postMessage(channel, `⚠️ Could not find a task matching "${command.taskDescription}".`);
        return;
      }
      await updateTask(task.id, { status: 'Done', dateCompleted: new Date().toISOString().split('T')[0] }, task.table);
      await postMessage(channel, `✅ Marked "${task.taskName}" as done.`);
      break;
    }

    case 'set_priority': {
      const task = await findTaskByName(command.taskDescription || '', userEmail);
      if (!task) {
        await postMessage(channel, `⚠️ Could not find a task matching "${command.taskDescription}".`);
        return;
      }
      await updateTask(task.id, { priority: command.priority }, task.table);
      await postMessage(channel, `✅ Set "${task.taskName}" to ${command.priority} priority.`);
      break;
    }

    case 'assign_task':
      await handleAssignTask(command.taskDescription, command.targetUser, channel, null, user, userEmail);
      break;

    case 'add_task': {
      const taskText = command.taskDescription || cleanText;
      const tasks = await extractTasksFromText(taskText);
      if (!tasks || !tasks.length) {
        await postMessage(channel, 'No tasks found in that message.');
        return;
      }
      const created = await logTasksToAirtable(tasks, {
        source: 'Slack message', sourceDetail: 'DM',
        rawInput: taskText, fallbackAssigneeEmail: userEmail, assignerUserId: user,
      });
      await postMessage(channel, buildLogConfirmation(created));
      break;
    }

    case 'add_note':
    case 'add_solution':
      await handleAddFieldUpdate(
        command.taskDescription, command.updateValue,
        command.intent === 'add_note' ? 'notes' : 'solutionDescription',
        channel, null, userEmail
      );
      break;

    case 'help':
      await postMessage(channel, buildHelpMessage());
      break;

    default: {
      const tasks = await extractTasksFromText(cleanText);
      if (!tasks || !tasks.length) {
        await postMessage(channel, `No tasks found. ${buildShortHelp()}`);
        return;
      }
      const created = await logTasksToAirtable(tasks, {
        source: 'Slack message', sourceDetail: 'DM',
        rawInput: cleanText, fallbackAssigneeEmail: userEmail, assignerUserId: user,
      });
      await postMessage(channel, buildLogConfirmation(created));
    }
  }
}

// ─── App mention handler ──────────────────────────────────────────────────────

async function handleAppMention(event) {
  const { channel, ts, user, text } = event;
  const cleanText = (text || '').replace(/<@[A-Z0-9]+>/g, '').trim();

  if (!cleanText) {
    await reply(channel, ts, buildHelpMessage(), { mrkdwn: true });
    return;
  }

  const userEmail = await resolveUserEmail(user);

  const scanMatch = cleanText.match(/^scan\s+(.+)$/i);
  if (scanMatch) {
    await handleScanCommand(scanMatch[1].trim(), channel, ts, user, userEmail);
    return;
  }

  const command = await parseCommand(cleanText, userEmail || user);

  switch (command.intent) {
    case 'show_my_tasks':
    case 'show_urgent':
      await handleShowTasks(userEmail, null, channel, ts);
      break;
    case 'show_user_tasks':
      await handleShowTasks(null, command.targetUser, channel, ts);
      break;
    case 'show_all_tasks':
      await handleShowAllTasks(channel, ts);
      break;
    case 'show_completed': {
      const tableKey = isIzzy(userEmail) ? 'tech' : 'operational';
      const completed = await getCompletedThisWeek(tableKey);
      const mine = completed.filter((t) => t.assigneeEmail === userEmail);
      if (!mine.length) {
        await reply(channel, ts, 'No completed tasks found for this week.');
        return;
      }
      const blocks = buildPersonalTaskBlocks(mine, userEmail);
      await reply(channel, ts, `Completed this week (${mine.length})`, { blocks });
      break;
    }
    case 'mark_done':
      await handleMarkDone(command.taskDescription, channel, ts, userEmail);
      break;
    case 'set_priority':
      await handleSetPriority(command.taskDescription, command.priority, channel, ts, userEmail);
      break;
    case 'assign_task':
      await handleAssignTask(command.taskDescription, command.targetUser, channel, ts, user, userEmail);
      break;
    case 'add_note':
    case 'add_solution':
      await handleAddFieldUpdate(
        command.taskDescription, command.updateValue,
        command.intent === 'add_note' ? 'notes' : 'solutionDescription',
        channel, ts, userEmail
      );
      break;
    case 'help':
      await reply(channel, ts, buildHelpMessage(), { mrkdwn: true });
      break;
    default:
      await processTextMessage(cleanText, channel, ts, user, 'Slack message', `#${channel}`);
  }
}

// ─── Steve oversight commands ─────────────────────────────────────────────────

async function handleSteveCommand(event, channelName) {
  const { channel, ts, text } = event;
  const ownerName = getChannelOwnerName(channelName);

  if (!ownerName) {
    await postThreadReply(channel, ts, '⚠️ Could not determine channel owner from channel name.');
    return;
  }

  const ownerUser = await resolveUserByDisplayName(ownerName);
  if (!ownerUser || !ownerUser.email) {
    await postThreadReply(channel, ts, `⚠️ Could not find a team member matching "${ownerName}".`);
    return;
  }

  const ownerEmail = ownerUser.email;
  const openTasks = await getTasksByAssignee(ownerEmail);
  const command = await parseManagementCommand(text, openTasks);

  if (!command || command.action === 'unknown') {
    await postThreadReply(channel, ts, `⚠️ I couldn't parse that as a management command. Try: "Set [task] to urgent", "Set deadline for [task] to Friday", "Mark [task] as done", or "What's on ${capitalize(ownerName)}'s list?"`);
    return;
  }

  if (command.action === 'query') {
    const displayName = capitalize(ownerName);
    if (!openTasks.length) {
      await postThreadReply(channel, ts, `${displayName} has no open tasks.`);
      return;
    }
    const tableKey = isIzzy(ownerEmail) ? 'tech' : 'operational';
    const label = tableKey === 'tech' ? 'Tech & Innovation' : 'Operations';
    const blocks = [
      { type: 'section', text: { type: 'mrkdwn', text: `*${displayName} — ${label} (${openTasks.length})*` } },
      ...buildPersonalTaskBlocks(openTasks, ownerEmail),
    ];
    await postThreadReply(channel, ts, `${displayName}'s tasks:`, { blocks });
    return;
  }

  const matches = fuzzyMatchTasks(command.taskSearch, openTasks);

  if (!matches.length) {
    await postThreadReply(channel, ts, `⚠️ No open task found matching "${command.taskSearch}" for ${capitalize(ownerName)}.`);
    return;
  }

  if (matches.length > 1) {
    const options = matches.slice(0, 3).map((t, i) => `${i + 1}. ${t.taskName}`).join('\n');
    await postThreadReply(channel, ts, `I found ${matches.length} tasks matching that — which one?\n${options}`);
    return;
  }

  const task = matches[0];
  const updates = {};
  let actionDesc = '';

  if (command.action === 'reprioritize') {
    updates.priority = command.newValue;
    actionDesc = `priority to *${command.newValue}*`;
  } else if (command.action === 'set_deadline') {
    updates.dueDate = command.newValue;
    actionDesc = `deadline to *${command.newValue}*`;
  } else if (command.action === 'update_status') {
    updates.status = command.newValue;
    if (command.newValue === 'Done') updates.dateCompleted = new Date().toISOString().split('T')[0];
    actionDesc = `status to *${command.newValue}*`;
  }

  await updateTask(task.id, updates, task.table);
  await postThreadReply(channel, ts, `✅ "${task.taskName}" — updated ${actionDesc}.`);
}

function fuzzyMatchTasks(search, tasks) {
  if (!search) return [];
  const lower = search.toLowerCase();
  return tasks.filter((t) => {
    const name = (t.taskName || '').toLowerCase();
    return name.includes(lower) || lower.split(' ').some((word) => word.length > 3 && name.includes(word));
  });
}

// ─── Core task processing ─────────────────────────────────────────────────────

async function processTextMessage(text, channel, ts, userId, source, sourceDetail) {
  const tasks = await extractTasksFromText(text);
  if (!tasks || tasks.length === 0) {
    await reply(channel, ts, 'No tasks found in that message.');
    return;
  }

  const senderEmail = userId ? await resolveUserEmail(userId) : null;

  if (isSteve(senderEmail)) {
    const hasRealAssignee = tasks.some((t) => t.assigneeEmail && !isSteve(t.assigneeEmail));
    if (!hasRealAssignee) {
      await reply(channel, ts, 'Hi Steve — I don\'t track tasks for you. If this is for a team member, mention their name and I\'ll assign it.');
      return;
    }
  }

  const fallbackEmail = !isSteve(senderEmail) ? senderEmail : null;
  const created = await logTasksToAirtable(tasks, {
    source, sourceDetail, rawInput: text,
    fallbackAssigneeEmail: fallbackEmail,
    assignerUserId: userId,
  });

  if (!created.length) {
    await reply(channel, ts, 'No tasks could be logged — all extracted tasks were filtered (e.g. assigned to Steve).');
    return;
  }

  await reply(channel, ts, buildLogConfirmation(created));
}

async function processImageFiles(files, channel, ts, userId, caption) {
  const senderEmail = userId ? await resolveUserEmail(userId) : null;
  const fallbackEmail = !isSteve(senderEmail) ? senderEmail : null;
  let totalLogged = 0;
  const allCreated = [];

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

    const tasks = await extractTasksFromImage(buffer.toString('base64'), mediaType);
    if (!tasks || !tasks.length) continue;

    const created = await logTasksToAirtable(tasks, {
      source: 'Handwritten note',
      sourceDetail: `#${channel}`,
      rawInput: caption || `Image: ${file.name}`,
      fallbackAssigneeEmail: fallbackEmail,
      assignerUserId: userId,
    });

    totalLogged += created.length;
    allCreated.push(...created);
  }

  if (!totalLogged) {
    await reply(channel, ts, 'No tasks found in that image.');
  } else {
    await reply(channel, ts, buildLogConfirmation(allCreated));
  }
}

// ─── Task logging — dual-table routing ───────────────────────────────────────

async function logTasksToAirtable(tasks, opts) {
  const { source, sourceDetail, rawInput, fallbackAssigneeEmail, assignerUserId } = opts;
  const created = [];
  const assignerEmail = assignerUserId ? await resolveUserEmail(assignerUserId) : null;

  for (const task of tasks) {
    let assigneeEmail = task.assigneeEmail && !isSteve(task.assigneeEmail)
      ? task.assigneeEmail
      : (!isSteve(fallbackAssigneeEmail) ? fallbackAssigneeEmail : null);

    if (!assigneeEmail) continue;

    const projectRecordId = isIzzy(assigneeEmail)
      ? await matchProjectForEmail(task.projectName, assigneeEmail)
      : null;

    const taskFields = {
      taskName: task.taskName,
      description: task.description || null,
      assigneeEmail,
      assignedByEmail: assignerEmail || null,
      priority: task.priority || 'Medium',
      source,
      sourceDetail,
      dueDate: task.dueDate || null,
      notes: task.notes || null,
      rawInput,
      projectRecordId,
    };

    try {
      if (isIzzy(assigneeEmail)) {
        await createTechTask(taskFields);
      } else {
        await createOperationalTask({ ...taskFields, category: task.category || null });
      }

      const createdTask = {
        ...task,
        assigneeEmail,
        projectName: task.projectName || null,
        table: isIzzy(assigneeEmail) ? TECH_TABLE : OPERATIONAL_TABLE,
      };
      created.push(createdTask);

      if (assigneeEmail && assignerEmail && assigneeEmail !== assignerEmail) {
        await sendTaskAssignmentNotification(createdTask, assigneeEmail, assignerEmail).catch((err) =>
          console.error('DM notification failed:', err.message)
        );
      }
    } catch (err) {
      console.error('Airtable create failed:', err.message, JSON.stringify(task));
    }
  }

  return created;
}

// Build reply string — groups by table
function buildLogConfirmation(created) {
  if (!created.length) return 'No tasks logged.';

  const opTasks = created.filter((t) => t.table === OPERATIONAL_TABLE);
  const techTasks = created.filter((t) => t.table === TECH_TABLE);
  const parts = [];

  if (opTasks.length) {
    const assignees = [...new Set(opTasks.map((t) => t.assigneeEmail ? capitalize(t.assigneeEmail.split('@')[0]) : null).filter(Boolean))];
    const names = opTasks.map((t) => `"${t.taskName}"`).join(', ');
    parts.push(`Logged for ${assignees.join(', ')} (Operational): ${names}`);
  }

  if (techTasks.length) {
    const names = techTasks.map((t) => `"${t.taskName}"`).join(', ');
    parts.push(`Logged for Izzy (Tech): ${names}`);
  }

  return `✅ ${parts.join(' | ')}`;
}

// ─── Task assignment DM notification ─────────────────────────────────────────

async function sendTaskAssignmentNotification(task, assigneeEmail, assignerEmail) {
  if (isSteve(assigneeEmail)) return;

  const userId = await getUserIdByEmail(assigneeEmail);
  if (!userId) return;

  const dmChannel = await openDirectMessage(userId);
  const assignerName = assignerEmail ? capitalize(assignerEmail.split('@')[0]) : 'Someone';
  const priorityEmoji = formatPriorityEmoji(task.priority || 'Medium');

  const details = [
    `${priorityEmoji} ${task.priority || 'Medium'}`,
    task.category ? task.category : null,
    task.projectName ? task.projectName : null,
  ].filter(Boolean).join(' | ');

  const text = `📋 *New task assigned to you by ${assignerName}*\n\n*${task.taskName}*\n${details}\n\n_Reply to me to manage your tasks._`;

  await postMessage(dmChannel, text, {
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }],
  });
}

// ─── Conversational command handlers ─────────────────────────────────────────

async function handleShowTasks(email, nameOrEmail, channel, ts) {
  let resolvedEmail = email;

  if (nameOrEmail && !email) {
    if (nameOrEmail.includes('@')) {
      resolvedEmail = nameOrEmail;
    } else {
      const user = await resolveUserByDisplayName(nameOrEmail);
      resolvedEmail = user ? user.email : null;
    }
  }

  if (!resolvedEmail) {
    await reply(channel, ts, `⚠️ Could not find a user matching "${nameOrEmail}".`);
    return;
  }

  const tasks = await getTasksByAssignee(resolvedEmail);
  if (!tasks.length) {
    await reply(channel, ts, `No open tasks found for ${resolvedEmail}.`);
    return;
  }

  const displayName = capitalize(resolvedEmail.split('@')[0]);
  const label = isIzzy(resolvedEmail) ? 'Tech & Innovation' : 'Operations';
  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: `*${displayName} — ${label} (${tasks.length} task${tasks.length !== 1 ? 's' : ''})*` } },
    ...buildPersonalTaskBlocks(tasks, resolvedEmail),
  ];
  await reply(channel, ts, `Open tasks for ${displayName}`, { blocks });
}

async function handleShowAllTasks(channel, ts) {
  const [opTasks, techTasks] = await Promise.all([getAllOpenOperationalTasks(), getAllOpenTechTasks()]);
  const allTasks = [...opTasks, ...techTasks];

  if (!allTasks.length) {
    await reply(channel, ts, 'No open tasks found.');
    return;
  }

  const grouped = groupTasksByAssignee(allTasks);
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `All Open Tasks (${allTasks.length})`, emoji: true } },
    { type: 'divider' },
  ];

  for (const [assigneeEmail, tasks] of Object.entries(grouped)) {
    if (assigneeEmail === 'Unassigned' || isSteve(assigneeEmail)) continue;
    const displayName = capitalize(assigneeEmail.split('@')[0]);
    const label = isIzzy(assigneeEmail) ? 'Tech & Innovation' : 'Operations';
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*${displayName} — ${label} (${tasks.length})*` },
    });
    blocks.push(...buildPersonalTaskBlocks(tasks, assigneeEmail));
    blocks.push({ type: 'divider' });
  }

  await reply(channel, ts, 'All open tasks:', { blocks });
}

async function handleMarkDone(taskDescription, channel, ts, userEmail) {
  if (!taskDescription) {
    await reply(channel, ts, '⚠️ Please specify which task to mark as done.');
    return;
  }
  const task = await findTaskByName(taskDescription, userEmail);
  if (!task) {
    await reply(channel, ts, `⚠️ Could not find a task matching "${taskDescription}".`);
    return;
  }
  await updateTask(task.id, { status: 'Done', dateCompleted: new Date().toISOString().split('T')[0] }, task.table);
  await reply(channel, ts, `✅ Marked "${task.taskName}" as done.`);
}

async function handleSetPriority(taskDescription, priority, channel, ts, userEmail) {
  if (!taskDescription || !priority) {
    await reply(channel, ts, '⚠️ Please specify the task and new priority.');
    return;
  }
  const task = await findTaskByName(taskDescription, userEmail);
  if (!task) {
    await reply(channel, ts, `⚠️ Could not find a task matching "${taskDescription}".`);
    return;
  }
  await updateTask(task.id, { priority }, task.table);
  await reply(channel, ts, `✅ Set "${task.taskName}" to ${priority} priority.`);
}

async function handleAssignTask(taskDescription, targetUser, channel, ts, assignerUserId, assignerEmail) {
  if (!taskDescription || !targetUser) {
    await reply(channel, ts, '⚠️ Please specify the task and the user to assign it to.');
    return;
  }
  const task = await findTaskByName(taskDescription, assignerEmail);
  if (!task) {
    await reply(channel, ts, `⚠️ Could not find a task matching "${taskDescription}".`);
    return;
  }

  let assigneeEmail = targetUser.includes('@') ? targetUser : null;
  if (!assigneeEmail) {
    const user = await resolveUserByDisplayName(targetUser);
    assigneeEmail = user ? user.email : null;
  }

  if (!assigneeEmail || isSteve(assigneeEmail)) {
    await reply(channel, ts, `⚠️ Could not find a valid team member matching "${targetUser}".`);
    return;
  }

  await updateTask(task.id, { assigneeEmail }, task.table);

  if (assignerEmail !== assigneeEmail) {
    await sendTaskAssignmentNotification(task, assigneeEmail, assignerEmail).catch(() => {});
  }

  await reply(channel, ts, `✅ Assigned "${task.taskName}" to ${capitalize(assigneeEmail.split('@')[0])}.`);
}

async function handleAddFieldUpdate(taskDescription, updateValue, field, channel, ts, userEmail) {
  if (!taskDescription || !updateValue) {
    await reply(channel, ts, '⚠️ Please specify the task and the text to add.');
    return;
  }
  const task = await findTaskByName(taskDescription, userEmail);
  if (!task) {
    await reply(channel, ts, `⚠️ Could not find a task matching "${taskDescription}".`);
    return;
  }

  if (field === 'notes' && task.table !== OPERATIONAL_TABLE) {
    await reply(channel, ts, `⚠️ Notes can only be added to Operational tasks. "${task.taskName}" is a Tech & Innovation task. Try "add solution to ${task.taskName}: [text]" instead.`);
    return;
  }
  if (field === 'solutionDescription' && task.table !== TECH_TABLE) {
    await reply(channel, ts, `⚠️ Solution descriptions can only be added to Tech & Innovation tasks. "${task.taskName}" is an Operational task. Try "add note to ${task.taskName}: [text]" instead.`);
    return;
  }

  const updates = { [field]: updateValue };
  await updateTask(task.id, updates, task.table);
  const label = field === 'notes' ? 'Note' : 'Solution';
  await reply(channel, ts, `✅ ${label} added to "${task.taskName}".`);
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
      await reply(channel, ts, `⚠️ Could not find channel "${commandText}". Make sure the bot is a member.`);
      return;
    }
    targetChannelId = foundId;
    channelLabel = `#${channelName}`;
  }

  await reply(channel, ts, `🔍 Scanning ${channelLabel} for tasks...`);

  try { await joinChannel(targetChannelId); } catch {}

  let messages = await getChannelHistory(targetChannelId, 100);
  messages = messages.filter((m) => !m.bot_id && m.subtype !== 'bot_message' && m.text);
  if (filterToUser) messages = messages.filter((m) => m.user === filterToUser);

  if (!messages.length) {
    await reply(channel, ts, `No messages found to scan in ${channelLabel}.`);
    return;
  }

  const combined = messages.map((m) => m.text).join('\n---\n');
  const tasks = await extractTasksFromText(combined);

  if (!tasks || !tasks.length) {
    await reply(channel, ts, `No tasks found in ${channelLabel}.`);
    return;
  }

  const created = await logTasksToAirtable(tasks, {
    source: 'Slack message',
    sourceDetail: channelLabel,
    rawInput: `Scanned from ${channelLabel}`,
    fallbackAssigneeEmail: !isSteve(userEmail) ? userEmail : null,
    assignerUserId: userId,
  });

  await reply(channel, ts, `✅ Scanned ${channelLabel} — ${buildLogConfirmation(created)}`);
}

// ─── Digest block builder for DM/channel show-tasks responses ─────────────────

function buildPersonalDigestBlocks(tasks, email) {
  const displayName = capitalize((email || '').split('@')[0]);
  const label = isIzzy(email) ? 'Tech & Innovation' : 'Operations';
  return [
    { type: 'section', text: { type: 'mrkdwn', text: `*${displayName} — ${label} (${tasks.length} open task${tasks.length !== 1 ? 's' : ''})*` } },
    ...buildPersonalTaskBlocks(tasks, email),
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `${tasks.length} open task${tasks.length !== 1 ? 's' : ''} — reply to me to manage your list.` }],
    },
  ];
}

// ─── Help messages ────────────────────────────────────────────────────────────

function buildHelpMessage() {
  return `*TaskMate — Commands*

*In any channel*
- Post a message → tasks extracted and logged automatically (Izzy's go to Tech & Innovation, all others to Operational)
- Upload a photo of handwritten notes → tasks extracted from image

*Mention commands*
- \`@TaskMate what's my list\` — your open tasks
- \`@TaskMate what's Dan working on\` — someone else's tasks
- \`@TaskMate show all open tasks\` — full team view (both tables)
- \`@TaskMate what did I complete this week\` — your completions
- \`@TaskMate mark [task] as done\`
- \`@TaskMate set [task] to urgent\`
- \`@TaskMate assign [task] to Dan\`
- \`@TaskMate add task: [description]\`
- \`@TaskMate add note to [task]: [text]\` — add note to Operational task
- \`@TaskMate add solution to [task]: [text]\` — add solution to Tech task
- \`@TaskMate scan #channel-name\`

*In your DM with TaskMate*
- All the same commands work — just without the @mention
- Your tasks only — no one else's are visible to you

*Personal task channels (#dan-tasks, #izzy-tasks)*
- Steve can reprioritise, set deadlines, and update status here`;
}

function buildShortHelp() {
  return 'Try: "show my tasks", "add task: [description]", or just post your tasks naturally.';
}
