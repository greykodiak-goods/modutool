# 시리즈 3분할 기획 — iLove 구조 벤치마크 (2026-07-21)

> 대표 지시: "계산기는 this is my calculator처럼 나눠야 할 것 같다. iLove 베껴서 해. img도 기능 넣고. 또 기획해봐."
> iLove 실제 구조: **ilovepdf.com**(PDF만) + **iloveimg.com**(이미지만) — 별도 도메인·별도 브랜드지만 **공유 플랫폼**(같은 회사, 상호 헤더 링크, 공용 계정). 우리도 이 구조를 그대로 따른다.

## 1. 3-사이트 구성 (iLove 미러링)

| 사이트 | 도메인(제안) | 대응 iLove | 포함 툴 | 현재 개수 |
|---|---|---|---|---|
| **ThisIsMyPDF** | thisismypdf.com | ilovepdf.com | 합치기·나누기·추출·페이지편집·회전·압축·워터마크·쪽번호·서명·PDF→JPG·이미지→PDF | 11 |
| **ThisIsMyIMG** | thisismyimg.com | iloveimg.com | 압축·리사이즈·자르기·포맷변환·회전반전·워터마크 (+이미지→PDF 공유) | 6 (오늘 +4) |
| **ThisIsMyCalculator** | thisismycalculator.com | (iLove엔 없음 — 우리 확장) | 만나이·퍼센트·글자수·D-day·삼각함수·평수 | 6 |

- 각 사이트는 자기 카테고리 툴만 노출 + 헤더에 형제 사이트 링크(iLove 우상단 "iLoveIMG" 링크와 동일).
- **계정·프리미엄은 3사이트 공유**(iLove도 계정 공유): Supabase 프로젝트 하나, auth 쿠키 도메인 전략은 도메인 확정 후 결정(초기엔 사이트별 독립 로그인도 무방).

## 2. 코드는 한 벌 — SITE 빌드 플래그 (핵심 아키텍처)

레포 하나(현 modutool)가 3사이트 공용 코드베이스다. iLove도 내부적으로 공유 코드. 분할은 **물리적 폴더 복제가 아니라 빌드 시점 필터**로 한다:

- `sites.json`: 사이트별 정의(brand, domain, 포함 툴 slug 목록, 액센트색). 
- `SITE=img node scripts/build.mjs`: ①해당 사이트 툴만 sitemap/허브에 포함 ②브랜드명·파비콘·색 주입 ③형제 사이트 헤더 링크 주입.
- 툴 페이지 자체는 공용(코드 중복 0). 어느 사이트로 빌드하든 같은 pdf-merge를 쓴다.
- **장점**: 툴 하나 고치면 전 사이트 반영, 드리프트 0(어닝옵스 "화면 한 벌" 원칙과 동일). 신규 도메인 3개는 같은 레포에서 SITE만 바꿔 각각 배포.

**이행 순서(리스크 최소화)**:
1. 지금: 통합 프리뷰 유지(한 허브가 PDF/이미지/계산기 섹션으로 구분) — 작동 중인 라이브를 깨지 않음.
2. sites.json + SITE 필터 빌드 구현(이번 배치) — 통합 빌드는 SITE 미지정 시 전체(현행 동작 보존).
3. 도메인 구매 시: 각 도메인에 SITE 지정 배포 → 3사이트 독립.

## 3. IMG 기능 확충 (오늘 구축 — iLoveIMG 벤치마크)

| iLoveIMG 기능 | 우리 상태 | 비고 |
|---|---|---|
| Compress IMAGE | ✅ 있음 (목표KB 지정까지) | |
| Resize IMAGE | ✅ 있음 | |
| **Crop IMAGE** | 🆕 오늘 (image-crop) | 종횡비 프리셋 드래그 crop |
| **Convert (to/from JPG)** | 🆕 오늘 (image-convert) | JPG/PNG/WEBP 상호 + HEIC 한계 고지 |
| **Rotate IMAGE** | 🆕 오늘 (image-rotate) | 회전+좌우/상하 반전 |
| **Watermark IMAGE** | 🆕 오늘 (image-watermark) | 텍스트·타일·투명도(한글 canvas 렌더) |
| Photo editor | 🔜 2차 | 필터·밝기·자르기 통합 에디터 |
| Upscale / Remove background | 🔜 프리미엄 | ML 모델 클라이언트(onnx/tfjs, 수십 MB) — 유료 차별 기능 |
| Meme generator | 🔜 저우선 | 수요 있으나 니치 |
| Blur face | 🔜 프리미엄 | 얼굴검출 모델 |
| HTML to image | ⏸ 보류 | |

오늘 이후 이미지 스위트 **6툴**(압축·리사이즈·자르기·변환·회전반전·워터마크) — iLoveIMG 무료 핵심에서 photo editor·AI계열만 잔여.

## 4. 계산기 분리 (ThisIsMyCalculator)

- 계산기는 파일 처리가 아니라 별 성격(PDF/IMG 무업로드 소구와 무관)이라 **별 사이트로 분리가 맞다**(대표 판단 동의).
- iLove엔 계산기 사업이 없어 벤치마크 대상이 아니지만, 구조는 동일(별 도메인·공유 플랫폼).
- 계산기 확장 후보(2차): 연봉 실수령액·시급/주휴수당·대출이자·BMI·근무일수 — 단 만나이/연봉 등은 네이버 위젯 점령이라 유입 기대 낮음(리서치 근거). 계산기 사이트는 "글로벌 영어 계산기"로 포지셔닝하면(예: Korean age·pyeong 등 한국 특화 + 범용) 위젯 회피 가능.

## 5. 브랜드 네이밍 재확인

- thisismypdf / thisismyimg / thisismycalculator — 일관 시리즈. ⚠️ 각 도메인 가용성은 구매 시점 확인(thisismyimg는 앞서 RDAP 미확인).
- itsmypdf.com 유사품 존재 리스크는 PDF에 한정 — 로고·톤 차별화로 대응(이미 다름).
- 대안(가용성 문제 시): thisismy.tools 우산 도메인 하위(/pdf /img /calc) — 단일 도메인이라 SEO 축적이 분산 안 되는 장점. **도메인 3개 vs 우산 1개는 트레이드오프**(3개=브랜드 독립성·정확매칭 / 우산=권위 집중·저비용). 개인적 권고는 **우산 도메인으로 시작 → 검증 후 개별 분사**(신규 도메인 3개 동시는 색인 대기 3배).

## 6. 다음 실행(이번 세션 계속)
- [x] IMG 4툴 구축(image-crop/convert/rotate/watermark × en+ko)
- [ ] sites.json + SITE 빌드 필터 구현
- [ ] 허브를 카테고리 섹션으로 정리(PDF/Image/Calculator 명확 구분) — 도메인 분할 전 시각적 분리
- [ ] 전 툴 재검증 + gh-pages 재배포 + 라이브 체크
