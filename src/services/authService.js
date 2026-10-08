/* ==========================================================================
   services/authService.js
   - 교직원/관리자/비상연락망 보안 인증을 전담하는 서비스 모듈
   - state.js의 전역 state와 인증 코드 상수만을 참조하며, DOM 접근은
     보안 게이트(#security-gate) 표시/숨김 제어에 한해 최소한으로 수행한다
   ========================================================================== */

import { state, ADMIN_PASSCODE, STAFF_PASSCODE, CONTACT_PIN_CODE } from '../core/state.js';

// ------------------------------------------------------------------
// 인증 관련 localStorage 키
// ------------------------------------------------------------------
export const AUTH_STORAGE_KEYS = {
    STAFF: 'teacherschedule_staff_authenticated',
    ADMIN: 'teacherschedule_admin_auth'
};

/**
 * 현재 브라우저가 카카오톡/네이버/인스타그램/라인/페이스북 등 인앱(In-App) 브라우저인지 감지한다.
 * 인앱 브라우저는 보안 정책상 일부 기능(파일 다운로드, 팝업 등)이 제한되므로
 * 외부 브라우저로의 전환을 유도하는 오버레이 노출 여부를 판단하는 데 사용한다.
 * @returns {boolean} 인앱 브라우저 여부
 */
export function isInAppBrowser() {
    const ua = navigator.userAgent.toLowerCase();
    const inAppPatterns = ['kakaotalk', 'naver', 'instagram', 'line/', 'fban', 'fbav'];
    return inAppPatterns.some((pattern) => ua.includes(pattern));
}

/**
 * 교직원 보안 인증 게이트(#security-gate)의 노출 상태를 판단하고 UI를 갱신한다.
 * localStorage에 교직원 인증 기록이 있거나 이미 관리자 권한(state.isAdmin)이 있다면
 * 게이트를 fade-out 처리해 통과시키고, 그렇지 않으면 게이트를 다시 노출한다.
 * @returns {boolean} 최종 교직원 인증 통과 여부 (state.isStaffAuthenticated와 동일)
 */
export function checkSecurityGate() {
    let isAuth = false;
    try {
        isAuth = localStorage.getItem(AUTH_STORAGE_KEYS.STAFF) === 'true';
    } catch (e) {
        console.warn('보안 인증 상태 조회 실패:', e);
    }

    const securityGate = document.getElementById('security-gate');

    if (isAuth || state.isAdmin) {
        state.isStaffAuthenticated = true;
        if (securityGate) securityGate.classList.add('fade-out');
    } else {
        state.isStaffAuthenticated = false;
        if (securityGate) securityGate.classList.remove('fade-out');
    }

    return state.isStaffAuthenticated;
}

/**
 * 보안 게이트에 입력된 코드를 교직원/관리자 비밀번호와 대조해 인증을 처리한다.
 * 관리자 비밀번호를 입력한 경우 교직원 인증과 관리자 권한을 동시에 부여한다.
 * @param {string} code - 사용자가 입력한 인증 코드
 * @returns {{success: boolean, isAdmin: boolean}} 인증 성공 여부와 관리자 권한 부여 여부
 */
export function verifySecurityCode(code) {
    const value = (code || '').trim();

    if (value === STAFF_PASSCODE) {
        state.isStaffAuthenticated = true;
        try {
            localStorage.setItem(AUTH_STORAGE_KEYS.STAFF, 'true');
        } catch (e) {
            console.warn('교직원 인증 정보 저장 실패:', e);
        }
        return { success: true, isAdmin: false };
    }

    if (value === ADMIN_PASSCODE) {
        state.isStaffAuthenticated = true;
        state.isAdmin = true;
        try {
            localStorage.setItem(AUTH_STORAGE_KEYS.STAFF, 'true');
            localStorage.setItem(AUTH_STORAGE_KEYS.ADMIN, 'true');
        } catch (e) {
            console.warn('관리자 인증 정보 저장 실패:', e);
        }
        return { success: true, isAdmin: true };
    }

    return { success: false, isAdmin: false };
}

/**
 * 비상연락망 2차 보안 PIN을 검증한다.
 * @param {string} pin - 사용자가 입력한 PIN 번호
 * @returns {boolean} PIN 인증 성공 여부
 */
export function verifyContactsPin(pin) {
    const value = (pin || '').trim();
    if (value !== CONTACT_PIN_CODE) return false;

    state.isContactsAuthenticated = true;
    return true;
}

/**
 * 설정 화면 등에서 별도로 관리자 비밀번호를 검증해 관리자 권한을 부여한다.
 * @param {string} passcode - 사용자가 입력한 관리자 비밀번호
 * @returns {boolean} 관리자 인증 성공 여부
 */
export function verifyAdminPasscode(passcode) {
    const value = (passcode || '').trim();
    if (value !== ADMIN_PASSCODE) return false;

    state.isAdmin = true;
    try {
        localStorage.setItem(AUTH_STORAGE_KEYS.ADMIN, 'true');
    } catch (e) {
        console.warn('관리자 인증 정보 저장 실패:', e);
    }
    return true;
}

/**
 * localStorage에 저장된 관리자 로그인 세션이 있는지 확인하고 state.isAdmin에 반영한다.
 * 앱 최초 로드 시 세션 유지를 위해 호출한다.
 * @returns {boolean} 관리자 세션 유지 여부
 */
export function checkAdminSession() {
    let adminSession = null;
    try {
        adminSession = localStorage.getItem(AUTH_STORAGE_KEYS.ADMIN);
    } catch (e) {
        console.warn('관리자 세션 조회 실패:', e);
    }

    if (adminSession === 'true') {
        state.isAdmin = true;
    }

    return state.isAdmin;
}

/**
 * 관리자 권한을 해제하고 저장된 관리자 세션을 삭제한다.
 */
export function logoutAdmin() {
    state.isAdmin = false;
    try {
        localStorage.removeItem(AUTH_STORAGE_KEYS.ADMIN);
    } catch (e) {
        console.warn('관리자 세션 삭제 실패:', e);
    }
}

/**
 * 비상연락망 2차 인증 상태를 초기화(잠금)한다.
 * 연락망 탭을 벗어나거나 다시 잠글 때 호출한다.
 */
export function lockContacts() {
    state.isContactsAuthenticated = false;
}
