'use strict';

const { getOperationalProjects, getTechProjects, isIzzy } = require('../services/airtable');

const PRIORITY_ORDER = { Urgent: 0, High: 1, Medium: 2, Low: 3 };

// Per-invocation caches
let opProjectsCache = null;
let techProjectsCache = null;

async function getOpProjectsCache() {
  if (!opProjectsCache) opProjectsCache = await getOperationalProjects();
  return opProjectsCache;
}

async function getTechProjectsCache() {
  if (!techProjectsCache) techProjectsCache = await getTechProjects();
  return techProjectsCache;
}

function normalizeStr(str) {
  return (str || '').toLowerCase().trim();
}

// ─── Project matching ─────────────────────────────────────────────────────────

async function matchOperationalProject(projectName) {
  if (!projectName) return null;
  const projects = await getOpProjectsCache();
  const norm = normalizeStr(projectName);
  const exact = projects.find((p) => normalizeStr(p.name) === norm);
  if (exact) return exact.recordId;
  const partial = projects.find(
    (p) => normalizeStr(p.name).includes(norm) || norm.includes(normalizeStr(p.name))
  );
  return partial ? partial.recordId : null;
}

async function matchTechProject(projectName) {
  if (!projectName) return null;
  const projects = await getTechProjectsCache();
  const norm = normalizeStr(projectName);
  const exact = projects.find((p) => normalizeStr(p.title) === norm);
  if (exact) return exact.recordId;
  const partial = projects.find(
    (p) => normalizeStr(p.title).includes(norm) || norm.includes(normalizeStr(p.title))
  );
  return partial ? partial.recordId : null;
}

async function matchProjectForEmail(projectName, email) {
  if (!projectName) return null;
  if (isIzzy(email)) return matchTechProject(projectName);
  return matchOperationalProject(projectName);
}

// ─── Emoji helpers ────────────────────────────────────────────────────────────

function formatPriorityEmoji(priority) {
  switch (priority) {
    case 'Urgent': return '🔴';
    case 'High': return '🟠';
    case 'Medium': return '🟡';
    case 'Low': return '⚪';
    default: return '⚪';
  }
}

function formatCategoryEmoji(category) {
  const map = {
    Permits: '🏗',
    Subcontractors: '🔧',
    Materials: '📦',
    Client: '👤',
    Site: '🏠',
    Finance: '💰',
    Admin: '📋',
    Draws: '💵',
    Proposals: '📄',
    Lots: '🏘',
    'Vendor Management': '🤝',
  };
  return map[category] || '📌';
}

// ─── Grouping ─────────────────────────────────────────────────────────────────

function groupTasksByPriority(tasks) {
  const groups = { Urgent: [], High: [], Medium: [], Low: [] };
  for (const task of tasks) {
    const p = task.priority || 'Medium';
    if (groups[p]) groups[p].push(task);
    else groups.Medium.push(task);
  }
  return groups;
}

function groupTasksByCategory(tasks) {
  const groups = {};
  for (const task of tasks) {
    const key = task.category || 'Uncategorized';
    if (!groups[key]) groups[key] = [];
    groups[key].push(task);
  }
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99));
  }
  return groups;
}

function groupTasksByProjectName(tasks) {
  const groups = {};
  for (const task of tasks) {
    const key = task.projectName || 'No Project';
    if (!groups[key]) groups[key] = [];
    groups[key].push(task);
  }
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99));
  }
  return groups;
}

function groupTasksByAssignee(tasks) {
  const groups = {};
  for (const task of tasks) {
    const key = task.assigneeEmail || 'Unassigned';
    if (!groups[key]) groups[key] = [];
    groups[key].push(task);
  }
  return groups;
}

// ─── Block builders ───────────────────────────────────────────────────────────

// Tech & Innovation: grouped by project name, then priority within each project
function buildTechTaskBlocks(tasks) {
  const blocks = [];
  const grouped = groupTasksByProjectName(tasks);
  for (const [project, items] of Object.entries(grouped)) {
    if (!items.length) continue;
    const lines = items.map((t) => `  ${formatPriorityEmoji(t.priority)} ${t.taskName}`).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `📁 *${project}*\n${lines}` },
    });
  }
  return blocks;
}

// Operational Tasks: grouped by category, then priority within each category
function buildOperationalTaskBlocks(tasks) {
  const blocks = [];
  const grouped = groupTasksByCategory(tasks);
  for (const [category, items] of Object.entries(grouped)) {
    if (!items.length) continue;
    const emoji = formatCategoryEmoji(category);
    const lines = items.map((t) => `  ${formatPriorityEmoji(t.priority)} ${t.taskName}`).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `${emoji} *${category}*\n${lines}` },
    });
  }
  return blocks;
}

// Unified — picks correct format based on assignee email
function buildPersonalTaskBlocks(tasks, email) {
  if (isIzzy(email)) return buildTechTaskBlocks(tasks);
  return buildOperationalTaskBlocks(tasks);
}

// Legacy priority-only blocks (kept for backward compatibility)
function buildPriorityBlocks(tasks, header) {
  const blocks = [];
  if (header) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*${header} (${tasks.length})*` },
    });
  }
  const groups = groupTasksByPriority(tasks);
  for (const [priority, items] of Object.entries(groups)) {
    if (!items.length) continue;
    const emoji = formatPriorityEmoji(priority);
    const lines = items.slice(0, 20).map((t) => `  • ${t.taskName}`).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `${emoji} *${priority}*\n${lines}` },
    });
  }
  return blocks;
}

module.exports = {
  matchOperationalProject,
  matchTechProject,
  matchProjectForEmail,
  formatPriorityEmoji,
  formatCategoryEmoji,
  groupTasksByPriority,
  groupTasksByCategory,
  groupTasksByProjectName,
  groupTasksByAssignee,
  buildTechTaskBlocks,
  buildOperationalTaskBlocks,
  buildPersonalTaskBlocks,
  buildPriorityBlocks,
};
