# TaskMate — Oakley Home Builders Task Bot

A Claude-powered Slack bot that extracts tasks from messages and photos, routes them to the correct Airtable table based on who is assigned, and keeps the whole team organised through three interaction layers: personal DMs, a central team channel, and personal oversight channels.

---

## Overview

TaskMate operates across three layers:

**Layer 1 - Personal DMs**
Each team member DMs TaskMate directly. The bot sends a daily morning digest of your open tasks, and you can manage your list conversationally (mark done, change priority, add tasks, view list, add notes or solution descriptions).

**Layer 2 - Central channel (`#oakley-operational-tasks`)**
Post a message or photo and TaskMate extracts every actionable task, routes each to the correct Airtable table, and replies in-thread. Monday morning and Friday afternoon digests are posted here for the whole team.

**Layer 3 - Personal oversight channels (`#dan-tasks`, `#izzy-tasks`, etc.)**
Steve can view and manage each person's task list from their dedicated channel. Weekly digests post here per person, in that person's correct format.

**Steve's role**
Steve (`steve@oakleyhomebuilders.com`) is oversight-only. He is never assigned tasks in Airtable. When Steve posts in a personal task channel, TaskMate interprets it as a management command (reprioritise, reassign, set deadlines). When Steve DMs TaskMate, he is redirected to the personal channels.

---

## Routing Logic

This is the core rule TaskMate follows on every task creation:

| Assignee | Airtable table | Project lookup | Digest format |
|---|---|---|---|
| Izzy (elizabeth@oakleyhomebuilders.com) | Tech & Innovation Tasks | Tech Projects (field: "Project Title") | Grouped by Project, then Priority |
| Dan, or any other team member | Operational Tasks | Projects (field: "Project") | Grouped by Category, then Priority |

**Mixed messages**: If Izzy posts "Dan needs to call the framing sub and I need to fix the MargO security integration", TaskMate creates one record in Operational Tasks (Dan) and one in Tech & Innovation Tasks (Izzy) in the same operation and labels each in the reply.

**Assigned By**: Every task records who assigned it. If Izzy posts a task for Dan, the task shows Assigned By = Izzy, Assignee = Dan.

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

### Access Token

1. Go to [airtable.com/create/tokens](https://airtable.com/create/tokens) and create a Personal Access Token
2. Grant these scopes: `data.records:read`, `data.records:write`, `schema.bases:read`
3. Under **Access**, select your specific base ("Team Collaboration")
4. Copy the token (starts with `pat...`)
5. Your base ID is in the Airtable URL: `airtable.com/YOUR_BASE_ID/...`

### Required Tables

Your Airtable base must have these four tables:

**Operational Tasks** (Dan + all other team members)

| Field | Type |
|---|---|
| Task Name | Single line text |
| Description | Long text |
| Assignee | User (Collaborator) |
| Assigned By | User (Collaborator) |
| Status | Single select: To Do / In Progress / Blocked / Done |
| Priority | Single select: Urgent / High / Medium / Low |
| Project | Linked record to Projects |
| Category | Single select — see values below |
| Source | Single select: Slack message / Handwritten note / Email / Verbal |
| Source Detail | Single line text |
| Due Date | Date |
| Date Created | Formula (auto — do NOT write to this field) |
| Date Completed | Date |
| Notes | Long text |
| Raw Input | Long text |
| Bot Created | Checkbox |

Category values (must match exactly): Permits / Subcontractors / Materials / Client / Site / Finance / Admin / Draws / Proposals / Lots / Vendor Management

**Tech & Innovation Tasks** (Izzy only)

| Field | Type | Notes |
|---|---|---|
| Task Name | Single line text | |
| Task Description | Long text | Note: field name is "Task Description", not "Description" |
| Assignee | User (Collaborator) | |
| Assigned By | User (Collaborator) | |
| Status | Single select: To Do / In Progress / Blocked / Done | |
| Priority | Single select: Urgent / High / Medium / Low | |
| Project | Linked record to Tech Projects | |
| Source | Single select | |
| Source Detail | Single line text | |
| Due Date | Date | |
| Date Created | Formula (auto) | |
| Date Completed | Date | |
| Raw Input | Long text | |
| Bot Created | Checkbox | |
| Solution Description | Long text | How the task was resolved |

**Projects** (linked to Operational Tasks)

| Field | Type |
|---|---|
| Project | Single line text |
| Status | Single select: Open / Closed / Completed |
| Job Stage | Single select |
| Project Manager | Single select |

**Tech Projects** (linked to Tech & Innovation Tasks)

| Field | Type | Notes |
|---|---|---|
| Project Title | Single line text | Field name is "Project Title" not "Project" |
| Project description | Long text | |
| Status | Single select | |

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

**Personal oversight channels**: Create a channel named `#[firstname]-tasks` (e.g. `#dan-tasks`, `#izzy-tasks`) and invite TaskMate and Steve. The bot automatically detects the naming convention and routes digests and Steve's management commands there.

**DMs**: Click TaskMate's name in the sidebar and start messaging. Make sure the Messages Tab is enabled in the Slack App Home settings (see setup step 6 above).

---

## Command Reference

### Personal DM commands (message TaskMate directly)

| What you type | What happens |
|---|---|
| `show my tasks` / `what's my list` | Your open tasks, in your correct format (Izzy: by project, others: by category) |
| `what's urgent` | Your open tasks filtered by urgency |
| `show completed` / `what did I complete this week` | Tasks you completed this week |
| `mark [task] as done` | Status set to Done, Date Completed set to today |
| `set [task] to high priority` | Priority updated |
| `assign [task] to Dan` | Reassigns the task, DMs Dan |
| `add task: [description]` | Creates task in your correct table |
| `add note to [task]: [text]` | Appends note to an Operational task (Dan/others) |
| `add solution to [task]: [text]` | Appends solution to a Tech & Innovation task (Izzy) |
| Any task list or note | Tasks extracted and logged to your table automatically |

### Central channel commands (in `#oakley-operational-tasks`)

| What you type | What happens |
|---|---|
| `@TaskMate what's my list` | Your open tasks in correct format |
| `@TaskMate what's Dan working on` | Dan's open Operational tasks |
| `@TaskMate what's Izzy working on` | Izzy's open Tech & Innovation tasks |
| `@TaskMate show all open tasks` | All tasks from both tables, grouped by person |
| `@TaskMate show completed` | Your completed tasks this week |
| `@TaskMate mark [task] as done` | Mark a task complete |
| `@TaskMate set [task] to urgent` | Change priority |
| `@TaskMate assign [task] to Dan` | Reassign a task |
| `@TaskMate add note to [task]: [text]` | Add note to Operational task |
| `@TaskMate add solution to [task]: [text]` | Add solution to Tech task |
| `@TaskMate scan #channel-name` | Scan a channel for tasks |
| `@TaskMate help` | Show command reference |
| Post any message or photo | Tasks extracted and routed automatically |

### Steve's management commands (in personal task channels)

Steve's messages in `#[name]-tasks` channels are interpreted as management instructions:

| What Steve types | What happens |
|---|---|
| `set [task] to urgent` | Priority updated |
| `reassign [task] to Dan` | Task reassigned |
| `set deadline for [task] to Friday` | Due date set |
| `mark [task] as done` | Status set to Done |
| `what's on Izzy's list` | Shows Izzy's Tech tasks (by project) |

---

## Personal Channel Setup

1. Create a Slack channel named `#[firstname]-tasks` (e.g. `#dan-tasks`, `#izzy-tasks`)
2. Invite the team member, invite Steve, and invite `@TaskMate`
3. That's it — TaskMate automatically detects the naming pattern and routes that person's weekly digests and Steve's management commands to that channel

---

## Weekly Digest Schedule

| Digest | When | Where |
|---|---|---|
| Morning digest (personal DM) | Weekdays at 8:00 AM EST | Each person's DM with TaskMate |
| Monday overview | Monday at 8:00 AM EST | `#oakley-operational-tasks` + each `#[name]-tasks` channel |
| Friday summary | Friday at 5:00 PM EDT | `#oakley-operational-tasks` + each `#[name]-tasks` channel |

**Izzy's digests** show tasks grouped by Tech Project, then Priority within each project.

**Dan's (and others') digests** show tasks grouped by Category, then Priority within each category.

**Monday digest** shows all open tasks with headings per person.

**Friday digest** shows completed tasks this week (with checkmarks) and what remains open.

---

## Troubleshooting

### View function logs

In Netlify: **Site - Functions - click a function - Logs**

### Common issues

**Slack says "Your URL didn't respond with the value of the `challenge` parameter"**
- Make sure your Netlify site is deployed before setting the Request URL in Slack.

**Tasks are not appearing in Airtable**
- Check function logs for errors. Verify `AIRTABLE_API_KEY` has `data.records:write` scope and the correct base is selected. Make sure all field names in Airtable exactly match the schema above (including "Task Description" in Tech table, and "Project Title" in Tech Projects).

**Airtable 422 error about field values**
- Category values must match exactly (capitalisation matters): Permits, Subcontractors, Materials, Client, Site, Finance, Admin, Draws, Proposals, Lots, Vendor Management. Status values must be: To Do, In Progress, Blocked, Done.

**Izzy's tasks going to Operational Tasks instead of Tech & Innovation Tasks**
- Make sure Izzy's email in Airtable and Slack is exactly `elizabeth@oakleyhomebuilders.com`. The routing is based on exact email match.

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

**"add note" command returns wrong table error**
- Notes field only exists in Operational Tasks (Dan/others). Solution Description only exists in Tech & Innovation Tasks (Izzy). Use the correct command for the task's table.
