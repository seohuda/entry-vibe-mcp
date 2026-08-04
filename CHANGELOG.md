# Changelog

이 프로젝트는 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 형식과
[Semantic Versioning](https://semver.org/lang/ko/)을 따릅니다.

## [Unreleased]

### Added

- IR에 `lists` 지원 추가. `variables`와 같은 방식으로 이름을 선언하고 `LIST` 파라미터에서
  참조하면 컴파일 시 Entry 내부 리스트 id로 치환됩니다 (`add_value_to_list`,
  `value_of_index_from_list` 등 9개 리스트 블록 활성화).

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
