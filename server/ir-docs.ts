/**
 * Shared IR schema documentation embedded in MCP tool descriptions.
 * This is the "prompt" that guides the host LLM.
 */
export const IR_SCHEMA_DOC = `
EntryIR JSON schema (use named param keys and statementKeys from the catalog):

{
  "objects": [{
    "name": string,
    "sprite": "entrybot",   // v1 only supports entrybot
    "scripts": [ Thread, ... ]
  }],
  "variables": [{ "name": string, "initialValue": string|number }]  // optional
}

Thread = IRBlock[]  // MUST start with a hat/event block (isHat: true), e.g. when_run_button_click

IRBlock = {
  "type": string,                          // catalog block type
  "params": { [key: string]: string|number|boolean|IRBlock },  // named keys from schema
  "statements": { [slotName: string]: Thread }  // e.g. "DO", "STACK_IF", "STACK_ELSE"
}

Example — cat that moves and bounces:
{
  "objects": [{
    "name": "고양이",
    "sprite": "entrybot",
    "scripts": [[
      { "type": "when_run_button_click" },
      { "type": "repeat_basic", "params": { "VALUE": 4 },
        "statements": { "DO": [
          { "type": "move_direction", "params": { "VALUE": 10 } },
          { "type": "bounce_wall" }
        ]}}
    ]]
  }]
}

Workflow: list_categories → search_blocks → get_block_schema → validate_project → compile_project.
If validate_project or compile_project returns errors, fix the IR and retry.
`.trim();
