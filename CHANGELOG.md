# Changelog

이 프로젝트는 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 형식과
[Semantic Versioning](https://semver.org/lang/ko/)을 따릅니다.

## [Unreleased]

### Added

- **`AGENT-GUIDE.md`** — MCP 호스트 LLM용 전체 계약 (금지 사항, 재시도 루프, OpenCode 프롬프트 템플릿)
- 예제 `function-list.ir.json` — 함수 + 리스트 + `show_list`
- npm 패키지 `files`에 `AGENT-GUIDE.md`, `SKILL.md` 포함
- MCP `get_build_guide` 응답에 `agentContract` 필드 (모델이 repo 문서를 못 읽어도 핵심 규칙 전달)
- MCP 툴 `audit_ent` — 기존 `.ent` 구조 감사
- `compiler/audit-export.ts` — export 감사 (name, media, func 참조)
- MCP 툴 `get_build_guide` + 내장 레시피 (bounce/점수/리스트/신호/함수/TTS)
- MCP 툴 `import_ent`, `add_object`, `patch_script`, `smoke_test_project`
- MCP 툴 `verify_project`, `simulate_project`, `remove_object`, `patch_object`, `add_scene`, `remove_scene`, `set_learning`
- `.ent` 역컴파일 (`compiler/decompile.ts`, `compiler/unpack.ts`)
- IR `scenes` / `background` / `kind:text` / `sprite:custom` / `learning` / `speed` 확장
- 코어 블록 런타임 시뮬레이터 (`compiler/runtime-sim.ts`)
- 전체 검증 파이프라인 (`compiler/verify.ts`) — pack roundtrip 포함
- IR `messages` / `functions` / `objects[].x|y` — 신호·함수·좌표 지원
- `function_call` 의사 블록 → Entry `func_<id>`
- `validate_project` / `compile_project`의 `hints` 필드
- Cursor 규칙(`.cursor/rules/entry-vibe-mcp.mdc`)과 `SKILL.md`
- 예제 `message-ping`, `function-double`

### Added (earlier)

- 카탈로그에 AI 활용·AI 학습·확장·하드웨어·하드웨어 Lite 블록 포함
- 컴파일 시 `aiUtilizeBlocks` / `expansionBlocks` / `hardwareLiteBlocks` /
  `externalModules` 자동 채움 (사용된 확장 블록 기준)
- `getBlocks` 할당형(`Entry.X.getBlocks = function…`) 추출 지원

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
