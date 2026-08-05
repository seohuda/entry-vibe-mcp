/**
 * Shared IR schema documentation embedded in MCP tool descriptions.
 * This is the mandatory host-agent contract for unattended Entry builds.
 */
export const IR_SCHEMA_DOC = `
MANDATORY WORKFLOW (do not skip; do not invent IR from memory):
Full agent guide: AGENT-GUIDE.md in the repo root (never-do list, retry loop, troubleshooting).

1) get_build_guide({ request }) — recipe + IR sketch + agentContract
2) search_blocks({ query, scope: "core" }) — default scope is core (not hardware)
3) get_block_schema({ types }) — use exact param keys / statementKeys
4) validate_project({ ir }) — fix using errors[].hints, then re-validate
5) verify_project({ ir }) — smoke + roundtrip + simulation (recommended)
6) compile_project({ ir, filename? }) — writes .ent + .json in host cwd

Edit existing .ent:
import_ent → patch_script / patch_object / add_object / remove_object → verify_project → compile

Incremental edits: add_scene, remove_scene, set_learning (AI learning model metadata)

Simulation: simulate_project returns predicted x/y/variables after core blocks run.

scope values: "core" (default) | "ai" | "hardware" | "all"
Only use scope="hardware" when the user names a board/device.
Only use scope="ai" for TTS/번역/비디오 등 AI 활용 요청.

EntryIR JSON schema:

{
  "scenes": [{ "name": string, "background"?: { "name"?: string, "path": "assets/...." } }],
  "objects": [{
    "name": string,
    "kind"?: "sprite"|"text",
    "sprite"?: "entrybot"|"custom",
    "text"?: string,
    "x"?: number, "y"?: number,
    "scene"?: string,
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
    "body": IRBlock[],
    "returnValue"?: string|number|boolean|IRBlock
  }],
  "learning"?: {
    "type": "image"|"speech"|"text"|"number"|"regression"|"logisticRegression"|"cluster"|"decisiontree"|"svm",
    "labels": string[],
    "modelPath"?: "assets/learning/model.json"
  },
  "speed"?: number
}

Thread = IRBlock[]  // sprite objects MUST start with an event hat (basic_event)

IRBlock = {
  "type": string,
  "params": { [key: string]: string|number|boolean|IRBlock },
  "statements": { [slotName: string]: Thread }
}

Special blocks:
- Messages: declare in messages[], pass name via params.VALUE on message_cast / when_message_cast
- Functions: declare in functions[]; call with { "type": "function_call", "params": { "NAME": "<name>" } }
- Text boxes: kind "text", text required, scripts optional
- Custom sprites: sprite "custom" + pictures[] under assets/
- Scene backgrounds: scenes[].background (locked sprite, not listed in objects[])

Custom media: write files into host assets/, then reference from pictures / sounds / backgrounds.
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
