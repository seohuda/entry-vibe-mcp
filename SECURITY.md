# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | yes       |

## Reporting a vulnerability

보안 취약점은 **공개 이슈로 등록하지 말고** GitHub Security Advisories 또는 repo maintainer에게 비공개로 알려 주세요.

- https://github.com/seohuda/entry-vibe-mcp/security/advisories/new

가능하면 재현 방법, 영향 범위, 사용 중인 버전 및 Node.js 버전을 함께 기재해 주세요.

## Scope

이 서버는 로컬 stdio MCP로 동작합니다. 네트워크 리스너를 열지 않으며, 호스트가 전달한 IR을 검증·컴파일한 뒤 호스트 실행 디렉터리(또는 `ENTRY_VIBE_OUTPUT_DIR`로 지정한 경로)에 파일을 작성합니다.
