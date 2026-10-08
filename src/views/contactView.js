/* ==========================================================================
   views/contactView.js
   - 비상연락망 탭의 2차 PIN 보안 게이트, 초성/텍스트 검색, 카드 그리드 렌더링을
     담당하는 프론트엔드 뷰 모듈
   - PIN 검증 자체는 authService.verifyContactsPin에 위임하고, 이 모듈은
     인증 결과에 따른 UI 토글과 연락처 데이터 표시/수정 상호작용만 전담한다
   ========================================================================== */

import { state, subscribeState } from '../core/state.js';
import { escapeHTML, getChoseung, debounce } from '../utils/helpers.js';
import { verifyContactsPin } from '../services/authService.js';
import { saveLocalContacts } from '../services/storageService.js';

// 검색 입력 디바운스 지연 시간 (ms)
const SEARCH_DEBOUNCE_DELAY = 200;

/**
 * 일정 상세 모달과 마찬가지로 modalView 모듈이 아직 로드되지 않았거나
 * 전역에 노출되지 않은 경우에도 에러 없이 무시되도록 안전하게 모달을 연다.
 * @param {string} modalId - 열고자 하는 모달의 엘리먼트 id
 */
function safeOpenModal(modalId) {
    if (typeof window !== 'undefined' && typeof window.openModal === 'function') {
        try {
            window.openModal(modalId);
        } catch (e) {
            console.error('[contactView] openModal 호출 중 오류:', e);
        }
    } else {
        console.warn('[contactView] openModal 핸들러를 찾을 수 없습니다.');
    }
}

/**
 * safeOpenModal의 닫기 버전.
 * @param {string} modalId - 닫고자 하는 모달의 엘리먼트 id
 */
function safeCloseModal(modalId) {
    if (typeof window !== 'undefined' && typeof window.closeModal === 'function') {
        try {
            window.closeModal(modalId);
        } catch (e) {
            console.error('[contactView] closeModal 호출 중 오류:', e);
        }
    } else {
        console.warn('[contactView] closeModal 핸들러를 찾을 수 없습니다.');
    }
}

/**
 * 비상연락망 2차 보안 게이트(#contacts-auth-gate)와 콘텐츠 영역(#contacts-content-area)의
 * 노출 상태를 state.isContactsAuthenticated에 맞춰 토글한다.
 * 인증된 상태면 콘텐츠를 노출하고 카드 그리드를 다시 그리며,
 * 인증되지 않은 상태면 게이트를 노출하고 PIN 입력값/에러 메시지를 초기화한다.
 * 연락망 탭이 활성화될 때(또는 인증/잠금 상태가 바뀔 때)마다 호출한다.
 */
export function checkContactsAuth() {
    const authGate = document.getElementById('contacts-auth-gate');
    const contentArea = document.getElementById('contacts-content-area');
    const errorMsg = document.getElementById('contacts-pin-error-msg');
    const pinInput = document.getElementById('contacts-pin-input');

    if (state.isContactsAuthenticated) {
        if (authGate) authGate.classList.add('hidden');
        if (contentArea) contentArea.classList.remove('hidden');
        renderContacts();
    } else {
        if (authGate) authGate.classList.remove('hidden');
        if (contentArea) contentArea.classList.add('hidden');
        if (errorMsg) errorMsg.classList.add('hidden');
        if (pinInput) {
            pinInput.value = '';
            setTimeout(() => pinInput.focus(), 100);
        }
    }
}

/**
 * #contacts-pin-input에 입력된 값을 authService.verifyContactsPin으로 검증하고
 * 결과에 따라 게이트를 통과시키거나(#contacts-pin-error-msg) 오류를 노출한다.
 */
function handleVerifyContactsPin() {
    const inputElement = document.getElementById('contacts-pin-input');
    const errorMsg = document.getElementById('contacts-pin-error-msg');

    if (!inputElement) return;

    const success = verifyContactsPin(inputElement.value);
    inputElement.value = '';

    if (success) {
        if (errorMsg) errorMsg.classList.add('hidden');
        checkContactsAuth();
    } else {
        if (errorMsg) errorMsg.classList.remove('hidden');
        inputElement.focus();
    }
}

/**
 * state.contacts를 #contact-search 검색어(일반 텍스트 또는 초성)로 필터링하고
 * 이름 가나다순으로 정렬해 #contacts-grid에 카드 형태로 렌더링한다.
 * 각 카드는 부서/직위 뱃지, 비고, tel: 통화 버튼을 포함하며,
 * 관리자(state.isAdmin)에게는 window.editContact와 연동된 수정 버튼이 추가로 노출된다.
 * 대상 엘리먼트가 없는 화면(다른 탭)에서도 에러 없이 안전하게 동작한다.
 */
export function renderContacts() {
    const grid = document.getElementById('contacts-grid');
    if (!grid) return;

    const searchInput = document.getElementById('contact-search');
    const searchVal = (searchInput ? searchInput.value : '').toLowerCase().trim();

    grid.innerHTML = '';

    const isChoseungQuery = /^[ㄱ-ㅎ\s]+$/.test(searchVal);
    const contacts = Array.isArray(state.contacts) ? state.contacts : [];

    const filteredContacts = contacts.filter((c) => {
        if (!searchVal) return true;

        const nameCho = getChoseung(c.name || '').toLowerCase();
        const deptCho = getChoseung(c.dept || '').toLowerCase();
        const roleCho = getChoseung(c.role || '').toLowerCase();

        if (isChoseungQuery) {
            return nameCho.includes(searchVal) || deptCho.includes(searchVal) || roleCho.includes(searchVal);
        }
        return (c.name || '').toLowerCase().includes(searchVal) ||
               (c.dept || '').toLowerCase().includes(searchVal) ||
               (c.role || '').toLowerCase().includes(searchVal);
    });

    if (filteredContacts.length === 0) {
        grid.innerHTML = `<div class="no-events"><i class="fa-solid fa-user-slash" style="font-size: 24px; margin-bottom: 8px; display: block;"></i>검색 결과에 맞는 교직원이 없습니다.</div>`;
        return;
    }

    filteredContacts
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'))
        .forEach((c) => {
            const card = document.createElement('div');
            card.className = 'contact-card';
            card.innerHTML = `
                <div class="contact-info">
                    <h4>${escapeHTML(c.name)}</h4>
                    <div class="contact-tags">
                        <span class="badge badge-info">${escapeHTML(c.dept)}</span>
                        <span class="badge">${escapeHTML(c.role)}</span>
                    </div>
                    ${c.note ? `<div class="contact-note">비고: ${escapeHTML(c.note)}</div>` : ''}
                </div>
                <div class="contact-actions">
                    ${state.isAdmin ? `<button class="btn-circle" onclick="editContact('${c.id}')"><i class="fa-solid fa-user-pen"></i></button>` : ''}
                    <a href="tel:${escapeHTML(c.phone)}" class="btn-circle btn-circle-call" title="전화 걸기"><i class="fa-solid fa-phone"></i></a>
                </div>
            `;
            grid.appendChild(card);
        });
}

/**
 * 관리자가 연락처 카드의 수정 버튼을 눌렀을 때 호출된다.
 * 연락처 등록/수정 모달(#modal-contact) 폼에 기존 값을 채워 넣고
 * 모달 하단에 동적으로 삭제 버튼을 추가한 뒤 모달을 연다.
 * window.editContact로 전역에 노출되어 카드의 inline onclick에서 호출된다.
 * @param {string} id - 수정할 연락처의 id
 */
function editContact(id) {
    if (!state.isAdmin) return;

    const contacts = Array.isArray(state.contacts) ? state.contacts : [];
    const contact = contacts.find((c) => c.id === id);
    if (!contact) return;

    const idInput = document.getElementById('contact-id');
    const nameInput = document.getElementById('contact-name');
    const deptInput = document.getElementById('contact-dept');
    const roleInput = document.getElementById('contact-role');
    const phoneInput = document.getElementById('contact-phone');
    const noteInput = document.getElementById('contact-note');
    const titleEl = document.getElementById('modal-contact-title');

    if (idInput) idInput.value = contact.id;
    if (nameInput) nameInput.value = contact.name;
    if (deptInput) deptInput.value = contact.dept;
    if (roleInput) roleInput.value = contact.role;
    if (phoneInput) phoneInput.value = contact.phone;
    if (noteInput) noteInput.value = contact.note || '';
    if (titleEl) titleEl.innerText = '연락처 수정';

    const modalFooter = document.querySelector('#modal-contact .modal-footer');
    const oldDelBtn = document.getElementById('btn-delete-contact-dynamic');
    if (oldDelBtn) oldDelBtn.remove();

    if (modalFooter) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.id = 'btn-delete-contact-dynamic';
        delBtn.className = 'btn btn-danger';
        delBtn.style.marginRight = 'auto';
        delBtn.innerHTML = '<i class="fa-solid fa-trash"></i> 삭제';
        delBtn.addEventListener('click', () => handleDeleteContact(contact));
        modalFooter.insertBefore(delBtn, modalFooter.firstChild);
    }

    safeOpenModal('modal-contact');
}

/**
 * 연락처 수정 모달의 삭제 버튼 클릭을 처리한다.
 * 파이어베이스 연동 모드면 원격 문서를 삭제(실시간 구독이 자동으로 state.contacts를 갱신)하고,
 * 로컬 모드면 state.contacts에서 직접 제거한 뒤 localStorage에 반영하고 그리드를 다시 그린다.
 * @param {{id: string, name: string}} contact - 삭제할 연락처 객체
 */
async function handleDeleteContact(contact) {
    if (!confirm(`${contact.name} 교직원의 연락처를 완전히 삭제하시겠습니까?`)) return;

    if (state.dbMode === 'firebase' && state.db) {
        try {
            await state.db.collection('contacts').doc(contact.id).delete();
        } catch (e) {
            console.error('[contactView] 연락처 삭제 실패:', e);
        }
    } else {
        state.contacts = state.contacts.filter((c) => c.id !== contact.id);
        saveLocalContacts(state.contacts);
        renderContacts();
    }

    safeCloseModal('modal-contact');
}

/**
 * 비상연락망 관련 DOM 이벤트 리스너와 전역 바인딩을 등록한다.
 * - PIN 검증 버튼(#btn-verify-contacts-pin) 클릭 및 입력창(#contacts-pin-input) 엔터키 처리
 * - 연락처 검색(#contact-search) 입력 시 디바운스된 카드 그리드 재필터링
 * - window.editContact 전역 함수 노출 (카드의 inline onclick에서 호출)
 * - state.contacts가 외부(파이어베이스 실시간 동기화 등)에서 변경될 때 자동 재렌더링
 * 대상 엘리먼트가 없는 화면(다른 탭)에서도 에러 없이 안전하게 동작한다.
 */
export function initContactView() {
    const btnVerifyContactsPin = document.getElementById('btn-verify-contacts-pin');
    if (btnVerifyContactsPin) {
        btnVerifyContactsPin.addEventListener('click', handleVerifyContactsPin);
    }

    const contactsPinInput = document.getElementById('contacts-pin-input');
    if (contactsPinInput) {
        contactsPinInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleVerifyContactsPin();
            }
        });
    }

    const contactSearchInput = document.getElementById('contact-search');
    if (contactSearchInput) {
        contactSearchInput.addEventListener('input', debounce(renderContacts, SEARCH_DEBOUNCE_DELAY));
    }

    if (typeof window !== 'undefined') {
        window.editContact = editContact;
    }

    // 외부 요인(실시간 동기화, 가져오기 등)으로 연락처 목록이 바뀌면 인증된 상태에서만 자동으로 다시 그린다.
    subscribeState((key) => {
        if (key === 'contacts' && state.isContactsAuthenticated) {
            renderContacts();
        }
    });
}
