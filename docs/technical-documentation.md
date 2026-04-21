# TaskMate - Technical Documentation

## Overview

TaskMate is a Claude-powered Slack bot deployed on Netlify that automatically extracts tasks from Slack messages and handwritten note photos, logs them to Airtable, and supports conversational task management. It is built for the Oakley Home Builders team and designed to scale to the full workforce.

---

## Architecture

### High-Level Flow

```
Slack Message
     |
     v
slack-events.js          <- Netlify Serverless Function
(verify signature,        (must respond within 3 seconds)
 ack Slack, fire-and-forget)
     |
     v (async POST, no await)
process-task-background.js  <- Netlify Background Function
(AI processing,               (up to 15 minutes runtime)
 Airtable writes,
 Slack thread reply)
     |
     +-- src/services/claude.js      (Anthropic API)
     +-- src/services/airtable.js    (Airtable API)
     +-- src/services/slack.js       (Slack Web API)
     +-- src/utils/userMap.js        (Slack -> email resolution)
     +-- src/utils/taskParser.js     (project matching, Block Kit)

morning-digest.js  <- Netlify Scheduled Function
(runs weekdays at 8 AM EST)
     |
     +-- Personal DM to each assignee (Mon-Fri)
     +-- Group channel overview (Mondays only)
```

### Why Two Functions?

Slack requires a `200 OK` HTTP response within **3 seconds** or it marks the delivery as failed. AI processing and Airtable writes take longer than that. The solution is a two-function pattern:

- `slack-events.js` - verifies the request, acknowledges Slack immediately, then fires an async POST to the background function without awaiting it
- `process-task-background.js` - receives the full payload, does all the work, posts results back to Slack via the Web API

Netlify Background Functions support runtimes up to 15 minutes, which is more than enough for vision processing and bulk scans.

---

## Repository Structure

```
/
+-- netlify/
|   +-- functions/
|       +-- slack-events.js              # Fast ack only - <3s
|       +-- process-task-background.js   # All logic - up to 15min
|       +-- morning-digest.js            # Scheduled weekday digest + DMs
+-- src/
|   +-- services/
|   |   +-- claude.js                    # All Anthropic API calls
|   |   +-- airtable.js                  # All Airtable CRUD
|   |   +-- slack.js                     # Slack Web API helpers
|   +-- utils/
|       +-- userMap.js                   # Slack user ID -> email
|       +-- taskParser.js                # Project matching, formatting
+-- docs/
|   +-- technical-documentation.md
|   +-- user-manual.md
+-- .env.example
+-- .gitignore
+-- netlify.toml
+-- package.json
+-- README.md
```

---

## Technology Stack

| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js | 18+ |
| Hosting | Netlify Serverless + Background Functions | - |
| Slack SDK | @slack/bolt, @slack/web-api | latest |
| AI | Anthropic SDK (@anthropic-ai/sdk) | latest |
| AI Model | claude-opus-4-6 | - |
| Task Database | Airtable via `airtable` npm package | latest |
| HTTP | node-fetch | ^2.6.9 |

All functions use CommonJS (`require`) for Netlify esbuild compatibility.

---

## Environment Variables

| Variable | Description | Where to get it |
|---|---|---|
| `SLACK_BOT_TOKEN` | Bot OAuth token (xoxb-...) | Slack App - OAuth & Permissions |
| `SLACK_SIGNING_SECRET` | Request signing secret | Slack App - Basic Information |
| `ANTHROPIC_API_KEY` | Anthropic API key (sk-ant-...) | console.anthropic.com |
| `AIRTABLE_API_KEY` | Personal Access Token (pat...) | airtable.com/create/tokens |
| `AIRTABLE_BASE_ID` | Base ID (app...) | Base URL in Airtable |
| `DIGEST_CHANNEL_ID` | Slack channel ID for Monday group digest | Right-click channel - Copy link |
| `NETLIFY_SITE_URL` | Full deployed URL | Netlify dashboard |

Set all variables in **Netlify - Site configuration - Environment variables** for production. For local dev, copy `.env.example` to `.env` and fill in values.

---

## Netlify Functions Detail

### `slack-events.js`

**Type**: Regular Serverless Function (3-second timeout)

**Responsibilities**:
- Validates `x-slack-signature` using HMAC-SHA256 with `SLACK_SIGNING_SECRET`
- Rejects requests older than 5 minutes (replay attack protection)
- Handles Slack URL verification challenge (`type: "url_verification"`)
- For all other events: fires a non-awaited POST to `process-task-background` and immediately returns `200`

**Security**: Uses `crypto.timingSafeEqual` to prevent timing attacks during signature comparison.

---

### `process-task-background.js`

**Type**: Background Function (15-minute timeout)

**Entry point**: Parses the Slack event, routes to the correct handler, handles errors, posts failure messages to Slack if something goes wrong.

**Event routing**:
- `app_mention` - `handleAppMention()` - parses commands via Claude
- `message` (no subtype, does not start with a bot mention) - `handleMessage()` - checks for images first, then text

**Bot loop prevention**: Checks `event.bot_id` and `event.subtype === 'bot_message'` and exits immediately for bot-originated messages. Also skips `message` events whose text starts with `<@` to prevent double-processing of mentions.

**Key internal functions**:

| Function | Purpose |
|---|---|
| `handleMessage` | Routes to image or text handler |
| `handleAppMention` | Parses `@TaskMate` commands via Claude; falls back to task extraction for unrecognized input |
| `processTextMessage` | Extracts tasks from text, writes to Airtable, replies in thread |
| `processImageFiles` | Downloads image, sends to Claude vision, writes to Airtable |
| `logTasksToAirtable` | Iterates Claude output, resolves projects, creates records |
| `handleShowTasks` | Fetches tasks for a specific user, formats with Block Kit |
| `handleShowAllTasks` | Fetches all open tasks, groups by assignee |
| `handleMarkDone` | Finds task by name, sets Status=Done + Date Completed |
| `handleSetPriority` | Finds task by name, updates Priority field |
| `handleAssignTask` | Finds task by name, resolves new assignee, updates record |
| `handleScanCommand` | Fetches channel history, bulk-extracts tasks |
| `buildHelpMessage` | Returns formatted help text |

---

### `morning-digest.js`

**Type**: Scheduled Function

**Schedule**: `0 13 * * 1-5` - 1:00 PM UTC = 8:00 AM EST / 9:00 AM EDT, Monday through Friday

**Behavior**:
- **Every weekday (Mon-Fri)**: Fetches all open tasks, groups by assignee, and sends each person a personal DM with their own tasks sorted by priority
- **Mondays only**: Also posts a full team overview to the channel set in `DIGEST_CHANNEL_ID`, showing all open tasks grouped by assignee

**DM flow**: For each assignee email found in open tasks, looks up their Slack user ID via `users.lookupByEmail`, opens a DM channel via `conversations.open`, and posts their task list.

---

## Service Modules

### `src/services/claude.js`

All calls use model `claude-opus-4-6`.

**`extractTasksFromText(text)`**
- Sends text to Claude with the task extraction system prompt
- Returns a JSON array of task objects
- On JSON parse failure: retries once with clarification prompt
- Max tokens: 2000

**`extractTasksFromImage(imageBase64, mediaType)`**
- Sends image as base64-encoded content block with vision
- Prepends handwriting-specific system prompt prefix
- Same JSON output format and retry logic
- Max tokens: 2000

**`parseCommand(text, userEmail)`**
- Determines user intent from a `@TaskMate` mention
- Returns `{ intent, targetUser, taskDescription, priority, channel }`
- Max tokens: 500

**Task JSON schema returned by Claude**:
```json
{
  "taskName": "string",
  "description": "string | null",
  "assigneeEmail": "string | null",
  "priority": "Urgent | High | Medium | Low",
  "category": "Project Sub-contractors/vendors | Active Clients | Sales | Office Procurement | Accountant | IT & Systems | Real Estate Work | Internal Team Collaboration",
  "projectName": "string | null",
  "dueDate": "ISO 8601 string | null"
}
```

---

### `src/services/airtable.js`

Connects to the **"Team Collaboration"** Airtable base, **"Operational Tasks"** and **"Projects"** tables.

**Functions**:

| Function | Description |
|---|---|
| `createTask(fields)` | Creates a new Operational Tasks record. Never writes to Date Created (formula field). Always sets Bot Created = true. |
| `updateTask(recordId, fields)` | Updates Status, Priority, Assignee, or Date Completed |
| `getTasksByAssignee(email)` | Returns open tasks for a specific email, sorted by priority |
| `getTasksByName(name)` | Partial name match for display-name-only lookups |
| `getAllOpenTasks()` | Returns all To Do + In Progress tasks |
| `getProjects()` | Returns all open projects as `{ name, recordId }[]` |
| `findTaskByName(description)` | Fuzzy-finds an open task by partial name match |

**Collaborator fields** are set as `{ email: "..." }` per Airtable API spec.
**Linked record fields** are set as `["recXXXXXXXXXXXXXX"]` arrays.

---

### `src/services/slack.js`

Thin wrapper around `@slack/web-api` WebClient.

| Function | Description |
|---|---|
| `postMessage(channel, text, options)` | Post to a channel |
| `postThreadReply(channel, threadTs, text, options)` | Reply in a thread |
| `getChannelHistory(channelId, limit)` | Fetch recent messages |
| `downloadFile(url)` | Download a Slack file with bot token auth |
| `getUserInfo(userId)` | Get full user object |
| `joinChannel(channelId)` | Join a channel (needed for scan) |
| `getChannelIdByName(channelName)` | Paginate conversations.list to find ID by name |
| `openDirectMessage(userId)` | Open a DM channel with a user, returns channel ID |
| `getUserIdByEmail(email)` | Look up a Slack user ID by email address |

---

### `src/utils/userMap.js`

Resolves Slack user identities to email addresses for Airtable.

- **`resolveUserEmail(slackUserId)`** - calls `users.info`, caches result in memory
- **`resolveUserByDisplayName(displayName)`** - paginates `users.list`, matches on real_name / name / display_name
- **`resolveUserByEmail(email)`** - calls `users.lookupByEmail`

Cache is in-process memory - lives for the duration of the function invocation only.

---

### `src/utils/taskParser.js`

Shared formatting and matching utilities.

- **`matchProject(projectName)`** - fetches and caches projects from Airtable, normalizes names, returns record ID or null
- **`groupTasksByPriority(tasks)`** - groups into `{ Urgent, High, Medium, Low }`
- **`groupTasksByAssignee(tasks)`** - groups by assignee email
- **`buildPriorityBlocks(tasks, header)`** - returns Slack Block Kit block array
- **`formatPriorityEmoji(priority)`** - returns the priority color emoji

---

## Airtable Schema

### Table: "Operational Tasks"

| Field | Type | Notes |
|---|---|---|
| Task Name | Single line text | Required |
| Description | Long text | Optional |
| Assignee | Collaborator | Set via `{ email }` |
| Status | Single select | To Do / In Progress / Blocked / Done |
| Priority | Single select | Urgent / High / Medium / Low |
| Project | Linked record - Projects | Set via record ID array |
| Category | Single select | Project Sub-contractors/vendors / Active Clients / Sales / Office Procurement / Accountant / IT & Systems / Real Estate Work / Internal Team Collaboration |
| Source | Single select | Slack message / Handwritten note / Email / Verbal |
| Source Detail | Single line text | Channel name or context |
| Due Date | Date | ISO format |
| Date Created | Formula | Never write to this field |
| Date Completed | Date | Set when Status = Done |
| Raw Input | Long text | Original message text |
| Bot Created | Checkbox | Always true for bot records |

### Table: "Projects"

| Field | Type |
|---|---|
| Project | Single line text |
| Status | Single select: Open / Closed / Completed |
| Job Stage | Single select |
| Project Manager | Single select |
| Operational Tasks | Linked record |

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

### Event Subscriptions

Request URL: `https://optasks.netlify.app/.netlify/functions/slack-events`

Bot events subscribed:
```
message.channels
message.groups
message.im
message.mpim
app_mention
```

---

## Error Handling

- All Claude and Airtable calls are wrapped in `try/catch`
- Claude JSON parse failures trigger one automatic retry
- Airtable 422 errors (field validation) log the full payload to console
- Any unhandled error in the background function posts a user-facing message to Slack
- All errors are logged via `console.error()` - visible in Netlify function logs
- DM failures (user not found, DM blocked) are logged but do not halt the digest for other users

---

## Security

- Slack request signatures are verified on every inbound request using HMAC-SHA256
- Requests older than 5 minutes are rejected to prevent replay attacks
- `crypto.timingSafeEqual` is used to prevent timing-based signature attacks
- No credentials are hardcoded anywhere - all secrets are injected via environment variables
- `.env` is gitignored and never committed

---

## Local Development

```bash
npm install
cp .env.example .env
# fill in .env
netlify dev
```

Use [ngrok](https://ngrok.com) to expose port 8888 publicly for Slack webhook testing:
```bash
ngrok http 8888
# Set Slack Request URL to: https://xxxx.ngrok.io/.netlify/functions/slack-events
```

---

## Deployment

- Repo: https://github.com/IzzyOakley/tasks-slack-bot
- Host: Netlify (connected to GitHub repo, auto-deploys on push to `main`)
- Live URL: https://optasks.netlify.app

To deploy changes: push to `main` branch - Netlify auto-deploys.

---

## Known Limitations

- **1:1 DMs**: Slack does not allow bots to be added to private 1:1 DMs. Users must use a group DM or forward messages to a monitored channel.
- **Project auto-creation**: The bot matches task project names to existing Airtable Projects but will not create new Project records automatically.
- **User cache**: The in-memory user cache resets on each function invocation. There is no persistent cross-invocation cache.
- **Task fuzzy match**: `findTaskByName` uses simple substring matching. Ambiguous task names may match the wrong record.
- **DM delivery**: Personal DMs require the assignee's Airtable email to match their Slack account email. Mismatches will be logged and skipped.
