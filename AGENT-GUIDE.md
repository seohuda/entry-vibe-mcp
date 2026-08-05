# EntryVibe MCP — AI 에이전트 가이드

> **대상:** Cursor / Claude / OpenCode / Codex 등 MCP 호스트에 붙은 LLM  
> **목적:** 모델마다 MCP 활용 능력이 달라도, **같은 규칙**으로 열리고 실행되는 `.ent`를 만들기

사람용 설치·연결 안내는 [README.md](README.md)를 보세요. 이 문서는 **당신(에이전트)** 이 따라야 할 계약입니다.

---

## 0. 한 줄 요약

**IR JSON을 직접 조립해서 zip/tar로 묶지 마세요.**  
반드시 MCP 툴 `validate_project` → `verify_project` → `compile_project`로 `.ent`를 만드세요.

---

## 1. 필수 워크플로 (순서 고정)

새 작품을 만들 때 **이 순서를 건너뛰지 마세요.**

```
1. get_build_guide({ request })     ← 항상 첫 호출
2. search_blocks({ query, scope: "core" })
3. get_block_schema({ types: [...] })   ← 쓸 블록마다
4. validate_project({ ir })
5. verify_project({ ir })               ← compile 전 권장
6. compile_project({ ir, filename? })
```

`validate_project` 또는 `verify_project`가 `ok: false`이면:

1. `errors`와 `hints`를 **전부** 읽는다  
2. IR만 수정한다 (project.json / .ent 직접 수정 금지)  
3. 4번부터 **다시** 호출한다  
4. `ok: true`가 될 때까지 반복한 뒤에만 `compile_project`

기존 `.ent`를 고칠 때:

```
import_ent → (patch_script / add_object / …) → verify_project → compile_project
```

다른 도구가 만든 `.ent`를 열기 전:

```
audit_ent({ filename })   ← name 누락, 잘못된 미디어 경로, 끊긴 func_* 참조 검사
```

---

## 2. 절대 하지 말 것 (실제 장애 사례)

| 하지 말 것 | 왜 문제인지 |
|-----------|------------|
| `project.json`을 직접 쓰고 zip/tar로 `.ent` 만들기 | `name` 누락 → 제목 **undefined**; `temp/media/` 평탄 경로 → Entry Offline에서 이미지/소리 안 뜸 |
| 블록 param 키를 **추측**하기 | Entry는 **이름 키**(IR) → **슬롯 배열**(export)로 컴파일됨. 키가 틀리면 블록이 로드돼도 **실행 안 됨** |
| `get_block_schema` 없이 블록 타입 나열하기 | `calc_basic`의 `LEFTHAND`/`OPERATOR`/`RIGHTHAND`, 리스트 블록의 `LIST`/`INDEX` 등 틀리기 쉬움 |
| `scope: "all"`로 블록 검색 | 하드웨어 블록 수천 개가 섞여 **엉뚱한 블록** 선택 |
| `function_create`를 오브젝트 스크립트에 넣기 | 함수는 `ir.functions[]` + `function_call`로만 정의 |
| `validate_project` 생략하고 `compile_project` | 컴파일은 되도 Entry 런타임에서 조용히 실패할 수 있음 |
| 검증 실패 시 같은 IR로 재시도만 반복 | `hints`를 적용하지 않으면 무한 루프만 남음 |
| IR 전체를 매번 처음부터 다시 쓰기 | `patch_script`, `add_object` 등 **증분 편집** 툴 사용 |

---

## 3. 능력이 낮은 모델을 위한 축소 규칙

MCP 툴 호출이 불안정하거나 컨텍스트가 짧다면:

1. **한 번에 하나의 오브젝트**만 — `examples/*.ir.json` 패턴을 `get_build_guide` 스케치에 맞춰 따르기  
2. **함수·리스트·메시지는 나중에** — 먼저 `when_run_button_click` + `move_direction` + `repeat_basic`만으로 동작 확인  
3. 블록 타입은 **한 번에 최대 5개**만 `get_block_schema`에 넘기기  
4. 복잡한 수식(MLP, XOR, 시그모이드)은 **함수 탭에 블록이 많음** → 메인 스크립트만 보면 “비어 있다”고 착각하지 말 것  
5. 막히면 `npm run example -- bounce-cat` 결과 IR을 `import_ent` / 예제 파일과 비교

---

## 4. IR 규칙 (암기용)

### 4.1 최상위 구조

```json
{
  "objects": [{ "name": "...", "sprite": "entrybot", "scripts": [[ ... ]] }],
  "variables": [{ "name": "점수", "initialValue": 0 }],
  "lists": [{ "name": "목록", "initialValues": [1, 2] }],
  "messages": [{ "name": "신호1" }],
  "functions": [{ "name": "두배", "type": "statement", "body": [ ... ] }]
}
```

- `objects[].scripts` = **스레드 배열의 배열**. 각 스레드는 `IRBlock[]`
- 스프라이트 스레드 **첫 블록은 반드시 이벤트 모자**(hat): `when_run_button_click`, `when_message_cast`, …

### 4.2 블록 하나

```json
{
  "type": "repeat_basic",
  "params": { "VALUE": 4 },
  "statements": { "DO": [ { "type": "move_direction", "params": { "VALUE": 10 } } ] }
}
```

- `params` 키 = `get_block_schema`가 알려주는 **대문자 이름** (`VALUE`, `VARIABLE`, `LIST`, …)
- `statements` 키 = `statementKeys` (`DO`, `SUBSTACK`, …) — 숫자 인덱스 아님

### 4.3 변수·리스트·메시지

| 선언 | 사용 시 param 키 |
|------|------------------|
| `variables[]` | `VARIABLE` + 이름 문자열 |
| `lists[]` | `LIST` + 이름 문자열 |
| `messages[]` | `VALUE` + 이름 문자열 (`MESSAGE` 아님) |

리스트 **인덱스는 1부터** (Entry 규칙).

### 4.4 함수

```json
"functions": [{
  "name": "두배",
  "type": "string",
  "body": [{ "type": "set_variable", "params": { "VARIABLE": "결과", "VALUE": 2 } }],
  "returnValue": { "type": "get_variable", "params": { "VARIABLE": "결과" } }
}],
"objects": [{
  "scripts": [[
    { "type": "when_run_button_click" },
    { "type": "function_call", "params": { "NAME": "두배" } }
  ]]
}]
```

- 함수 본문은 `ir.functions[].body`에만  
- 호출은 `{ "type": "function_call", "params": { "NAME": "함수이름" } }`

### 4.5 텍스트 박스

```json
{ "name": "안내", "kind": "text", "text": "설명 문구", "scripts": [] }
```

`kind: "text"` 오브젝트는 블록이 없을 수 있음. **스크립트가 있는 오브젝트(스프라이트)를 선택**해야 블록 탭에 코드가 보임.

### 4.6 커스텀 미디어

- 호스트 작업 디렉터리의 `assets/` 아래에 png/svg/mp3 저장  
- IR에서 `"path": "assets/파일명.png"` 형태로 참조  
- 컴파일러가 Entry 해시 폴더(`temp/ab/cd/image/...`)로 패킹함 — **직접 경로 쓰지 말 것**

---

## 5. 검색 범위 (`scope`)

| scope | 언제 |
|-------|------|
| `core` (기본) | 이동, 반복, 변수, 리스트, 판단, 계산, 메시지, 함수 |
| `ai` | TTS, 번역, AI 활용 블록 |
| `hardware` | 사용자가 **보드 이름을 명시**했을 때만 |
| `all` | 거의 사용 금지 |

---

## 6. 검증 툴 차이

| 툴 | 하는 일 |
|----|---------|
| `validate_project` | IR ↔ 카탈로그 (param 키, hat, 참조) |
| `smoke_test_project` | validate + 컴파일 + 구조 |
| `verify_project` | smoke + export 감사 + pack 왕복 + (선택) 시뮬 |
| `audit_ent` | **이미 만든** `.ent` 파일만 검사 (수정 안 함) |
| `simulate_project` | 이동/변수/반복 등 **일부** 블록만 예측 실행 |

`compile_project` 전에는 최소 `validate_project`, 가능하면 `verify_project`를 호출하세요.

---

## 7. 자주 나는 “작동 안 함” 착각

| 증상 | 실제 원인 |
|------|-----------|
| 제목이 `undefined` | `project.name` 없이 수동 `.ent` 생성 → `compile_project` 사용 |
| 블록 28개인데 화면이 비어 있음 | **안내글(text)** 선택 중이거나, 로직이 **함수 탭**에만 있음 |
| ▶ 눌러도 아무 일 없음 | `show_variable`/`show_list` 없이 내부 계산만 함 → 리스트 모니터 확인 |
| 리스트 값이 정답과 안 맞음 | 시그모이드 **소수 출력** vs 정수 정답 — 반올림 블록 필요할 수 있음 |
| 이미지가 안 보임 | `temp/media/` 수동 경로 — `audit_ent`로 확인 후 `compile_project`로 재패킹 |

---

## 8. 재시도 루프 (의사코드)

```
guide = get_build_guide(request)
ir = guide.matchedRecipes[0].irSketch  // 있으면 시작점

loop:
  schemas = get_block_schema(모든_블록_타입)
  ir = 스키마에_맞게_IR_완성(ir)
  v = validate_project(ir)
  if not v.valid:
    ir = apply_hints(v.errors, v.hints)
    continue
  vf = verify_project(ir)
  if not vf.ok:
    ir = apply_hints(vf.errors, vf.warnings)
    continue
  break

compile_project({ ir, filename: "작품이름.ent" })
```

최대 5회 실패 시: 요구사항을 **단순화**하고 `get_build_guide`부터 다시 시작.

---

## 9. 예제 IR (복사 시작점)

레포의 [`examples/`](examples/) 디렉터리:

| 파일 | 내용 |
|------|------|
| `bounce-cat.ir.json` | 반복 이동 + 벽 튕기기 |
| `score-counter.ir.json` | 변수 |
| `todo-list.ir.json` | 리스트 |
| `message-ping.ir.json` | 메시지 |
| `function-double.ir.json` | 함수 정의 + 호출 |
| `function-list.ir.json` | 함수 + 리스트 + `show_list` (실행 결과가 무대에 보임) |
| `two-objects.ir.json` | 오브젝트 2개 |
| `custom-media.ir.json` | 커스텀 png/mp3 |

로컬 확인: `npm run example -- function-list`

---

## 10. 체크리스트 (컴파일 직전)

- [ ] `get_build_guide`를 호출했는가  
- [ ] 쓴 모든 `type`에 대해 `get_block_schema`를 호출했는가  
- [ ] `params` 키가 스키마와 일치하는가 (`VALUE`, `VARIABLE`, `LIST`, …)  
- [ ] `statements` 키가 `DO` 등 스키마와 일치하는가  
- [ ] 변수/리스트/메시지/함수를 **선언**했는가  
- [ ] `validate_project` → `ok: true`인가  
- [ ] `verify_project` → `ok: true`인가 (권장)  
- [ ] `project.json` / 수동 zip을 만들지 **않았는가**  
- [ ] `compile_project`로만 `.ent`를 만들었는가  

---

## 11. OpenCode / 시스템 프롬프트 템플릿

호스트가 레포 파일을 못 읽을 때, 아래 블록을 **시스템 프롬프트** 또는 OpenCode `instructions`에 그대로 붙여 넣으세요.

### English (copy-paste)

```text
You build Entry (playentry.org) projects ONLY through the entry-vibe MCP server.

Rules:
1. ALWAYS call get_build_guide({ request }) first for every new build.
2. NEVER hand-write project.json or create .ent archives yourself — only compile_project.
3. Workflow: get_build_guide → search_blocks(scope=core) → get_block_schema → validate_project → verify_project → compile_project.
4. NEVER guess block param keys — get_block_schema for every block type you emit.
5. Functions: declare in ir.functions[]; call with function_call + NAME — never function_create in object scripts.
6. On validate/verify failure: read errors and hints, fix IR only, re-validate — do not retry unchanged IR.
7. Foreign .ent files: audit_ent(filename) before import_ent.
8. For list + function patterns, start from examples/function-list.ir.json in the repo.

If the repo is available, read AGENT-GUIDE.md before your first tool call.
```

### 한국어 (복붙용)

```text
Entry(playentry.org) 작품은 entry-vibe MCP 툴만으로 만듭니다.

규칙:
1. 새 작품마다 반드시 get_build_guide({ request })를 첫 호출로 실행합니다.
2. project.json을 직접 쓰거나 .ent zip/tar를 만들지 않습니다 — compile_project만 사용합니다.
3. 순서: get_build_guide → search_blocks(scope=core) → get_block_schema → validate_project → verify_project → compile_project.
4. 블록 param 키를 추측하지 않습니다 — 쓸 블록마다 get_block_schema를 호출합니다.
5. 함수는 ir.functions[]에 선언하고 function_call로 호출합니다 — 오브젝트 스크립트에 function_create 금지.
6. validate/verify 실패 시 errors·hints를 보고 IR만 고친 뒤 재검증합니다 — 같은 IR로 compile_project 재시도 금지.
7. 다른 도구가 만든 .ent는 import_ent 전에 audit_ent(filename)로 검사합니다.
8. 리스트+함수 패턴은 레포의 examples/function-list.ir.json을 참고합니다.

레포를 읽을 수 있으면 첫 툴 호출 전 AGENT-GUIDE.md를 읽으세요.
```

OpenCode `opencode.json` 예시는 [README.md](README.md)의 OpenCode 섹션을 참고하세요.

---

## 12. 관련 파일

| 파일 | 용도 |
|------|------|
| [SKILL.md](SKILL.md) | Cursor 스킬 요약 |
| [.cursor/rules/entry-vibe-mcp.mdc](.cursor/rules/entry-vibe-mcp.mdc) | Cursor 규칙 |
| [server/ir-docs.ts](server/ir-docs.ts) | MCP 툴 설명에 임베드되는 IR 스키마 |
| [examples/README.md](examples/README.md) | 예제 설명 |

**이 가이드를 사용자가 @멘션하거나 시스템 프롬프트에 넣으면**, MCP 숙련도가 낮은 모델도 동일한 품질 기준을 따를 수 있습니다.
