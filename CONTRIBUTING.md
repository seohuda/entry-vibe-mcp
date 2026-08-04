# 기여 가이드

이슈·PR 환영합니다. 버그, 기능 제안, 문서 수정 모두 괜찮습니다.

## 이슈 올리기

GitHub Issues에서 템플릿을 골라 주세요.

| 템플릿 | 언제 |
|--------|------|
| 버그 리포트 | 컴파일/검증/`.ent` 로드 실패 등 재현 가능한 문제 |
| 기능 제안 | 블록·sprite·툴 추가 등 |
| 질문 | MCP 호스트 연결, 설정 |

Entry(엔트리) 자체 버그나 수업/계정 문의는 [playentry.org](https://playentry.org) 쪽입니다.

## 개발 환경

```bash
git clone https://github.com/seohuda/entry-vibe-mcp.git
cd entry-vibe-mcp
npm install
npm run build
npm test
```

카탈로그를 entryjs에서 다시 뽑을 때만:

```bash
npm run fetch:entryjs
npm run extract:catalog
```

## PR 보내기

1. `main`에서 브랜치 따기
2. 변경 + 테스트 (`npm test`, 필요하면 `npm run build`)
3. PR 템플릿 채우기

커밋 메시지는 [Conventional Commits](https://www.conventionalcommits.org/) 형식을 씁니다.

```
feat(catalog): ...
fix(compiler): ...
docs: ...
ci: ...
```

scope 예: `catalog`, `compiler`, `server`

## 코드 영역

| 디렉터리 | 내용 |
|----------|------|
| `scripts/` | entryjs → 카탈로그 AST 추출 |
| `catalog/` | 생성된 블록 스키마 |
| `compiler/` | IR 검증·컴파일·`.ent` 패킹 |
| `server/` | MCP stdio 서버 |
| `test/` | vitest |

## 라이선스

기여 코드는 MIT로 기여하는 것으로 봅니다. `assets/media/`의 entryjs 미디어는 Apache-2.0 — [NOTICE](assets/media/NOTICE.md) 참고.
