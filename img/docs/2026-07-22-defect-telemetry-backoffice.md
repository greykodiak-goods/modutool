# 결과 텔레메트리 + 백오피스 통계 (2026-07-22)

> 대표 지시: "이런 오작동·건들을 개선 위해 저장해놔. 고객이 원하는 결과물을 내지 못했을 때 상황과 이유를 기록해서 백오피스 통계로 볼 수 있게 하나 만들어놓자."
> 계기: Compress PDF에서 이미 가벼운 파일을 올리면 "원본보다 작지 않아 다운로드하지 않음"이 뜬다 — 도구는 **정상(더 큰 파일을 강제로 주지 않는 안전동작)**이지만, 고객 입장에선 "왜 안 돼?"로 읽힌다. 바로 이런 "원하는 결과를 못 준 순간"을 데이터로 모아 개선 우선순위를 잡는다.

## 무엇을 만들었나

1. **익명 결과 로거** (`assets/site.js` 내 `mdtlLogEvent`) — 전 페이지 로드. 도구·결과유형·사유·비식별 메타만 전송.
2. **전역 자동 캡처** — 어떤 툴이든 `mdtlResult(el, html, true)`로 오류를 표시하면 **페이지 수정 없이 자동으로 error 이벤트 로깅**. 사유는 메시지 텍스트에서 코드로 추정(password_protected·invalid_file·too_large_or_oom 등).
3. **명시 계측** — 자동 캡처가 못 잡는 `no_result`(결과 미달성, ℹ️로 안내되는 "변경 없음/더 작지 않음" 등)와 `success`(원하는 결과 다운로드)를 각 툴에 심음. 플래그십: pdf-compress.
4. **백오피스 통계 페이지** `/admin/` — 로그인 + 관리자 이메일 게이트. 결과유형별·도구별 실패율·상위 사유·일별 추이·최근 실패 피드.

## 프라이버시 (이 사이트의 핵심 약속과 충돌 없이)

- 사이트의 약속은 "**파일**은 브라우저를 떠나지 않는다"이다. 텔레메트리는 파일이 아니라 **집계 메타데이터**만 보낸다.
- **절대 전송 안 함**: 파일명·파일 바이트·파일 내용·사용자가 입력한 값.
- **전송함(비식별)**: 도구 슬러그, 결과유형(success/no_result/error/unsupported/cancelled), 짧은 사유 코드, 언어(ko/en), 브라우저 계열(Chrome/mobile 등), 익명 세션ID(계정과 무관한 난수), 화이트리스트 메타(pages·size_bucket·level·saved_pct·width·height·format·quality·err_name).
- 파일 용량은 **정확값이 아니라 구간**으로만(예: "5-10MB").
- 옵트아웃: `localStorage['mdtl-no-telemetry']='1'`이면 전송 중단. 로컬호스트에선 전송 안 함.
- 개인정보처리방침(ko/en)에 "비식별 결과 이벤트 수집" 고지 추가함.

## 데이터/보안 구조 (Supabase 프로젝트 gysvtgnpacqjpdijbcaw)

`supabase/migration_02_tool_events.sql` (적용 완료):

- **`tool_events`** 테이블. RLS 켬.
  - 클라이언트(anon·authenticated)는 **INSERT만** 가능. **SELECT/UPDATE/DELETE 정책 없음** → 브라우저로는 로그를 읽을 수도 없다.
  - CHECK로 outcome 열거·길이·meta 크기(≤2KB) 강제 → 악성/과다 데이터 차단.
- **`admin_users`** 화이트리스트. 정책 없음(정의자 함수만 참조). 시드: `greykodiak1@gmail.com`.
  - 관리자 추가: `insert into public.admin_users(email) values ('x@y.com');`
- **`mdtl_tool_dashboard(days)`** SECURITY DEFINER 함수. 호출자 이메일이 admin_users에 없으면 `not authorized` 예외. authenticated에만 execute 부여.

검증 완료(2026-07-22): anon INSERT 성공 / anon SELECT 0행(읽기 차단) / anon·비관리자 대시보드 호출 차단 / 관리자 JWT로 대시보드 정상 집계 / 잘못된 outcome 값 거부.

## 백오피스 사용법

1. 배포된 사이트에서 `/admin/` 접속 (예: `https://greykodiak-goods.github.io/modutool/admin/`).
2. **관리자 이메일(greykodiak1@gmail.com)로 로그인**돼 있어야 통계가 보인다. 아니면 "관리자 아님" 안내.
3. 기간(7/30/90/365일) 전환 가능.
4. 화면: 실패율 KPI → 도구별 실패율 표 → 상위 사유 → 일별 추이 → 최근 실패 50건 피드.
   - **개선 우선순위 판독법**: "도구별 실패율" 상단 + "상위 사유"를 보면 어느 도구의 어떤 사유가 고객을 가장 많이 막는지 바로 나온다. 예: `pdf-compress / result_not_smaller`가 많으면 → 안내 문구 개선 또는 "이미 최적화됨" 사전판정 UX가 필요하다는 신호.

## 남은 롤아웃 / 다음

- 계측 커버리지: 전 툴 error는 자동(전역). no_result/success는 주요 툴부터 명시 계측(compress 완료, 나머지 순차).
- 트래픽이 커지면 success 이벤트는 샘플링 고려(현재는 전량 — 볼륨 미미). 실패 이벤트는 항상 전량.
- 관리자용 "샘플 시드 삭제"·CSV 내보내기는 필요 시 추가(현재 클라이언트는 삭제 불가 — 의도된 보안).
