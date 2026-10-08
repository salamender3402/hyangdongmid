/* ==========================================================================
   core/state.js
   - 앱 전역에서 공유되는 상수와 싱글톤 반응형 상태(state) 저장소
   - 모든 서비스/뷰 모듈은 이 파일의 state 객체 하나만을 참조해 데이터를 동기화한다
   ========================================================================== */

// ------------------------------------------------------------------
// 1. 나이스(NEIS) 공식 API 설정 (향동중학교 고정)
// ------------------------------------------------------------------
export const NEIS_API_KEY = 'f98ed0c3e5b346c693f8f931a09603fc';
export const NEIS_DEFAULT_SCHOOL = '7621365'; // 향동중학교
export const NEIS_DEFAULT_OFFICE = 'J10';     // 경기도교육청

// ------------------------------------------------------------------
// 2. 보안 인증 코드
// ------------------------------------------------------------------
export const ADMIN_PASSCODE = '023153';   // 관리자 비밀번호
export const STAFF_PASSCODE = '31535372'; // 교직원 보안 인증 코드
export const CONTACT_PIN_CODE = '3153';   // 비상연락망 2차 PIN 번호

// ------------------------------------------------------------------
// 3. 기본 탑재용 향동중학교 파이어베이스 연동 정보 (하드코딩)
// ------------------------------------------------------------------
export const DEFAULT_FIREBASE_CONFIG = {
    apiKey: 'AIzaSyBz-d2NUBO90_hDFa5gInytcrGw0drYFjE',
    authDomain: 'hyangdong-middleschool-sch.firebaseapp.com',
    projectId: 'hyangdong-middleschool-sch',
    storageBucket: 'hyangdong-middleschool-sch.appspot.com',
    appId: '1:409367451356:web:5f584d150d690aa08dc619'
};

// ------------------------------------------------------------------
// 4. 초기 모의 데이터 (Mock Data) - 시범 배포를 위해 비워둠
// ------------------------------------------------------------------
export const MOCK_EVENTS = [];
export const MOCK_CONTACTS = [];

/**
 * state 초기값을 매번 새로 생성하는 팩토리 함수.
 * 객체/배열 필드를 공유 참조가 아닌 독립된 값으로 만들기 위해
 * resetState()에서도 이 함수를 다시 호출해 사용한다.
 * @returns {object} 초기 상태 객체
 */
function createInitialState() {
    return {
        currentDate: new Date(),      // 달력에 표시 중인 기준 월(月)
        selectedDate: new Date(),     // 달력에서 선택된 날짜
        mealSelectedDate: new Date(), // 급식 조회 전용 날짜 (달력 선택일과 분리)
        activeTab: 'tab-calendar',    // 현재 활성화된 하단 탭
        filterCategory: 'all',        // 일정 필터 카테고리
        events: [],                   // 학사일정 목록
        contacts: [],                 // 비상연락망 목록
        meals: {},                    // 월별 급식 캐싱 { '2026-07': [...] }
        isStaffAuthenticated: false,  // 교직원 보안 인증 여부
        isContactsAuthenticated: false, // 비상연락망 2차 보안 인증 여부
        isAdmin: false,                 // 관리자 권한 여부
        isSyncing: false,               // 대량 파이어베이스 동기화 중 실시간 리스너 무한 루프 방지용 락 플래그
        dbMode: 'local',                // 'local' 또는 'firebase'
        firebaseConfig: null,           // Firebase 연동 정보
        deferredPrompt: null,           // PWA 설치 프롬프트 보관용
        notice: { text: '', active: true }, // 상단 롤링 공지사항
        notices: [],                    // 누적 공지사항 게시판 목록
        firebaseApp: null,              // Firebase App 인스턴스
        db: null,                       // Firestore DB 인스턴스
        unsubscribeEvents: null,        // events 실시간 구독 해제 함수
        unsubscribeContacts: null       // contacts 실시간 구독 해제 함수
    };
}

// state 변경을 감지하는 구독자(listener) 목록
const listeners = new Set();

/**
 * 등록된 모든 구독자에게 상태 변경을 알린다.
 * @param {string} key - 변경된 상태 필드명
 * @param {*} value - 변경된 값
 */
function notify(key, value) {
    listeners.forEach((listener) => listener(key, value, state));
}

/**
 * 전역 싱글톤 반응형 상태 객체.
 * Proxy를 통해 필드가 변경(state.xxx = yyy)될 때마다 구독자에게 자동으로 통지되므로,
 * 뷰 모듈은 subscribeState()로 변경을 감지해 화면을 다시 그릴 수 있다.
 */
export const state = new Proxy(createInitialState(), {
    set(target, key, value) {
        target[key] = value;
        notify(key, value);
        return true;
    }
});

/**
 * state 변경을 구독한다.
 * @param {(key: string, value: *, state: object) => void} listener - 상태 변경 시 호출될 콜백
 * @returns {() => void} 구독을 해제하는 함수
 */
export function subscribeState(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/**
 * 여러 state 필드를 한 번에 갱신한다.
 * @param {object} patch - { 필드명: 새 값 } 형태의 부분 갱신 객체
 */
export function updateState(patch) {
    Object.entries(patch).forEach(([key, value]) => {
        state[key] = value;
    });
}

/**
 * state를 앱 최초 실행 시의 초기값으로 되돌린다.
 * (로그아웃, 팩토리 리셋 등에서 사용)
 */
export function resetState() {
    updateState(createInitialState());
}
