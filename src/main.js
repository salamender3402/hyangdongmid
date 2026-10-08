/* ==========================================================================
   main.js
   - 앱 전체의 진입점(Main Orchestrator)
   - 모든 서비스/뷰/코어/유틸리티 모듈을 조립해 초기화 시퀀스를 실행하고,
     하단 내비게이션 탭 전환, 빠른 액션 버튼, 데이터 가져오기/내보내기,
     PWA 설치/서비스워커 제어 등 화면 전역의 이벤트 바인딩을 전담한다
   ========================================================================== */

import { state } from './core/state.js';
import { formatDate } from './utils/helpers.js';

import {
    checkSecurityGate,
    verifySecurityCode,
    checkAdminSession
} from './services/authService.js';
import { loadLocalStorageData } from './services/storageService.js';
import { syncNeisSchedule, autoSyncNeisBackground } from './services/neisService.js';
import { initFirebase } from './services/firebaseService.js';
import {
    downloadCsvTemplate,
    importScheduleFile,
    exportAllData,
    importBackupData,
    resetAllData
} from './services/importExportService.js';

import { renderCalendar, renderDayEvents, initCalendarEvents } from './views/calendarView.js';
import { renderMealInfo, initMealView } from './views/mealView.js';
import { renderContacts, checkContactsAuth, initContactView } from './views/contactView.js';
import { renderNotice, renderNoticeBoard, syncNoticeForm, initNoticeView } from './views/noticeView.js';
import { initSettingsView, updateAdminUI } from './views/settingsView.js';
import { initModalView, showAddEventModal, showAddContactModal } from './views/modalView.js';

// ------------------------------------------------------------------
// 1. PWA 설치 프롬프트 및 서비스워커 등록
// ------------------------------------------------------------------

/**
 * PWA(홈 화면 설치) 프롬프트 제어와 서비스워커 등록/업데이트 감지를 담당한다.
 * - 로컬 개발 환경(localhost / 127.0.0.1)에서는 캐싱을 우회한다.
 * - 새 버전의 서비스워커가 활성화되면 화면을 자동 새로고침한다.
 * - beforeinstallprompt/appinstalled 이벤트로 설치 배너(#install-banner)와
 *   설정 탭 설치 버튼(#btn-pwa-install-settings)을 제어한다.
 */
function setupPwa() {
    const installBanner = document.getElementById('install-banner');
    const btnInstall = document.getElementById('btn-install');
    const btnPwaSettings = document.getElementById('btn-pwa-install-settings');
    const pwaStatus = document.getElementById('pwa-status');
    const swStatus = document.getElementById('sw-status');

    const isLocalhost = Boolean(
        window.location.hostname === 'localhost' ||
        window.location.hostname === '[::1]' ||
        window.location.hostname.match(/^127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/)
    );

    if ('serviceWorker' in navigator && !isLocalhost) {
        navigator.serviceWorker.register('service-worker.js')
            .then((reg) => {
                console.log('Service Worker 등록 성공:', reg.scope);
                if (swStatus) swStatus.innerText = '활성화됨 (오프라인 모드 작동)';

                reg.onupdatefound = () => {
                    const installingWorker = reg.installing;
                    if (installingWorker == null) return;

                    installingWorker.onstatechange = () => {
                        if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            console.log('[PWA Update] 새로운 버전의 자산이 백그라운드에 다운로드되었습니다.');
                            if (reg.waiting) {
                                reg.waiting.postMessage({ action: 'skipWaiting' });
                            }
                        }
                    };
                };
            })
            .catch((err) => {
                console.warn('Service Worker 등록 실패:', err);
                if (swStatus) swStatus.innerText = '등록 실패 (HTTPS 환경 필요)';
            });

        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return;
            refreshing = true;
            console.log('[PWA Update] 새로운 서비스 워커 활성화 감지. 화면을 최신 코드로 새로고침합니다.');
            window.location.reload();
        });
    } else if (swStatus) {
        swStatus.innerText = isLocalhost ? '개발자 로컬 모드 (캐싱 우회)' : '미지원 브라우저';
    }

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        state.deferredPrompt = e;

        if (installBanner) installBanner.classList.remove('hidden');
        if (pwaStatus) pwaStatus.innerText = '설치 대기 중 (홈화면 추가 가능)';
    });

    const triggerInstall = () => {
        if (!state.deferredPrompt) {
            alert('이 기기는 이미 설치되었거나 브라우저 보안 규정(HTTPS 미사용 등)에 따라 홈 화면 추가를 바로 호출할 수 없습니다. 모바일 기기의 브라우저 [홈 화면에 추가] 단추를 클릭해 주세요.');
            return;
        }
        state.deferredPrompt.prompt();
        state.deferredPrompt.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') {
                if (installBanner) installBanner.classList.add('hidden');
                if (pwaStatus) pwaStatus.innerText = '앱 설치 완료';
            }
            state.deferredPrompt = null;
        });
    };

    if (btnInstall) btnInstall.addEventListener('click', triggerInstall);
    if (btnPwaSettings) btnPwaSettings.addEventListener('click', triggerInstall);

    window.addEventListener('appinstalled', () => {
        if (installBanner) installBanner.classList.add('hidden');
        if (pwaStatus) pwaStatus.innerText = '앱이 설치되었습니다.';
    });
}

// ------------------------------------------------------------------
// 2. 하단 내비게이션 탭 전환
// ------------------------------------------------------------------

/**
 * 하단 내비게이션(.nav-item) 클릭 시 탭을 전환하고, 이동한 탭에 맞춰 화면을 갱신한다.
 * 비상연락망 탭을 벗어날 때는 2차 보안 인증을 자동으로 잠근다(state.isContactsAuthenticated = false).
 */
function initNavTabs() {
    const navItems = document.querySelectorAll('.nav-item');

    navItems.forEach((item) => {
        item.addEventListener('click', () => {
            const targetTab = item.getAttribute('data-tab');
            const targetPane = document.getElementById(targetTab);
            if (!targetPane) return;

            document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));

            item.classList.add('active');
            targetPane.classList.add('active');
            state.activeTab = targetTab;

            if (targetTab === 'tab-calendar') {
                state.isContactsAuthenticated = false;
                renderCalendar();
                renderDayEvents();
            } else if (targetTab === 'tab-contacts') {
                checkContactsAuth();
            } else {
                state.isContactsAuthenticated = false;
                if (targetTab === 'tab-meals') {
                    state.mealSelectedDate = new Date();
                    renderMealInfo();
                } else if (targetTab === 'tab-notice') {
                    renderNoticeBoard();
                }
            }
        });
    });
}

// ------------------------------------------------------------------
// 3. 빠른 액션 버튼 및 데이터 가져오기/내보내기 바인딩
// ------------------------------------------------------------------

/**
 * 나이스 학사일정 수동 동기화 버튼(#btn-sync-neis) 클릭을 처리한다.
 * 설정 폼(#neis-office-code, #neis-school-code, #neis-year) 값을 읽어
 * neisService.syncNeisSchedule을 호출하고, 진행 중 버튼 상태를 표시한다.
 */
async function handleSyncNeisClick() {
    if (!state.isAdmin) return;

    const officeCodeInput = document.getElementById('neis-office-code');
    const schoolCodeInput = document.getElementById('neis-school-code');
    const yearInput = document.getElementById('neis-year');

    const officeCode = officeCodeInput ? officeCodeInput.value : undefined;
    const schoolCode = schoolCodeInput ? schoolCodeInput.value.trim() : undefined;
    const year = yearInput ? yearInput.value : undefined;

    const syncButton = document.getElementById('btn-sync-neis');
    const originalText = syncButton ? syncButton.innerHTML : '';
    if (syncButton) {
        syncButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 나이스 연동 동기화 중...';
        syncButton.disabled = true;
    }

    try {
        const result = await syncNeisSchedule({ officeCode, schoolCode, year });
        if (result.success) {
            alert(`나이스 학사일정 동기화 완료! (${result.source === 'mock' ? '모의 데이터' : '공식 API'})\n총 ${result.count}건의 신규 일정이 추가되었습니다.`);
            renderCalendar();
            renderDayEvents();
        } else {
            alert(result.message || '나이스 학사일정 동기화에 실패했습니다.');
        }
    } finally {
        if (syncButton) {
            syncButton.innerHTML = originalText;
            syncButton.disabled = false;
        }
    }
}

/**
 * CSV/JSON 파일 업로드(드래그 앤 드롭 또는 파일 선택)를 처리한다.
 * @param {File} file - 업로드된 일정 일괄등록 파일
 */
async function handleFileSelect(file) {
    if (!file || !state.isAdmin) return;

    const result = await importScheduleFile(file);
    if (result.success) {
        alert(`파일에서 일정 ${result.count}건을 일괄 등록 완료했습니다.`);
        renderCalendar();
        renderDayEvents();
    } else {
        alert(result.error || '파일 불러오기에 실패했습니다.');
    }
}

/**
 * JSON 백업 파일 복원 버튼(#backup-file-input change)을 처리한다.
 * 되돌릴 수 없는 동작이므로 실행 전 사용자 확인을 받는다.
 * @param {File} file - 업로드된 백업 파일
 */
async function handleImportBackup(file) {
    if (!file) return;
    if (!confirm('백업 파일로 현재 데이터를 덮어씁니다. 계속하시겠습니까?')) return;

    const result = await importBackupData(file);
    if (result.success) {
        alert('백업 데이터 복원이 완료되었습니다.');
        renderCalendar();
        renderDayEvents();
        renderContacts();
    } else {
        alert(result.error || '백업 데이터 복원에 실패했습니다.');
    }
}

/**
 * 전체 데이터 공장 초기화 버튼(#btn-reset-data) 클릭을 처리한다.
 * 되돌릴 수 없는 동작이므로 실행 전 사용자 확인을 받는다.
 */
async function handleResetData() {
    if (!state.isAdmin) return;
    if (!confirm('모든 학사일정과 연락망 데이터를 초기 상태로 되돌립니다. 이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?')) return;

    const result = await resetAllData();
    if (result.success) {
        alert('데이터가 초기 상태로 리셋되었습니다.');
        renderCalendar();
        renderDayEvents();
        renderContacts();
    } else {
        alert(result.error || '데이터 초기화에 실패했습니다.');
    }
}

/**
 * 보안 게이트(#security-code-input, #btn-verify-security) 인증 시도를 처리한다.
 * 관리자 비밀번호로 인증에 성공하면 관련 화면을 함께 갱신한다.
 */
function handleVerifySecurityCode() {
    const inputElement = document.getElementById('security-code-input');
    const errorMsg = document.getElementById('security-error-msg');
    if (!inputElement) return;

    const result = verifySecurityCode(inputElement.value);
    inputElement.value = '';

    if (result.success) {
        if (errorMsg) errorMsg.classList.add('hidden');
        checkSecurityGate();

        if (result.isAdmin) {
            updateAdminUI();
            renderCalendar();
            renderDayEvents();
            renderContacts();
        }
    } else if (errorMsg) {
        errorMsg.classList.remove('hidden');
    }
}

/**
 * 빠른 액션 버튼, 파일 업로드(드래그앤드롭/선택), 백업/복원/리셋, 보안 인증
 * 등 화면 전역에 흩어진 나머지 이벤트 리스너를 바인딩한다.
 * 대상 엘리먼트가 없는 화면에서도 에러 없이 안전하게 동작한다.
 */
function bindGlobalActions() {
    const btnAddEventQuick = document.getElementById('btn-add-event-quick');
    if (btnAddEventQuick) btnAddEventQuick.addEventListener('click', () => showAddEventModal());

    const btnAddContact = document.getElementById('btn-add-contact');
    if (btnAddContact) btnAddContact.addEventListener('click', showAddContactModal);

    const btnSyncNeis = document.getElementById('btn-sync-neis');
    if (btnSyncNeis) btnSyncNeis.addEventListener('click', handleSyncNeisClick);

    const btnDownloadTemplate = document.getElementById('btn-download-template');
    if (btnDownloadTemplate) btnDownloadTemplate.addEventListener('click', downloadCsvTemplate);

    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    if (dropZone && fileInput) {
        dropZone.addEventListener('click', () => {
            if (state.isAdmin) fileInput.click();
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) handleFileSelect(e.target.files[0]);
        });

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (state.isAdmin) dropZone.classList.add('dragover');
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('dragover');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            if (state.isAdmin && e.dataTransfer.files.length > 0) {
                handleFileSelect(e.dataTransfer.files[0]);
            }
        });
    }

    const btnExportData = document.getElementById('btn-export-data');
    if (btnExportData) btnExportData.addEventListener('click', exportAllData);

    const backupFileInput = document.getElementById('backup-file-input');
    const btnImportTrigger = document.getElementById('btn-import-data-trigger');
    if (btnImportTrigger && backupFileInput) {
        btnImportTrigger.addEventListener('click', () => {
            if (state.isAdmin) backupFileInput.click();
        });
        backupFileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) handleImportBackup(e.target.files[0]);
        });
    }

    const btnResetData = document.getElementById('btn-reset-data');
    if (btnResetData) btnResetData.addEventListener('click', handleResetData);

    const btnVerifySecurity = document.getElementById('btn-verify-security');
    if (btnVerifySecurity) btnVerifySecurity.addEventListener('click', handleVerifySecurityCode);

    const securityCodeInput = document.getElementById('security-code-input');
    if (securityCodeInput) {
        securityCodeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleVerifySecurityCode();
        });
    }
}

// ------------------------------------------------------------------
// 4. 앱 초기화 (initApp)
// ------------------------------------------------------------------

/**
 * 앱 전체 초기화 시퀀스를 실행한다.
 * 로컬 데이터 적재 → 인증 세션/보안 게이트 확인 → 관리자 백그라운드 동기화 →
 * 파이어베이스 연동 → 각 뷰 모듈 초기화 → PWA 기동 → 초기 렌더링 순서로 진행된다.
 */
function initApp() {
    // A. 로컬 데이터 적재
    loadLocalStorageData();

    // B. 관리자 세션 및 교직원 보안 게이트 확인
    checkAdminSession();
    updateAdminUI();
    checkSecurityGate();

    // C. 관리자인 경우 백그라운드에서 나이스 자동 동기화 1회 실행
    if (state.isAdmin) {
        autoSyncNeisBackground();
    }

    // D. 파이어베이스 연동 개시 (로컬 재정의 또는 하드코딩 기본값 자동 적용)
    // 실시간 구독 연결은 백그라운드에서 진행하고, 초기 화면은 로컬 데이터로 즉시 렌더링한다.
    initFirebase();

    // E. 각 뷰 모듈 초기화 (DOM 이벤트 바인딩)
    initModalView();
    initCalendarEvents();
    initMealView();
    initContactView();
    initNoticeView();
    initSettingsView();

    // F. 내비게이션 탭 및 전역 액션 바인딩
    initNavTabs();
    bindGlobalActions();

    // G. PWA 환경 기동
    setupPwa();

    // H. 초기 렌더링
    renderCalendar();
    renderDayEvents();
    renderContacts();
    renderNotice();
    syncNoticeForm();
    renderNoticeBoard();

    // I. 상단 오늘 날짜 배지 갱신
    const statusDate = document.getElementById('status-date');
    if (statusDate) {
        statusDate.innerText = `오늘: ${formatDate(new Date())}`;
    }

    // J. 디버깅용 전역 객체 바인딩
    window.state = state;
}

// ------------------------------------------------------------------
// 5. 부트스트랩
// ------------------------------------------------------------------

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
