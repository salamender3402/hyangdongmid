# 학사일정 웹앱(Hdhaksaa) 백엔드/프론트엔드 분할 모듈화 구현 계획 (마스터 플랜)

본 계획서는 단일 거대 파일(`app.js`, 2,450줄)로 구성된 학사일정 웹앱을 **백엔드(Back-end & Services)**와 **프론트엔드(Front-end & Views)** 영역으로 명확히 구분하고, **클로드(Claude 3.7 Sonnet)**와의 대화 세션 단위로 단계별 정밀 코딩을 진행하기 위한 영구 참고 기준 문서입니다.

---

## 🏗️ 전체 아키텍처 청사진 (Target Architecture)

```
haksaa/Hdhaksaa/
├── index.html                      # 메인 UI 구조 마크업
├── style.css                       # 디자인 시스템 및 CSS 변수
├── service-worker.js               # PWA 오프라인 캐싱 & 무선 업데이트
├── manifest.json                   # PWA 설치 설정
├── MODULARIZATION_PLAN.md          # 📌 본 마스터 계획서 (공통 기준점)
│
└── src/                            # [모듈화 소스코드]
    ├── main.js                     # 🚀 메인 오케스트레이터 (앱 진입점)
    │
    ├── core/                       # 🧠 [코어 상태 관리]
    │   └── state.js                # 전역 반응형 상태 저장소
    │
    ├── services/                   # ⚙️ [영역 1: 백엔드 & 데이터 서비스]
    │   ├── authService.js          # 교직원/관리자/연락망 보안 인증
    │   ├── neisService.js          # 나이스(NEIS) 학사일정 및 급식 API 연동
    │   ├── firebaseService.js      # Firebase Firestore 실시간 DB 동기화
    │   ├── storageService.js       # LocalStorage 캐싱 및 개인 순서 보관
    │   └── importExportService.js  # 구글 시트 연동, CSV/JSON 파일 파서 & 백업
    │
    ├── views/                      # 🎨 [영역 2: 프론트엔드 & UI 뷰]
    │   ├── calendarView.js         # 42칸 달력, 일정 띠지, 선택일 일정 뷰
    │   ├── mealView.js             # 급식 카드, 메뉴별 아이콘 자동 매핑
    │   ├── contactView.js          # 연락망 카드, 한글 초성 검색, 전화 걸기
    │   ├── noticeView.js           # 상단 공지 배너 & 누적 공지 타임라인
    │   ├── settingsView.js         # 설정 탭 폼 제어 및 관리자 UI 토글
    │   └── modalView.js            # 일정/연락처/공지 등록·수정 모달창
    │
    └── utils/                      # 🛠️ [공통 유틸리티]
        └── helpers.js              # 초성 추출, XSS 방지, linkify, 날짜 포맷
```

---

## ⚙️ [영역 1] 백엔드 & 데이터 서비스 구축 단계 (Back-end Layer) - 최우선 진행

백엔드 계층은 UI와 완전히 분리되어 데이터 연동, 보안 인증, 외부 API 통신, 로컬/클라우드 스토리지를 전담합니다.

### 💬 대화 세션 1: [Step 1] 공통 유틸리티 및 코어 상태 관리자 구축
* **핵심 파일**: 
  - [`src/utils/helpers.js`](file:///c:/Users/qzwxe/OneDrive/Desktop/antigravity%20project/haksaa/Hdhaksaa/src/utils/helpers.js)
  - [`src/core/state.js`](file:///c:/Users/qzwxe/OneDrive/Desktop/antigravity%20project/haksaa/Hdhaksaa/src/core/state.js)
* **주요 구현 내용**:
  - `getChoseung`: 한글 자음/초성(ㄱ~ㅎ) 분리 및 검색 추출 엔진
  - `escapeHTML` & `linkify`: XSS 공격 방어 및 URL(http/https/www) 자동 하이퍼링크 변환
  - `formatDate`: 날짜 객체를 `YYYY-MM-DD` 표준 문자열로 포맷팅
  - `state.js`: 날짜, 일정 목록, 급식 캐시, 권한 플래그(`isAdmin`, `isStaffAuthenticated`) 등을 중앙에서 일괄 관리하는 싱글톤 상태 객체 선언
* **검증 기준**: 유틸리티 함수 단위 테스트 및 초기 전역 상태 정상 로드 확인.

---

### 💬 대화 세션 2: [Step 2] 보안 인증 및 로컬 스토리지 서비스 구축
* **핵심 파일**: 
  - [`src/services/authService.js`](file:///c:/Users/qzwxe/OneDrive/Desktop/antigravity%20project/haksaa/Hdhaksaa/src/services/authService.js)
  - [`src/services/storageService.js`](file:///c:/Users/qzwxe/OneDrive/Desktop/antigravity%20project/haksaa/Hdhaksaa/src/services/storageService.js)
* **주요 구현 내용**:
  - `authService.js`:
    - 인앱 브라우저(카카오톡/네이버 등) 감지 및 외부 브라우저 전환 오버레이 제어
    - 교직원 코드(`31535372`), 관리자 비밀번호(`023153`), 비상연락망 PIN(`3153`) 검증
    - 세션 로그인 유지 및 관리자 로그아웃 처리
  - `storageService.js`:
    - `localStorage` 기반 일정, 연락처, 공지사항 로드/저장
    - 사용자가 지정한 날짜별 개인 일정 순서(`teacherschedule_local_orders`) 저장 및 스왑(`changeEventOrder`) 기능
* **검증 기준**: 암호 검증 로직 및 로컬 스토리지 입출력 정상 작동 확인.

---

### 💬 대화 세션 3: [Step 3] 나이스(NEIS) 공식 API 연동 서비스 구축
* **핵심 파일**: 
  - [`src/services/neisService.js`](file:///c:/Users/qzwxe/OneDrive/Desktop/antigravity%20project/haksaa/Hdhaksaa/src/services/neisService.js)
* **주요 구현 내용**:
  - `syncNeisSchedule`: 나이스 학사일정 Open API(`SchoolSchedule`) 호출 및 연간 일정 파싱
  - `fetchMonthMeals`: 나이스 급식 Open API(`mealServiceDietInfo`) 호출, 중식 메뉴/칼로리/원산지/알레르기 파싱
  - **비용 0원 최적화**: 급식 데이터를 `teacherschedule_meals_YYYY-MM` 키로 브라우저 로컬에 월별 캐싱하여 파이어베이스 할당량 소모 0회 달성
  - 네트워크 단절 또는 API 장애 시 안전한 백그라운드 모의 데이터(`simulateNeisSync`) 자동 폴백
* **검증 기준**: 나이스 학사일정 및 급식 API 정상 통신 및 월별 캐싱 확인.

---

### 💬 대화 세션 4: [Step 4] 파이어베이스 실시간 DB & 외부 파일 임포터 구축
* **핵심 파일**: 
  - [`src/services/firebaseService.js`](file:///c:/Users/qzwxe/OneDrive/Desktop/antigravity%20project/haksaa/Hdhaksaa/src/services/firebaseService.js)
  - [`src/services/importExportService.js`](file:///c:/Users/qzwxe/OneDrive/Desktop/antigravity%20project/haksaa/Hdhaksaa/src/services/importExportService.js)
* **주요 구현 내용**:
  - `firebaseService.js`:
    - Cloud Firestore 초기화 및 `schedules`, `contacts`, `notices`, `settings` 실시간 구독(`onSnapshot`)
    - 대량 동기화 시 Snapshot Storm 방지 락(`isSyncing`) 및 Firestore 공백 시 자동 마이그레이션
  - `importExportService.js`:
    - 구글 스프레드시트 공유 링크 CSV 파싱 (CORS 프록시 폴백 포함)
    - CSV/JSON 드래그 앤 드롭 파일 파서 및 CSV 템플릿 다운로드
    - 전체 데이터 JSON 백업 파일 생성 및 팩토리 리셋
* **검증 기준**: Firestore 실시간 데이터 바인딩 및 구글시트/CSV 파싱 정상 작동 확인.

---

## 🎨 [영역 2] 프론트엔드 & UI 뷰 계층 (Front-end Layer) - 후순위 진행

프론트엔드 계층은 백엔드 서비스에서 가공된 데이터를 전달받아 화면을 그리고, 사용자 터치 및 모달 상호작용을 처리합니다.

### 💬 대화 세션 5: [Step 5] 달력 및 선택일 일정 뷰 컴포넌트 구축
* **핵심 파일**: 
  - [`src/views/calendarView.js`](file:///c:/Users/qzwxe/OneDrive/Desktop/antigravity%20project/haksaa/Hdhaksaa/src/views/calendarView.js)
* **주요 구현 내용**:
  - 42칸 표준 월간 달력 렌더링 (이전/다음 달 패딩, 오늘 및 선택일 하이라이트)
  - 카테고리별 필터(전체, 공식 학사일정, 학교 내부일정) 및 일정 띠지(Pill) 최대 2개 표기
  - 하단 선택일 일정 리스트 렌더링 및 모바일 최적화 위/아래 순서 변경 화살표 버튼 연동
* **검증 기준**: 달력 월 이동, 날짜 클릭, 필터 버튼 및 순서 변경 UI 검증.

---

### 💬 대화 세션 6: [Step 6] 급식 식단 및 교직원 비상연락망 뷰 구축
* **핵심 파일**: 
  - [`src/views/mealView.js`](file:///c:/Users/qzwxe/OneDrive/Desktop/antigravity%20project/haksaa/Hdhaksaa/src/views/mealView.js)
  - [`src/views/contactView.js`](file:///c:/Users/qzwxe/OneDrive/Desktop/antigravity%20project/haksaa/Hdhaksaa/src/views/contactView.js)
* **주요 구현 내용**:
  - `mealView.js`:
    - 이전/다음 날짜 탐색 및 캘린더 네이티브 DatePicker를 통한 특정 일자 급식 조회
    - 메뉴 텍스트에 따른 자동 아이콘 매핑 (밥, 국/찌개, 김치, 고기, 음료/유제품 등)
    - 총 칼로리, 원산지, 알레르기 유발 성분 분리 표시
  - `contactView.js`:
    - 2차 보안 PIN 인증 게이트 UI 제어
    - 교직원 카드 그리드 렌더링, 'ㄱㅈㄷ' 실시간 초성 검색 필터링
    - 개인정보 보호를 위한 번호 텍스트 숨김 및 원터치 전화 걸기(`tel:`) 버튼 연동
* **검증 기준**: 급식 날짜 이동/메뉴 렌더링 및 연락망 초성 검색/PIN 인증 검증.

---

### 💬 대화 세션 7: [Step 7] 공지사항, 설정, 팝업 모달 제어 뷰 구축
* **핵심 파일**: 
  - [`src/views/noticeView.js`](file:///c:/Users/qzwxe/OneDrive/Desktop/antigravity%20project/haksaa/Hdhaksaa/src/views/noticeView.js)
  - [`src/views/settingsView.js`](file:///c:/Users/qzwxe/OneDrive/Desktop/antigravity%20project/haksaa/Hdhaksaa/src/views/settingsView.js)
  - [`src/views/modalView.js`](file:///c:/Users/qzwxe/OneDrive/Desktop/antigravity%20project/haksaa/Hdhaksaa/src/views/modalView.js)
* **주요 구현 내용**:
  - `noticeView.js`: 메인 상단 롤링 공지 배너 및 공지사항 탭 누적 게시판 피드 렌더링
  - `settingsView.js`: 관리자 권한 상태 배지, 설정 폼 동기화 및 `admin-only` 요소 동적 토글
  - `modalView.js`: 일정 등록/수정, 연락처 등록/수정, 공지사항 작성 모달의 오픈/클로즈 및 폼 유효성 검사
* **검증 기준**: 공지사항 배너/피드 렌더링 및 각 모달 팝업 동작 확인.

---

## 🚀 [영역 3] 메인 오케스트레이션 및 통합 검증 단계

### 💬 대화 세션 8: [Step 8] 메인 진입점 연결 및 전체 기능 무결성 검증
* **핵심 파일**: 
  - [`src/main.js`](file:///c:/Users/qzwxe/OneDrive/Desktop/antigravity%20project/haksaa/Hdhaksaa/src/main.js)
  - [`index.html`](file:///c:/Users/qzwxe/OneDrive/Desktop/antigravity%20project/haksaa/Hdhaksaa/index.html)
  - [`service-worker.js`](file:///c:/Users/qzwxe/OneDrive/Desktop/antigravity%20project/haksaa/Hdhaksaa/service-worker.js)
* **주요 구현 내용**:
  - `main.js`: 모든 서비스 및 뷰 모듈을 import하여 초기화 시퀀스 실행 (보안 게이트 체크, 로컬 데이터 적재, Firebase 연결, 뷰 렌더링, 탭 내비게이션 이벤트 바인딩)
  - `index.html`: `<script type="module" src="src/main.js"></script>`로 전환
  - `service-worker.js`: 모듈화된 새 자산 경로(`src/**`)를 오프라인 캐시 목록에 등록
  - 기존 2,450줄짜리 레거시 `app.js`를 깔끔하게 교체 완료
* **검증 기준**:
  1. 교직원(31535372) / 관리자(023153) / 연락망 PIN(3153) 정상 인증
  2. 달력 일정 조회 및 CRUD 정상 작동
  3. 급식 식단 실시간 조회 및 아이콘 표기 정상
  4. 연락망 초성 검색 및 통화 링크 작동
  5. Firebase 실시간 동기화 및 PWA 오프라인 캐싱 완벽 작동
