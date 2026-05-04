'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { getTechProjects } = require('./airtable');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-opus-4-6';

const TASK_EXTRACTION_SYSTEM_TEMPLATE = `You are a task extraction assistant for Oakley Home Builders, a residential construction company. Extract every discrete, actionable task from the input.

For each task, return a JSON array of objects with these fields:
- taskName: string — STRICT RULE: 3 to 6 words maximum, headline style, starts with a verb.
  Think ticket title, not sentence.
  Good: "Fix bid package duplicates", "Set up bid automation interface", "Call framing sub"
  Bad: "Fix duplicates showing up in bid packages", "I need to set up an interactive interface for bid automated messages"
  The full detail belongs in the description field, not the task name.
- description: string or null — full detail, context, and everything that doesn't fit in the task name.
  This is where the complete information goes. Never leave this blank if there is meaningful context in the original message.
- assigneeEmail: string or null — STRICT RULE: only set this if another person is explicitly named in the message as the one who should do the task.
  Explicit examples: "Dan needs to call the sub", "task for Dan:", "Izzy should fix this", "assign to Dan", "tell Izzy to..."
  Return null in ALL other cases — including "I need to...", "we need to...", "need to follow up...", or any message with no name.
  NEVER infer or guess the assignee. If in doubt, return null. The sender's identity is handled separately.
- priority: "Urgent" | "High" | "Medium" | "Low" (infer from urgency language; default "Medium")
- category: string (required for all Operational tasks — Dan and other team members)
  Choose the single best fit from this list:
  "Project Sub-contractors/vendors" | "Active Clients" | "Sales" | "Office Procurement" |
  "Accountant" | "IT & Systems" | "Real Estate Work" | "Internal Team Collaboration"

  Categorisation guide for Oakley Home Builders context:
  - Project Sub-contractors/vendors: anything involving subs, suppliers, vendors, materials,
    site work, inspections, deliveries, bids from contractors
  - Active Clients: client-facing tasks, client communication, walkthroughs, approvals,
    change orders, client follow-ups
  - Sales: new leads, proposals, estimates, pre-contract work, showing properties
  - Office Procurement: office supplies, equipment purchases, non-project purchasing
  - Accountant: invoices, draws, payments, payroll, financial reviews, accounting tasks
  - IT & Systems: software, tools, computer or system issues for the operations team
  - Real Estate Work: lot acquisitions, land, property transactions, real estate admin
  - Internal Team Collaboration: internal meetings, team coordination, HR, onboarding,
    staff-related tasks

  When in doubt between two categories, pick the one closest to the core action being performed.
  Set null only for Izzy's tasks (Tech & Innovation). Never null for Operational tasks.
- projectName: string | null — only populated for Izzy's tasks. Always null for everyone else.
- dueDate: string or null (ISO 8601 date if a deadline is mentioned, else null)
- notes: string or null (specific notes about the task, e.g. "ask about Thursday availability", "call before noon")
- solutionDescription: string or null (usually null at creation)

ROUTING RULE: If assigneeEmail is elizabeth@oakleyhomebuilders.com — this is a Tech & Innovation task (no category needed, set category null). All other assignees — Operational task (category required).

PROJECT MATCHING RULES:

For Izzy's tasks (assigneeEmail = elizabeth@oakleyhomebuilders.com) only:
Use semantic reasoning to match the task context to the most relevant Tech Project.
Even if the project is not explicitly named, infer from keywords and context.
If no reasonable match exists, return null.
You MUST return the project name exactly as it appears in this list (spelling and capitalisation must match).

Available Tech Projects: {{TECH_PROJECTS_LIST}}

For all other tasks (Dan and any other team member):
Always return null for projectName. No project linking for Operational Tasks.

Return ONLY valid JSON. No markdown. No explanation. If no tasks found, return [].

Team reference (for explicit name matching only):
- Dan (dan@oakleyhomebuilders.com) — site operations, subcontractors, materials, permits, vendor management
- Izzy / Elizabeth (elizabeth@oakleyhomebuilders.com) — tech systems, project management, software, integrations
- Steve (steve@oakleyhomebuilders.com) — oversight only, NEVER assign tasks to Steve
- "Draws" = construction payment draw requests | "Prelim" = preliminary proposal
- Urgency words (ASAP, today, urgent, critical) → Urgent
- Words (soon, this week, follow up, need to) → High

ASSIGNMENT REMINDER: Most messages will have assigneeEmail = null. That is correct. The system assigns to the sender by default. Only override with a named email when the message unmistakably directs the task at a specific named person.`;

async function buildExtractionSystem() {
  let techProjectsList = '(none available)';
  try {
    const projects = await getTechProjects();
    const titles = projects.map((p) => p.title).filter(Boolean);
    if (titles.length) techProjectsList = titles.join(', ');
  } catch (err) {
    console.error('Failed to fetch tech projects for prompt:', err.message);
  }
  return TASK_EXTRACTION_SYSTEM_TEMPLATE.replace('{{TECH_PROJECTS_LIST}}', techProjectsList);
}

const IMAGE_SYSTEM_PREFIX = `The following image contains handwritten notes from a construction site or office. Read ALL text carefully, including marginalia, numbered lists, circled items, and annotations. Treat every action item, to-do, follow-up, or reminder as a task.

`;

const STEVE_MANAGEMENT_SYSTEM = `Steve is the company boss. He is sending a management command to update an existing task. Parse his message and return JSON:
{
  "action": "reprioritize" | "set_deadline" | "update_status" | "query" | "unknown",
  "taskSearch": string or null,
  "newValue": string or null,
  "targetEmail": string or null
}
Valid priorities: Urgent, High, Medium, Low
Valid statuses: To Do, In Progress, Blocked, Done
Dates: ISO 8601 (YYYY-MM-DD). "This Friday" = coming Friday.
Return ONLY valid JSON. No markdown.`;

// ─── Task extraction ──────────────────────────────────────────────────────────

async function extractTasksFromText(text) {
  const systemPrompt = await buildExtractionSystem();
  return callWithRetry([{ role: 'user', content: text }], systemPrompt);
}

async function extractTasksFromImage(imageBase64, mediaType) {
  const systemPrompt = IMAGE_SYSTEM_PREFIX + (await buildExtractionSystem());
  return callWithRetry([
    {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: 'Extract all tasks from this image.' },
      ],
    },
  ], systemPrompt);
}

// ─── Command parsing ──────────────────────────────────────────────────────────

async function parseCommand(text, userEmail) {
  const today = new Date().toISOString().split('T')[0];
  const system = `You are a command parser for a Slack task management bot. Parse the user's message and return a JSON object.

Return JSON with:
- intent: one of ["show_my_tasks", "show_user_tasks", "show_all_tasks", "show_urgent", "show_completed", "mark_done", "set_priority", "assign_task", "add_task", "add_note", "add_solution", "scan_channel", "help", "unknown"]
- targetUser: string or null (name or email of another user)
- taskDescription: string or null (task name being referenced or created)
- priority: "Urgent" | "High" | "Medium" | "Low" | null
- channel: string or null (channel name without # for scan commands, "current", or "my_messages")
- updateValue: string or null (the text content to set — used for add_note and add_solution intents)

Intent guide:
- "show my tasks" / "what's my list" → show_my_tasks
- "what's urgent" / "what's high priority" → show_urgent
- "what did I complete this week" → show_completed
- "what's [name] working on" → show_user_tasks
- "show all open tasks" → show_all_tasks
- "mark [task] as done" → mark_done
- "set [task] to [priority]" → set_priority
- "assign [task] to [person]" → assign_task
- "add task: [description]" → add_task
- "add note to [task]: [text]" → add_note (taskDescription = task name, updateValue = text)
- "add solution to [task]: [text]" → add_solution (taskDescription = task name, updateValue = text)
- "scan #channel" / "scan this channel" → scan_channel
- "help" → help

Today is ${today}. Current user email: ${userEmail}
Return ONLY valid JSON. No markdown.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 500,
    system,
    messages: [{ role: 'user', content: text }],
  });

  const raw = response.content[0].text.trim();
  try {
    return JSON.parse(raw);
  } catch {
    return { intent: 'unknown' };
  }
}

// ─── Steve management command parser ─────────────────────────────────────────

async function parseManagementCommand(text, openTasks) {
  const today = new Date().toISOString().split('T')[0];
  const taskList = openTasks.length
    ? openTasks.map((t, i) => `${i + 1}. ${t.taskName} (${t.priority})`).join('\n')
    : '(no open tasks)';

  const userContent = `Current open tasks:\n${taskList}\n\nSteve's message: "${text}"`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 500,
      system: STEVE_MANAGEMENT_SYSTEM + `\n\nToday is ${today}.`,
      messages: [{ role: 'user', content: userContent }],
    });
    return JSON.parse(response.content[0].text.trim());
  } catch {
    return { action: 'unknown' };
  }
}

// ─── Notes / solution update parser ──────────────────────────────────────────

async function parseSolutionOrNoteUpdate(text) {
  const system = `Parse this task update command and return JSON:
{
  "fieldToUpdate": "Solution Description" | "Notes",
  "taskSearch": string,
  "newValue": string
}
If the message says "add solution", "update solution", or "solution:" → "Solution Description"
If the message says "add note", "update note", "note:", or "notes:" → "Notes"
taskSearch: the task name or description being referenced
newValue: the text content to set
Return ONLY valid JSON. No markdown.`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 500,
      system,
      messages: [{ role: 'user', content: text }],
    });
    return JSON.parse(response.content[0].text.trim());
  } catch {
    return null;
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function callWithRetry(messages, system) {
  let raw;
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system,
      messages,
    });
    raw = response.content[0].text.trim();
    return JSON.parse(raw);
  } catch (firstErr) {
    if (firstErr instanceof SyntaxError && raw) {
      try {
        const retryResponse = await client.messages.create({
          model: MODEL,
          max_tokens: 2000,
          system,
          messages: [
            ...messages,
            { role: 'assistant', content: raw },
            { role: 'user', content: 'Return only a valid JSON array. No markdown or explanation.' },
          ],
        });
        return JSON.parse(retryResponse.content[0].text.trim());
      } catch (retryErr) {
        console.error('Claude retry failed:', retryErr.message);
        return [];
      }
    }
    console.error('Claude API error:', firstErr.message);
    return [];
  }
}

// ─── Friday digest rewriter ───────────────────────────────────────────────────

async function rewriteTasksForReport(completedTasks, openTasks) {
  const items = [
    ...completedTasks.map((t) => ({ id: t.id, name: t.taskName, type: 'completed' })),
    ...openTasks.map((t) => ({ id: t.id, name: t.taskName, type: 'open' })),
  ];
  if (!items.length) return new Map();

  const system = `Rewrite construction company task names for a professional weekly report.
- "completed" tasks → confident past tense (e.g. "Called framing sub", "Reviewed Henderson invoices", "Resolved MargO security issue")
- "open" tasks → forward-looking present/future (e.g. "Follow up on permits", "Complete bid automation setup", "Send updated proposal")
Keep names short: 2–6 words. Preserve the subject matter exactly — just change the tense and tone.
Return ONLY valid JSON array: [{ "id": "...", "rewritten": "..." }]`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system,
      messages: [{ role: 'user', content: JSON.stringify(items) }],
    });
    let raw = response.content[0].text.trim();
    // Strip markdown code fences if Claude wraps the response
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const result = JSON.parse(raw);
    return new Map(result.map((r) => [r.id, r.rewritten]));
  } catch (err) {
    console.error('rewriteTasksForReport failed:', err.message);
    return new Map();
  }
}

module.exports = {
  extractTasksFromText,
  extractTasksFromImage,
  parseCommand,
  parseManagementCommand,
  parseSolutionOrNoteUpdate,
  rewriteTasksForReport,
};
