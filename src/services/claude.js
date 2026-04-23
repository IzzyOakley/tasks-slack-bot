'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-opus-4-6';

const TASK_EXTRACTION_SYSTEM = `You are a task extraction assistant for Oakley Home Builders, a residential construction company. Extract every discrete, actionable task from the input.

For each task, return a JSON array of objects with these fields:
- taskName: string (action-oriented title, max 100 characters, start with a verb)
- description: string or null (additional context)
- assigneeEmail: string or null (email if clearly mentioned or strongly implied, else null)
- priority: "Urgent" | "High" | "Medium" | "Low" (infer from urgency language; default "Medium")
- category: string or null (ONLY for non-Izzy tasks — one of: Permits, Subcontractors, Materials, Client, Site, Finance, Admin, Draws, Proposals, Lots, Vendor Management. Set null for Izzy's tasks)
- projectName: string or null (project or address mentioned, e.g. "14 Oak St", "Henderson build", "MargO")
- dueDate: string or null (ISO 8601 date if a deadline is mentioned, else null)
- notes: string or null (specific notes about the task, e.g. "ask about Thursday availability", "call before noon")
- solutionDescription: string or null (usually null at creation)

ROUTING RULE: If assigneeEmail is elizabeth@oakleyhomebuilders.com — this is a Tech & Innovation task (no category needed, set category null). All other assignees — Operational task (category required).

Return ONLY valid JSON. No markdown. No explanation. If no tasks found, return [].

Team:
- Dan (dan@oakleyhomebuilders.com) — site operations, subcontractors, materials, permits, vendor management
- Izzy / Elizabeth (elizabeth@oakleyhomebuilders.com) — tech systems, project management, software, integrations
- Steve (steve@oakleyhomebuilders.com) — oversight only, NEVER assign tasks to Steve
- "Draws" = construction payment draw requests | "Prelim" = preliminary proposal
- Urgency words (ASAP, today, urgent, critical) → Urgent
- Words (soon, this week, follow up, need to) → High`;

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
  return callWithRetry([{ role: 'user', content: text }], TASK_EXTRACTION_SYSTEM);
}

async function extractTasksFromImage(imageBase64, mediaType) {
  const systemPrompt = IMAGE_SYSTEM_PREFIX + TASK_EXTRACTION_SYSTEM;
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

module.exports = {
  extractTasksFromText,
  extractTasksFromImage,
  parseCommand,
  parseManagementCommand,
  parseSolutionOrNoteUpdate,
};
