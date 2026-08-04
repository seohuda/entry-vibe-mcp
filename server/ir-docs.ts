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
  "variables": [{ "name": string, "initialValue": string|number }],  // optional
  "lists": [{ "name": string, "initialValues": (string|number)[] }]  // optional
}

Thread = IRBlock[]  // MUST start with a hat/event block (isHat: true), e.g. when_run_button_click

IRBlock = {
  "type": string,                          // catalog block type
  "params": { [key: string]: string|number|boolean|IRBlock },  // named keys from schema
  "statements": { [slotName: string]: Thread }  // e.g. "DO", "STACK_IF", "STACK_ELSE"
}

Variables: declare them in "variables", then reference them from a block's
"VARIABLE" param by NAME — the compiler rewrites the name to the internal
variable id. Referencing an undeclared name is a validation error.

  "variables": [{ "name": "점수", "initialValue": 0 }],
  ...
  { "type": "set_variable", "params": { "VARIABLE": "점수", "VALUE": 0 } }

Lists work the same way: declare them in "lists", then reference them from a
block's "LIST" param by NAME — the compiler rewrites the name to the internal
list id. Referencing an undeclared name is a validation error.

  "lists": [{ "name": "점수판", "initialValues": [10, 20] }],
  ...
  { "type": "add_value_to_list", "params": { "VALUE": 30, "LIST": "점수판" } }

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
