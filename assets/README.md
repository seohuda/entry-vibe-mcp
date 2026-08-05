# assets/

호스트(MCP가 실행된 작업 폴더)에서 커스텀 이미지를 두는 위치입니다.

- 지원 형식: `.png`, `.svg`
- IR 예: `"pictures": [{ "path": "assets/cat.png" }]`
- `pictures`를 생략하면 패키지 기본 엔트리봇 모양(`assets/media/`)을 사용합니다.
- SVG만 넣을 때는 같은 이름의 `.png`(예: `cat.svg` + `cat.png`)가 있으면 썸네일로 씁니다.

AI는 이미지를 이 폴더에 저장한 뒤 `compile_project`를 호출하면 됩니다.
