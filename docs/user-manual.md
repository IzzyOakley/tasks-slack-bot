# TaskMate User Manual

Welcome to TaskMate. This bot lives in Slack and automatically logs tasks to Airtable so nothing falls through the cracks. You don't need to open Airtable or fill in any forms. Just post in Slack like you normally would.

---

## Getting Started

TaskMate works in any Slack channel or group DM it has been invited to. Anyone on the team can invite it by typing `/invite @TaskMate` in any channel or group DM.

You'll know it's working when you post a message and it replies in the thread like this:

> ✅ Logged 2 tasks: "Call framing sub re: 14 Oak St", "Order window hardware"

---

## Logging Tasks

### Method 1 - Just post a message

Type your tasks or notes into any channel TaskMate is in. You don't need any special format. The bot reads your message, figures out what the tasks are, and logs them automatically.

**Examples of things you can post:**

> Need to call the framing sub about 14 Oak St, ASAP. Also order the window hardware this week.

> Follow up with county on Henderson permits. Jake needs the invoice reviewed by Friday.

> ASAP - materials delivery for Lot 7 is delayed, need to find alternate supplier

The bot will reply in thread confirming what it logged. Each task becomes a separate record in Airtable.

---

### Method 2 - Photo of handwritten notes

Take a photo of any handwritten notes - a site notepad, whiteboard, sticky note - and upload it directly to Slack. TaskMate will read the handwriting and log every task it finds.

**How to upload:**
- On phone: tap the paperclip/attachment icon, then choose photo
- On desktop: drag and drop the image into the message box, or click the + icon

The bot will reply confirming the tasks it found. If the handwriting is unclear, it will do its best. Always double-check the thread reply.

---

## Talking to TaskMate

Mention the bot with `@TaskMate` followed by your request. You can use natural language - you don't need to memorize exact commands.

---

### View your tasks

```
@TaskMate what's my list
@TaskMate show my tasks
```

The bot will reply with all your open tasks, grouped by priority (Urgent first).

---

### View someone else's tasks

```
@TaskMate what's Dan working on
@TaskMate show Izzy's tasks
```

---

### View all open tasks

```
@TaskMate show all open tasks
```

Shows every open task across the whole team, grouped by person.

---

### Mark a task as done

```
@TaskMate mark "call framing sub" as done
@TaskMate mark the Henderson permits task as done
```

You don't need to type the exact task name - just enough for the bot to identify it.

---

### Change a task's priority

```
@TaskMate set "order window hardware" to urgent
@TaskMate set the materials delivery task to high priority
```

Priority options: **Urgent**, **High**, **Medium**, **Low**

---

### Reassign a task

```
@TaskMate assign "call framing sub" to Dan
@TaskMate assign the Henderson proposal to Izzy
```

---

### Add a single task directly

```
@TaskMate add task: review invoice from Jake's Plumbing
@TaskMate add task: send updated proposal to Henderson client by Friday
```

---

### Scan a channel for tasks

Use this when you want to go back through a channel and log anything that was discussed but never formally captured.

```
@TaskMate scan #permits-channel
@TaskMate scan this channel
@TaskMate scan my recent messages
```

The bot will read the last 100 messages and log any tasks it finds.

---

### Get help

```
@TaskMate help
```

Posts the full command list in Slack.

---

## Morning Digest

Every weekday at **8:00 AM**, TaskMate posts a task digest to the team channel. It shows all open tasks for everyone on the team, grouped by person and sorted by priority - Urgent tasks first.

This is a good way to start your morning knowing exactly what's on your plate and what the rest of the team is working on.

---

## Tips

**The bot works best when you're specific.**
Instead of: *"follow up with the sub"*
Try: *"Follow up with framing sub re: 14 Oak St delivery schedule"*

**Urgency words matter.**
Words like "ASAP", "today", "urgent", "critical" tell the bot to set the task to Urgent priority. Words like "this week" or "soon" set it to High.

**Project names are matched automatically.**
If you mention a job address or project name the bot recognizes (e.g. "Henderson build", "Lot 7"), it will link the task to that project in Airtable automatically.

**Each task becomes its own Airtable record.**
If you post a message with five different action items, the bot logs five separate records - one per task.

**You can always check Airtable directly.**
The bot logs everything to the **Operational Tasks** table in the **Team Collaboration** base. If you need to edit a task, add details, or change the project link, open it directly in Airtable.

---

## What TaskMate Can't Do

- **It cannot be added to a private 1:1 DM between two people.** This is a Slack limitation. If you need to log tasks from a conversation with someone, forward the messages to `#task-inbox` or start a group DM that includes TaskMate.
- **It won't create new projects in Airtable.** It can link tasks to existing projects but won't add new ones. If a task doesn't link to a project automatically, you can set it manually in Airtable.
- **It won't catch tasks in channels it hasn't been invited to.** Anyone on the team can invite it by typing `/invite @TaskMate` in any channel or group DM.

---

## Something went wrong?

If the bot replies with: *Something went wrong logging that task. Please try again or log it manually in Airtable.*

Either try posting again, or log the task directly in the **Operational Tasks** table in Airtable. Let Izzy know so she can check the logs and fix any issues.

---

## Quick Reference Card

| What you want to do | What to type |
|---|---|
| Log tasks from a message | Just post it - bot picks it up automatically |
| Log tasks from a photo | Upload the photo to Slack |
| See your open tasks | `@TaskMate what's my list` |
| See someone's tasks | `@TaskMate what's Dan working on` |
| See all team tasks | `@TaskMate show all open tasks` |
| Mark something done | `@TaskMate mark [task] as done` |
| Change priority | `@TaskMate set [task] to urgent` |
| Reassign a task | `@TaskMate assign [task] to Dan` |
| Add a task manually | `@TaskMate add task: [description]` |
| Scan a channel | `@TaskMate scan #channel-name` |
| Get help | `@TaskMate help` |
