# EntryVibe — host agent skill

Use the **entry-vibe** MCP tools to turn a natural-language Entry request into a `.ent` file.

## Workflow (mandatory)

1. `get_build_guide({ request })`
2. `search_blocks({ query, scope: "core" })` — default **core**; `ai` / `hardware` only when needed
3. `get_block_schema({ types })`
4. `validate_project({ ir })` — follow `hints`
5. `compile_project({ ir, filename? })`

## Do not

- Invent param keys or statement slot names
- Search with `scope: "all"` unless the user asks for hardware/AI specifically
- Put `function_create` in object scripts (use `ir.functions` + `function_call`)
- Skip validation before compile

## Quick references

- Messages: `ir.messages` + `message_cast` / `when_message_cast` param `VALUE`
- Variables/lists: declare then use `VARIABLE` / `LIST` by name
- Functions: `ir.functions[].body` + `{ type: "function_call", params: { NAME } }`
