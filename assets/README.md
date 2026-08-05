# assets/

호스트(MCP가 실행된 작업 폴더)에서 커스텀 미디어를 두는 위치입니다.

| 종류 | 확장자 | IR |
|------|--------|-----|
| 모양 | `.png`, `.svg` | `"pictures": [{ "path": "assets/cat.png" }]` |
| 소리 | `.mp3` | `"sounds": [{ "path": "assets/meow.mp3" }]` |

- `pictures` / `sounds`를 생략하면 패키지 기본 엔트리봇 미디어(`assets/media/`)를 사용합니다.
- SVG만 넣을 때는 같은 이름의 `.png`(예: `cat.svg` + `cat.png`)가 있으면 썸네일로 씁니다.

AI는 파일을 이 폴더에 저장한 뒤 `compile_project`를 호출하면 됩니다.
