/* ==========================================================================
   views/mealView.js
   - 급식 탭의 날짜 탐색, 메뉴 카드, 칼로리/원산지/알레르기 정보를 담당하는 프론트엔드 뷰 모듈
   - neisService의 월별 캐싱 급식 조회를 활용해 API 호출(비용)을 최소화한다
   ========================================================================== */

import { state } from '../core/state.js';
import { formatDate, parseDate, getKoreanDay, escapeHTML } from '../utils/helpers.js';
import { fetchMonthMeals } from '../services/neisService.js';

/**
 * 급식 메뉴 항목 텍스트에 어울리는 Font Awesome 아이콘 클래스를 반환한다.
 * 밥류(기본값), 국/찌개/탕, 김치/깍두기, 우유/음료, 고기/구이/튀김/조림/볶음 순으로
 * 키워드를 검사해 가장 먼저 일치하는 아이콘을 매핑한다.
 * @param {string} item - 급식 메뉴 개별 항목 텍스트 (예: '소고기미역국')
 * @returns {string} Font Awesome 아이콘 클래스명 (fa-solid 뒤에 붙는 부분)
 */
function getMealItemIcon(item) {
    if (item.includes('국') || item.includes('찌개') || item.includes('탕')) {
        return 'fa-spoon';
    }
    if (item.includes('김치') || item.includes('깍두기')) {
        return 'fa-pepper-hot';
    }
    if (item.includes('우유') || item.includes('요구르트') || item.includes('주스') || item.includes('음료')) {
        return 'fa-glass-water';
    }
    if (item.includes('구이') || item.includes('가스') || item.includes('튀김') || item.includes('조림') || item.includes('볶음') || item.includes('고기')) {
        return 'fa-drumstick-bite';
    }
    return 'fa-bowl-rice';
}

/**
 * state.mealSelectedDate 기준으로 급식 탭 전체(#meal-date-str, #meal-date-picker,
 * #meal-content-area, #meal-calories, #meal-origin, #meal-allergy)를 렌더링한다.
 * 해당 월의 급식 캐시가 없으면 neisService.fetchMonthMeals로 로드하는 동안
 * 로딩 스피너를 노출하고, 조회된 급식이 없으면 미등록 폴백 UI를 표시한다.
 * 대상 엘리먼트가 없는 화면(다른 탭)에서도 에러 없이 안전하게 동작한다.
 */
export async function renderMealInfo() {
    const dateStrElement = document.getElementById('meal-date-str');
    const contentArea = document.getElementById('meal-content-area');
    const caloriesElement = document.getElementById('meal-calories');
    const originElement = document.getElementById('meal-origin');
    const allergyElement = document.getElementById('meal-allergy');
    const mealDatePicker = document.getElementById('meal-date-picker');

    if (!dateStrElement || !contentArea || !caloriesElement || !originElement || !allergyElement) return;

    if (!state.mealSelectedDate) state.mealSelectedDate = new Date();

    const year = state.mealSelectedDate.getFullYear();
    const month = state.mealSelectedDate.getMonth() + 1;
    const date = state.mealSelectedDate.getDate();
    const dayName = getKoreanDay(state.mealSelectedDate);

    dateStrElement.innerText = `${year}년 ${month}월 ${date}일(${dayName})`;

    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const targetDateStr = formatDate(state.mealSelectedDate);

    // 숨겨진 input datepicker 값도 실시간 동기화
    if (mealDatePicker) {
        mealDatePicker.value = targetDateStr;
    }

    contentArea.innerHTML = `<div class="text-center" style="width: 100%; padding: 20px;"><i class="fa-solid fa-spinner fa-spin fa-2x" style="color: var(--color-internal);"></i><p class="text-muted mt-2" style="font-size: 12px;">급식 식단을 불러오고 있습니다...</p></div>`;

    if (!state.meals[monthKey]) {
        await fetchMonthMeals(year, month);
    }

    const dayMeals = state.meals[monthKey] || [];
    const todayMeal = dayMeals.find((m) => m.date === targetDateStr);

    if (todayMeal && todayMeal.menu) {
        const items = todayMeal.menu
            .split(/<br\s*\/?>/gi)
            .map((item) => item.trim())
            .filter((item) => item);

        contentArea.innerHTML = '';
        items.forEach((item) => {
            const tag = document.createElement('div');
            tag.className = 'meal-tag';
            tag.innerHTML = `<i class="fa-solid ${getMealItemIcon(item)}"></i> <span>${escapeHTML(item)}</span>`;
            contentArea.appendChild(tag);
        });

        caloriesElement.innerText = todayMeal.calories || '- Kcal';
        originElement.innerText = todayMeal.origin ? todayMeal.origin.replace(/<br\s*\/?>/gi, ', ') : '원산지 정보가 없습니다.';
        allergyElement.innerText = todayMeal.allergy || '알레르기 유발 물질 정보가 없습니다.';
    } else {
        contentArea.innerHTML = `<div class="text-center text-muted" style="width: 100%; padding: 30px 10px;"><i class="fa-solid fa-mug-hot" style="font-size: 32px; margin-bottom: 12px; display: block; color: var(--text-muted);"></i>급식 정보가 없습니다.<br><span style="font-size: 11px; color: var(--text-muted);">(주말, 공휴일, 방학 또는 미등록 상태)</span></div>`;
        caloriesElement.innerText = '- Kcal';
        originElement.innerText = '원산지 정보가 없습니다.';
        allergyElement.innerText = '알레르기 유발 물질 정보가 없습니다.';
    }
}

/**
 * 급식 관련 DOM 이벤트 리스너를 등록한다.
 * - 이전 날짜(#btn-prev-meal) / 다음 날짜(#btn-next-meal) 이동
 * - 날짜 선택(#meal-date-picker change) 시 해당 일자 급식 조회
 * 대상 엘리먼트가 없는 화면(다른 탭)에서도 에러 없이 안전하게 동작한다.
 */
export function initMealView() {
    const btnPrevMeal = document.getElementById('btn-prev-meal');
    const btnNextMeal = document.getElementById('btn-next-meal');
    const mealDatePickerInput = document.getElementById('meal-date-picker');

    if (btnPrevMeal) {
        btnPrevMeal.addEventListener('click', () => {
            if (!state.mealSelectedDate) state.mealSelectedDate = new Date();
            state.mealSelectedDate.setDate(state.mealSelectedDate.getDate() - 1);
            renderMealInfo();
        });
    }

    if (btnNextMeal) {
        btnNextMeal.addEventListener('click', () => {
            if (!state.mealSelectedDate) state.mealSelectedDate = new Date();
            state.mealSelectedDate.setDate(state.mealSelectedDate.getDate() + 1);
            renderMealInfo();
        });
    }

    if (mealDatePickerInput) {
        mealDatePickerInput.addEventListener('change', (e) => {
            if (e.target.value) {
                // 'YYYY-MM-DD' 문자열은 parseDate로 로컬 타임존 기준 변환해 하루 밀림을 방지한다
                state.mealSelectedDate = parseDate(e.target.value);
                renderMealInfo();
            }
        });
    }
}
