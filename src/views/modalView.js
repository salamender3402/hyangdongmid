/* ==========================================================================
   views/modalView.js
   - 일정/연락처/공지사항 등록·수정 모달 및 일정 상세보기 모달의 오픈/클로즈와
     폼 제출(저장) 로직을 전담하는 프론트엔드 뷰 모듈
   - openModal/closeModal은 ESC 키, 모달 배경(backdrop) 클릭으로도 닫히도록 처리하며,
     index.html의 인라인 onclick="closeModal(...)" 대응을 위해 window 전역에도 노출한다
   ========================================================================== */

import { state } from '../core/state.js';
import { formatDate, parseDate, linkify, sortEventsByDate } from '../utils/helpers.js';
import { saveLocalEvents, saveLocalContacts } from '../services/storageService.js';

// 일정 상세 모달 카테고리 뱃지 표기 텍스트
const CATEGORY_DETAIL_LABELS = {
    neis: '공식 학사일정',
    internal: '학교 내부일정',
    meeting: '학교 내부일정',
    study: '학교 내부일정',
    etc: '학교 내부일정'
};

// 현재 열려 있는 모달 id를 오픈 순서대로 보관하는 스택.
// ESC 키를 눌렀을 때 가장 마지막에 연 모달부터 닫기 위해 사용한다.
const modalStack = [];

// ------------------------------------------------------------------
// 1. 모달 공통 오픈/클로즈 제어
// ------------------------------------------------------------------

/**
 * 지정한 id의 모달을 연다. (.active 클래스 부여, 배경 스크롤 방지)
 * @param {string} modalId - 열고자 하는 모달의 엘리먼트 id
 */
export function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    modal.classList.add('active');
    if (!modalStack.includes(modalId)) modalStack.push(modalId);
    document.body.style.overflow = 'hidden';
}

/**
 * 지정한 id의 모달을 닫는다. 열려 있는 모달이 모두 닫히면 배경 스크롤을 복구한다.
 * @param {string} modalId - 닫고자 하는 모달의 엘리먼트 id
 */
export function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    modal.classList.remove('active');

    const idx = modalStack.indexOf(modalId);
    if (idx > -1) modalStack.splice(idx, 1);

    if (modalStack.length === 0) {
        document.body.style.overflow = '';
    }
}

// ------------------------------------------------------------------
// 2. 일정 분류(category-tab-btn) 탭 헬퍼
// ------------------------------------------------------------------

/**
 * 일정 모달의 분류 탭 버튼(.category-tab-btn) 중 지정한 카테고리를 active 상태로 동기화한다.
 * @param {string} activeCategory - 활성화할 카테고리 값 ('internal' | 'neis')
 */
function syncCategoryTabButtons(activeCategory) {
    document.querySelectorAll('.category-tab-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-category') === activeCategory);
    });
}

/**
 * 일정 모달의 분류 탭 버튼 클릭 이벤트를 바인딩한다.
 * 클릭 시 active 클래스를 갱신하고 숨겨진 #event-category 값을 동기화한다.
 */
function bindCategoryTabButtons() {
    const categoryTabBtns = document.querySelectorAll('.category-tab-btn');
    categoryTabBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            categoryTabBtns.forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');

            const category = btn.getAttribute('data-category');
            const categoryInput = document.getElementById('event-category');
            if (categoryInput) categoryInput.value = category;
        });
    });
}

// ------------------------------------------------------------------
// 3. 일정 모달 (등록 / 수정 / 상세보기)
// ------------------------------------------------------------------

/**
 * 신규 일정 등록 모달(#modal-event)을 연다. 폼을 초기화하고 분류 선택 영역은 숨긴다.
 * @param {Date} [defaultDate] - 일자 입력란에 채울 기본 날짜 (미지정 시 state.selectedDate)
 */
export function showAddEventModal(defaultDate) {
    const form = document.getElementById('form-event');
    if (form) form.reset();

    const idInput = document.getElementById('event-id');
    if (idInput) idInput.value = '';

    const categoryGroup = document.getElementById('form-group-category');
    if (categoryGroup) categoryGroup.classList.add('hidden');

    const categoryInput = document.getElementById('event-category');
    if (categoryInput) categoryInput.value = 'internal';
    syncCategoryTabButtons('internal');

    const titleEl = document.getElementById('modal-event-title');
    if (titleEl) titleEl.innerText = '새 일정 등록';

    const dateInput = document.getElementById('event-date');
    if (dateInput) dateInput.value = formatDate(defaultDate || state.selectedDate);

    openModal('modal-event');
}

/**
 * 기존 일정 수정 모달(#modal-event)을 연다. 대상 일정 값으로 폼을 채우고
 * 수정 모달에서만 노출되는 분류 선택 영역을 활성화한다.
 * @param {{id: string, title: string, date: string, desc?: string, category?: string}} eventObj - 수정할 일정 객체
 */
export function showEditEventModal(eventObj) {
    if (!eventObj) return;

    const form = document.getElementById('form-event');
    if (form) form.reset();

    const idInput = document.getElementById('event-id');
    const titleInput = document.getElementById('event-title');
    const dateInput = document.getElementById('event-date');
    const descInput = document.getElementById('event-desc');
    const categoryInput = document.getElementById('event-category');
    const categoryGroup = document.getElementById('form-group-category');
    const titleEl = document.getElementById('modal-event-title');

    if (idInput) idInput.value = eventObj.id;
    if (titleInput) titleInput.value = eventObj.title || '';
    if (dateInput) dateInput.value = eventObj.date || '';
    if (descInput) descInput.value = eventObj.desc || '';

    const category = eventObj.category || 'internal';
    if (categoryInput) categoryInput.value = category;
    if (categoryGroup) categoryGroup.classList.remove('hidden');
    syncCategoryTabButtons(category);

    if (titleEl) titleEl.innerText = '일정 수정';

    openModal('modal-event');
}

/**
 * 일정 상세보기 모달(#modal-detail)을 열고 삭제/수정 버튼 동작을 바인딩한다.
 * 삭제/수정 버튼은 관리자(state.isAdmin)만 실제로 동작하며, index.html에서
 * .admin-only 클래스로 비관리자에게는 이미 숨김 처리되어 있다.
 * @param {{id: string, title: string, date: string, desc?: string, category?: string}} eventObj - 상세 표시할 일정 객체
 */
export function showEventDetail(eventObj) {
    if (!eventObj) return;

    const badge = document.getElementById('detail-category-badge');
    const titleEl = document.getElementById('detail-title');
    const dateEl = document.getElementById('detail-date');
    const descEl = document.getElementById('detail-desc');
    const deleteBtn = document.getElementById('btn-delete-event');
    const editBtn = document.getElementById('btn-edit-event-trigger');

    if (badge) {
        badge.className = 'badge';
        badge.style.backgroundColor = '';
        badge.style.color = '';
        badge.innerText = CATEGORY_DETAIL_LABELS[eventObj.category] || '';

        if (eventObj.category === 'neis') {
            badge.classList.add('badge-success');
        } else {
            badge.style.backgroundColor = 'var(--color-internal-light)';
            badge.style.color = 'var(--color-internal)';
        }
    }

    if (titleEl) titleEl.innerText = eventObj.title || '';
    if (dateEl) dateEl.innerText = eventObj.date || '';
    if (descEl) {
        descEl.innerHTML = eventObj.desc && eventObj.desc.trim()
            ? linkify(eventObj.desc)
            : '등록된 상세 설명이 없습니다.';
    }

    if (deleteBtn) {
        deleteBtn.onclick = async () => {
            if (!state.isAdmin) return;
            if (!confirm('이 일정을 완전히 삭제하시겠습니까?')) return;

            if (state.dbMode === 'firebase' && state.db) {
                try {
                    await state.db.collection('schedules').doc(eventObj.id).delete();
                } catch (e) {
                    console.error('[modalView] 일정 삭제 실패:', e);
                }
            } else {
                state.events = state.events.filter((e) => e.id !== eventObj.id);
                saveLocalEvents(state.events);
            }

            closeModal('modal-detail');
        };
    }

    if (editBtn) {
        editBtn.onclick = () => {
            if (!state.isAdmin) return;
            closeModal('modal-detail');
            showEditEventModal(eventObj);
        };
    }

    openModal('modal-detail');
}

/**
 * 일정 등록/수정 폼(#form-event) 제출을 처리한다.
 * 파이어베이스 연동 모드면 Firestore에 저장하고(실시간 구독이 state.events를 자동 갱신),
 * 로컬 모드면 state.events를 직접 갱신하고 localStorage에 반영한다.
 * @param {SubmitEvent} e - 폼 제출 이벤트
 */
function handleEventFormSubmit(e) {
    e.preventDefault();
    if (!state.isAdmin) return;

    const idInput = document.getElementById('event-id');
    const titleInput = document.getElementById('event-title');
    const dateInput = document.getElementById('event-date');
    const descInput = document.getElementById('event-desc');
    const categoryInput = document.getElementById('event-category');

    const id = (idInput && idInput.value) || `ev-${Date.now()}`;
    const title = titleInput ? titleInput.value.trim() : '';
    const date = dateInput ? dateInput.value : '';
    const category = (categoryInput && categoryInput.value) || 'internal';
    const desc = descInput ? descInput.value.trim() : '';

    if (!title || !date) return;

    if (state.dbMode === 'firebase' && state.db) {
        state.db.collection('schedules').doc(id).set({ title, date, category, desc })
            .catch((err) => console.error('[modalView] 일정 저장 실패:', err));
    } else {
        const events = Array.isArray(state.events) ? [...state.events] : [];
        const index = events.findIndex((ev) => ev.id === id);
        if (index > -1) {
            events[index] = { id, title, date, category, desc };
        } else {
            events.push({ id, title, date, category, desc });
        }

        state.events = sortEventsByDate(events);
        saveLocalEvents(state.events);

        state.selectedDate = parseDate(date);
        state.currentDate = parseDate(date);
    }

    closeModal('modal-event');
}

// ------------------------------------------------------------------
// 4. 연락처 모달 (등록 / 수정)
// ------------------------------------------------------------------

/**
 * 연락처 수정 모달에서 동적으로 추가되는 삭제 버튼(#btn-delete-contact-dynamic)이
 * 남아있다면 제거한다. 신규 등록 모달을 열거나 다른 연락처 수정 모달을 다시 열 때 호출한다.
 */
function removeDynamicContactDeleteButton() {
    const oldBtn = document.getElementById('btn-delete-contact-dynamic');
    if (oldBtn) oldBtn.remove();
}

/**
 * 신규 연락처 등록 모달(#modal-contact)을 연다. 폼을 초기화한다.
 */
export function showAddContactModal() {
    const form = document.getElementById('form-contact');
    if (form) form.reset();

    const idInput = document.getElementById('contact-id');
    if (idInput) idInput.value = '';

    const titleEl = document.getElementById('modal-contact-title');
    if (titleEl) titleEl.innerText = '교직원 연락처 등록';

    removeDynamicContactDeleteButton();
    openModal('modal-contact');
}

/**
 * 기존 연락처 수정 모달(#modal-contact)을 연다. 대상 연락처 값으로 폼을 채우고
 * 모달 하단에 동적으로 삭제 버튼을 추가한다.
 * @param {{id: string, name: string, dept: string, role: string, phone: string, note?: string}} contactObj - 수정할 연락처 객체
 */
export function showEditContactModal(contactObj) {
    if (!contactObj) return;

    const idInput = document.getElementById('contact-id');
    const nameInput = document.getElementById('contact-name');
    const deptInput = document.getElementById('contact-dept');
    const roleInput = document.getElementById('contact-role');
    const phoneInput = document.getElementById('contact-phone');
    const noteInput = document.getElementById('contact-note');
    const titleEl = document.getElementById('modal-contact-title');

    if (idInput) idInput.value = contactObj.id;
    if (nameInput) nameInput.value = contactObj.name || '';
    if (deptInput) deptInput.value = contactObj.dept || '';
    if (roleInput) roleInput.value = contactObj.role || '';
    if (phoneInput) phoneInput.value = contactObj.phone || '';
    if (noteInput) noteInput.value = contactObj.note || '';
    if (titleEl) titleEl.innerText = '연락처 수정';

    removeDynamicContactDeleteButton();

    const modalFooter = document.querySelector('#modal-contact .modal-footer');
    if (modalFooter) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.id = 'btn-delete-contact-dynamic';
        delBtn.className = 'btn btn-danger';
        delBtn.style.marginRight = 'auto';
        delBtn.innerHTML = '<i class="fa-solid fa-trash"></i> 삭제';
        delBtn.addEventListener('click', async () => {
            if (!confirm(`${contactObj.name} 교직원의 연락처를 완전히 삭제하시겠습니까?`)) return;

            if (state.dbMode === 'firebase' && state.db) {
                try {
                    await state.db.collection('contacts').doc(contactObj.id).delete();
                } catch (e) {
                    console.error('[modalView] 연락처 삭제 실패:', e);
                }
            } else {
                state.contacts = state.contacts.filter((c) => c.id !== contactObj.id);
                saveLocalContacts(state.contacts);
            }

            closeModal('modal-contact');
        });
        modalFooter.insertBefore(delBtn, modalFooter.firstChild);
    }

    openModal('modal-contact');
}

/**
 * 연락처 등록/수정 폼(#form-contact) 제출을 처리한다.
 * @param {SubmitEvent} e - 폼 제출 이벤트
 */
function handleContactFormSubmit(e) {
    e.preventDefault();
    if (!state.isAdmin) return;

    const idInput = document.getElementById('contact-id');
    const nameInput = document.getElementById('contact-name');
    const deptInput = document.getElementById('contact-dept');
    const roleInput = document.getElementById('contact-role');
    const phoneInput = document.getElementById('contact-phone');
    const noteInput = document.getElementById('contact-note');

    const id = (idInput && idInput.value) || `con-${Date.now()}`;
    const name = nameInput ? nameInput.value.trim() : '';
    const dept = deptInput ? deptInput.value.trim() : '';
    const role = roleInput ? roleInput.value.trim() : '';
    const phone = phoneInput ? phoneInput.value.trim() : '';
    const note = noteInput ? noteInput.value.trim() : '';

    if (!name || !dept || !role || !phone) return;

    if (state.dbMode === 'firebase' && state.db) {
        state.db.collection('contacts').doc(id).set({ name, dept, role, phone, note })
            .catch((err) => console.error('[modalView] 연락처 저장 실패:', err));
    } else {
        const contacts = Array.isArray(state.contacts) ? [...state.contacts] : [];
        const index = contacts.findIndex((c) => c.id === id);
        if (index > -1) {
            contacts[index] = { id, name, dept, role, phone, note };
        } else {
            contacts.push({ id, name, dept, role, phone, note });
        }

        state.contacts = contacts;
        saveLocalContacts(state.contacts);
    }

    closeModal('modal-contact');
}

// ------------------------------------------------------------------
// 5. 공지사항 모달 (작성 / 수정) - 오픈/클로즈 및 폼 채우기만 담당
//    실제 저장(생성/수정)·삭제 로직은 noticeView.js가 전담한다.
// ------------------------------------------------------------------

/**
 * 신규 공지사항 작성 모달(#modal-notice)을 연다. 폼을 초기화한다.
 */
export function showAddNoticeModal() {
    const form = document.getElementById('form-notice');
    if (form) form.reset();

    const idInput = document.getElementById('notice-id');
    if (idInput) idInput.value = '';

    const titleEl = document.getElementById('modal-notice-title');
    if (titleEl) titleEl.innerText = '공지사항 작성';

    openModal('modal-notice');
}

/**
 * 기존 공지사항 수정 모달(#modal-notice)을 연다. 대상 공지 값으로 폼을 채운다.
 * @param {{id: string, title: string, content: string}} noticeObj - 수정할 공지 객체
 */
export function showEditNoticeModal(noticeObj) {
    if (!noticeObj) return;

    const idInput = document.getElementById('notice-id');
    const titleInput = document.getElementById('notice-board-title');
    const contentInput = document.getElementById('notice-board-content');
    const titleEl = document.getElementById('modal-notice-title');

    if (idInput) idInput.value = noticeObj.id;
    if (titleInput) titleInput.value = noticeObj.title || '';
    if (contentInput) contentInput.value = noticeObj.content || '';
    if (titleEl) titleEl.innerText = '공지사항 수정';

    openModal('modal-notice');
}

// ------------------------------------------------------------------
// 6. 초기화: 모달 공통 상호작용 바인딩 및 전역 노출
// ------------------------------------------------------------------

/**
 * 모달 관련 DOM 이벤트 리스너를 등록하고, index.html의 인라인 onclick 및
 * 다른 뷰 모듈(calendarView, contactView 등)의 안전 호출(safeOpenModal 등)이
 * 참조할 수 있도록 주요 함수를 window 전역에 노출한다.
 * - 모달 배경(backdrop) 클릭 시 닫기
 * - ESC 키 입력 시 가장 최근에 연 모달 닫기
 * - 일정/연락처 등록·수정 폼 제출 처리
 * - 일정 분류 탭 버튼 클릭 처리
 */
export function initModalView() {
    document.querySelectorAll('.modal').forEach((modal) => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal(modal.id);
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modalStack.length > 0) {
            closeModal(modalStack[modalStack.length - 1]);
        }
    });

    const formEvent = document.getElementById('form-event');
    if (formEvent) formEvent.addEventListener('submit', handleEventFormSubmit);

    const formContact = document.getElementById('form-contact');
    if (formContact) formContact.addEventListener('submit', handleContactFormSubmit);

    bindCategoryTabButtons();

    if (typeof window !== 'undefined') {
        window.openModal = openModal;
        window.closeModal = closeModal;
        window.showAddEventModal = showAddEventModal;
        window.showEditEventModal = showEditEventModal;
        window.showEventDetail = showEventDetail;
        window.showAddContactModal = showAddContactModal;
        window.showEditContactModal = showEditContactModal;
        window.showAddNoticeModal = showAddNoticeModal;
        window.showEditNoticeModal = showEditNoticeModal;
    }
}
