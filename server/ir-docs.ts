/**
 * Shared IR schema documentation embedded in MCP tool descriptions.
 * This is the "prompt" that guides the host LLM.
 */
export const IR_SCHEMA_DOC = `
EntryIR JSON schema (use named param keys and statementKeys from the catalog):

{
  "objects": [{
    "name": string,
    "sprite": "entrybot",
    "pictures": [{ "name"?: string, "path": "assets/...." }],  // optional png/svg costumes
    "sounds": [{ "name"?: string, "path": "assets/....mp3", "duration"?: number }],  // optional
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

Custom media: write files into the host project's assets/ folder, then
reference them from objects[].pictures (png/svg) and/or objects[].sounds (mp3).

  // 1) save e.g. assets/cat.png and assets/meow.mp3
  // 2) compile with:
  "objects": [{
    "name": "고양이",
    "sprite": "entrybot",
    "pictures": [{ "name": "고양이", "path": "assets/cat.png" }],
    "sounds": [{ "name": "야옹", "path": "assets/meow.mp3", "duration": 1.2 }],
    "scripts": [ ... ]
  }]

Omit pictures/sounds to keep the built-in Entrybot costumes and bark.
Paths must stay under assets/ (no ..). jpg/webp/wav/ogg are not supported.

AI utilize / expansion / hardwareLite: using those catalog blocks automatically
fills project.aiUtilizeBlocks / expansionBlocks / hardwareLiteBlocks on compile.
Classic hardware blocks set externalModules. AI learning blocks are in the
catalog but need a trained model (project.learning) which this compiler does
not generate yet — they validate/compile into scripts only.

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

Example — cat that moves and bounces (built-in entrybot look):
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
