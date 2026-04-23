'use strict';

const Airtable = require('airtable');

const OPERATIONAL_TABLE = 'Operational Tasks';
const TECH_TABLE = 'Tech & Innovation Tasks';
const PROJECTS_TABLE = 'Projects';
const TECH_PROJECTS_TABLE = 'Tech Projects';

const IZZY_EMAIL = 'elizabeth@oakleyhomebuilders.com';
const PRIORITY_ORDER = { Urgent: 0, High: 1, Medium: 2, Low: 3 };

function getBase() {
  return new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
}

function isIzzy(email) {
  return !!(email && email.toLowerCase() === IZZY_EMAIL.toLowerCase());
}

function getTableForEmail(email) {
  return isIzzy(email) ? TECH_TABLE : OPERATIONAL_TABLE;
}

// ─── Create ───────────────────────────────────────────────────────────────────

async function createOperationalTask(fields) {
  const payload = {
    'Task Name': fields.taskName,
    'Status': 'To Do',
    'Priority': fields.priority || 'Medium',
    'Bot Created': true,
  };
  if (fields.description) payload['Description'] = fields.description;
  if (fields.assigneeEmail) payload['Assignee'] = { email: fields.assigneeEmail };
  if (fields.assignedByEmail) payload['Assigned By'] = { email: fields.assignedByEmail };
  if (fields.category) payload['Category'] = fields.category;
  if (fields.source) payload['Source'] = fields.source;
  if (fields.sourceDetail) payload['Source Detail'] = fields.sourceDetail;
  if (fields.dueDate) payload['Due Date'] = fields.dueDate;
  if (fields.notes) payload['Notes'] = fields.notes;
  if (fields.rawInput) payload['Raw Input'] = fields.rawInput;
  if (fields.projectRecordId) payload['Project'] = [fields.projectRecordId];
  return getBase()(OPERATIONAL_TABLE).create(payload);
}

async function createTechTask(fields) {
  const payload = {
    'Task Name': fields.taskName,
    'Status': 'To Do',
    'Priority': fields.priority || 'Medium',
    'Bot Created': true,
  };
  if (fields.description) payload['Task Description'] = fields.description;
  if (fields.assigneeEmail) payload['Assignee'] = { email: fields.assigneeEmail };
  if (fields.assignedByEmail) payload['Assigned By'] = { email: fields.assignedByEmail };
  if (fields.source) payload['Source'] = fields.source;
  if (fields.sourceDetail) payload['Source Detail'] = fields.sourceDetail;
  if (fields.dueDate) payload['Due Date'] = fields.dueDate;
  if (fields.rawInput) payload['Raw Input'] = fields.rawInput;
  if (fields.projectRecordId) payload['Project'] = [fields.projectRecordId];
  return getBase()(TECH_TABLE).create(payload);
}

// ─── Update ───────────────────────────────────────────────────────────────────

async function updateTask(recordId, fields, table) {
  const targetTable = table || OPERATIONAL_TABLE;
  const payload = {};
  if (fields.status !== undefined) payload['Status'] = fields.status;
  if (fields.priority !== undefined) payload['Priority'] = fields.priority;
  if (fields.assigneeEmail !== undefined) payload['Assignee'] = { email: fields.assigneeEmail };
  if (fields.dateCompleted !== undefined) payload['Date Completed'] = fields.dateCompleted;
  if (fields.dueDate !== undefined) payload['Due Date'] = fields.dueDate;
  if (targetTable === OPERATIONAL_TABLE && fields.notes !== undefined) payload['Notes'] = fields.notes;
  if (targetTable === TECH_TABLE && fields.solutionDescription !== undefined) payload['Solution Description'] = fields.solutionDescription;
  return getBase()(targetTable).update(recordId, payload);
}

// ─── Query ────────────────────────────────────────────────────────────────────

async function getTasksByAssignee(email) {
  const table = getTableForEmail(email);
  const records = await getBase()(table)
    .select({ filterByFormula: `AND({Assignee} = "${email}", {Status} != "Done")` })
    .all();
  const tasks = records.map((r) => formatTaskRecord(r, table)).sort(sortByPriority);
  if (table === TECH_TABLE) return enrichTechTasksWithProjectNames(tasks);
  return tasks;
}

async function getAllOpenOperationalTasks() {
  const records = await getBase()(OPERATIONAL_TABLE)
    .select({ filterByFormula: `OR({Status} = "To Do", {Status} = "In Progress", {Status} = "Blocked")` })
    .all();
  return records.map((r) => formatTaskRecord(r, OPERATIONAL_TABLE)).sort(sortByPriority);
}

async function getAllOpenTechTasks() {
  const records = await getBase()(TECH_TABLE)
    .select({ filterByFormula: `OR({Status} = "To Do", {Status} = "In Progress", {Status} = "Blocked")` })
    .all();
  const tasks = records.map((r) => formatTaskRecord(r, TECH_TABLE)).sort(sortByPriority);
  return enrichTechTasksWithProjectNames(tasks);
}

async function getAllOpenTasks() {
  const [operational, tech] = await Promise.all([getAllOpenOperationalTasks(), getAllOpenTechTasks()]);
  return [...operational, ...tech];
}

async function getCompletedThisWeek(tableKey) {
  const mondayStr = getMondayOfCurrentWeek();
  const table = tableKey === 'tech' ? TECH_TABLE : OPERATIONAL_TABLE;
  const records = await getBase()(table)
    .select({ filterByFormula: `AND(IS_AFTER({Date Completed}, "${mondayStr}"), {Status} = "Done")` })
    .all();
  const tasks = records.map((r) => formatTaskRecord(r, table));
  if (table === TECH_TABLE) return enrichTechTasksWithProjectNames(tasks);
  return tasks;
}

async function getCompletedThisWeekAll() {
  const [operational, tech] = await Promise.all([
    getCompletedThisWeek('operational'),
    getCompletedThisWeek('tech'),
  ]);
  return [...operational, ...tech];
}

// ─── Project lookups ──────────────────────────────────────────────────────────

async function getOperationalProjects() {
  const records = await getBase()(PROJECTS_TABLE)
    .select({ fields: ['Project'] })
    .all();
  return records.map((r) => ({ name: r.fields['Project'] || '', recordId: r.id }));
}

async function getTechProjects() {
  const records = await getBase()(TECH_PROJECTS_TABLE)
    .select({ fields: ['Project Title'] })
    .all();
  return records.map((r) => ({ title: r.fields['Project Title'] || '', recordId: r.id }));
}

// ─── Find task by name ────────────────────────────────────────────────────────

async function findTaskByName(description, preferEmail) {
  const lower = (description || '').toLowerCase();

  const searchTable = async (table) => {
    const records = await getBase()(table)
      .select({ filterByFormula: `{Status} != "Done"`, maxRecords: 100 })
      .all();
    const match = records.find((r) => {
      const name = (r.fields['Task Name'] || '').toLowerCase();
      return name.includes(lower) || lower.includes(name);
    });
    if (!match) return null;
    const task = formatTaskRecord(match, table);
    if (table === TECH_TABLE) {
      const enriched = await enrichTechTasksWithProjectNames([task]);
      return enriched[0];
    }
    return task;
  };

  const primaryTable = preferEmail ? getTableForEmail(preferEmail) : OPERATIONAL_TABLE;
  const secondaryTable = primaryTable === OPERATIONAL_TABLE ? TECH_TABLE : OPERATIONAL_TABLE;

  const first = await searchTable(primaryTable);
  if (first) return first;
  return searchTable(secondaryTable);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function enrichTechTasksWithProjectNames(tasks) {
  if (!tasks.length) return tasks;
  try {
    const projects = await getTechProjects();
    const projectMap = new Map(projects.map((p) => [p.recordId, p.title]));
    return tasks.map((t) => ({
      ...t,
      projectName: t.projectRecordId ? (projectMap.get(t.projectRecordId) || 'No Project') : 'No Project',
    }));
  } catch (err) {
    console.error('Failed to enrich tech task project names:', err.message);
    return tasks.map((t) => ({ ...t, projectName: 'No Project' }));
  }
}

function formatTaskRecord(record, table) {
  const projectField = record.fields['Project'];
  const projectRecordId = Array.isArray(projectField) && projectField.length ? projectField[0] : null;
  return {
    id: record.id,
    table,
    taskName: record.fields['Task Name'] || '(unnamed)',
    description: table === TECH_TABLE
      ? (record.fields['Task Description'] || null)
      : (record.fields['Description'] || null),
    assigneeEmail: record.fields['Assignee'] ? record.fields['Assignee'].email : null,
    assignedByEmail: record.fields['Assigned By'] ? record.fields['Assigned By'].email : null,
    status: record.fields['Status'] || 'To Do',
    priority: record.fields['Priority'] || 'Medium',
    category: record.fields['Category'] || null,
    projectRecordId,
    projectName: null,
    dueDate: record.fields['Due Date'] || null,
    dateCompleted: record.fields['Date Completed'] || null,
    notes: record.fields['Notes'] || null,
    solutionDescription: record.fields['Solution Description'] || null,
  };
}

function getMondayOfCurrentWeek() {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + diff);
  monday.setUTCHours(0, 0, 0, 0);
  return monday.toISOString().split('T')[0];
}

function sortByPriority(a, b) {
  const pa = PRIORITY_ORDER[a.priority] ?? 99;
  const pb = PRIORITY_ORDER[b.priority] ?? 99;
  return pa - pb;
}

module.exports = {
  createOperationalTask,
  createTechTask,
  updateTask,
  getTasksByAssignee,
  getAllOpenOperationalTasks,
  getAllOpenTechTasks,
  getAllOpenTasks,
  getCompletedThisWeek,
  getCompletedThisWeekAll,
  getOperationalProjects,
  getTechProjects,
  findTaskByName,
  isIzzy,
  getTableForEmail,
  OPERATIONAL_TABLE,
  TECH_TABLE,
};
