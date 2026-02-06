---
name: contacts
description: Manage the contact book — lookup, create, and update contact profiles stored in memory.
metadata: { "openclaw": { "emoji": "📇" } }
---

# Contact Management

Contacts are stored as markdown files in `memory/contacts/{name}.md` with YAML frontmatter.

## Contact File Format

Each contact file uses this structure:

```markdown
---
name: John Doe
telegram: "@johndoe"
whatsapp: "+491234567890"
relationship: colleague
last_contact: 2026-02-01
tags: [work, engineering]
---

# John Doe

## Context

Works at Acme Corp as a backend engineer. Met at conference in 2025.

## Notes

- Prefers async communication
- Available mornings CET
- Working on microservices migration
```

## Operations

### Lookup a Contact

Use `memory_search` to find contacts by name, platform handle, or relationship:

```bash
# Search is handled by the built-in memory_search tool
# Contacts in memory/contacts/ are auto-indexed
```

### Create a New Contact

Write a new file to `memory/contacts/{name-slug}.md` with the frontmatter format above.
Use lowercase kebab-case for filenames (e.g., `john-doe.md`).

### Update a Contact

Read the existing file, update the relevant fields, and write it back.
Always update `last_contact` after a meaningful interaction.

### After Conversations

After handling a conversation involving a contact:

1. Update `last_contact` date
2. Add relevant notes under `## Notes`
3. Update any changed platform handles or context
