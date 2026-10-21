# EntryVibe — host agent skill

**Full contract:** read [AGENT-GUIDE.md](AGENT-GUIDE.md) first (anti-patterns, retry loop, IR rules).

Use the **entry-vibe** MCP tools to turn a natural-language Entry request into a `.ent` file.

## Workflow (mandatory)

1. `get_build_guide({ request })` — includes `agentContract` with never-do rules
   `search_objects({ query })` → `get_object_info({ objectId })` — 요청한 캐릭터·배경을 실제 메타데이터로 선택합니다. `local` 원본 자산과 설정된 `user` 자산을 지원하며 공식 온라인 `entry` 카탈로그는 미지원입니다.
2. `search_blocks({ query, scope: "core" })` — default **core**; `ai` / `hardware` only when needed
3. `get_block_schema({ types })`
4. `validate_project({ ir })` — follow `hints`
5. `verify_project({ ir })` — smoke + pack roundtrip + hints
6. `compile_project({ ir, filename? })`

For an existing `.ent` from another tool: `audit_ent({ filename })` first.

## Do not

- Hand-write `project.json` or zip your own `.ent` (causes `undefined` title, broken media)
- Invent param keys or statement slot names
- Search with `scope: "all"` unless the user asks for hardware/AI specifically
- Put `function_create` in object scripts (use `ir.functions` + `function_call`)
- Skip validation before compile
- Invent library IDs or replace a requested character with Entrybot without searching
- Retry `compile_project` with the same IR after failure — fix using `hints` first

## Quick references

- Messages: `ir.messages` + `message_cast` / `when_message_cast` param `VALUE`
- Variables/lists: declare then use `VARIABLE` / `LIST` by name
- Functions: `ir.functions[].body` + `{ type: "function_call", params: { NAME } }`
- Text boxes (`kind: "text"`) may have zero blocks — select a sprite to see scripts
- Heavy logic in `ir.functions` appears under Entry's **함수** tab, not the main block workspace
