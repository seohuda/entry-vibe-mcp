# 예제

바로 컴파일해 볼 수 있는 IR입니다.

| 파일 | 내용 |
|------|------|
| `bounce-cat.ir.json` | 4번 반복하며 이동·벽 튕기기 |
| `score-counter.ir.json` | 변수(`variables`)로 점수를 누적 |
| `todo-list.ir.json` | 리스트(`lists`)에 항목을 추가 |
| `two-objects.ir.json` | 오브젝트 2개(플레이어·방해꾼) |
| `custom-media.ir.json` | `assets/`의 커스텀 png·소리 |
| `message-ping.ir.json` | 신호(`messages`) 보내기/받기 |
| `function-double.ir.json` | 함수(`functions`) 정의 + `function_call` |
| `function-list.ir.json` | 함수 + 리스트 + `show_list` (▶ 실행 시 목록 모니터에 결과 표시) |
| `library-movement.ir.json` | 로컬 고양이의 두 모양을 번갈아 보여 주며 이동 |
| `library-dialogue.ir.json` | 로컬 고양이·강아지가 신호를 주고받으며 대화 |
| `library-space.ir.json` | 로컬 우주 배경과 로켓·운석을 같은 장면에 배치 |

`custom-media.ir.json`은 [`examples/assets/`](assets/)의 `dot.png`·`beep.mp3`를 참조합니다.
(`beep.mp3`는 entryjs bark 샘플 복사본, Apache-2.0.)

## 실행

MCP 호스트 없이 로컬에서 바로 `.ent`로 컴파일해 볼 수 있습니다.

```bash
npm run example -- bounce-cat
npm run example -- score-counter
npm run example -- todo-list
npm run example -- two-objects
npm run example -- custom-media
npm run example -- message-ping
npm run example -- function-double
npm run example -- function-list
npm run example -- library-movement
npm run example -- library-dialogue
npm run example -- library-space
```

`output/<이름>.ent`가 생성되며, [엔트리 오프라인](https://playentry.org/download)이나
playentry.org에서 열면 됩니다.

또는 파일 내용을 그대로 복사해서 MCP 호스트에 "이 IR로 프로젝트를 컴파일해줘"라고
붙여넣어도 됩니다 — `compile_project` 툴이 같은 IR을 받습니다.

## 객체 라이브러리 예제

`library-*` 예제는 패키지의 `assets/library/`에 포함된 직접 제작 자산을 사용합니다.
공식 Entry 객체 라이브러리에서 다운로드한 자산이 아니며, 네트워크·로그인 없이
재현할 수 있습니다. 자산 라이선스와 제작 출처는 [자산 안내](../assets/library/NOTICE.md)를
참고하세요. `local:cat` 같은 ID는 이 로컬 공급원의 ID입니다.

새 프로젝트를 만들 때는 먼저 `search_objects({ query: "고양이" })`로 실제 후보를
찾고 `get_object_info({ objectId: "local:cat" })`로 모양·소리·출처를 확인합니다.
선택한 결과를 `add_library_object`로 가져오거나 아래처럼 IR에 참조합니다.

```json
{
  "name": "고양이",
  "sprite": "library",
  "library": { "source": "local", "objectId": "local:cat" },
  "scripts": [[{ "type": "when_run_button_click" }]]
}
```

`library-movement`는 카탈로그의 실제 키인 `DRIECTION: "next"`를 사용해 두 모양을
전환합니다. `library-space`의 우주 객체는 공급원 메타데이터가 배경으로 지정되어 있어
컴파일 시 무대에 맞춰 확대되고 잠기며, 다른 캐릭터 뒤에 배치됩니다.
모든 모양·소리는 `.ent`에 포함됩니다.

공식 라이브러리 검색·가져오기는 현재 지원하지 않습니다. 검색 결과가 없으면 임의의
ID를 만들거나 엔트리봇으로 조용히 바꾸지 말고, 지원하는 로컬 자산이나 사용 권한이
확인된 커스텀 파일을 선택하세요. 자동 검증은 IR·아카이브 구조와 컴파일 왕복을
검사하며, Entry 편집기에서의 화면 표시·실행은 별도 확인이 필요합니다.
