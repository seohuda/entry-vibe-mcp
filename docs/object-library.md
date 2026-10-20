# 객체 라이브러리

## 지원 범위

`local` 공급원은 이 저장소에서 제작한 객체를 오프라인으로 제공합니다. `user` 공급원은 사용 권한이 있는 사용자 파일을 명시적으로 등록할 때 활성화됩니다. `entry`는 공식 온라인 카탈로그용으로 예약한 미지원 공급원입니다. 공식 서비스의 내부 GraphQL을 호출하거나 카탈로그를 크롤링하지 않습니다. [공식 자료 조사](entry-library-research.md)를 참고하세요.

기존 `sprite: "entrybot"`, `sprite: "custom"`, `pictures`, `sounds`, 텍스트 상자는 그대로 사용할 수 있습니다. 라이브러리를 사용하지 않는 컴파일에는 추가 네트워크나 manifest 설정이 필요하지 않습니다.

## 검색과 가져오기

1. `search_objects({ query: "자동차 경주 게임", limit: 5 })`로 검색합니다. 이름·별칭·카테고리에 근거해 순위를 매기며 한국어와 영어를 지원합니다.
2. 반환된 ID로 `get_object_info({ objectId: "local:car" })`를 호출해 모양·소리·크기·라이선스를 확인합니다.
3. `add_library_object({ ir, objectId: "local:car", name: "플레이어", x: -100, scene: "경주" })`로 객체를 추가합니다. 장면은 먼저 IR에 선언해야 합니다.
4. 반환된 `ir`에 스크립트를 추가하고 `validate_project` → `verify_project` → `compile_project`를 호출합니다.

새 프로젝트는 `add_library_object`에만 `ir: { "objects": [] }`를 넘겨 시작할 수 있습니다. 일반 검증·컴파일의 최소 객체 수는 한 개입니다. `limit`은 최대 50입니다. 카테고리는 `list_object_categories`가 반환한 값을 사용합니다. `source`를 지정하면 해당 공급원만 검색합니다.

```json
{
  "objects": [{
    "name": "플레이어",
    "sprite": "library",
    "library": { "source": "local", "objectId": "local:car" },
    "scripts": [[
      { "type": "when_run_button_click" },
      { "type": "move_direction", "params": { "VALUE": 10 } }
    ]]
  }]
}
```

`library` 참조와 `pictures`/`sounds`를 혼용하지 않습니다. 같은 객체를 여러 번 추가할 수 있으며 각 객체와 모양·소리에는 별도의 Entry 참조 ID가 할당됩니다. 자산 바이트가 같으면 `.ent` 안의 파일은 공유합니다. 공급원은 모든 모양과 소리를 순서대로 제공하고, 소리가 없으면 bark를 넣지 않습니다. 알 수 없는 ID, 출처 불일치, 손상·누락된 파일은 오류입니다.

`kind: "background"`인 공급원 객체는 잠긴 배경으로 가져오며 Entry의 480×270 무대를 채우도록 크기를 맞추고 뒤쪽 레이어에 배치합니다. 기존 `scenes[].background.path` 방식도 계속 지원합니다. 역컴파일에서 모양·소리를 가진 배경은 `background: true`인 커스텀 객체로 보존할 수 있습니다.

라이브러리로 생성한 `.ent`에는 `temp/library-attribution.json`에 출처와 라이선스를 함께 기록합니다. `import_ent`로 가져오면 미디어는 로컬 커스텀 자산이 되고 권리 정보는 `ir.assetAttributions`로 보존됩니다. 다시 내보낼 때 이 필드를 유지하세요. 사용자 자산의 권리 정보는 manifest의 내용을 그대로 전달하며, 재배포 조건을 사용자가 확인해야 합니다.

## 사용자 자산 등록

호스트 작업 디렉터리에 다음 파일을 준비합니다.

```text
assets/object-library.json
assets/hero.png
assets/hero-walk.png
assets/beep.mp3
```

`assets/object-library.json` 예시:

```json
{
  "version": 1,
  "objects": [{
    "id": "hero",
    "name": "주인공",
    "category": "characters",
    "categoryName": "캐릭터",
    "aliases": ["hero", "주인공"],
    "description": "직접 제작한 주인공의 서기·걷기 모양",
    "kind": "sprite",
    "license": {
      "spdx": "MIT",
      "attribution": "자산 제작자 이름",
      "text": "실제 자산의 라이선스 전문을 여기에 기록합니다."
    },
    "costumes": [
      { "id": "idle", "name": "서 있기", "path": "hero.png", "format": "png" },
      { "id": "walk", "name": "걷기", "path": "hero-walk.png", "format": "png" }
    ],
    "sounds": [
      { "id": "beep", "name": "전자음", "path": "beep.mp3", "format": "mp3", "duration": 0.2 }
    ]
  }]
}
```

MCP 서버 프로세스에 `ENTRY_VIBE_OBJECT_LIBRARY=assets/object-library.json`을 설정한 뒤 서버를 다시 시작합니다. 자산 루트를 바꿀 때는 기존 `ENTRY_VIBE_ASSETS_DIR`를 사용합니다. manifest와 미디어 모두 이 자산 루트 안에 있어야 합니다. 검색에는 `source: "user"`, ID에는 `user:hero`를 사용합니다. `license`는 사용자가 확인한 권리를 기록하는 필드이며, 실제 사용 허가를 대신하지 않습니다.

manifest의 미디어 경로는 자산 루트 기준 상대 경로입니다. 절대 경로, 상위 디렉터리 이동, 루트 밖 심볼릭 링크, URL은 허용하지 않습니다. PNG·MP3와 제한된 SVG를 지원합니다. SVG는 스크립트·외부 리소스·스타일·엔티티를 허용하지 않고, 실제 PNG `thumbnailPath`를 함께 제공해야 합니다. 기존 커스텀 `pictures`의 SVG 지원과는 별개입니다.

## 보안·자원 한도

- 검색 결과 최대 50개, manifest 최대 2 MiB·객체 256개
- 객체당 모양 64개·소리 32개, 파일당 8 MiB, 객체당 32 MiB, 컴파일 요청당 라이브러리 자산 64 MiB
- 파일 크기·경로를 확인하고 제한된 바이트를 읽은 뒤 PNG/MP3 시그니처와 구조를 검증합니다. PNG는 4096×4096 이하의 비인터레이스 형식만 허용하며, MP3는 완전한 MPEG Layer III 프레임을 요구합니다.
- HTTP/HTTPS를 포함한 원격 자산 URL을 받지 않습니다. SSRF·악성 리다이렉트·네트워크 타임아웃은 다운로드를 시작하지 않는 방식으로 차단합니다. 재시도·다운로드 캐시는 사용하지 않으며 다운로드 예산은 0입니다.
- 라이브러리 파일은 콘텐츠 해시로 이름을 정해 안전한 Entry 아카이브 경로에 넣습니다. 객체 간 중복 파일은 한 번만 포함합니다.

네트워크 타임아웃·재시도 동작을 제공한다고 주장하지 않습니다. 현재 네트워크 공급원이 없기 때문입니다. 미래 공급원을 추가할 때에는 요청 시간 제한, 제한된 재시도·백오프, DNS/IP 기반 SSRF 방어, 매 리다이렉트 재검증, 허용 호스트, MIME·시그니처 검증, 총 다운로드 한도와 제한된 캐시를 별도로 구현해야 합니다.

## 공급원 확장

`src/library/`의 `ObjectLibraryProvider` 계약을 구현합니다. `searchObjects`, `getObject`, `listCategories`, `resolveObjectAssets`가 공통 인터페이스이며 `source`가 공급원을 식별합니다. 레지스트리가 공급원을 선택하므로 MCP 도구에 서비스별 로직을 넣을 필요가 없습니다.

ID는 `source:objectId` 형식으로 안정적으로 유지합니다. 검색 결과에는 실제 메타데이터만 넣고 자산 출처·라이선스를 기록합니다. 현재 컴파일러는 동기식이며 이미 검증된 로컬 바이트를 소비합니다. 원격 공급원을 추가한다면 허가된 자료를 안전하게 확보하는 사전 단계나 명시적인 비동기 API를 설계해야 합니다. 동기 인터페이스에서 암묵적으로 네트워크를 호출하지 마세요.

테스트는 고정 fixture와 실제 패커·검증기를 사용하며 Entry 서버에 의존하지 않습니다. `.ent` 구조·자산 포함·컴파일 왕복 검증은 Entry GUI에서 직접 열어 본 검증과 구분합니다. 이 변경에서는 Entry GUI 검증을 수행하지 않았습니다.
