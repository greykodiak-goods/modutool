# Product Contract — 기계검증형 제품 명세

"버튼 하나까지" 기획을 장문 PRD가 아니라 **사람이 읽고 CI가 검사하는 계약**으로 관리한다.
계약이 없으면 기획이 끝난 게 아니고, 계약에 연결된 테스트가 없으면 구현이 끝난 게 아니다.

## 구조

```
product-contract/
├─ product.yaml     제품 목적·KPI·제외범위 (제품 전체 1개)
├─ events.yaml      분석 이벤트 계약 — 결과 코드·메타 화이트리스트·금지 필드
│                   (convex/telemetry.ts 서버 화이트리스트와 CI가 동기 검사)
└─ tools/<slug>.yaml  도구별 계약 — 화면 상태·컴포넌트·오류·불변식·테스트 연결
```

## 강제 방식 (tests/contract-audit.mjs — CI 실행)

- **신규 도구는 계약 필수**: 동결 목록(도입 이전 40개)에 없는 도구 폴더는
  `tools/<slug>.yaml`이 없거나 필수 항목이 비면 CI가 실패한다.
- **테스트 연결 필수**: 계약의 `tests:`에 적힌 파일이 실제로 존재하고 그 안에
  도구 slug가 등장해야 한다(명세→테스트 추적성).
- **이벤트 계약 동기**: `events.yaml`의 outcome·meta 화이트리스트가 서버 코드
  (convex/telemetry.ts)와 다르면 실패 — 문서와 실제가 갈라지는 것을 차단.
- 동결 목록에서 도구를 빼려면(=계약을 소급 작성하면) contract-audit의 FROZEN에서
  제거한다. 목록은 줄어들기만 해야 한다(래칫).

## 계약 작성 요령

`tools/pdf-merge.yaml`이 본보기다. 최소 필수 키: `id` `purpose` `states`
`components` `errors` `telemetry` `invariants` `tests`.
상태는 idle → input_loading → ready/invalid_input → processing →
success/no_result/unsupported/error/cancelled 흐름을 도구 실정에 맞게 명시한다.
