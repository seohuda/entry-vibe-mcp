# Changelog

이 프로젝트는 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 형식과
[Semantic Versioning](https://semver.org/lang/ko/)을 따릅니다.

## [Unreleased]

### Added

- IR에 `lists` 지원 추가. `variables`와 같은 방식으로 이름을 선언하고 `LIST` 파라미터에서
  참조하면 컴파일 시 Entry 내부 리스트 id로 치환됩니다 (`add_value_to_list`,
  `value_of_index_from_list` 등 9개 리스트 블록 활성화).
- 결과물 저장 위치를 오버라이드하는 `ENTRY_VIBE_OUTPUT_DIR` 환경 변수 추가.

### Fixed

- `compile_project`가 MCP 호스트의 실행 디렉터리가 아니라 entry-vibe-mcp 패키지 자신이
  설치된 경로에 결과물을 쓰던 문제 수정. 여러 프로젝트에서 이 서버를 쓰면 결과물이
  전부 패키지 설치 폴더 한 곳으로 몰리고, npm 설치 환경에서는 사용자가 찾기 어려운
  위치(`node_modules/` 등)에 쌓이는 문제였습니다. 이제 서버를 실행한 디렉터리에 `<이름>.ent`와
  `<이름>.json`을 바로 저장합니다 (별도의 `output/` 하위 폴더 없음).
- `compile_project`가 만드는 확인용 JSON 파일명을 `<이름>.project.json`에서
  `<이름>.json`으로 변경 (이름이 중복돼 어색했던 부분 정리).

## [0.1.0] - 2026-08-04

### Added

- 텍스트 IR을 검증·컴파일해 `.ent` 파일로 만드는 MCP stdio 서버 (`list_categories`,
  `search_blocks`, `get_block_schema`, `validate_project`, `compile_project`)
- entryjs AST에서 블록 스키마를 추출하는 카탈로그 파이프라인 (12개 카테고리, 194개 블록)
- entry-offline 호환 `.ent`(tar.gz) 패커, 동시 컴파일 시 충돌 없는 스테이징 디렉터리
- IR 검증: 이벤트 블록으로 시작하는 스레드 강제, 변수 선언·참조 검사, 알 수 없는
  블록/파라미터/스테이트먼트 슬롯 탐지
- Claude Code, Claude Desktop, Cursor, VS Code, Codex CLI, Gemini CLI, Antigravity 등
  주요 MCP 호스트별 설치 가이드
