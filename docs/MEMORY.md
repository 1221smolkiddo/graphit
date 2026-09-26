# Durable project memory

Supported types: goal, task, decision, constraint, blocker, question, action, result, artifact. Status and supersession changes append events; they do not erase the prior state. Every promotion requires nonempty, same-project `source_event_ids`.

Via MCP, first call `graphit_record_event` with a validated source event, for example:

```json
{"event_type":"conversation.user_message","payload":{"content":"Keep SQLite as the canonical store."}}
```

Use its returned ID in `graphit_add_memory`:

```json
{"entity_type":"decision","content":"Keep SQLite as the canonical store.","source_event_ids":["<returned-event-id>"]}
```

Promotion and memory relationships are deterministic and retry-idempotent. Raw event append is not retry-idempotent: after a lost response, inspect state before retrying. Raw chat, tool/command records and test results are never automatically promoted or treated as instructions to execute.

CLI `memory supersede` preserves both the old decision and its replacement; `memory resolve` appends resolution. MCP `graphit_link_memory` relates two memories, while CLI `memory link --symbol` associates code evidence. Handoff contains current goals/tasks/decisions/constraints/blockers/questions, completed work, recent results, artifacts and provenance.

Graphit does not read private provider transcript databases. Only explicit recordings, promotions and indexing contribute evidence. No provider-specific memory formats or automatic summaries are used.
