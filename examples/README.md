# 예제

바로 컴파일해 볼 수 있는 IR 3종입니다.

| 파일 | 내용 |
|------|------|
| `bounce-cat.ir.json` | 4번 반복하며 이동·벽 튕기기 |
| `score-counter.ir.json` | 변수(`variables`)로 점수를 누적 |
| `todo-list.ir.json` | 리스트(`lists`)에 항목을 추가 |

## 실행

MCP 호스트 없이 로컬에서 바로 `.ent`로 컴파일해 볼 수 있습니다.

```bash
npm run example -- bounce-cat
npm run example -- score-counter
npm run example -- todo-list
```

`output/<이름>.ent`가 생성되며, [엔트리 오프라인](https://playentry.org/download)이나
playentry.org에서 열면 됩니다.

또는 파일 내용을 그대로 복사해서 MCP 호스트에 "이 IR로 프로젝트를 컴파일해줘"라고
붙여넣어도 됩니다 — `compile_project` 툴이 같은 IR을 받습니다.
