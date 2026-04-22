# TaskMate — Oakley Home Builders Task Bot

A Claude-powered Slack bot that extracts tasks from messages and photos, logs them to Airtable, and keeps the whole team organized through three interaction layers: personal DMs, a central team channel, and personal oversight channels.

---

## Overview

TaskMate operates across three layers:

**Layer 1 - Personal DMs**
Each team member can DM TaskMate directly. The bot sends a daily morning digest of your open tasks, and you can manage your list conversationally (mark done, change priority, add tasks, view list).

**Layer 2 - Central channel (`#oakley-operational-tasks`)**
Post a message or photo and TaskMate extracts every actionable task, logs them to Airtable, and replies in-thread. Monday morning and Friday afternoon digests are posted here for the whole team.

**Layer 3 - Personal oversight channels (`#dan-tasks`, `#izzy-tasks`, etc.)**
Steve can view and manage each person's task list from their dedicated channel. Weekly digests are also posted here per person. Anyone can invite TaskMate to a personal channel by following the naming convention `#[firstname]-tasks`.

**Steve's role**
Steve (`steve@oakleyhomebuilders.com`) is oversight-only. He is never assigned tasks in Airtable. When Steve messages in a team channel, TaskMate interprets his messages as management commands (reprioritize, reassign, set deadlines). When Steve DMs TaskMate, he is redirected to the personal channels.

---

## Prerequisites

- Slack workspace admin access (to create and install an app)
- [Netlify](https://netlify.com) account (free tier works)
- [Anthropic API key](https://console.anthropic.com)
- [Airtable Personal Access Token](https://airtable.com/create/tokens)
- Node.js 18+ (for local development)
- [Netlify CLI](https://docs.netlify.com/cli/get-started/) (`npm install -g netlify-cli`)

---

## Slack App Setup

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App - From scratch**
2. Name it **TaskMate** and select your workspace
3. Under **OAuth & Permissions - Bot Token Scopes**, add all of the following scopes:

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

4. Click **Install to Workspace** and copy the **Bot User OAuth Token** (starts with `xoxb-`)
5. Under **Basic Information**, copy the **Signing Secret**
6. Under **App Home**, go to the **Messages Tab** section and enable **Allow users to send Slash commands and messages from the messages tab** — this is required for DMs to work
7. Under **Event Subscriptions**, toggle **Enable Events** ON
   - Set the **Request URL** to: `https://YOUR-NETLIFY-URL/.netlify/functions/slack-events`
   - Deploy Netlify first, then paste the URL — Slack will verify it
8. Under **Subscribe to bot events**, add:
   ```
   app_mention
   message.channels
   message.groups
   message.im
   message.mpim
   ```
9. Click **Save Changes** and reinstall the app if prompted

---

## Airtable Setup

1. Open your Airtable base — the base ID is in the URL: `airtable.com/YOUR_BASE_ID/...`
2. Go to [airtable.com/create/tokens](https://airtable.com/create/tokens) and create a Personal Access Token
3. Grant these scopes:
   - `data.records:read`
   - `data.records:write`
   - `schema.bases:read`
4. Under **Access**, select your specific base
5. Copy the token (starts with `pat...`)

Your Airtable base must have a table named **"Operational Tasks"** with these fields:

| Field | Type |
|---|---|
| Task Name | Single line text |
| Assignee | Email |
| Priority | Single select (Urgent, High, Medium, Low) |
| Status | Single select (Open, In Progress, Done) |
| Category | Single select (see values below) |
| Project | Linked record to Projects table |
| Notes | Long text |
| Due Date | Date |
| Date Completed | Date |

**Category values** (must match exactly):
- Project Sub-contractors/vendors
- Active Clients
- Sales
- Office Procurement
- Accountant
- IT & Systems
- Real Estate Work
- Internal Team Collaboration

---

## Environment Variables

Copy `.env.example` to `.env` and fill in all values:

| Variable | Description |
|---|---|
| `SLACK_BOT_TOKEN` | Bot OAuth token from Slack (xoxb-...) |
| `SLACK_SIGNING_SECRET` | Request signing secret from Slack Basic Information |
| `ANTHROPIC_API_KEY` | Anthropic API key (sk-ant-...) |
| `AIRTABLE_API_KEY` | Airtable Personal Access Token (pat...) |
| `AIRTABLE_BASE_ID` | Airtable base ID (app...) |
| `CENTRAL_CHANNEL_ID` | Slack channel ID for `#oakley-operational-tasks` |
| `NETLIFY_SITE_URL` | Full deployed URL, no trailing slash: `https://your-site.netlify.app` |
| `STEVE_EMAIL` | Steve's email address (default: `steve@oakleyhomebuilders.com`) |

**To find a Slack channel ID**: Right-click the channel in Slack - Copy link - the ID is the last path segment (e.g. `C0XXXXXXXX`).

**Important**: Do not include a trailing slash in `NETLIFY_SITE_URL`.

---

## Netlify Deployment

1. Push this repo to GitHub
2. Log in to [app.netlify.com](https://app.netlify.com) - **Add new site - Import an existing project**
3. Connect your GitHub repo
4. Under **Site configuration - Environment variables**, add all variables listed above
5. Deploy — Netlify will auto-detect `netlify.toml`

After deploy, copy your Netlify site URL and:
- Set `NETLIFY_SITE_URL` in Netlify environment variables (no trailing slash)
- Paste `https://YOUR-NETLIFY-URL/.netlify/functions/slack-events` into Slack's Event Subscriptions Request URL

---

## Inviting the Bot

Any team member can invite TaskMate to a channel:

1. Open any channel in Slack
2. Type `/invite @TaskMate`

**Personal oversight channels**: Create a channel named `#[firstname]-tasks` (e.g. `#dan-tasks`, `#izzy-tasks`) and invite TaskMate. The bot will automatically recognize it as a personal channel and route digests and Steve's management commands there.

**DMs**: Click TaskMate's name in the sidebar and start messaging. Make sure the Messages Tab is enabled in the Slack App Home settings (see setup step 6 above).

---

## Command Reference

### Personal DM commands (message TaskMate directly)

| What you type | What happens |
|---|---|
| `what's my list` | Show your open tasks, sorted by priority |
| `show my tasks` | Same as above |
| `show urgent tasks` | Show only Urgent priority tasks |
| `show completed` | Show tasks you completed this week |
| `mark [task] as done` | Mark a task complete |
| `set [task] to high priority` | Change a task's priority |
| `assign [task] to Dan` | Reassign a task to someone else |
| `add task: [description]` | Create a task immediately |
| Any task list or note | TaskMate extracts and logs tasks automatically |

### Central channel commands (in `#oakley-operational-tasks`)

| What you type | What happens |
|---|---|
| `@TaskMate what's my list` | Show your open tasks |
| `@TaskMate show Dan's tasks` | Show Dan's open tasks |
| `@TaskMate show all open tasks` | All open tasks grouped by assignee |
| `@TaskMate show completed` | Tasks completed this week |
| `@TaskMate mark [task] as done` | Mark a task complete |
| `@TaskMate set [task] to urgent` | Change priority |
| `@TaskMate assign [task] to Dan` | Reassign a task |
| `@TaskMate help` | Show command reference |
| Post any message or photo | Tasks are extracted and logged automatically |

### Steve's management commands (in any channel or personal channel)

Steve's messages are interpreted as management instructions, not task creation:

| What Steve types | What happens |
|---|---|
| `set [task] to urgent` | Changes that task's priority |
| `reassign [task] to Dan` | Reassigns the task |
| `set deadline for [task] to Friday` | Sets a due date |
| `mark [task] as done` | Marks the task complete |

---

## Personal Channel Setup

To set up a personal task channel for a team member:

1. Create a Slack channel named `#[firstname]-tasks` (e.g. `#dan-tasks`)
2. Invite the team member and invite `@TaskMate`
3. That's it — TaskMate will automatically detect the channel and route that person's weekly digests there

Steve can manage that person's tasks directly from their personal channel.

---

## Weekly Digest Schedule

| Digest | When | Where |
|---|---|---|
| Morning digest (personal DM) | Weekdays at 8:00 AM EST | Each person's DM with TaskMate |
| Monday overview | Monday at 8:00 AM EST | `#oakley-operational-tasks` + each `#[name]-tasks` channel |
| Friday summary | Friday at 5:00 PM EDT | `#oakley-operational-tasks` + each `#[name]-tasks` channel |

**Monday digest** shows all open tasks grouped by person and sorted by priority.

**Friday digest** shows what was completed during the week and what is still open.

---

## Troubleshooting

### View function logs

In Netlify: **Site - Functions - click a function - Logs**

### Common issues

**Slack says "Your URL didn't respond with the value of the `challenge` parameter"**
- Make sure your Netlify site is deployed before setting the Request URL in Slack.

**Tasks are not appearing in Airtable**
- Check function logs for errors. Verify `AIRTABLE_API_KEY` has `data.records:write` scope and the correct base is selected. Make sure field names in Airtable exactly match the schema.

**DMs to TaskMate are not working**
- Under Slack App Home, enable the Messages Tab and make sure **Allow users to send Slash commands and messages from the messages tab** is turned on.

**Morning digest not posting**
- Verify the bot has been DMed at least once by each team member (Slack requires the user to initiate). Check `morning-digest` function logs.

**Monday or Friday digest not posting to central channel**
- Verify `CENTRAL_CHANNEL_ID` is set correctly and TaskMate has been invited to `#oakley-operational-tasks`.

**Personal channel digests not posting**
- Make sure the channel is named exactly `#[firstname]-tasks` (lowercase, no spaces). TaskMate must be invited to the channel.

**Bot responds with "Something went wrong"**
- Check the `process-task-background` function logs for the specific error.

**Image processing not working**
- Ensure the bot has `files:read` scope and was reinstalled after adding it. Supported formats: jpg, jpeg, png, heic, webp.

**Steve's messages are being logged as tasks**
- Verify `STEVE_EMAIL` environment variable is set correctly in Netlify.
