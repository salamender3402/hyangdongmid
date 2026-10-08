/* ==========================================================================
   views/noticeView.js
   - 메인 달력 화면 상단 롤링 공지 배너(notice)와 공지사항 탭 누적 게시판(notices)
     피드 렌더링, 설정/작성 폼 동기화를 담당하는 프론트엔드 뷰 모듈
   - 모달의 오픈/클로즈 자체는 modalView.js가 전담하므로, 이 모듈은 window 전역에
     노출된 modalView 함수를 안전하게 호출(safeShowAddNoticeModal 등)하는 방식으로
     연동하여 순환 참조(circular import) 없이 두 모듈을 느슨하게 결합한다
   ========================================================================== */

import { state, subscribeState } from '../core/state.js';
import { escapeHTML, linkify, formatDate } from '../utils/helpers.js';
import { saveLocalNotice, saveLocalNotices } from '../services/storageService.js';

// ------------------------------------------------------------------
// 내부 헬퍼: modalView.js가 아직 로드되지 않았거나 전역에 노출되지 않은 경우에도
// 에러 없이 무시되도록 안전하게 모달을 열고 닫는다.
// ------------------------------------------------------------------

/**
 * modalView.showAddNoticeModal을 안전하게 호출한다.
 */
function safeShowAddNoticeModal() {
    if (typeof window !== 'undefined' && typeof window.showAddNoticeModal === 'function') {
        try {
            window.showAddNoticeModal();
        } catch (e) {
            console.error('[noticeView] showAddNoticeModal 호출 중 오류:', e);
        }
    } else {
        console.warn('[noticeView] showAddNoticeModal 핸들러를 찾을 수 없습니다.');
    }
}

/**
 * modalView.showEditNoticeModal을 안전하게 호출한다.
 * @param {{id: string, title: string, content: string}} noticeObj - 수정할 공지 객체
 */
function safeShowEditNoticeModal(noticeObj) {
    if (typeof window !== 'undefined' && typeof window.showEditNoticeModal === 'function') {
        try {
            window.showEditNoticeModal(noticeObj);
        } catch (e) {
            console.error('[noticeView] showEditNoticeModal 호출 중 오류:', e);
        }
    } else {
        console.warn('[noticeView] showEditNoticeModal 핸들러를 찾을 수 없습니다.');
    }
}

/**
 * modalView.closeModal을 안전하게 호출한다.
 * @param {string} modalId - 닫고자 하는 모달의 엘리먼트 id
 */
function safeCloseModal(modalId) {
    if (typeof window !== 'undefined' && typeof window.closeModal === 'function') {
        try {
            window.closeModal(modalId);
        } catch (e) {
            console.error('[noticeView] closeModal 호출 중 오류:', e);
        }
    } else {
        console.warn('[noticeView] closeModal 핸들러를 찾을 수 없습니다.');
    }
}

// ------------------------------------------------------------------
// 1. 상단 롤링 공지 배너
// ------------------------------------------------------------------

/**
 * 메인 달력 화면 상단 공지 배너(#notice-banner, #notice-banner-content)를 렌더링한다.
 * state.notice.active가 true이고 상단 강조 문구(state.notice.text)가 있으면 그 문구를,
 * 문구가 비어 있더라도 누적 게시판(state.notices)에 항목이 있으면 최신 게시글을
 * 요약해서 노출한다. 그 외에는 배너를 숨긴다.
 */
export function renderNotice() {
    const banner = document.getElementById('notice-banner');
    const content = document.getElementById('notice-banner-content');
    if (!banner || !content) return;

    const isActive = Boolean(state.notice && state.notice.active);
    const hasNoticeText = Boolean(state.notice && state.notice.text && state.notice.text.trim());
    const notices = Array.isArray(state.notices) ? state.notices : [];
    const hasNoticeBoard = notices.length > 0;

    if (isActive && (hasNoticeText || hasNoticeBoard)) {
        if (hasNoticeText) {
            content.innerHTML = linkify(state.notice.text);
        } else {
            const latest = notices[0];
            content.innerHTML = `<strong>${escapeHTML(latest.title || '')}</strong> ${linkify(latest.content || '')}`;
        }
        banner.classList.remove('hidden');
    } else {
        banner.classList.add('hidden');
    }
}

// ------------------------------------------------------------------
// 2. 누적 공지사항 게시판
// ------------------------------------------------------------------

/**
 * 누적 공지사항 게시판(#notice-board-list)을 최신순(date 내림차순)으로 렌더링한다.
 * 관리자(state.isAdmin)에게는 각 카드에 수정/삭제 버튼이 추가로 노출된다.
 * 수정 버튼은 modalView.showEditNoticeModal을 호출하고, 삭제 버튼은 확인창 후
 * deleteNotice()로 파이어베이스/로컬 스토리지 양쪽 모드를 모두 처리한다.
 */
export function renderNoticeBoard() {
    const listContainer = document.getElementById('notice-board-list');
    if (!listContainer) return;

    const notices = Array.isArray(state.notices) ? state.notices : [];

    if (notices.length === 0) {
        listContainer.innerHTML = `<div class="no-events"><i class="fa-solid fa-bullhorn" style="font-size: 24px; margin-bottom: 8px; display: block;"></i>등록된 공지사항이 없습니다.</div>`;
        return;
    }

    const sortedNotices = [...notices].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    listContainer.innerHTML = '';
    sortedNotices.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'notice-card';

        let adminActions = '';
        if (state.isAdmin) {
            adminActions = `
                <div class="notice-card-actions">
                    <button class="btn btn-outline btn-sm btn-edit-notice" data-id="${item.id}"><i class="fa-solid fa-pen"></i> 수정</button>
                    <button class="btn btn-danger btn-sm btn-delete-notice" data-id="${item.id}"><i class="fa-solid fa-trash-can"></i> 삭제</button>
                </div>
            `;
        }

        card.innerHTML = `
            <div class="notice-card-header">
                <span class="notice-card-title">${escapeHTML(item.title)}</span>
                <span class="notice-card-date">${escapeHTML(item.date || '')}</span>
            </div>
            <div class="notice-card-body">${linkify(item.content || '')}</div>
            ${adminActions}
        `;

        listContainer.appendChild(card);
    });

    if (state.isAdmin) {
        listContainer.querySelectorAll('.btn-edit-notice').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                const target = notices.find((n) => n.id === id);
                if (target) safeShowEditNoticeModal(target);
            });
        });

        listContainer.querySelectorAll('.btn-delete-notice').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                if (confirm('이 공지사항을 삭제하시겠습니까?')) {
                    deleteNotice(id);
                }
            });
        });
    }
}

/**
 * 공지사항을 삭제한다. 파이어베이스 연동 모드면 원격 문서를 삭제하고(실시간 구독이
 * 자동으로 state.notices와 게시판을 갱신), 로컬 모드면 state.notices에서 직접 제거한 뒤
 * localStorage에 반영하고 게시판을 다시 그린다.
 * @param {string} id - 삭제할 공지의 id
 */
export async function deleteNotice(id) {
    if (state.dbMode === 'firebase' && state.db) {
        try {
            await state.db.collection('notices').doc(id).delete();
        } catch (e) {
            console.error('[noticeView] 공지사항 삭제 실패:', e);
        }
    } else {
        state.notices = (Array.isArray(state.notices) ? state.notices : []).filter((n) => n.id !== id);
        saveLocalNotices(state.notices);
        renderNoticeBoard();
    }
}

// ------------------------------------------------------------------
// 3. 설정 탭 상단 강조 공지 폼 동기화 및 저장
// ------------------------------------------------------------------

/**
 * 설정 탭의 상단 강조 공지 입력 폼(#notice-text, #notice-active)에
 * 현재 state.notice 값을 반영한다.
 */
export function syncNoticeForm() {
    const textInput = document.getElementById('notice-text');
    const activeInput = document.getElementById('notice-active');
    if (textInput) textInput.value = (state.notice && state.notice.text) || '';
    if (activeInput) activeInput.checked = Boolean(state.notice && state.notice.active);
}

/**
 * 설정 탭의 상단 강조 공지 폼(#notice-text, #notice-active)을 저장한다.
 * state.notice를 갱신해 배너를 즉시 다시 그리고, 파이어베이스 연동 모드면
 * settings/notice 문서에 실시간 배포하며, 로컬 모드면 localStorage에만 저장한다.
 */
async function saveNotice() {
    const textInput = document.getElementById('notice-text');
    const activeInput = document.getElementById('notice-active');
    if (!textInput || !activeInput) return;

    const noticeData = {
        text: textInput.value.trim(),
        active: activeInput.checked,
        updatedAt: new Date().toISOString()
    };

    state.notice = noticeData;
    saveLocalNotice(noticeData);
    renderNotice();

    if (state.dbMode === 'firebase' && state.db) {
        try {
            await state.db.collection('settings').doc('notice').set(noticeData);
            alert('공지사항이 클라우드 서버에 저장 및 실시간 배포되었습니다!');
        } catch (e) {
            console.error('[noticeView] 공지사항 저장 실패:', e);
            alert('클라우드 저장 실패: ' + e.message);
        }
    } else {
        alert('로컬에 공지사항이 저장되었습니다.');
    }
}

/**
 * 공지사항 작성/수정 모달(#form-notice)의 값을 읽어 누적 게시판(state.notices)에
 * 신규 등록하거나 기존 항목을 수정한다. 저장 후 모달을 닫는다.
 */
async function saveNoticeFromModal() {
    const idInput = document.getElementById('notice-id');
    const titleInput = document.getElementById('notice-board-title');
    const contentInput = document.getElementById('notice-board-content');
    if (!titleInput || !contentInput) return;

    const id = idInput ? idInput.value : '';
    const title = titleInput.value.trim();
    const content = contentInput.value.trim();

    if (!title || !content) {
        alert('제목과 내용을 모두 입력해 주세요.');
        return;
    }

    const noticeObj = {
        title,
        content,
        date: formatDate(new Date()),
        updatedAt: new Date().toISOString()
    };

    if (id) {
        // 기존 공지 수정
        if (state.dbMode === 'firebase' && state.db) {
            try {
                await state.db.collection('notices').doc(id).set(noticeObj);
            } catch (e) {
                console.error('[noticeView] 공지사항 수정 실패:', e);
            }
        } else {
            const notices = Array.isArray(state.notices) ? [...state.notices] : [];
            const index = notices.findIndex((n) => n.id === id);
            if (index > -1) notices[index] = { id, ...noticeObj };
            state.notices = notices;
        }
    } else {
        // 신규 공지 작성
        const newId = `notice-${Date.now()}`;
        if (state.dbMode === 'firebase' && state.db) {
            try {
                await state.db.collection('notices').doc(newId).set(noticeObj);
            } catch (e) {
                console.error('[noticeView] 공지사항 등록 실패:', e);
            }
        } else {
            state.notices = [{ id: newId, ...noticeObj }, ...(Array.isArray(state.notices) ? state.notices : [])];
        }
    }

    if (state.dbMode !== 'firebase') {
        saveLocalNotices(state.notices);
        renderNoticeBoard();
    }

    safeCloseModal('modal-notice');
}

// ------------------------------------------------------------------
// 4. 초기화
// ------------------------------------------------------------------

/**
 * 공지사항 관련 DOM 이벤트 리스너를 등록한다.
 * - 상단 강조 공지 저장 버튼(#btn-save-notice) 클릭
 * - 공지사항 탭의 신규 작성 버튼(#btn-add-notice-quick) 클릭 시 작성 모달 오픈
 * - 공지사항 모달 저장 버튼(#btn-save-notice-modal) 클릭
 * - state.notice / state.notices가 외부(파이어베이스 실시간 동기화 등)에서
 *   변경될 때 배너/폼/게시판을 자동으로 다시 그린다.
 * 대상 엘리먼트가 없는 화면(다른 탭)에서도 에러 없이 안전하게 동작한다.
 */
export function initNoticeView() {
    const btnSaveNotice = document.getElementById('btn-save-notice');
    if (btnSaveNotice) btnSaveNotice.addEventListener('click', saveNotice);

    const btnAddNoticeQuick = document.getElementById('btn-add-notice-quick');
    if (btnAddNoticeQuick) btnAddNoticeQuick.addEventListener('click', safeShowAddNoticeModal);

    const btnSaveNoticeModal = document.getElementById('btn-save-notice-modal');
    if (btnSaveNoticeModal) btnSaveNoticeModal.addEventListener('click', saveNoticeFromModal);

    subscribeState((key) => {
        if (key === 'notice') {
            renderNotice();
            syncNoticeForm();
        }
        if (key === 'notices') {
            renderNotice();
            renderNoticeBoard();
        }
    });
}
