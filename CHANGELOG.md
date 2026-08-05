# Changelog

이 프로젝트는 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 형식과
[Semantic Versioning](https://semver.org/lang/ko/)을 따릅니다.

## [Unreleased]

## [0.1.0] - 2026-08-05

### Added

- 텍스트 IR을 검증·컴파일해 `.ent` 파일로 만드는 MCP stdio 서버
  (`list_categories`, `search_blocks`, `get_block_schema`, `validate_project`,
  `compile_project`)
- entryjs AST에서 블록 스키마를 추출하는 카탈로그 파이프라인 (12개 카테고리, 194개 블록)
- playentry.org / entry-offline 호환 `.ent`(tar.gz) 패커 — 해시 폴더 미디어 레이아웃
- 호스트 `assets/` 커스텀 미디어: `pictures`(png/svg), `sounds`(mp3)
- IR `variables` / `lists` 지원 (이름 → Entry 내부 id 치환)
- `ENTRY_VIBE_OUTPUT_DIR`, `compile_project`의 `overwrite` 옵션
- Claude Code, Claude Desktop, Cursor, VS Code, Codex CLI, Gemini CLI, Antigravity,
  OpenCode 등 MCP 호스트별 설치 가이드
- 예제 IR: bounce-cat, score-counter, todo-list, two-objects, custom-media

### Fixed

- `compile_project`가 패키지 설치 경로가 아니라 MCP 호스트 cwd에 `.ent`/`.json`을 저장
- 기존 파일 덮어쓰기 방지 (기본 거부, `overwrite: true`로 허용)
- 커스텀 코스튬의 entity scale이 엔트리봇 기본값(~0.51)으로 남는 문제
- 에셋 realpath 실패 시 fail-closed
