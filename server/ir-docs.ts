/**
 * Shared IR schema documentation embedded in MCP tool descriptions.
 * This is the mandatory host-agent contract for unattended Entry builds.
 */
export const IR_SCHEMA_DOC = `
MANDATORY WORKFLOW (do not skip; do not invent IR from memory):
Full agent guide: AGENT-GUIDE.md in the repo root (never-do list, retry loop, troubleshooting).

1) get_build_guide({ request }) — recipe + IR sketch + agentContract
2) search_objects({ query }) → get_object_info({ objectId }) — 요청한 캐릭터·배경의 실제 공급원과 모양/소리 확인
3) add_library_object({ ir, objectId }) 또는 sprite:"library" 참조로 IR 구성
4) search_blocks({ query, scope: "core" }) → get_block_schema({ types }) — 정확한 param keys / statementKeys 사용
5) validate_project({ ir }) — errors와 hints를 적용하고 재검증
6) verify_project({ ir }) — smoke + .ent 왕복 + 제한된 시뮬레이션
7) compile_project({ ir, filename? }) — 호스트 cwd에 .ent + .json 생성

객체 공급원: local은 MIT 라이선스의 별도 제작 오프라인 자산입니다. 설정된 user 공급원도 지원합니다.
공식 Entry 온라인 객체 라이브러리는 현재 미지원입니다. local 객체를 공식 Entry 객체라고 소개하지 마세요.
자동차·고양이·로켓 등을 요청하면 먼저 검색하고 실제 메타데이터로 선택하세요. ID를 추측하지 마세요.
검색/가져오기 실패 시 이유를 설명하고 지원되는 로컬 자산을 제안하세요. Entrybot으로 조용히 대체하면 안 됩니다.

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
    "sprite"?: "entrybot"|"custom"|"library",
    "library"?: { "source": string, "objectId": string },
    "text"?: string,
    "x"?: number, "y"?: number,
    "scene"?: string,
    "background"?: boolean,
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
  "speed"?: number,
  "assetAttributions"?: [{ "id": string, "source": string, "name": string,
    "license": { "spdx": string, "attribution": string, "url"?: string, "text"?: string } }]
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
- 라이브러리: sprite "library" + library:{source,objectId}; 검색 결과의 정확한 값을 사용하고 pictures/sounds와 혼합하지 않습니다.
- 라이브러리의 모든 모양/소리와 순서는 공급원 메타데이터로 결정합니다. 미해결 ID는 검증·컴파일 오류입니다.
- 배경: background:true 또는 공급원 메타데이터의 kind가 "background"인 객체는 장면에 맞춰 고정되고 캐릭터 뒤에 자동 배치됩니다 (IR kind는 변경하지 않음).
- Scene backgrounds: scenes[].background (locked sprite, not listed in objects[])

Custom media: write files into host assets/, then reference from pictures / sounds / backgrounds.
Paths must stay under assets/ (no ..).
import_ent가 반환한 assetAttributions는 자산 출처와 라이선스 고지입니다. IR을 편집·재컴파일할 때 삭제하거나 바꾸지 말고 그대로 전달하세요.

Variables / lists: declare then reference by NAME in VARIABLE / LIST params.

Example — bounce:
{
  "objects": [{
    "name": "고양이",
    "sprite": "library",
    "library": { "source": "local", "objectId": "local:cat" },
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
