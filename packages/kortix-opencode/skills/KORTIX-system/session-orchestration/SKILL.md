---
name: kortix-session-orchestration
description: "Kortix background session orchestration reference: session_start_background, session_list_background, session_read, session_message, project scoping, aliases, and session-report flow."
---

# Kortix Session Orchestration

This skill documents the Kortix background-session layer that sits on top of OpenCode's regular session model.

## Primary Tools

| Tool | Scope model | Notes |
|---|---|---|
| `session_start_background` | Project-scoped for new sessions; session-scoped for resume | Preferred tool. Starts a new background child session or resumes an existing one via `session_id`. |
| `session_list_background` | Optional project scope | With `project`, lists background sessions for that project. Without `project`, lists background sessions across all Kortix-managed projects in the shared orchestration DB. |
| `session_read` | Session-scoped | Reads any readable session by `session_id`; not filtered by project. |
| `session_message` | Session-scoped | Sends a message into a running session by `session_id`; not filtered by project. |

## Compatibility Aliases

- `session_spawn` = alias for `session_start_background`
- `session_list_spawned` = alias for `session_list_background`

## Scoping Rules

1. For new background work, provide a `project` so the child session inherits project context and is recorded against the correct project.
2. For resume, provide `session_id`; `project` is not required because the existing delegation row already owns the project association.
3. Omitting `project` on `session_list_background` does not mean "default OpenCode project"; it means cross-project Kortix orchestration scope.
4. `session_read` and `session_message` use `session_id` as the scope key, even if the session originally came from a project-scoped spawn.

## Reporting Model

- Completion flows return a `<session-report>` back to the parent session.
- Background sessions are session-native, not task-native.
- The public mental model is `session`, `session_id`, and `session-report`.

## Recommended Usage

- Prefer `session_start_background` for substantial parallel work.
- Prefer passing `project` on new background work.
- Use `session_list_background` to inspect active work within a project, or across all projects only when that broader scope is intentional.
- Use `session_read` and `session_message` when you already have a concrete `session_id`.
