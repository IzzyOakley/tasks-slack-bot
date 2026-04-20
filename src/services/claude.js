'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-opus-4-6';

const TASK_EXTRACTION_SYSTEM = `You are a task extraction assistant for Oakley Home Builders, a residential construction company. Your job is to read messages, notes, or conversation excerpts and extract every discrete, actionable task.

For each task, return a JSON array of objects with these fields:
- taskName: string (concise, action-oriented title, max 100 characters, start with a verb)
- description: string or null (additional context if available)
- assigneeEmail: string or null (email address if clearly mentioned or strongly implied, otherwise null)
- priority: "Urgent" | "High" | "Medium" | "Low" (infer from urgency language; default to "Medium")
- category: one of ["Permits", "Subcontractors", "Materials", "Client", "Site", "Finance", "Admin", "Draws", "Proposals", "Lots", "Vendor Management"] — infer from context
- projectName: string or null (project or address mentioned, e.g. "14 Oak St", "Henderson build")
- dueDate: string or null (ISO 8601 date format if a deadline is mentioned, otherwise null)

Return ONLY valid JSON. No markdown. No explanation. If no tasks are found, return [].

Team context:
- Dan (dan@oakleyhomebuilders.com) — handles site operations, subcontractors, materials
- Izzy / Elizabeth (elizabeth@oakleyhomebuilders.com) — handles project management, proposals, client communication
- "Draws" = construction payment draw requests
- "Prelim" = preliminary proposal
- Urgency words like "ASAP", "today", "urgent", "critical" → Priority: Urgent
- Words like "soon", "this week", "follow up" → Priority: High`;

const IMAGE_SYSTEM_PREFIX = `The following image contains handwritten notes from a construction site or office. Read ALL text carefully, including marginalia, numbered lists, circled items, and any annotations. Treat every action item, to-do, follow-up, or reminder as a task.

`;

async function extractTasksFromText(text) {
  return callWithRetry([
    { role: 'user', content: text },
  ], TASK_EXTRACTION_SYSTEM);
}

async function extractTasksFromImage(imageBase64, mediaType) {
  const systemPrompt = IMAGE_SYSTEM_PREFIX + TASK_EXTRACTION_SYSTEM;
  return callWithRetry([
    {
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType,
            data: imageBase64,
          },
        },
        {
          type: 'text',
          text: 'Extract all tasks from this image.',
        },
      ],
    },
  ], systemPrompt);
}

async function parseCommand(text, userEmail) {
  const system = `You are a command parser for a Slack task management bot for Oakley Home Builders. Parse the user's message and return a JSON object describing their intent.

Return a JSON object with:
- intent: one of ["show_my_tasks", "show_user_tasks", "show_all_tasks", "mark_done", "set_priority", "assign_task", "add_task", "scan_channel", "help", "unknown"]
- targetUser: string or null (name or email of the user being referenced, e.g. "Dan", "dan@oakleyhomebuilders.com")
- taskDescription: string or null (description of the task being referenced or created)
- priority: "Urgent" | "High" | "Medium" | "Low" | null
- channel: string or null (channel name without # for scan commands, or "current" or "my_messages")

Current user email: ${userEmail}
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
    // If JSON parse failed, retry with clarification
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

module.exports = { extractTasksFromText, extractTasksFromImage, parseCommand };
