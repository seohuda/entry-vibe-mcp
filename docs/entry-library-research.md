# Entry 오브젝트 라이브러리 조사 (2026-10-20)

## 결론

현재 확인한 공식 개발 문서는 EntryJS 런타임, 프로젝트 스키마, ENT 포맷을 설명하지만 외부 서비스가 사용할 수 있는 안정적인 오브젝트 검색·다운로드 API 계약은 확인하지 못했다. 사이트 공개 프런트엔드에는 내부 GraphQL 카탈로그 질의가 있으나 공개 API 지원·안정성·자산 재배포 권한을 입증하지 못한다. 따라서 이 변경에서는 `entry` 공급원을 **미지원**으로 표시하고, 독자 제작/허가받은 로컬 자산 공급원을 실제 사용 가능한 대안으로 제공하는 것이 타당하다. 전체 공식 카탈로그를 지원한다고 주장해서는 안 된다.

## 검증한 자료

- EntryJS GitHub: https://github.com/entrylabs/entryjs
- 조사 기준 커밋: `e01b81b77131098509887c48dca0b1f81607a84d`
- 프로젝트/스프라이트 예시 스키마: https://github.com/entrylabs/entryjs/blob/e01b81b77131098509887c48dca0b1f81607a84d/README.md#sprite-picture-sound-schema
- Object Data: https://docs.playentry.org/entryjs/typedef/2024-03-15-object-data.html
- ENT파일 관리: https://docs.playentry.org/entryjs/file/2024-07-24-ent.html
- Entry 서비스 저작권 안내: https://playentry.org/terms/copyright
- 공개 워크스페이스: https://playentry.org/ws/new

## 실제 구조

`objects[].sprite.pictures[]`와 `sounds[]`로 여러 모양/소리를 표현한다. `selectedPictureId`가 현재 모양을 참조한다. `scene`은 장면 ID이다. README의 오래된 스키마에는 그림/소리 `fileurl`이 있으며, 현재 소스는 `fileurl`이 있으면 사용하고 없으면 `filename`에서 경로를 조합한다.

현재 EntryJS 이미지 로더:
https://github.com/entrylabs/entryjs/blob/e01b81b77131098509887c48dca0b1f81607a84d/src/class/pixi/atlas/loader/AtlasImageLoadingInfo.ts#L135

그림 기본 경로는 `/uploads/${filename[0:2]}/${filename[2:4]}/image/${filename}.png`이다. 소리도 앞 네 글자 분할 폴더를 사용한다.

배경은 별도 무대 리소스가 아니라 `sprite.category.main === 'background'`인 오브젝트로 취급된다. 추가 시 뒤 레이어에 배치하고 잠근다. 기본 엔티티 크기를 초기화할 때 무대 비율 480×270에 맞춘다.

- https://github.com/entrylabs/entryjs/blob/e01b81b77131098509887c48dca0b1f81607a84d/src/class/container.js#L389
- https://github.com/entrylabs/entryjs/blob/e01b81b77131098509887c48dca0b1f81607a84d/src/class/object.js#L142

## ENT 포맷

공식 문서는 gzip tar 안에 `temp/project.json`과 에셋을 넣도록 명시한다. 파일명 앞 네 글자를 두 글자씩 나눠 폴더를 만든다.

- `temp/aa/bb/image/<filename>.png`
- `temp/aa/bb/thumb/<filename>.png`
- `temp/aa/bb/sound/<filename>.mp3`

EntryJS가 실제로 로드하는 미디어 참조와 압축 안의 경로가 일치해야 한다. 커스텀 포맷 사용 시 확장자 지원을 별도로 검증해야 한다. 공식 문서 확인은 Entry GUI에서의 실제 열기 테스트를 대체하지 않는다.

## 공개 사이트에서 관찰한 내부 카탈로그

2026-10-20 공개 페이지가 전달한 JS를 읽기 전용으로 조사했다. 인증·접근 제한을 우회하거나 카탈로그 서버를 크롤링하지 않았다. 내부 GraphQL을 호출하지 않았다.

- https://playentry.org/_next/static/chunks/2629-ea83b6654cddf1c2.js
  - `GET_SPRITES(category_main, category_sub, type, userId, pageParam)`
  - `SEARCH_SPRITES(name, type)`
  - `GET_CATEGORIES(categoryType, depth)`
- https://playentry.org/_next/static/chunks/pages/_app-8ddd66a26df5d3ef.js
  - sprite: `id`, `name`, `label {ko,en,ja,vn}`, `category {main,sub}`, `pictures`, `sounds`
  - picture: `id`, `name`, `label`, `filename`, `imageType`, `dimension {width,height}`, `trimmed {filename,width,height}`
  - sound: `id`, `name`, `label`, `filename`, `duration`
  - category: `id`, `name`, `value`, `label`, `categoryType`, `depth`, `categoryOrder`, `children`

프런트엔드 번들은 변경 가능한 내부 구현 자료다. 공급원의 정식 계약이나 사용 허가가 아니다. 안정성, 호출 한도, 인증 요건, 서비스 차원의 사용 허가를 검증하지 못했으므로 운영 공급원으로 구현하지 않는다.

## 라이선스

EntryJS 소스 저장소는 Apache-2.0이다. 이 라이선스를 별도 서비스 오브젝트 카탈로그 전체에 자동 적용할 수 없다. 공식 사이트 푸터는 “모든 저작물은 교육 목적에 한해 출처를 밝히고 자유롭게 이용할 수 있습니다.”라고 안내한다. 저작권 페이지의 동적 약관 본문 일부는 정적 HTML에서 `undefined`로 보였으므로 푸터 이상으로 권리 범위를 단정하지 않는다.

범용 개발 도구에 공식 에셋을 복제·동봉해 모든 용도로 재배포할 수 있다는 근거는 확보하지 못했다. 이번 기능은 저작권이 명확한 독자 제작 로컬 자산과 사용자에게 사용 권한이 있는 리소스를 사용해야 한다. 향후 공식 공급원 추가 시 카탈로그/API 사용 허가, 자산별 라이선스, 출처 표시, 교육 목적 제한 등을 명시적으로 검토해야 한다.

## 네트워크 검증 범위

`playentry.org`, `docs.playentry.org`, GitHub의 공개 페이지/저장소 읽기는 성공했다. 이는 카탈로그 API 인증/호출 허가나 모든 에셋 URL의 가용성을 검증한 결과가 아니다. 공식 GUI에서 ENT 파일을 직접 여는 검증은 수행하지 않았다.
