'use strict';

const Airtable = require('airtable');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

const TASKS_TABLE = 'Operational Tasks';
const PROJECTS_TABLE = 'Projects';

// Priority sort order for display
const PRIORITY_ORDER = { Urgent: 0, High: 1, Medium: 2, Low: 3 };

async function createTask(fields) {
  const record = await base(TASKS_TABLE).create({
    'Task Name': fields.taskName,
    'Description': fields.description || undefined,
    'Assignee': fields.assigneeEmail ? { email: fields.assigneeEmail } : undefined,
    'Status': 'To Do',
    'Priority': fields.priority || 'Medium',
    'Category': fields.category || undefined,
    'Source': fields.source || 'Slack message',
    'Source Detail': fields.sourceDetail || undefined,
    'Due Date': fields.dueDate || undefined,
    'Raw Input': fields.rawInput || undefined,
    'Bot Created': true,
    'Project': fields.projectRecordId ? [fields.projectRecordId] : undefined,
  });
  return record;
}

async function updateTask(recordId, fields) {
  const updatePayload = {};
  if (fields.status !== undefined) updatePayload['Status'] = fields.status;
  if (fields.priority !== undefined) updatePayload['Priority'] = fields.priority;
  if (fields.assigneeEmail !== undefined) updatePayload['Assignee'] = { email: fields.assigneeEmail };
  if (fields.dateCompleted !== undefined) updatePayload['Date Completed'] = fields.dateCompleted;

  const record = await base(TASKS_TABLE).update(recordId, updatePayload);
  return record;
}

async function getTasksByAssignee(assigneeEmail) {
  const records = await base(TASKS_TABLE)
    .select({
      filterByFormula: `AND({Assignee} = "${assigneeEmail}", {Status} != "Done")`,
      sort: [{ field: 'Priority', direction: 'asc' }],
    })
    .all();

  return records.map(formatTaskRecord).sort(sortByPriority);
}

async function getTasksByName(assigneeName) {
  // Search by partial name match when we only have a display name
  const records = await base(TASKS_TABLE)
    .select({
      filterByFormula: `AND(FIND("${assigneeName.toLowerCase()}", LOWER({Assignee})) > 0, {Status} != "Done")`,
    })
    .all();

  return records.map(formatTaskRecord).sort(sortByPriority);
}

async function getAllOpenTasks() {
  const records = await base(TASKS_TABLE)
    .select({
      filterByFormula: `OR({Status} = "To Do", {Status} = "In Progress")`,
    })
    .all();

  return records.map(formatTaskRecord).sort(sortByPriority);
}

async function getProjects() {
  const records = await base(PROJECTS_TABLE)
    .select({
      filterByFormula: `{Status} = "Open"`,
      fields: ['Project'],
    })
    .all();

  return records.map((r) => ({
    name: r.fields['Project'] || '',
    recordId: r.id,
  }));
}

async function findTaskByName(taskDescription) {
  // Fetch recent open tasks and find the closest match
  const records = await base(TASKS_TABLE)
    .select({
      filterByFormula: `{Status} != "Done"`,
      sort: [{ field: 'Task Name', direction: 'asc' }],
      maxRecords: 100,
    })
    .all();

  const lower = taskDescription.toLowerCase();
  const match = records.find((r) => {
    const name = (r.fields['Task Name'] || '').toLowerCase();
    return name.includes(lower) || lower.includes(name);
  });

  return match ? formatTaskRecord(match) : null;
}

function formatTaskRecord(record) {
  return {
    id: record.id,
    taskName: record.fields['Task Name'] || '(unnamed)',
    description: record.fields['Description'] || null,
    assigneeEmail: record.fields['Assignee'] ? record.fields['Assignee'].email : null,
    status: record.fields['Status'] || 'To Do',
    priority: record.fields['Priority'] || 'Medium',
    category: record.fields['Category'] || null,
    dueDate: record.fields['Due Date'] || null,
  };
}

function sortByPriority(a, b) {
  const pa = PRIORITY_ORDER[a.priority] ?? 99;
  const pb = PRIORITY_ORDER[b.priority] ?? 99;
  return pa - pb;
}

module.exports = {
  createTask,
  updateTask,
  getTasksByAssignee,
  getTasksByName,
  getAllOpenTasks,
  getProjects,
  findTaskByName,
};
