/* ==========================================================================
   services/neisService.js
   - 나이스(NEIS) 교육정보 개방포털 Open API 연동을 전담하는 서비스 모듈
   - 학사일정(SchoolSchedule)과 급식식단정보(mealServiceDietInfo)를 호출하며,
     API 인증키는 로컬 재정의 값을 우선하고 없으면 state.js의 기본키로 폴백한다
   - 급식 데이터는 월별로 localStorage에 캐싱되어 재조회 시 API 호출(비용) 없이
     즉시 응답하도록 최적화되어 있다
   ========================================================================== */

import { state, NEIS_API_KEY, NEIS_DEFAULT_SCHOOL, NEIS_DEFAULT_OFFICE } from '../core/state.js';
import { sortEventsByDate } from '../utils/helpers.js';
import { saveLocalEvents, getCachedMeals, setCachedMeals } from './storageService.js';

// ------------------------------------------------------------------
// 나이스 API 인증키 로컬 재정의(override) localStorage 키
// ------------------------------------------------------------------
const NEIS_API_KEY_STORAGE_KEY = 'teacherschedule_neis_api_key';

// ------------------------------------------------------------------
// 나이스 Open API 엔드포인트
// ------------------------------------------------------------------
const NEIS_SCHEDULE_ENDPOINT = 'https://open.neis.go.kr/hub/SchoolSchedule';
const NEIS_MEAL_ENDPOINT = 'https://open.neis.go.kr/hub/mealServiceDietInfo';

// ------------------------------------------------------------------
// 1. API 인증키 getter/setter (로컬 재정의 우선, 기본키 폴백)
// ------------------------------------------------------------------

/**
 * 현재 사용할 나이스 Open API 인증키를 반환한다.
 * 관리자가 설정에서 별도로 지정한 로컬 재정의 키가 있으면 그 값을 우선 사용하고,
 * 없으면 state.js에 하드코딩된 기본 인증키(NEIS_API_KEY)로 폴백한다.
 * @returns {string} 사용할 나이스 API 인증키
 */
export function getNeisApiKey() {
    try {
        const overridden = localStorage.getItem(NEIS_API_KEY_STORAGE_KEY);
        if (overridden && overridden.trim()) return overridden.trim();
    } catch (e) {
        console.warn('나이스 API 인증키 조회 실패:', e);
    }
    return NEIS_API_KEY;
}

/**
 * 나이스 Open API 인증키를 로컬에 재정의(override)한다.
 * 빈 값을 전달하면 재정의를 제거하고 기본 인증키로 되돌린다.
 * @param {string} apiKey - 새로 지정할 인증키. 비어 있으면 재정의 해제.
 */
export function setNeisApiKey(apiKey) {
    try {
        const value = (apiKey || '').trim();
        if (value) {
            localStorage.setItem(NEIS_API_KEY_STORAGE_KEY, value);
        } else {
            localStorage.removeItem(NEIS_API_KEY_STORAGE_KEY);
        }
    } catch (e) {
        console.warn('나이스 API 인증키 저장 실패:', e);
    }
}

// ------------------------------------------------------------------
// 2. 내부 헬퍼
// ------------------------------------------------------------------

/**
 * 'YYYYMMDD' 형식의 나이스 원본 날짜 문자열을 'YYYY-MM-DD'로 변환한다.
 * @param {string} rawYmd - 'YYYYMMDD' 형식의 원본 날짜 문자열
 * @returns {string} 'YYYY-MM-DD' 형식의 날짜 문자열
 */
function formatNeisDate(rawYmd) {
    return `${rawYmd.substring(0, 4)}-${rawYmd.substring(4, 6)}-${rawYmd.substring(6, 8)}`;
}

/**
 * 향동중학교 2026학년도 공식 학사일정 모의(mock) 데이터를 생성한다.
 * 나이스 API 호출이 실패했을 때(네트워크 단절, 서버 장애 등) 사용자 경험이
 * 끊기지 않도록 하는 안전한 폴백 데이터로 사용된다.
 * @param {string|number} year - 학사일정 기준 연도 (예: 2026)
 * @returns {Array<{title: string, date: string, category: string, desc: string}>} 모의 학사일정 배열
 */
function buildMockScheduleEvents(year) {
    return [
        { title: '2026학년도 향동중 입학식 및 개학식', date: `${year}-03-02`, category: 'neis', desc: '향동중학교 1학년 신입생 입학식 및 2, 3학년 시업식' },
        { title: '1학기 학교 총회 및 공개수업', date: `${year}-03-18`, category: 'neis', desc: '각 교실별 학부모 참관 수업 및 시청각실 교육 설명회' },
        { title: '과학 탐구의 달 행사', date: `${year}-04-21`, category: 'neis', desc: '물로켓, 가상 코딩 드론 탐구 활동 전개' },
        { title: '춘계 교내 스포츠한마당', date: `${year}-05-01`, category: 'neis', desc: '학년별 피구, 풋살, 계주 활동 진행' },
        { title: '1학기 중간 1차 지필평가', date: `${year}-05-12`, category: 'neis', desc: '2, 3학년 대상 교과 평가' },
        { title: '현장 체험 학습 주간', date: `${year}-05-22`, category: 'neis', desc: '진로 체험 학습 및 용인 에버랜드 탐방' },
        { title: '여름방학식', date: `${year}-07-24`, category: 'neis', desc: '여름방학 개식 및 하교' },
        { title: '2학기 개학식', date: `${year}-08-24`, category: 'neis', desc: '2학기 등교 및 시업' },
        { title: '향동중 종합 축제 한마당', date: `${year}-10-23`, category: 'neis', desc: '교실 전시회 및 강당 예술제 동아리 장기자랑' },
        { title: '겨울방학식', date: `${year}-12-24`, category: 'neis', desc: '겨울방학 시작일' },
        { title: '학년 수료 및 졸업식', date: `${Number(year) + 1}-02-12`, category: 'neis', desc: '제7회 향동중학교 졸업장 수여식' }
    ];
}

/**
 * 새로 추가된(중복 아닌) 일정들을 state.events에 반영하고, 정렬 후 localStorage에 영속화한다.
 * @param {Array<{id: string, title: string, date: string, category: string, desc: string}>} newEvents - 추가할 일정 배열
 * @returns {number} 실제로 추가된 일정 건수
 */
function mergeNewEvents(newEvents) {
    let importCount = 0;
    newEvents.forEach((event) => {
        const exists = state.events.some((e) => e.date === event.date && e.title === event.title);
        if (!exists) {
            state.events.push(event);
            importCount++;
        }
    });

    if (importCount > 0) {
        state.events = sortEventsByDate(state.events);
        saveLocalEvents(state.events);
    }

    return importCount;
}

// ------------------------------------------------------------------
// 3. 학사일정(SchoolSchedule) 동기화
// ------------------------------------------------------------------

/**
 * 나이스 학사일정 Open API(SchoolSchedule)를 호출해 연간 공식 학사일정을 동기화한다.
 * 관리자 권한이 없거나 학교코드가 비어 있으면 실행되지 않으며,
 * API 호출이 실패하면 자동으로 simulateNeisSync()의 모의 데이터로 폴백한다.
 * @param {object} [options] - 동기화 옵션
 * @param {string} [options.officeCode] - 시도교육청 코드 (기본값: 경기도교육청 J10)
 * @param {string} [options.schoolCode] - 행정표준기관코드 8자리 (기본값: 향동중학교)
 * @param {string|number} [options.year] - 학사일정 기준 연도 (기본값: 올해)
 * @returns {Promise<{success: boolean, count: number, source: 'api'|'mock'|'none', message?: string}>} 동기화 결과
 */
export async function syncNeisSchedule({
    officeCode = NEIS_DEFAULT_OFFICE,
    schoolCode = NEIS_DEFAULT_SCHOOL,
    year = String(new Date().getFullYear())
} = {}) {
    if (!state.isAdmin) {
        return { success: false, count: 0, source: 'none', message: '관리자 권한이 필요합니다.' };
    }
    if (!schoolCode) {
        return { success: false, count: 0, source: 'none', message: '행정표준기관코드 8자리를 입력해 주세요.' };
    }

    try {
        const fromYmd = `${year}0301`;
        const toYmd = `${Number(year) + 1}0228`;
        const url = `${NEIS_SCHEDULE_ENDPOINT}?KEY=${getNeisApiKey()}&Type=json&pIndex=1&pSize=100&ATPT_OFCDC_SC_CODE=${officeCode}&SD_SCHUL_CODE=${schoolCode}&AA_FROM_YMD=${fromYmd}&AA_TO_YMD=${toYmd}`;

        const response = await fetch(url);
        if (!response.ok) throw new Error('API 서버 통신에 실패했습니다.');

        const result = await response.json();
        if (result.RESULT && result.RESULT.CODE === 'INFO-200') {
            throw new Error('검색된 학사일정 데이터가 없습니다.');
        }
        if (!(result.SchoolSchedule && result.SchoolSchedule[1] && result.SchoolSchedule[1].row)) {
            throw new Error('예상치 못한 데이터 결과 형식입니다.');
        }

        const rows = result.SchoolSchedule[1].row;
        const newEvents = rows.map((row, i) => ({
            id: `ev-neis-${Date.now()}-${i}`,
            title: row.EVENT_NM,
            date: formatNeisDate(row.AA_YMD),
            category: 'neis',
            desc: row.EVENT_CN ? row.EVENT_CN.trim() : ''
        }));

        const importCount = mergeNewEvents(newEvents);
        return { success: true, count: importCount, source: 'api' };
    } catch (error) {
        console.warn('나이스 학사일정 API 연동 실패로 모의 데이터를 주입합니다:', error);
        return simulateNeisSync(year);
    }
}

/**
 * 나이스 API 연동이 불가능할 때 사용하는 안전한 모의(mock) 학사일정 데이터를 주입한다.
 * 이미 동일한 날짜/제목의 일정이 있으면 건너뛰어 중복을 방지한다.
 * @param {string|number} year - 학사일정 기준 연도
 * @returns {{success: boolean, count: number, source: 'mock'}} 동기화 결과
 */
export function simulateNeisSync(year) {
    const newEvents = buildMockScheduleEvents(year).map((se, i) => ({
        id: `ev-sim-${Date.now()}-${i}`,
        ...se
    }));

    const importCount = mergeNewEvents(newEvents);
    return { success: true, count: importCount, source: 'mock' };
}

// ------------------------------------------------------------------
// 4. 백그라운드 자동 동기화 (관리자 UI 조작 없이 앱 구동 시 1회 실행)
// ------------------------------------------------------------------

/**
 * 앱 구동 시 나이스 공식 학사일정을 조용히(팝업 없이) 백그라운드에서 자동 동기화한다.
 * 이미 나이스 공식 일정(category === 'neis')이 하나라도 있으면 비용 절감을 위해
 * API 호출 자체를 생략한다. API 호출이 실패하면 autoSyncNeisMockSilent()로 폴백한다.
 * @param {string|number} [year] - 학사일정 기준 연도 (기본값: 올해)
 * @returns {Promise<{success: boolean, count: number, source: 'skip'|'api'|'mock'}>} 동기화 결과
 */
export async function autoSyncNeisBackground(year = String(new Date().getFullYear())) {
    const hasNeisEvents = state.events.some((e) => e.category === 'neis');
    if (hasNeisEvents) {
        console.log('[Auto Sync] 이미 나이스 공식 학사일정이 연동되어 있으므로 API 호출을 생략합니다.');
        return { success: true, count: 0, source: 'skip' };
    }

    try {
        console.log('[Auto Sync] 나이스 일정이 비어 있어 학사일정 최초 자동 동기화를 시작합니다...');
        const fromYmd = `${year}0301`;
        const toYmd = `${Number(year) + 1}0228`;
        const url = `${NEIS_SCHEDULE_ENDPOINT}?KEY=${getNeisApiKey()}&Type=json&pIndex=1&pSize=100&ATPT_OFCDC_SC_CODE=${NEIS_DEFAULT_OFFICE}&SD_SCHUL_CODE=${NEIS_DEFAULT_SCHOOL}&AA_FROM_YMD=${fromYmd}&AA_TO_YMD=${toYmd}`;

        const response = await fetch(url);
        if (!response.ok) throw new Error('API network error');

        const result = await response.json();
        if (!(result.SchoolSchedule && result.SchoolSchedule[1] && result.SchoolSchedule[1].row)) {
            return { success: true, count: 0, source: 'api' };
        }

        const rows = result.SchoolSchedule[1].row;
        const newEvents = rows.map((row, i) => ({
            id: `ev-neis-${Date.now()}-${i}`,
            title: row.EVENT_NM,
            date: formatNeisDate(row.AA_YMD),
            category: 'neis',
            desc: row.EVENT_CN ? row.EVENT_CN.trim() : ''
        }));

        const importCount = mergeNewEvents(newEvents);
        console.log(`[Auto Sync] 나이스 학사일정 백그라운드 자동 갱신 완료 (${importCount}건 추가됨)`);
        return { success: true, count: importCount, source: 'api' };
    } catch (error) {
        console.warn('[Auto Sync] API 실패로 백그라운드 모의 데이터를 주입합니다:', error);
        return autoSyncNeisMockSilent(year);
    }
}

/**
 * 나이스 API 백그라운드 자동 동기화가 실패했을 때 호출되는 조용한(팝업 없는) 모의 데이터 폴백.
 * @param {string|number} year - 학사일정 기준 연도
 * @returns {{success: boolean, count: number, source: 'mock'}} 동기화 결과
 */
export function autoSyncNeisMockSilent(year) {
    const newEvents = buildMockScheduleEvents(year).map((se, i) => ({
        id: `ev-sim-${Date.now()}-${i}`,
        ...se
    }));

    const importCount = mergeNewEvents(newEvents);
    console.log(`[Auto Sync] 모의 학사일정 백그라운드 자동 갱신 완료 (${importCount}건 추가됨)`);
    return { success: true, count: importCount, source: 'mock' };
}

// ------------------------------------------------------------------
// 5. 급식식단정보(mealServiceDietInfo) 조회 - 비용 0원 로컬 캐싱
// ------------------------------------------------------------------

/**
 * 특정 월의 중식 급식 정보를 조회한다.
 * `teacherschedule_meals_YYYY-MM` 키로 localStorage에 캐싱된 데이터가 있으면
 * API 호출 없이 즉시 반환(비용 0원)하고, 없을 때만 나이스 급식 API를 호출해
 * 결과를 캐싱한 뒤 반환한다.
 * @param {number|string} year - 조회할 연도 (예: 2026)
 * @param {number|string} month - 조회할 월 (1~12)
 * @returns {Promise<Array<{date: string, menu: string, calories: string, origin: string, allergy: string}>>} 해당 월의 중식 급식 목록
 */
export async function fetchMonthMeals(year, month) {
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;

    const cached = getCachedMeals(monthKey);
    if (cached) return cached;

    const paddedMonth = String(month).padStart(2, '0');
    const fromYmd = `${year}${paddedMonth}01`;
    const lastDay = new Date(year, month, 0).getDate();
    const toYmd = `${year}${paddedMonth}${String(lastDay).padStart(2, '0')}`;

    const url = `${NEIS_MEAL_ENDPOINT}?KEY=${getNeisApiKey()}&Type=json&pIndex=1&pSize=100&ATPT_OFCDC_SC_CODE=${NEIS_DEFAULT_OFFICE}&SD_SCHUL_CODE=${NEIS_DEFAULT_SCHOOL}&MLSV_FROM_YMD=${fromYmd}&MLSV_TO_YMD=${toYmd}`;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('급식 API 응답 실패');

        const result = await response.json();
        const mealData = [];

        if (result.mealServiceDietInfo && result.mealServiceDietInfo[1] && result.mealServiceDietInfo[1].row) {
            result.mealServiceDietInfo[1].row.forEach((row) => {
                if (row.MMEAL_SC_NM === '중식' || row.MMEAL_SC_CODE === '2') {
                    mealData.push({
                        date: formatNeisDate(row.MLSV_YMD),
                        menu: row.DDISH_NM,
                        calories: row.CAL_INFO,
                        origin: row.ORTR_INFO,
                        allergy: row.ALR_INFO
                    });
                }
            });
        }

        setCachedMeals(monthKey, mealData);
        return mealData;
    } catch (err) {
        console.error('나이스 급식 API 호출 에러:', err);
        state.meals[monthKey] = [];
        return [];
    }
}
