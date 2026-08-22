# ThisIsMyPDF·IMG — tripodfish/Supabase 편입 검토 (대표 지시, 2026-08-22)

> 헌장(app.charter.yaml)의 "Supabase 공유 인스턴스 통합은 tripodfish 편입 시점에 재검토" 조항의 그 재검토.
> 실측 기반: 3사이트 코드 한 벌(SITE 빌드), Convex 백엔드 742줄(11파일), 7월 Supabase→Convex 이관 이력,
> 어제 야간 루프 마감(10/10) 및 "당분간 유지+prod 전환(출시 우선)" 결정.

## 결론 요약

| 대상 | 권고 | 근거 한 줄 |
| --- | --- | --- |
| **프론트(3사이트 정적 툴)** | **이관 반대 — 현 구조 유지** | 서비스의 차별점이 "서버 없음·비용 0·정적"인데, Next 앱화는 얻는 것 없이 비용·복잡도만 추가 |
| **표준 편입** | 이미 사실상 완료 | 헌장(charter-assembly)·제품계약 yaml·CI 게이트(axe/모바일/구조/증거팩)가 tripodfish 표준과 동형 |
| **백엔드(Convex→Supabase)** | **이관 찬성 — 단 시점이 전부** | 아래 "무통 이관 창" 참조 |

## 핵심 판단: "무통 이관 창"은 prod 전환 전까지다

- Convex 백엔드의 실체: 계정(auth)·프리미엄(profiles)·익명 텔레메트리(toolEvents+일별 롤업)·백오피스·크론·컨택트.
- 최대 난점은 **계정 이관**: Convex Auth 와 Supabase Auth 는 비밀번호 해시가 호환되지 않아, 실사용자가 생긴 뒤 이관하면 전원 비밀번호 재설정 플로우가 필요하다.
- 그런데 **Convex prod 전환이 아직 대표 T0 대기 중** = 실계정 데이터가 사실상 없다. **지금이 마지막 무통 창**: prod 전환을 실행하는 순간부터 이관 비용이 사용자 수에 비례해 증가한다.
- 부수 근거: 스키마 주석 스스로 인정한 NoSQL 집계 약점(롤업 우회), 조직 표준 1-DB(관제·백업 단일화), 프리미엄 결제 시 @platform/auth·payments·admin 재사용.

## 옵션

| 안 | 내용 | 비용 | 권고 |
| --- | --- | --- | --- |
| **A′ (권고)** | 대기 중인 "Convex prod 전환" T0 자리에 **Supabase 이관을 대신 실행** — profiles/toolEvents/롤업 → `tim_` 네임스페이스(NAMING.md), auth → Supabase Auth, 백오피스 데이터층 → @platform/db, 크론 → pg_cron, HTTP action → 엣지 함수 1개, 정적 사이트는 API URL 스왑만 | 2~3일 | ✅ 무통 창 활용. 출시(광고 수익)는 정적 사이트라 이 작업과 독립 — 지연 없음 |
| B | 프리미엄 결제 착수 시점에 이관 | 동일 작업 + 계정 재설정 플로우 | 결제 전까지 사용자가 늘수록 고통 증가 |
| C | Convex 유지 확정 | 0 | 조직 이중 스택 고착(관제·백업·기술 분산), 롤업 우회 유지보수 지속 |

## A′ 실행 개요 (승인 시)
1. Supabase 공유 인스턴스에 `tim_` 마이그레이션(profiles·tool_events·daily_rollups·contacts) + RLS(익명 INSERT-only 텔레메트리는 정책으로 재현)
2. convex/ 함수 11개 → @platform/db 스토어 + 엣지 함수(텔레메트리 수집 1개) 포팅, 백오피스는 조회 URL 교체
3. 정적 사이트 config 의 백엔드 URL 스왑 → CI 전 게이트 + 라이브 스모크
4. 헌장 `backend: supabase` 갱신 + Convex 프로젝트 동결(1주 관찰 후 폐기)
- T0 변화: "Convex prod 키" 항목이 소멸하고 기존 Supabase 공유 키로 대체(신규 T0 없음)

## 프론트를 안 옮기는 이유 (기록)
tripodfish 편입 ≠ 레포 이동이다. 편입의 실익(표준·게이트·계약·관제)은 이미 charter-assembly 로 확보됐고,
남은 실익은 백엔드 통합뿐이다. 정적 3사이트를 Next 로 옮기면 "파일이 서버로 안 감·운영비 0" 차별점을 스스로 훼손한다.
공유할 가치가 생기면 contracts/design-tokens(디자인 토큰) 수준만 선택 편입한다.
