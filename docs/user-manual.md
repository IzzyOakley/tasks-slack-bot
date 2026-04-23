# TaskMate User Manual

Welcome to TaskMate. This bot lives in Slack and automatically logs tasks to Airtable so nothing falls through the cracks. You don't need to open Airtable or fill in any forms - just post in Slack like you normally would.

---

## How TaskMate Works

TaskMate operates across three places in Slack:

**Your personal DM with TaskMate**
A private conversation just between you and the bot. You get a morning digest here every weekday and can manage your own tasks conversationally.

**The central channel (#oakley-operational-tasks)**
Where the whole team can post. Anyone can log tasks for anyone else here. Monday and Friday digests for the whole team are posted here.

**Your personal task channel (#dan-tasks, #izzy-tasks, etc.)**
A private channel with just you, Steve, and TaskMate. Weekly digests land here in your personal format. Steve uses this channel to manage your priorities.

---

## Task Routing - Where Tasks Go

TaskMate automatically routes every task to the right Airtable table:

- **Izzy's tasks** go to the **Tech & Innovation Tasks** table, grouped by project in digests
- **Dan's tasks and everyone else's tasks** go to the **Operational Tasks** table, grouped by category in digests

You don't need to think about this - just post normally and the bot handles it.

**Every task also records who assigned it.** If Izzy posts a task for Dan, Airtable shows Assigned By = Izzy, Assignee = Dan.

---

## Getting Started

Anyone on the team can invite TaskMate to a channel by typing `/invite @TaskMate`.

For your personal DM: click TaskMate's name in the Slack sidebar and start messaging. The first time you do this, you may need to look for TaskMate under Apps in the sidebar.

---

## Logging Tasks

### Method 1 - Just post a message

Type your tasks into any channel TaskMate is in. No special format needed. The bot reads your message, figures out what the tasks are, and logs them to Airtable automatically.

**Examples:**

> Need to call the framing sub about 14 Oak St, ASAP. Also order the window hardware this week.

> Follow up with county on Henderson permits. Jake needs the invoice reviewed by Friday.

> ASAP - materials delivery for Lot 7 is delayed, need to find alternate supplier

TaskMate will reply in the thread confirming what it logged. Each task becomes a separate record in Airtable. If a message contains tasks for multiple people, TaskMate logs each task for the right person automatically.

**Example reply:**
> ✅ Logged for Dan (Operational): "Call framing sub", "Order window hardware" | Logged for Izzy (Tech): "Fix MargO security integration"

---

### Method 2 - Photo of handwritten notes

Take a photo of any handwritten notes - a site notepad, whiteboard, sticky note - and upload it directly to Slack. TaskMate will read the handwriting and log every task it finds.

**How to upload:**
- On phone: tap the paperclip icon, then choose photo
- On desktop: drag and drop the image into the message box, or click the + icon

The bot replies confirming the tasks it found. Always check the thread reply.

---

### Method 3 - DM TaskMate directly

In your personal DM with TaskMate, just type your tasks naturally. They'll be logged to your correct table automatically.

---

## Commands - In Channels

Mention the bot with `@TaskMate` followed by your request. You can use natural language.

---

### View tasks

```
@TaskMate what's my list
@TaskMate show my tasks
```
Shows your open tasks in your format (Izzy: by project, others: by category and priority).

```
@TaskMate what's Dan working on
@TaskMate show Izzy's tasks
```
Shows someone else's open tasks.

```
@TaskMate show all open tasks
```
Shows every open task across the whole team, grouped by person.

---

### Mark a task done

```
@TaskMate mark "call framing sub" as done
@TaskMate mark the Henderson permits task as done
```
You don't need the exact task name - just enough for the bot to identify it.

---

### Change priority

```
@TaskMate set "order window hardware" to urgent
@TaskMate set the materials delivery task to high priority
```
Priority options: **Urgent**, **High**, **Medium**, **Low**

---

### Reassign a task

```
@TaskMate assign "call framing sub" to Dan
@TaskMate assign the MargO security task to Izzy
```

---

### Add a task manually

```
@TaskMate add task: review invoice from Jake's Plumbing
@TaskMate add task: send updated proposal to Henderson client by Friday
```

---

### Add a note to a task (Dan and others)

```
@TaskMate add note to "call framing sub": ask about Thursday availability
```
Adds a note to an Operational task. This is for extra context or follow-up reminders.

---

### Add a solution to a task (Izzy)

```
@TaskMate add solution to "fix MargO security": updated the API token and rotated credentials
```
Adds a solution description to a Tech & Innovation task. Useful for documenting how something was resolved.

---

### See what you completed this week

```
@TaskMate show completed
@TaskMate what did I complete this week
```

---

### Scan a channel for tasks

```
@TaskMate scan #permits-channel
@TaskMate scan this channel
@TaskMate scan my recent messages
```
Goes back through the last 100 messages and logs any tasks it finds. Useful for catching things that were discussed but never formally captured.

---

### Get help

```
@TaskMate help
```

---

## Commands - In Your Personal DM

In your DM with TaskMate, all the same commands work - just without the `@TaskMate` part.

```
show my tasks
what's urgent
mark "call framing sub" as done
set "order window hardware" to high priority
add task: review invoice from Jake's Plumbing
add note to "call framing sub": ask about Thursday
show completed
```

Your DM only shows your own tasks. No one else's tasks are visible to you here.

---

## Steve's Management Commands (Personal Task Channels)

Steve can manage task priorities and deadlines from each person's personal task channel (`#dan-tasks`, `#izzy-tasks`, etc.).

Steve's messages in those channels are interpreted as management instructions:

```
set the Henderson permit task to urgent
set deadline for "call framing sub" to Friday
mark the materials delivery task as done
reassign the invoice review to Dan
what's on Dan's list
```

TaskMate confirms each change. Steve's updates appear in the next weekly digest.

---

## Digests

**Every weekday morning at 8:00 AM** - TaskMate sends you a personal DM with all your open tasks, in your format.

**Every Monday at 8:00 AM** - A full team overview is posted to `#oakley-operational-tasks` and to each person's `#[name]-tasks` channel.

**Every Friday at 5:00 PM** - A summary of what was completed that week and what's still open is posted to `#oakley-operational-tasks` and each `#[name]-tasks` channel.

**Izzy's digests** show tasks grouped by Tech Project, then priority within each project.

**Dan's (and everyone else's) digests** show tasks grouped by Category (Permits, Subcontractors, Materials, etc.), then priority within each category.

---

## Tips

**Be specific about who the task is for.**
If you post "follow up with the framing sub" without saying who, the bot assigns it to you. If it's for Dan, say so: "Dan needs to follow up with the framing sub."

**Urgency words matter.**
"ASAP", "today", "urgent", "critical" - these tell the bot to set the task to **Urgent** priority.
"This week", "soon", "follow up" - these set it to **High**.

**Project names are matched automatically.**
For Izzy's tasks, the bot uses the task context to figure out which Tech Project it belongs to - even if you don't use the exact project name. "Bid automation" will match "Bid Automated Reminders". For Dan's tasks, mention the job address or project name explicitly (e.g. "Henderson build", "14 Oak St").

**Each task becomes its own Airtable record.**
If you post a message with five action items, the bot logs five separate records.

**You can always edit in Airtable.**
If a task needs a different project link, category, or any other field updated, open Airtable directly. The bot logs everything but doesn't lock anything.

---

## What TaskMate Can't Do

- **It cannot be added to a private 1:1 DM between two people.** This is a Slack limitation. Use a group DM that includes TaskMate, or post in a channel.
- **It won't create new projects in Airtable.** It can link tasks to existing projects but won't add new ones. If a task doesn't link to a project, set it manually in Airtable.
- **It won't catch tasks in channels it hasn't been invited to.** Type `/invite @TaskMate` in any channel to add it.
- **Steve is never assigned tasks.** If a message is posted by Steve without a clear assignee, the bot will ask him to specify who it's for.

---

## Something Went Wrong?

If the bot replies with: *Something went wrong. Please try again or log it manually in Airtable.*

Try posting again, or log the task directly in Airtable. Let Izzy know so she can check the logs.

---

## Quick Reference

| What you want to do | What to type |
|---|---|
| Log tasks from a message | Just post it - bot picks it up automatically |
| Log tasks from a photo | Upload the photo to Slack |
| Log a task in your DM | Just type it to TaskMate |
| See your open tasks | `@TaskMate what's my list` |
| See someone's tasks | `@TaskMate what's Dan working on` |
| See all team tasks | `@TaskMate show all open tasks` |
| Mark something done | `@TaskMate mark [task] as done` |
| Change priority | `@TaskMate set [task] to urgent` |
| Reassign a task | `@TaskMate assign [task] to Dan` |
| Add a task manually | `@TaskMate add task: [description]` |
| Add a note (Operational) | `@TaskMate add note to [task]: [text]` |
| Add a solution (Tech) | `@TaskMate add solution to [task]: [text]` |
| See completed this week | `@TaskMate show completed` |
| Scan a channel | `@TaskMate scan #channel-name` |
| Get help | `@TaskMate help` |
