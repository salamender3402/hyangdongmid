/* ==========================================================================
   services/storageService.js
   - localStorage 기반 오프라인/로컬 모드 데이터 영속화를 전담하는 서비스 모듈
   - 일정, 연락처, 공지사항, 개인 정렬 순서, 급식 캐시를 관리한다
   ========================================================================== */

import { state, MOCK_EVENTS, MOCK_CONTACTS } from '../core/state.js';
import { sortEventsByDate } from '../utils/helpers.js';

// ------------------------------------------------------------------
// localStorage 키
// ------------------------------------------------------------------
export const STORAGE_KEYS = {
    EVENTS: 'teacherschedule_events',
    CONTACTS: 'teacherschedule_contacts',
    NOTICE: 'teacherschedule_notice',
    NOTICES: 'teacherschedule_notices',
    LOCAL_ORDERS: 'teacherschedule_local_orders',
    GSHEET_URL: 'teacherschedule_gsheet_url',
    FIREBASE_CONFIG: 'teacherschedule_firebase_config',
    MEALS_PREFIX: 'teacherschedule_meals_'
};

/**
 * localStorage에 저장된 일정/연락처/공지/공지목록을 읽어 state에 적재한다.
 * 각 항목은 독립적으로 예외 처리되어 하나가 손상되어도 나머지 로드에 영향을 주지 않는다.
 * 로드 후 일정은 날짜순으로 정렬되고, 정렬 결과가 다시 localStorage에 반영된다.
 */
export function loadLocalStorageData() {
    try {
        const localEvents = localStorage.getItem(STORAGE_KEYS.EVENTS);
        if (localEvents) {
            const parsedEvents = JSON.parse(localEvents);
            parsedEvents.forEach((e) => {
                if (e.desc === '나이스 연동 공식 학사일정') e.desc = '';
            });
            state.events = parsedEvents;
        } else {
            state.events = [...MOCK_EVENTS];
        }
    } catch (e) {
        console.warn('Failed to parse local events:', e);
        state.events = [...MOCK_EVENTS];
    }

    try {
        const localContacts = localStorage.getItem(STORAGE_KEYS.CONTACTS);
        state.contacts = localContacts ? JSON.parse(localContacts) : [...MOCK_CONTACTS];
    } catch (e) {
        console.warn('Failed to parse local contacts:', e);
        state.contacts = [...MOCK_CONTACTS];
    }

    try {
        const localNotice = localStorage.getItem(STORAGE_KEYS.NOTICE);
        if (localNotice) state.notice = JSON.parse(localNotice);
    } catch (e) {
        console.warn('Failed to parse local notice:', e);
    }

    try {
        const localNotices = localStorage.getItem(STORAGE_KEYS.NOTICES);
        state.notices = localNotices ? JSON.parse(localNotices) : [];
    } catch (e) {
        console.warn('Failed to parse local notices:', e);
        state.notices = [];
    }

    state.events = sortEventsByDate(state.events);
    saveLocalEvents(state.events);
    saveLocalContacts(state.contacts);
}

/**
 * 일정 배열을 localStorage에 저장한다.
 * @param {Array} events - 저장할 일정 배열
 */
export function saveLocalEvents(events) {
    try {
        localStorage.setItem(STORAGE_KEYS.EVENTS, JSON.stringify(events));
    } catch (e) {
        console.warn('Failed to save local events:', e);
    }
}

/**
 * 연락처 배열을 localStorage에 저장한다.
 * @param {Array} contacts - 저장할 연락처 배열
 */
export function saveLocalContacts(contacts) {
    try {
        localStorage.setItem(STORAGE_KEYS.CONTACTS, JSON.stringify(contacts));
    } catch (e) {
        console.warn('Failed to save local contacts:', e);
    }
}

/**
 * 상단 롤링 공지사항을 localStorage에 저장한다.
 * @param {{text: string, active: boolean}} notice - 저장할 공지 객체
 */
export function saveLocalNotice(notice) {
    try {
        localStorage.setItem(STORAGE_KEYS.NOTICE, JSON.stringify(notice));
    } catch (e) {
        console.warn('Failed to save local notice:', e);
    }
}

/**
 * 누적 공지사항 게시판 목록을 localStorage에 저장한다.
 * @param {Array} notices - 저장할 공지 목록 배열
 */
export function saveLocalNotices(notices) {
    try {
        localStorage.setItem(STORAGE_KEYS.NOTICES, JSON.stringify(notices));
    } catch (e) {
        console.warn('Failed to save local notices:', e);
    }
}

/**
 * 날짜별 개인 일정 정렬 순서 전체를 조회한다.
 * @returns {Object<string, string[]>} { 'YYYY-MM-DD': [eventId, ...] } 형태의 정렬 맵
 */
export function getLocalOrders() {
    try {
        const localOrders = localStorage.getItem(STORAGE_KEYS.LOCAL_ORDERS);
        return localOrders ? JSON.parse(localOrders) : {};
    } catch (e) {
        console.warn('Failed to parse local orders:', e);
        return {};
    }
}

/**
 * 날짜별 개인 일정 정렬 순서 전체를 localStorage에 저장한다.
 * @param {Object<string, string[]>} orders - 저장할 정렬 맵
 */
export function saveLocalOrders(orders) {
    try {
        localStorage.setItem(STORAGE_KEYS.LOCAL_ORDERS, JSON.stringify(orders));
    } catch (e) {
        console.warn('Failed to save local orders:', e);
    }
}

/**
 * 특정 날짜의 일정 목록에 사용자가 지정한 개인 정렬 순서를 적용한다.
 * 저장된 순서에 없는 일정은 뒤쪽에 그대로 이어붙인다.
 * @param {string} dateString - 'YYYY-MM-DD' 형식의 대상 날짜
 * @param {Array<{id: string}>} eventsToSort - 정렬을 적용할 원본 일정 배열
 * @returns {Array} 개인 정렬 순서가 반영된 일정 배열
 */
export function getLocalSortedEvents(dateString, eventsToSort) {
    const parsedOrders = getLocalOrders();
    const dateOrder = parsedOrders[dateString];
    if (!dateOrder || !Array.isArray(dateOrder)) return eventsToSort;

    const sorted = [];
    const remaining = [...eventsToSort];

    dateOrder.forEach((id) => {
        const index = remaining.findIndex((e) => e.id === id);
        if (index > -1) {
            sorted.push(remaining[index]);
            remaining.splice(index, 1);
        }
    });

    return [...sorted, ...remaining];
}

/**
 * 특정 날짜의 정렬된 일정 목록에서 두 항목의 순서를 교환하고 localStorage에 반영한다.
 * @param {string} dateString - 'YYYY-MM-DD' 형식의 대상 날짜
 * @param {Array<{id: string}>} sortedEvents - 현재 화면에 정렬되어 있는 일정 배열
 * @param {number} currentIdx - 이동할 항목의 현재 인덱스
 * @param {number} direction - 이동 방향 (-1: 위로, 1: 아래로)
 */
export function changeEventOrder(dateString, sortedEvents, currentIdx, direction) {
    const targetIdx = currentIdx + direction;
    if (targetIdx < 0 || targetIdx >= sortedEvents.length) return;

    const orderIds = sortedEvents.map((e) => e.id);
    const temp = orderIds[currentIdx];
    orderIds[currentIdx] = orderIds[targetIdx];
    orderIds[targetIdx] = temp;

    const localOrders = getLocalOrders();
    localOrders[dateString] = orderIds;
    saveLocalOrders(localOrders);
}

/**
 * 특정 월(YYYY-MM)의 캐싱된 급식 데이터를 조회하고 state.meals에 반영한다.
 * @param {string} yearMonth - 'YYYY-MM' 형식의 대상 연월
 * @returns {Array|null} 캐싱된 급식 데이터 배열, 없거나 파싱 실패 시 null
 */
export function getCachedMeals(yearMonth) {
    try {
        const cached = localStorage.getItem(`${STORAGE_KEYS.MEALS_PREFIX}${yearMonth}`);
        if (!cached) return null;

        const mealsData = JSON.parse(cached);
        state.meals[yearMonth] = mealsData;
        return mealsData;
    } catch (e) {
        console.warn('급식 캐시 파싱 실패:', e);
        return null;
    }
}

/**
 * 특정 월(YYYY-MM)의 급식 데이터를 localStorage에 캐싱하고 state.meals에 반영한다.
 * @param {string} yearMonth - 'YYYY-MM' 형식의 대상 연월
 * @param {Array} mealsData - 캐싱할 급식 데이터 배열
 */
export function setCachedMeals(yearMonth, mealsData) {
    try {
        localStorage.setItem(`${STORAGE_KEYS.MEALS_PREFIX}${yearMonth}`, JSON.stringify(mealsData));
    } catch (e) {
        console.warn('급식 캐시 저장 실패:', e);
    }
    state.meals[yearMonth] = mealsData;
}

/**
 * 앱 네임스페이스(teacherschedule_)로 저장된 모든 로컬 데이터를 초기화한다.
 * 일정, 연락처, 공지, 정렬 순서, 급식 캐시, 연동 설정 등이 모두 삭제된다.
 */
export function clearLocalData() {
    try {
        Object.keys(localStorage)
            .filter((key) => key.startsWith('teacherschedule_'))
            .forEach((key) => localStorage.removeItem(key));
    } catch (e) {
        console.warn('로컬 데이터 초기화 실패:', e);
    }
}
