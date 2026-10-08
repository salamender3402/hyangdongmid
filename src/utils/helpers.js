/* ==========================================================================
   utils/helpers.js
   - 프로젝트 전역에서 재사용되는 순수 함수(pure function) 모음
   - DOM이나 전역 상태에 의존하지 않는 유틸리티만 이곳에 둔다
   ========================================================================== */

/**
 * 문자열에 포함된 한글 음절을 초성(ㄱ~ㅎ)으로 변환한다.
 * 한글이 아닌 문자(영문, 숫자, 공백 등)는 원문 그대로 유지되어
 * 'ㄱㅈㄷ' 같은 초성 검색어와 일반 텍스트 검색어를 동시에 지원한다.
 * @param {string} str - 변환할 원본 문자열 (예: 이름, 부서명)
 * @returns {string} 초성으로 치환된 문자열
 */
export function getChoseung(str) {
    const cho = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
    let result = "";
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i) - 0xAC00;
        // 완성형 한글 음절 범위(가~힣)인 경우에만 초성 추출, 그 외는 원문 유지
        if (code > -1 && code < 11172) {
            result += cho[Math.floor(code / 588)];
        } else {
            result += str.charAt(i);
        }
    }
    return result;
}

/**
 * HTML 특수문자를 엔티티로 치환하여 XSS(Cross-Site Scripting) 공격을 방어한다.
 * 사용자 입력(일정 제목, 설명, 연락처 메모 등)을 innerHTML로 렌더링하기 전
 * 반드시 이 함수를 거쳐야 한다.
 * @param {string} str - 이스케이프할 원본 문자열
 * @returns {string} 이스케이프 처리된 안전한 문자열
 */
export function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g,
        (tag) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

/**
 * 일반 텍스트 안의 URL(http://, https://, www.)을 안전한 <a> 태그로 자동 변환한다.
 * 반드시 escapeHTML을 먼저 적용해 XSS를 차단한 뒤 링크 패턴을 치환하므로,
 * 악의적인 스크립트가 링크로 위장해 삽입되는 것을 방지한다.
 * 변환된 링크는 target="_blank" + rel="noopener noreferrer"로 새 탭에서 안전하게 열린다.
 * @param {string} text - 변환할 원본 텍스트 (일정 설명 등)
 * @returns {string} 링크와 줄바꿈이 반영된 안전한 HTML 문자열
 */
export function linkify(text) {
    if (!text) return '';
    // 1. XSS 및 부등호 기호 이스케이프 선처리
    let escaped = escapeHTML(text);

    // 2. 엔터(\n) 줄바꿈을 <br> 태그로 변환 (서식 보존)
    escaped = escaped.replace(/\r?\n/g, '<br>');

    // 3. https:// 또는 http:// URL 자동 인식 및 하이퍼링크 변환
    const urlPattern = /(https?:\/\/[^\s<]+)/g;
    escaped = escaped.replace(urlPattern, (url) => {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="event-desc-link">${url}</a>`;
    });

    // 4. www. 로 시작하는 링크 자동 인식 및 https:// 보정 변환
    const wwwPattern = /(^|[^/])(www\.[^\s<]+)/g;
    escaped = escaped.replace(wwwPattern, (match, p1, p2) => {
        return `${p1}<a href="https://${p2}" target="_blank" rel="noopener noreferrer" class="event-desc-link">${p2}</a>`;
    });

    return escaped;
}

/**
 * Date 객체 또는 날짜 문자열을 'YYYY-MM-DD' 포맷 문자열로 변환한다.
 * toISOString()을 사용하지 않는 이유: UTC로 변환되면서 로컬 자정 근처의 날짜가
 * 하루 밀리는 문제가 발생하므로, 로컬 시간 기준 필드를 직접 조합한다.
 * @param {Date|string} date - 변환할 Date 객체 또는 Date 생성자가 인식 가능한 문자열
 * @returns {string} 'YYYY-MM-DD' 형식의 문자열
 */
export function formatDate(date) {
    const d = date instanceof Date ? date : new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * 'YYYY-MM-DD' 문자열을 로컬 타임존 기준 Date 객체로 파싱한다.
 * new Date('YYYY-MM-DD')는 UTC 자정으로 해석되어 로컬 타임존에 따라
 * 하루 전 날짜로 어긋날 수 있으므로, 연/월/일을 분리해 로컬 생성자로 만든다.
 * @param {string} dateStr - 'YYYY-MM-DD' 형식의 날짜 문자열
 * @returns {Date} 로컬 타임존 기준 Date 객체
 */
export function parseDate(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
}

/**
 * Date 객체의 요일을 한글 한 글자로 반환한다.
 * @param {Date} date - 요일을 조회할 Date 객체
 * @returns {string} '일' | '월' | '화' | '수' | '목' | '금' | '토'
 */
export function getKoreanDay(date) {
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    return dayNames[date.getDay()];
}

/**
 * 설정값 입력(Firebase 연동 정보 등)에서 공백, 따옴표(' "), 쉼표(,)를 모두 제거한다.
 * 사용자가 JSON 스니펫을 복사/붙여넣기 할 때 딸려오는 불필요한 문자를 정리해
 * 순수한 값만 남긴다.
 * @param {string} val - 정제할 원본 입력값
 * @returns {string} 정제된 문자열
 */
export function sanitizeConfig(val) {
    if (!val) return '';
    return val.replace(/[\s'",]/g, '');
}

/**
 * 일정 배열을 date 필드(YYYY-MM-DD) 오름차순으로 정렬한다.
 * 원본 배열을 변경하지 않고 정렬된 새 배열을 반환하는 순수 함수이므로,
 * 호출부에서 state.events = sortEventsByDate(state.events) 형태로 사용한다.
 * @param {Array<{date?: string}>} events - 정렬할 일정 배열
 * @returns {Array} date 오름차순으로 정렬된 새 배열
 */
export function sortEventsByDate(events) {
    if (!Array.isArray(events)) return events;
    return [...events].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

/**
 * 표준 디바운스(debounce) 함수.
 * 연속 호출 중 마지막 호출로부터 delay(ms)가 지난 뒤에 딱 한 번만 fn을 실행한다.
 * 검색 입력, 리사이즈 등 짧은 간격으로 반복 발생하는 이벤트 처리에 사용한다.
 * @param {Function} fn - 지연 실행할 함수
 * @param {number} delay - 디바운스 지연 시간 (ms)
 * @returns {Function} 디바운스 처리된 함수
 */
export function debounce(fn, delay) {
    let timerId = null;
    return function debounced(...args) {
        clearTimeout(timerId);
        timerId = setTimeout(() => {
            fn.apply(this, args);
        }, delay);
    };
}
