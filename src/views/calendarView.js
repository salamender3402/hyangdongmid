/* ==========================================================================
   views/calendarView.js
   - 월간 42칸 달력 렌더링과 선택일 상세 일정 리스트를 담당하는 프론트엔드 뷰 모듈
   - 카테고리 필터링, 날짜 선택, 일정 개인 순서 변경(위/아래 화살표) 상호작용을 처리한다
   ========================================================================== */

import { state, subscribeState } from '../core/state.js';
import { formatDate, escapeHTML, linkify, getKoreanDay } from '../utils/helpers.js';
import { getLocalSortedEvents, changeEventOrder } from '../services/storageService.js';

// 일정 카테고리별 상세 리스트 뱃지 표기 텍스트
const CATEGORY_BADGE_LABELS = {
    neis: '공식',
    internal: '내부',
    meeting: '내부',
    study: '내부',
    etc: '내부'
};

/**
 * 현재 state.filterCategory 값에 따라 일정 배열을 필터링한다.
 * 'all'은 전체, 'internal'은 나이스(neis) 공식 일정을 제외한 내부 일정,
 * 그 외 값은 해당 카테고리와 정확히 일치하는 일정만 반환한다.
 * @param {Array} events - 필터링할 원본 일정 배열
 * @returns {Array} 필터링된 일정 배열
 */
function filterEventsByCategory(events) {
    if (state.filterCategory === 'all') return events;
    if (state.filterCategory === 'internal') return events.filter((e) => e.category !== 'neis');
    return events.filter((e) => e.category === state.filterCategory);
}

/**
 * 일정 상세 모달을 안전하게 호출한다.
 * modalView 모듈이 아직 로드되지 않았거나 전역에 노출되지 않은 경우에도
 * 에러 없이 무시되도록 존재 여부를 확인한 뒤 호출한다.
 * @param {object} eventObj - 상세 화면에 표시할 일정 객체
 */
function safeShowEventDetail(eventObj) {
    try {
        if (typeof showEventDetail === 'function') {
            showEventDetail(eventObj);
            return;
        }
    } catch (e) {
        // showEventDetail 참조 자체가 없는 환경(브라우저 module scope)에서는 무시하고 폴백 진행
    }

    if (typeof window !== 'undefined' && typeof window.showEventDetail === 'function') {
        try {
            window.showEventDetail(eventObj);
        } catch (e) {
            console.error('[calendarView] showEventDetail 호출 중 오류:', e);
        }
    } else {
        console.warn('[calendarView] showEventDetail 핸들러를 찾을 수 없습니다.');
    }
}

/**
 * 현재 state.currentDate 기준 월의 42칸(6주 x 7일) 달력 그리드와
 * 연월 제목(#calendar-title)을 렌더링한다. 이전/다음 달 날짜는 패딩으로 채워진다.
 */
export function renderCalendar() {
    const calendarDays = document.getElementById('calendar-days');
    const calendarTitle = document.getElementById('calendar-title');

    if (!calendarDays || !calendarTitle) return;

    calendarDays.innerHTML = '';

    const year = state.currentDate.getFullYear();
    const month = state.currentDate.getMonth();

    calendarTitle.innerText = `${year}년 ${month + 1}월`;

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const prevLastDay = new Date(year, month, 0);

    const startDayIndex = firstDay.getDay();
    const totalDays = lastDay.getDate();
    const prevTotalDays = prevLastDay.getDate();

    // 지난 달 날짜 패딩
    for (let i = startDayIndex - 1; i >= 0; i--) {
        const dayNum = prevTotalDays - i;
        createDayCell(new Date(year, month - 1, dayNum), true);
    }

    // 이번 달 날짜
    for (let i = 1; i <= totalDays; i++) {
        createDayCell(new Date(year, month, i), false);
    }

    // 다음 달 날짜 패딩 (42칸 기준 맞춤)
    const currentCellsCount = startDayIndex + totalDays;
    const nextPaddingCount = (currentCellsCount % 7 === 0) ? 0 : 7 - (currentCellsCount % 7);
    const totalCells = currentCellsCount + nextPaddingCount;
    const finalPaddingCount = nextPaddingCount + (42 - totalCells);

    for (let i = 1; i <= finalPaddingCount; i++) {
        createDayCell(new Date(year, month + 1, i), true);
    }
}

/**
 * 달력의 개별 날짜 셀 하나를 생성해 #calendar-days에 추가한다.
 * 오늘/선택일/일요일/토요일 강조, 최대 2개 일정 띠지, '+N' 더보기 표시를 담당하며
 * 클릭 시 해당 날짜를 선택하고 달력과 상세 리스트를 다시 렌더링한다.
 * @param {Date} date - 셀에 표시할 날짜
 * @param {boolean} isOtherMonth - 현재 표시 중인 월과 다른 달(패딩)인지 여부
 * @returns {HTMLElement|undefined} 생성된 셀 엘리먼트 (컨테이너가 없으면 undefined)
 */
export function createDayCell(date, isOtherMonth) {
    const calendarDays = document.getElementById('calendar-days');
    if (!calendarDays) return undefined;

    const dateString = formatDate(date);

    const cell = document.createElement('div');
    cell.className = 'day-cell';
    if (isOtherMonth) cell.classList.add('other-month');

    const today = new Date();
    if (date.getFullYear() === today.getFullYear() &&
        date.getMonth() === today.getMonth() &&
        date.getDate() === today.getDate()) {
        cell.classList.add('today');
    }

    if (dateString === formatDate(state.selectedDate)) {
        cell.classList.add('selected');
    }

    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0) cell.classList.add('sun');
    if (dayOfWeek === 6) cell.classList.add('sat');

    const numberSpan = document.createElement('span');
    numberSpan.className = 'day-number';
    numberSpan.innerText = date.getDate();
    cell.appendChild(numberSpan);

    const dayEvents = (Array.isArray(state.events) ? state.events : []).filter((e) => e.date === dateString);
    const filteredDayEvents = filterEventsByCategory(dayEvents);

    // 로컬 사용자 정렬 우선순위 적용
    const sortedDayEvents = getLocalSortedEvents(dateString, filteredDayEvents);

    // 최대 2개의 일정만 띠지(Pill) 형태로 렌더링
    sortedDayEvents.slice(0, 2).forEach((e) => {
        const pill = document.createElement('div');
        pill.className = `calendar-event-pill category-${e.category}`;
        pill.innerText = e.title;
        cell.appendChild(pill);
    });

    // 3개 이상 등록된 경우 '+N' 더보기 텍스트 노출
    if (filteredDayEvents.length > 2) {
        const more = document.createElement('div');
        more.className = 'event-more-indicator';
        more.innerText = `+${filteredDayEvents.length - 2}`;
        cell.appendChild(more);
    }

    cell.addEventListener('click', () => {
        state.selectedDate = new Date(date);
        if (date.getMonth() !== state.currentDate.getMonth()) {
            state.currentDate = new Date(date.getFullYear(), date.getMonth(), 1);
        }
        renderCalendar();
        renderDayEvents();
    });

    calendarDays.appendChild(cell);
    return cell;
}

/**
 * 선택일 제목(#selected-date-str)과 상세 일정 리스트(#day-events-list)를 렌더링한다.
 * 일정이 없으면 빈 상태 메시지를, 있으면 카테고리 뱃지·linkify가 적용된 설명·
 * 모바일 최적화 위/아래 순서 변경 화살표 버튼을 포함한 리스트를 그린다.
 */
export function renderDayEvents() {
    const listContainer = document.getElementById('day-events-list');
    const titleStr = document.getElementById('selected-date-str');

    if (!listContainer || !titleStr) return;

    const dateString = formatDate(state.selectedDate);
    const month = state.selectedDate.getMonth() + 1;
    const day = state.selectedDate.getDate();
    titleStr.innerText = `${month}월 ${day}일(${getKoreanDay(state.selectedDate)})`;

    listContainer.innerHTML = '';

    const dayEvents = (Array.isArray(state.events) ? state.events : []).filter((e) => e.date === dateString);
    const filteredEvents = filterEventsByCategory(dayEvents);

    if (filteredEvents.length === 0) {
        listContainer.innerHTML = `<div class="no-events"><i class="fa-solid fa-calendar-xmark" style="font-size: 24px; margin-bottom: 8px; display: block;"></i>등록된 학사 일정이 없습니다.</div>`;
        return;
    }

    // 로컬 정렬 우선순위 적용
    const sortedEvents = getLocalSortedEvents(dateString, filteredEvents);

    sortedEvents.forEach((e, idx) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'day-event-item-order-wrapper';
        wrapper.setAttribute('data-id', e.id);

        const item = document.createElement('div');
        item.className = `event-item category-${e.category}`;

        const categoryText = CATEGORY_BADGE_LABELS[e.category] || '';
        const descHtml = e.desc && e.desc.trim() ? `<p>${linkify(e.desc)}</p>` : '';
        item.innerHTML = `
            <div class="event-item-content">
                <h4>${escapeHTML(e.title)}</h4>
                ${descHtml}
            </div>
            <span class="event-item-meta">${categoryText}</span>
        `;

        item.addEventListener('click', (event) => {
            event.stopPropagation();
            safeShowEventDetail(e);
        });

        // 순서 변경 화살표 버튼 추가 (PC/모바일 공통 터치 간섭 우회 시스템)
        const orderActions = document.createElement('div');
        orderActions.className = 'event-order-actions';

        const upBtn = document.createElement('button');
        upBtn.type = 'button';
        upBtn.className = 'btn-order-arrow btn-order-up';
        if (idx === 0) upBtn.classList.add('hidden');
        upBtn.innerHTML = '<i class="fa-solid fa-chevron-up"></i>';
        upBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            changeEventOrder(dateString, sortedEvents, idx, -1);
            renderCalendar();
            renderDayEvents();
        });

        const downBtn = document.createElement('button');
        downBtn.type = 'button';
        downBtn.className = 'btn-order-arrow btn-order-down';
        if (idx === sortedEvents.length - 1) downBtn.classList.add('hidden');
        downBtn.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
        downBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            changeEventOrder(dateString, sortedEvents, idx, 1);
            renderCalendar();
            renderDayEvents();
        });

        orderActions.appendChild(upBtn);
        orderActions.appendChild(downBtn);

        wrapper.appendChild(item);
        wrapper.appendChild(orderActions);
        listContainer.appendChild(wrapper);
    });
}

/**
 * 달력 관련 DOM 이벤트 리스너를 등록한다.
 * - 이전 달(#btn-prev-month) / 다음 달(#btn-next-month) 이동
 * - 카테고리 필터 버튼(.filter-btn) 클릭
 * - state.events가 외부(파이어베이스 동기화 등)에서 변경될 때 자동 재렌더링
 * 대상 엘리먼트가 없는 화면(다른 탭)에서도 에러 없이 안전하게 동작한다.
 */
export function initCalendarEvents() {
    const prevBtn = document.getElementById('btn-prev-month');
    const nextBtn = document.getElementById('btn-next-month');
    const filterButtons = document.querySelectorAll('.filter-btn');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            state.currentDate.setMonth(state.currentDate.getMonth() - 1);
            renderCalendar();
            renderDayEvents();
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            state.currentDate.setMonth(state.currentDate.getMonth() + 1);
            renderCalendar();
            renderDayEvents();
        });
    }

    filterButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            filterButtons.forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            state.filterCategory = btn.getAttribute('data-filter');
            renderCalendar();
            renderDayEvents();
        });
    });

    // 외부 요인(실시간 동기화, 가져오기 등)으로 일정 목록이 바뀌면 자동으로 다시 그린다.
    subscribeState((key) => {
        if (key === 'events') {
            renderCalendar();
            renderDayEvents();
        }
    });
}
