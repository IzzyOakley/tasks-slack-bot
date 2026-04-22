'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-opus-4-6';

const TASK_EXTRACTION_SYSTEM = `You are a task extraction assistant for Oakley Home Builders, a residential construction company. Extract every discrete, actionable task from the input.

For each task, return a JSON array of objects with these fields:
- taskName: string (action-oriented title, max 100 characters, start with a verb)
- description: string or null (additional context if available)
- assigneeEmail: string or null (email if clearly mentioned or strongly implied, otherwise null)
- priority: "Urgent" | "High" | "Medium" | "Low" (infer from urgency language; default to "Medium")
- category: one of ["Project Sub-contractors/vendors", "Active Clients", "Sales", "Office Procurement", "Accountant", "IT & Systems", "Real Estate Work", "Internal Team Collaboration"] — infer from context
- projectName: string or null (project or address mentioned, e.g. "14 Oak St", "Henderson build")
- dueDate: string or null (ISO 8601 date format if a deadline is mentioned, otherwise null)

Return ONLY valid JSON. No markdown. No explanation. If no tasks are found, return [].

Team context:
- Dan (dan@oakleyhomebuilders.com) — site operations, subcontractors, materials
- Izzy / Elizabeth (elizabeth@oakleyhomebuilders.com) — project management, proposals, client communication
- Steve (steve@oakleyhomebuilders.com) — oversight only, NEVER assign tasks to Steve
- "Draws" = construction payment draw requests | "Prelim" = preliminary proposal
- Urgency words like "ASAP", "today", "urgent", "critical" → Priority: Urgent
- Words like "soon", "this week", "follow up" → Priority: High`;

const IMAGE_SYSTEM_PREFIX = `The following image contains handwritten notes from a construction site or office. Read ALL text carefully, including marginalia, numbered lists, circled items, and any annotations. Treat every action item, to-do, follow-up, or reminder as a task.

`;

const STEVE_MANAGEMENT_SYSTEM = `Steve is the company boss. He is sending a management command to update an existing task. Parse his message and return JSON:
{
  "action": "reprioritize" | "set_deadline" | "update_status" | "query" | "unknown",
  "taskSearch": string or null (partial task name to search for),
  "newValue": string or null (new priority, ISO date, or status value),
  "targetEmail": string or null
}
Valid priorities: Urgent, High, Medium, Low
Valid statuses: To Do, In Progress, Blocked, Done
For dates, return ISO 8601 (YYYY-MM-DD). "This Friday" or "this week Friday" = the coming Friday.
Return ONLY valid JSON. No markdown.`;

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

async function parseCommand(text, userEmail) {
  const today = new Date().toISOString().split('T')[0];
  const system = `You are a command parser for a Slack task management bot. Parse the user's message and return a JSON object.

Return JSON with:
- intent: one of ["show_my_tasks", "show_user_tasks", "show_all_tasks", "show_urgent", "show_completed", "mark_done", "set_priority", "assign_task", "add_task", "scan_channel", "help", "unknown"]
- targetUser: string or null (name or email of another user being referenced)
- taskDescription: string or null (description of the task being referenced or created)
- priority: "Urgent" | "High" | "Medium" | "Low" | null
- channel: string or null (channel name without # for scan commands, "current", or "my_messages")

Intent guide:
- "show my tasks" / "what's my list" / "what do I have" → show_my_tasks
- "what's urgent" / "what's high priority" → show_urgent
- "what did I complete this week" / "what did I finish" → show_completed
- "what's [name] working on" → show_user_tasks
- "show all open tasks" → show_all_tasks
- "mark [task] as done" / "complete [task]" → mark_done
- "set [task] to [priority]" → set_priority
- "assign [task] to [person]" → assign_task
- "add task: [description]" / "log task" → add_task
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

module.exports = { extractTasksFromText, extractTasksFromImage, parseCommand, parseManagementCommand };
