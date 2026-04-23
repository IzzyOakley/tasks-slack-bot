# TaskMate - Technical Documentation

## Overview

TaskMate is a Claude-powered Slack bot deployed on Netlify that automatically extracts tasks from Slack messages and handwritten note photos, routes them to the correct Airtable table based on the assignee, and supports conversational task management across three interaction layers. Built for Oakley Home Builders.

---

## Architecture

### High-Level Flow

```
Slack Event (message / app_mention)
     |
     v
slack-events.js                    <- Serverless Function (<3s)
  - Verify HMAC-SHA256 signature
  - Handle URL verification challenge
  - Await POST to background function (returns 202 immediately)
  - Return 200 to Slack
     |
     v
process-task-background.js         <- Background Function (up to 15min)
  - Route by event type and channel_type
  - DM: conversational command handling
  - Channel: task extraction + Airtable write
  - Personal task channel + Steve: management commands
     |
     +-- src/services/claude.js      (Anthropic API - task extraction, commands)
     +-- src/services/airtable.js    (Airtable - dual-table CRUD)
     +-- src/services/slack.js       (Slack Web API helpers)
     +-- src/utils/userMap.js        (Slack ID -> email, isSteve())
     +-- src/utils/taskParser.js     (project matching, Block Kit builders)
     +-- src/utils/channelMap.js     (personal [name]-tasks channel detection)

Scheduled Functions (Netlify Cron):
  morning-digest.js   <- weekdays 8 AM EST - personal DMs
  monday-digest.js    <- Mondays 8 AM EST  - central channel + personal channels
  friday-digest.js    <- Fridays 5 PM EDT  - completed + open summary
```

### Why Two Functions?

Slack requires a `200 OK` HTTP response within **3 seconds** or it marks the delivery as failed. AI processing and Airtable writes take longer. The solution:

- `slack-events.js` - verifies the request, acknowledges Slack, awaits a POST to the background function (which returns `202 Accepted` immediately - negligible latency), then returns `200`
- `process-task-background.js` - receives the full payload, does all the work, posts results back via Slack Web API

Note: fire-and-forget (non-awaited fetch) was used previously but caused intermittent dropped events because the Node.js process terminated before the TCP connection was established. Awaiting the fetch resolves in milliseconds and is reliable.

---

## Repository Structure

```
/
+-- netlify/
|   +-- functions/
|       +-- slack-events.js              # Fast ack only - <3s
|       +-- process-task-background.js   # All logic - up to 15min
|       +-- morning-digest.js            # Scheduled - weekday personal DMs
|       +-- monday-digest.js             # Scheduled - Monday team overview
|       +-- friday-digest.js             # Scheduled - Friday end-of-week summary
+-- src/
|   +-- services/
|   |   +-- claude.js                    # All Anthropic API calls
|   |   +-- airtable.js                  # All Airtable CRUD - both tables
|   |   +-- slack.js                     # Slack Web API helpers
|   +-- utils/
|       +-- userMap.js                   # Slack user ID -> email, isSteve()
|       +-- channelMap.js                # Personal [name]-tasks channel detection
|       +-- taskParser.js                # Project matching, Block Kit builders
+-- docs/
|   +-- technical-documentation.md
|   +-- user-manual.md
+-- .env.example
+-- netlify.toml
+-- package.json
+-- README.md
```

---

## Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ (CommonJS for Netlify esbuild compatibility) |
| Hosting | Netlify Serverless + Background + Scheduled Functions |
| Slack SDK | @slack/web-api |
| AI | @anthropic-ai/sdk, model: claude-opus-4-6 |
| Task Database | Airtable via `airtable` npm package |
| HTTP | node-fetch ^2.6.9 |

---

## Environment Variables

| Variable | Description |
|---|---|
| `SLACK_BOT_TOKEN` | Bot OAuth token (xoxb-...) |
| `SLACK_SIGNING_SECRET` | Request signing secret - Slack App Basic Information |
| `ANTHROPIC_API_KEY` | Anthropic API key (sk-ant-...) |
| `AIRTABLE_API_KEY` | Personal Access Token (pat...) |
| `AIRTABLE_BASE_ID` | Base ID (app...) - from Airtable URL |
| `CENTRAL_CHANNEL_ID` | Slack channel ID for #oakley-operational-tasks |
| `STEVE_EMAIL` | Steve's email (default: steve@oakleyhomebuilders.com) |
| `NETLIFY_SITE_URL` | Full deployed URL, no trailing slash |

---

## Table Routing Logic

This is the core rule applied on every task creation:

| Assignee | Airtable table | Project table | Digest format |
|---|---|---|---|
| elizabeth@oakleyhomebuilders.com (Izzy) | Tech & Innovation Tasks | Tech Projects (field: "Project Title") | By Project, then Priority |
| Any other email | Operational Tasks | Projects (field: "Project") | By Category, then Priority |

Steve (`STEVE_EMAIL`) is never assigned tasks. His messages in personal channels are interpreted as management commands, not task creation.

**Assigned By** is populated on every task from `event.user` (the Slack sender's email), regardless of who the assignee is.

---

## Netlify Functions

### `slack-events.js`

**Type**: Regular Serverless Function (3-second budget)

- Validates `x-slack-signature` using HMAC-SHA256 + `SLACK_SIGNING_SECRET`
- Rejects requests older than 5 minutes (replay attack protection via `crypto.timingSafeEqual`)
- Handles Slack URL verification challenge
- For all other events: awaits POST to `process-task-background`, returns `200`

---

### `process-task-background.js`

**Type**: Background Function (15-minute budget)

**Event routing**:

| Condition | Handler |
|---|---|
| `event.bot_id` or `subtype === 'bot_message'` | Exit (prevent loops) |
| `app_mention` in DM | `handleDMMessage` |
| `app_mention` in channel | `handleAppMention` |
| `message` starting with `<@` | Skip (already handled by app_mention) |
| `message` in DM | `handleDMMessage` |
| `message` in personal `[name]-tasks` channel, sender = Steve | `handleSteveCommand` |
| `message` in any other channel | `handleChannelMessage` (extract + log tasks) |

**Key functions**:

| Function | Description |
|---|---|
| `handleDMMessage` | Parses command intent; Steve gets redirect; others get conversational task management |
| `handleAppMention` | Parses @TaskMate command; falls back to task extraction for unknown input |
| `handleChannelMessage` | Routes images to `processImageFiles`, text to `processTextMessage` |
| `handleSteveCommand` | Parses management command, fuzzy-matches tasks, updates Airtable |
| `processTextMessage` | Extracts tasks, routes to correct table, replies with confirmation |
| `processImageFiles` | Downloads image, sends to Claude vision, routes tasks to correct tables |
| `logTasksToAirtable` | Iterates Claude output, routes each task (Izzy -> Tech, others -> Operational), sets Assigned By, sends DM notifications |
| `buildLogConfirmation` | Builds reply string labelled by table: "Logged for Dan (Operational): ... | Logged for Izzy (Tech): ..." |
| `handleShowTasks` | Fetches tasks via `getTasksByAssignee` (routes automatically), formats with correct block builder |
| `handleShowAllTasks` | Queries both tables, groups by assignee, formats each person correctly |
| `handleMarkDone` | Finds task (searches correct table first via `findTaskByName`), uses `task.table` to route update |
| `handleSetPriority` | Same pattern as mark done |
| `handleAssignTask` | Updates assignee in-place in existing table |
| `handleAddFieldUpdate` | Updates Notes (Operational only) or Solution Description (Tech only), validates table match |
| `handleScanCommand` | Fetches channel history, bulk-extracts and routes tasks |
| `sendTaskAssignmentNotification` | DMs the assignee when someone else logs a task for them |

---

### `morning-digest.js`

**Schedule**: `0 13 * * 1-5` (8 AM EST, weekdays)

Fetches all open tasks from both tables, groups by assignee, sends each person a personal DM in their correct format (Izzy: by project/priority, others: by category/priority). Skips Steve.

---

### `monday-digest.js`

**Schedule**: `0 13 * * 1` (8 AM EST, Monday only)

Posts to two places:
1. `CENTRAL_CHANNEL_ID` - full team overview, each person in their correct format
2. Each `#[name]-tasks` channel - that person's tasks only, in their correct format

---

### `friday-digest.js`

**Schedule**: `0 21 * * 5` (9 PM UTC = 5 PM EDT, Friday)

Fetches completed tasks from both tables (Date Completed within current week) and all open tasks. Posts to the central channel and each personal channel with:
- Completed tasks (with checkmarks), grouped by category or project
- Still-open tasks, same grouping

---

## Service Modules

### `src/services/claude.js`

All calls use model `claude-opus-4-6`.

**`extractTasksFromText(text)`** and **`extractTasksFromImage(imageBase64, mediaType)`**

Before calling the Anthropic API, these functions:
1. Call `getTechProjects()` from `airtable.js` to get the current list of Tech Project titles
2. Inject the list into the system prompt replacing `{{TECH_PROJECTS_LIST}}`
3. Send to Claude with the full extraction system prompt

This means Claude performs semantic project matching for Izzy's tasks (e.g. "bid automation" → "Bid Automated Reminders") and returns the exact project title from the list. Code-side matching is then a simple exact case-insensitive lookup.

**Task extraction JSON schema returned by Claude**:
```json
{
  "taskName": "3-6 words, headline style, starts with verb",
  "description": "full detail and context - never blank if context exists",
  "assigneeEmail": "string | null",
  "priority": "Urgent | High | Medium | Low",
  "category": "Permits | Subcontractors | Materials | Client | Site | Finance | Admin | Draws | Proposals | Lots | Vendor Management | null",
  "projectName": "exact title from Tech Projects list (Izzy) | explicit address/name (others) | null",
  "dueDate": "ISO 8601 | null",
  "notes": "string | null",
  "solutionDescription": "null at creation"
}
```

Category is null for Izzy's tasks (Tech table has no category field). projectName is semantically inferred for Izzy, explicitly required for others.

**`parseCommand(text, userEmail)`**

Returns `{ intent, targetUser, taskDescription, priority, channel, updateValue }`.

Intents: `show_my_tasks`, `show_user_tasks`, `show_all_tasks`, `show_urgent`, `show_completed`, `mark_done`, `set_priority`, `assign_task`, `add_task`, `add_note`, `add_solution`, `scan_channel`, `help`, `unknown`

`add_note` and `add_solution` populate `taskDescription` and `updateValue`.

**`parseManagementCommand(text, openTasks)`**

Steve-specific parser. Returns `{ action, taskSearch, newValue, targetEmail }`.
Actions: `reprioritize`, `set_deadline`, `update_status`, `query`, `unknown`.

**`parseSolutionOrNoteUpdate(text)`**

Parses "add note/solution to [task]: [text]" as fallback. Returns `{ fieldToUpdate, taskSearch, newValue }`.

**Retry logic**: On JSON parse failure, retries once by appending the failed response and asking for valid JSON only.

---

### `src/services/airtable.js`

Connects to the **"Team Collaboration"** Airtable base.

**Constants exported**: `OPERATIONAL_TABLE`, `TECH_TABLE`

**Routing helpers exported**: `isIzzy(email)`, `getTableForEmail(email)`

**Create functions**:

| Function | Table | Notes |
|---|---|---|
| `createOperationalTask(fields)` | Operational Tasks | Uses "Description" field |
| `createTechTask(fields)` | Tech & Innovation Tasks | Uses "Task Description" field (different name) |

Both functions accept: `taskName`, `description`, `assigneeEmail`, `assignedByEmail`, `priority`, `source`, `sourceDetail`, `dueDate`, `rawInput`, `projectRecordId`. Operational also accepts `category` and `notes`.

**Update**:

`updateTask(recordId, fields, table)` - routes to correct table. Supports `status`, `priority`, `assigneeEmail`, `dateCompleted`, `dueDate`. Also supports `notes` for Operational and `solutionDescription` for Tech.

**Query functions**:

| Function | Description |
|---|---|
| `getTasksByAssignee(email)` | Routes to correct table, enriches Tech tasks with project names |
| `getAllOpenOperationalTasks()` | To Do + In Progress + Blocked from Operational |
| `getAllOpenTechTasks()` | Same from Tech, enriched with project names |
| `getAllOpenTasks()` | Both tables combined |
| `getCompletedThisWeek(tableKey)` | Pass `'tech'` or `'operational'`; filters by Date Completed >= Monday |
| `getCompletedThisWeekAll()` | Both tables combined |
| `getOperationalProjects()` | Returns `{ name, recordId }[]` from Projects table |
| `getTechProjects()` | Returns `{ title, recordId }[]` from Tech Projects table (field: "Project Title") |
| `findTaskByName(description, preferEmail)` | Searches correct table first (based on email), falls back to other table; returns task object with `.table` property |

**Project name enrichment**: `enrichTechTasksWithProjectNames(tasks)` fetches Tech Projects and maps record IDs to titles. Called internally by any function returning Tech tasks.

**Task record shape**:
```js
{
  id, table,            // table = OPERATIONAL_TABLE or TECH_TABLE
  taskName, description,
  assigneeEmail, assignedByEmail,
  status, priority, category,
  projectRecordId, projectName,  // projectName populated by enrichment
  dueDate, dateCompleted,
  notes, solutionDescription
}
```

The `.table` property is used throughout `process-task-background.js` to route updates correctly.

---

### `src/services/slack.js`

| Function | Description |
|---|---|
| `postMessage(channel, text, options)` | Post to a channel or DM |
| `postThreadReply(channel, threadTs, text, options)` | Reply in a thread |
| `getChannelHistory(channelId, limit)` | Fetch recent messages |
| `downloadFile(url)` | Download a Slack file with bot token auth |
| `getUserInfo(userId)` | Get full Slack user object |
| `getUserDisplayName(userId)` | Returns display_name or real_name |
| `joinChannel(channelId)` | Join a channel (used for scan) |
| `getChannelInfo(channelId)` | Get channel metadata including name |
| `getChannelIdByName(channelName)` | Paginate conversations.list to find ID |
| `openDirectMessage(userId)` | Open a DM channel, returns channel ID |
| `getUserIdByEmail(email)` | Look up Slack user ID by email |

---

### `src/utils/userMap.js`

- `resolveUserEmail(slackUserId)` - calls `users.info`, caches in memory
- `resolveUserByDisplayName(displayName)` - paginates `users.list`, matches on real_name/name/display_name
- `resolveUserByEmail(email)` - calls `users.lookupByEmail`
- `isSteve(email)` - checks against `STEVE_EMAIL` env var

---

### `src/utils/channelMap.js`

- `getPersonalTaskChannels()` - paginates `conversations.list`, returns all channels the bot is a member of matching `^[a-z]+-tasks$`
- `getChannelOwnerName(channelName)` - extracts first name from `dan-tasks` → `dan`
- `isPersonalTaskChannel(channelName)` - regex test

---

### `src/utils/taskParser.js`

**Project matching**:

- `matchOperationalProject(projectName)` - exact case-insensitive lookup in Projects cache
- `matchTechProject(projectName)` - exact case-insensitive lookup in Tech Projects cache
- `matchProjectForEmail(projectName, email)` - routes to correct function

Exact-only matching (no fuzzy/partial): Claude returns the exact project title from the injected list, so the code just needs to confirm the match and return the record ID.

**Block builders**:

| Function | Used for |
|---|---|
| `buildTechTaskBlocks(tasks)` | Tech tasks - grouped by project name, then priority |
| `buildOperationalTaskBlocks(tasks)` | Operational tasks - grouped by category, then priority |
| `buildPersonalTaskBlocks(tasks, email)` | Routes to correct builder based on `isIzzy(email)` |
| `buildPriorityBlocks(tasks, header)` | Legacy priority-only grouping |

**Grouping helpers**: `groupTasksByPriority`, `groupTasksByCategory`, `groupTasksByProjectName`, `groupTasksByAssignee`

**Emoji helpers**: `formatPriorityEmoji` (🔴🟠🟡⚪), `formatCategoryEmoji` (🏗🔧📦👤🏠💰📋💵📄🏘🤝)

---

## Airtable Schema

### Table: "Operational Tasks" (Dan + all other team members)

| Field | Type | Notes |
|---|---|---|
| Task Name | Single line text | 3-6 words, headline style |
| Description | Long text | Full context |
| Assignee | Collaborator | `{ email }` |
| Assigned By | Collaborator | `{ email }` of Slack message sender |
| Status | Single select | To Do / In Progress / Blocked / Done |
| Priority | Single select | Urgent / High / Medium / Low |
| Project | Linked record | Links to Projects table |
| Category | Single select | Permits / Subcontractors / Materials / Client / Site / Finance / Admin / Draws / Proposals / Lots / Vendor Management |
| Source | Single select | Slack message / Handwritten note / Email / Verbal |
| Source Detail | Single line text | e.g. "#oakley-operational-tasks" |
| Due Date | Date | ISO format |
| Date Created | Formula | Never write to this field |
| Date Completed | Date | Set when Status = Done |
| Notes | Long text | Task-specific notes or reminders |
| Raw Input | Long text | Original message text |
| Bot Created | Checkbox | Always true for bot records |

### Table: "Tech & Innovation Tasks" (Izzy only)

| Field | Type | Notes |
|---|---|---|
| Task Name | Single line text | 3-6 words, headline style |
| Task Description | Long text | Note: "Task Description" not "Description" |
| Assignee | Collaborator | `{ email }` |
| Assigned By | Collaborator | `{ email }` of Slack message sender |
| Status | Single select | To Do / In Progress / Blocked / Done |
| Priority | Single select | Urgent / High / Medium / Low |
| Project | Linked record | Links to Tech Projects table |
| Source | Single select | |
| Source Detail | Single line text | |
| Due Date | Date | |
| Date Created | Formula | Never write to this field |
| Date Completed | Date | |
| Raw Input | Long text | |
| Bot Created | Checkbox | |
| Solution Description | Long text | How the task was resolved |

### Table: "Projects" (linked to Operational Tasks)

| Field | Type |
|---|---|
| Project | Single line text |
| Status | Single select: Open / Closed / Completed |
| Job Stage | Single select |
| Project Manager | Single select |

### Table: "Tech Projects" (linked to Tech & Innovation Tasks)

| Field | Type | Notes |
|---|---|---|
| Project Title | Single line text | Field name is "Project Title" not "Project" |
| Project description | Long text | |
| Status | Single select | |

---

## Slack App Configuration

### Required Bot Token Scopes

```
app_mentions:read
channels:history
channels:read
chat:write
files:read
groups:history
groups:read
im:history
im:read
im:write
mpim:history
mpim:read
mpim:write
users:read
users:read.email
```

### App Home

Under **App Home - Messages Tab**: enable **Allow users to send Slash commands and messages from the messages tab**. Required for personal DM conversations.

### Event Subscriptions

Request URL: `https://optasks.netlify.app/.netlify/functions/slack-events`

```
app_mention
message.channels
message.groups
message.im
message.mpim
```

---

## Error Handling

- All Claude and Airtable calls wrapped in `try/catch`
- Claude JSON parse failures trigger one automatic retry with clarification prompt
- Airtable 422 errors log the full payload for debugging
- Any unhandled error in the background function posts a user-facing message to Slack
- DM failures (user not found, DM blocked) are logged but do not halt the digest for other users
- Tech project fetch failure in `buildExtractionSystem` falls back gracefully with `(none available)` rather than crashing

---

## Security

- Slack request signatures verified on every inbound request via HMAC-SHA256
- Requests older than 5 minutes rejected (replay attack prevention)
- `crypto.timingSafeEqual` prevents timing-based signature attacks
- No credentials hardcoded - all secrets injected via environment variables
- `.env` is gitignored

---

## Deployment

- Repo: https://github.com/IzzyOakley/tasks-slack-bot
- Host: Netlify (connected to GitHub, auto-deploys on push to `main`)
- Live URL: https://optasks.netlify.app

---

## Local Development

```bash
npm install
cp .env.example .env
# fill in .env
netlify dev
```

Use [ngrok](https://ngrok.com) to expose port 8888 for Slack webhook testing:
```bash
ngrok http 8888
# Set Slack Request URL to: https://xxxx.ngrok.io/.netlify/functions/slack-events
```

---

## Known Limitations

- **1:1 DMs**: Slack does not allow bots in private 1:1 DMs. Use group DMs or a channel.
- **Table reassignment**: If a task is reassigned between Izzy and someone else via `assign [task] to...`, the record stays in the original table with the assignee updated. Cross-table migration is not implemented.
- **Project auto-creation**: The bot matches tasks to existing projects but will not create new Project or Tech Project records.
- **User cache**: The in-memory user cache resets per function invocation - there is no persistent cross-invocation cache.
- **Tech project injection**: The Tech Projects list is fetched from Airtable on every extraction call. If the API call fails, the project list in the prompt falls back to "(none available)" and project linking will not work for that call.
