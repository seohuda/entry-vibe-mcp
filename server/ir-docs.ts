/**
 * Shared IR schema documentation embedded in MCP tool descriptions.
 * This is the mandatory host-agent contract for unattended Entry builds.
 */
export const IR_SCHEMA_DOC = `
MANDATORY WORKFLOW (do not skip; do not invent IR from memory):
1) get_build_guide({ request }) — recipe + IR sketch + recommended blocks
2) search_blocks({ query, scope: "core" }) — default scope is core (not hardware)
3) get_block_schema({ types }) — use exact param keys / statementKeys
4) validate_project({ ir }) — fix using errors[].hints, then re-validate
5) compile_project({ ir, filename? }) — writes .ent + .json in host cwd

scope values: "core" (default) | "ai" | "hardware" | "all"
Only use scope="hardware" when the user names a board/device.
Only use scope="ai" for TTS/번역/비디오 등 AI 활용 요청.

EntryIR JSON schema:

{
  "objects": [{
    "name": string,
    "sprite": "entrybot",
    "x"?: number, "y"?: number,
    "pictures": [{ "name"?: string, "path": "assets/...." }],
    "sounds": [{ "name"?: string, "path": "assets/....mp3", "duration"?: number }],
    "scripts": [ Thread, ... ]
  }],
  "variables": [{ "name": string, "initialValue": string|number }],
  "lists": [{ "name": string, "initialValues": (string|number)[] }],
  "messages": [{ "name": string }],
  "functions": [{
    "name": string,
    "type": "statement"|"string"|"boolean",
    "body": IRBlock[],           // no event hat
    "returnValue"?: string|number|boolean|IRBlock  // required for string/boolean
  }]
}

Thread = IRBlock[]  // MUST start with an event hat (skeleton basic_event), e.g. when_run_button_click

IRBlock = {
  "type": string,
  "params": { [key: string]: string|number|boolean|IRBlock },
  "statements": { [slotName: string]: Thread }
}

Special blocks:
- Messages: declare in messages[], pass name via params.VALUE on message_cast / when_message_cast / message_cast_wait
- Functions: declare in functions[]; call with { "type": "function_call", "params": { "NAME": "<name>" } }
  Never put function_create in object scripts.

Custom media: write files into host assets/, then reference from pictures (png/svg) / sounds (mp3).
Paths must stay under assets/ (no ..).

Variables / lists: declare then reference by NAME in VARIABLE / LIST params.

Example — bounce:
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
`.trim();
