---
name: scheduler
description: Periodic check routine — review channels, pending tasks, and reminders, then notify the user.
metadata: { "openclaw": { "emoji": "🕐" } }
---

# Scheduler - Periodic Check Routine

When triggered by the cron scheduler, perform these checks in order:

## 1. Unread Messages

Check messaging channels (Telegram, WhatsApp) for unread or unhandled messages.
Summarize any that need the user's attention.

## 2. Pending Tasks

Review any open tasks or action items. Flag overdue items.

## 3. Reminders

Check for upcoming deadlines, meetings, or follow-ups within the next few hours.

## 4. Contact Follow-ups

Check contacts with stale `last_contact` dates that might need a follow-up.

## 5. Notify

If there's anything worth reporting, send a summary to the user via the dashboard.
Use `sessions_send` to push the update to the user's operator session.

Format the summary as:

```
📋 Periodic Update

**Messages**: [count] unread across [channels]
**Tasks**: [count] pending, [count] overdue
**Reminders**: [list upcoming]
**Follow-ups**: [contacts that need attention]
```

If nothing needs attention, do not send a notification.
