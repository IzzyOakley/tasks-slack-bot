# Oakley Home Builders — Claude Task Bot

A Claude-powered Slack bot that extracts tasks from messages and photos and logs them automatically to Airtable. Built for Netlify serverless deployment.

---

## Overview

Post a message or photo to any channel the bot is in and it will:
- Extract every actionable task using Claude AI
- Log each task as a separate record in the **Operational Tasks** Airtable table
- Reply in thread confirming what was logged

You can also mention the bot directly to view tasks, mark things done, change priorities, scan channels for tasks, and more.

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

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App → From scratch**
2. Name it (e.g. "Oakley Task Bot") and select your workspace
3. Under **OAuth & Permissions → Bot Token Scopes**, add all of the following scopes:

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
users:read
users:read.email
```

4. Click **Install to Workspace** and copy the **Bot User OAuth Token** (starts with `xoxb-`)
5. Under **Basic Information**, copy the **Signing Secret**
6. Under **Event Subscriptions**, toggle **Enable Events** ON
   - Set the **Request URL** to: `https://YOUR-NETLIFY-URL/.netlify/functions/slack-events`
   - Wait for Netlify to be deployed first, then paste the URL — Slack will verify it
7. Under **Subscribe to bot events**, add:
   ```
   message.channels
   message.groups
   message.im
   message.mpim
   app_mention
   ```
8. Click **Save Changes** and reinstall the app if prompted

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

Your Airtable base must have:
- A table named **"Operational Tasks"** with the fields described in the schema (see project documentation)
- A table named **"Projects"** with at least a **Project** (single line text) field

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
| `DIGEST_CHANNEL_ID` | Slack channel ID for the morning digest (C0XXXXXXXX) |
| `NETLIFY_SITE_URL` | Full deployed URL, e.g. `https://your-site.netlify.app` |

**To find a Slack channel ID**: Right-click the channel → Copy link → the ID is the last path segment (e.g. `C0XXXXXXXX`).

---

## Netlify Deployment

1. Push this repo to GitHub
2. Log in to [app.netlify.com](https://app.netlify.com) → **Add new site → Import an existing project**
3. Connect your GitHub repo
4. Under **Site configuration → Environment variables**, add all variables from `.env`
5. Deploy — Netlify will auto-detect `netlify.toml`

After deploy, copy your Netlify site URL and:
- Set `NETLIFY_SITE_URL` in Netlify environment variables
- Paste `https://YOUR-NETLIFY-URL/.netlify/functions/slack-events` into Slack's Event Subscriptions Request URL

---

## Local Development

```bash
npm install
cp .env.example .env
# fill in .env values
netlify dev
```

Netlify Dev runs your functions locally. Use [ngrok](https://ngrok.com) to expose a public URL for Slack webhook testing:

```bash
ngrok http 8888
# Then set your Slack Event Subscriptions URL to: https://xxxx.ngrok.io/.netlify/functions/slack-events
```

---

## Inviting the Bot to Channels

1. In Slack, open any channel
2. Type `/invite @OakleyTaskBot` (use your bot's name)
3. The bot will now monitor and respond to messages in that channel

**Group DMs**: You can add the bot to a group DM (3+ people) the same way.

**1:1 DMs**: Slack does not allow bots to be added to private 1:1 DMs between two humans. To log tasks from a 1:1 conversation, either:
- Forward the messages to `#task-inbox`
- Start a group DM that includes the bot

---

## Using the Bot

### Automatic task extraction

Just post a message in any channel the bot is in — it will extract tasks automatically.

| Action | What happens |
|---|---|
| Post a text message | Claude extracts tasks, logs to Airtable, replies in thread |
| Upload a photo of handwritten notes | Claude reads the image, extracts tasks, logs to Airtable |

### Mention commands

| Command | Action |
|---|---|
| `@bot what's my list` | Show your open tasks, sorted by priority |
| `@bot show my tasks` | Same as above |
| `@bot what's Dan working on` | Show Dan's open tasks |
| `@bot show all open tasks` | All open tasks, grouped by assignee |
| `@bot mark [task] as done` | Mark a task complete (set Status = Done) |
| `@bot set [task] to high priority` | Change task priority |
| `@bot assign [task] to Dan` | Reassign a task |
| `@bot add task: [description]` | Create a task immediately |
| `@bot scan #channel-name` | Scan last 100 messages in a channel for tasks |
| `@bot scan this channel` | Scan the current channel |
| `@bot scan my recent messages` | Scan your recent messages in this channel |
| `@bot help` | Show this command reference |

---

## Morning Digest

The bot posts a daily task digest every weekday at **8:00 AM EST / 9:00 AM EDT** to the channel set in `DIGEST_CHANNEL_ID`.

The digest shows all open tasks grouped by assignee and sorted by priority (Urgent → High → Medium → Low).

**To change the channel**: Update the `DIGEST_CHANNEL_ID` environment variable in Netlify and redeploy.

---

## Troubleshooting

### View function logs

In Netlify: **Site → Functions → click a function → Logs**

Or use the Netlify CLI:
```bash
netlify functions:log process-task-background
netlify functions:log slack-events
```

### Common issues

**Slack says "Your URL didn't respond with the value of the `challenge` parameter"**
→ Make sure your Netlify site is deployed and `slack-events.js` is live before setting the Request URL in Slack.

**Tasks are not appearing in Airtable**
→ Check function logs for errors. Verify your `AIRTABLE_API_KEY` has `data.records:write` scope and the correct base is selected. Make sure the field names in Airtable exactly match the schema.

**Bot responds with "⚠️ Something went wrong"**
→ Check the `process-task-background` function logs for the specific error.

**Image processing not working**
→ Ensure the bot has `files:read` scope and was reinstalled after adding it. Check that image files are jpg, jpeg, png, heic, or webp.

**Morning digest not posting**
→ Verify `DIGEST_CHANNEL_ID` is set. Make sure the bot has been invited to that channel. Check `morning-digest` function logs.

**"Bot cannot be added to 1:1 DMs" error**
→ This is a Slack platform limitation. Use `#task-inbox` or a group DM instead.
