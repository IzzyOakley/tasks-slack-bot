'use strict';

const { getProjects } = require('../services/airtable');

// In-memory project cache per function invocation
let projectsCache = null;

async function getProjectsCache() {
  if (!projectsCache) {
    projectsCache = await getProjects();
  }
  return projectsCache;
}

function normalizeStr(str) {
  return (str || '').toLowerCase().trim();
}

async function matchProject(projectName) {
  if (!projectName) return null;
  const projects = await getProjectsCache();
  const normalized = normalizeStr(projectName);

  // Exact match first
  const exact = projects.find((p) => normalizeStr(p.name) === normalized);
  if (exact) return exact.recordId;

  // Partial match
  const partial = projects.find(
    (p) => normalizeStr(p.name).includes(normalized) || normalized.includes(normalizeStr(p.name))
  );
  return partial ? partial.recordId : null;
}

function formatPriorityEmoji(priority) {
  switch (priority) {
    case 'Urgent': return '🔴';
    case 'High': return '🟠';
    case 'Medium': return '🟡';
    case 'Low': return '⚪';
    default: return '⚪';
  }
}

function groupTasksByPriority(tasks) {
  const groups = { Urgent: [], High: [], Medium: [], Low: [] };
  for (const task of tasks) {
    const p = task.priority || 'Medium';
    if (groups[p]) groups[p].push(task);
    else groups.Medium.push(task);
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

// Build a Slack Block Kit section for a list of tasks grouped by priority
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
  matchProject,
  formatPriorityEmoji,
  groupTasksByPriority,
  groupTasksByAssignee,
  buildPriorityBlocks,
};
