# 기여 가이드

이슈와 PR을 환영합니다. 버그 리포트, 기능 제안, 문서 수정 모두 가능합니다.

## 이슈 올리기

GitHub Issues에서 해당하는 템플릿을 선택해 주세요.

| 템플릿 | 용도 |
|--------|------|
| 버그 리포트 | 컴파일·검증·`.ent` 로드 실패 등 재현 가능한 문제 |
| 기능 제안 | 블록·sprite·툴 추가 등 |
| 질문 | MCP 호스트 연결, 설정 |

Entry(엔트리) 자체 버그나 수업·계정 문의는 [playentry.org](https://playentry.org)로 문의해 주세요.

## 개발 환경

```bash
git clone https://github.com/seohuda/entry-vibe-mcp.git
cd entry-vibe-mcp
npm install
npm run build
npm test
```

카탈로그를 entryjs에서 다시 추출할 때는 아래 명령을 실행합니다.

```bash
npm run fetch:entryjs
npm run extract:catalog
```

## PR 보내기

1. `main`에서 브랜치를 생성합니다
2. 변경 사항을 반영하고 테스트를 실행합니다 (`npm test`, 필요 시 `npm run build`)
3. PR 템플릿을 작성합니다

커밋 메시지는 [Conventional Commits](https://www.conventionalcommits.org/) 형식을 따릅니다.

```
feat(catalog): ...
fix(compiler): ...
docs: ...
ci: ...
```

scope 예시: `catalog`, `compiler`, `server`

## 코드 영역

| 디렉터리 | 내용 |
|----------|------|
| `scripts/` | entryjs → 카탈로그 AST 추출 |
| `catalog/` | 생성된 블록 스키마 |
| `compiler/` | IR 검증·컴파일·`.ent` 패킹 |
| `server/` | MCP stdio 서버 |
| `test/` | vitest |

## 라이선스

기여하신 코드는 MIT 라이선스로 제공하는 것으로 간주합니다. `assets/media/`의 entryjs 미디어는 Apache-2.0을 따릅니다. 자세한 내용은 [NOTICE](assets/media/NOTICE.md)를 참고하세요.
