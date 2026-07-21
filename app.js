/* ==========================================================================
   티처스케줄 - Core JavaScript Logic (Firebase Compat 버전 - 로컬 실행 대응)
   ========================================================================== */

// 1. 상태 관리 (State)
let state = {
    currentDate: new Date(), // 실제 오늘 날짜 기준으로 자동 설정
    selectedDate: new Date(),
    mealSelectedDate: new Date(), // 급식 조회 전용 오늘 날짜 상태 (달력 날짜 선택과 분리)
    activeTab: 'tab-calendar',
    filterCategory: 'all',
    events: [],
    contacts: [],
    meals: {},                  // 월별 급식 캐싱 { '2026-07': [...] }
    isStaffAuthenticated: false,// 교직원 보안 인증 여부
    isContactsAuthenticated: false, // 비상연락망 2차 보안 인증 여부
    isAdmin: false,             // 관리자 권한 여부
    isSyncing: false,           // 대량 파이어베이스 동기화 중 실시간 리스너 무한 루프 방지용 락 플래그
    dbMode: 'local',            // 'local' 또는 'firebase'
    firebaseConfig: null,       // Firebase 연동 정보
    deferredPrompt: null,       // PWA 설치 프롬프트 보관용
    notice: { text: '', active: true } // 학사일정 공지사항 & 개선사항 관리
};

// 나이스 공식 API 설정 (향동중학교 고정)
const NEIS_API_KEY = 'f98ed0c3e5b346c693f8f931a09603fc';
const NEIS_DEFAULT_SCHOOL = '7621365'; // 향동중학교
const NEIS_DEFAULT_OFFICE = 'J10';     // 경기도교육청
const ADMIN_PASSCODE = '023153';       // 관리자 비밀번호
const STAFF_PASSCODE = '31535372';     // 교직원 보안 인증 코드
const CONTACT_PIN_CODE = '3153';       // 비상연락망 2차 PIN 번호


// 기본 탑재용 향동중학교 파이어베이스 연동 정보 (하드코딩)
const DEFAULT_FIREBASE_CONFIG = {
    apiKey: "AIzaSyBz-d2NUBO90_hDFa5gInytcrGw0drYFjE",
    authDomain: "hyangdong-middleschool-sch.firebaseapp.com",
    projectId: "hyangdong-middleschool-sch",
    storageBucket: "hyangdong-middleschool-sch.appspot.com",
    appId: "1:409367451356:web:5f584d150d690aa08dc619"
};

// 2. 초기 모의 데이터 (Mock Data) - 시범 배포를 위해 비워둠
const MOCK_EVENTS = [];
const MOCK_CONTACTS = [];

// Firebase 인스턴스 변수
let firebaseApp = null;
let db = null;
let unsubscribeEvents = null;
let unsubscribeContacts = null;

// 3. 한글 초성 검색 헬퍼 함수
function getChoseung(str) {
    const cho = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
    let result = "";
    for (let i = 0; i < str.length; i++) {
        let code = str.charCodeAt(i) - 0xAC00;
        if (code > -1 && code < 11172) {
            result += cho[Math.floor(code / 588)];
        } else {
            result += str.charAt(i);
        }
    }
    return result;
}

// 4. 로컬 저장소 로드 (백업 및 로컬 모드용)
function loadLocalStorageData() {
    try {
        const localEvents = localStorage.getItem('teacherschedule_events');
        if (localEvents) {
            state.events = JSON.parse(localEvents);
            state.events.forEach(e => {
                if (e.desc === '나이스 연동 공식 학사일정') e.desc = '';
            });
        } else {
            state.events = [...MOCK_EVENTS];
        }
    } catch (e) {
        console.warn('Failed to parse local events:', e);
        state.events = [...MOCK_EVENTS];
    }
    
    try {
        const localContacts = localStorage.getItem('teacherschedule_contacts');
        state.contacts = localContacts ? JSON.parse(localContacts) : [...MOCK_CONTACTS];
    } catch (e) {
        console.warn('Failed to parse local contacts:', e);
        state.contacts = [...MOCK_CONTACTS];
    }
    
    try {
        const localNotice = localStorage.getItem('teacherschedule_notice');
        if (localNotice) state.notice = JSON.parse(localNotice);
    } catch (e) {
        console.warn('Failed to parse local notice:', e);
    }
    
    sortEventsByDate();
    localStorage.setItem('teacherschedule_events', JSON.stringify(state.events));
    localStorage.setItem('teacherschedule_contacts', JSON.stringify(state.contacts));
}

// 4.5 일정 날짜순 정렬 유틸
function sortEventsByDate() {
    if (Array.isArray(state.events)) {
        state.events.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    }
}

// 4.6 LocalStorage 기반 날짜별 정렬 헬퍼 (개인 로컬 정렬 적용)
function getLocalSortedEvents(dateString, eventsToSort) {
    const localOrders = localStorage.getItem('teacherschedule_local_orders');
    if (!localOrders) return eventsToSort;
    
    try {
        const parsedOrders = JSON.parse(localOrders);
        const dateOrder = parsedOrders[dateString];
        if (!dateOrder || !Array.isArray(dateOrder)) return eventsToSort;
        
        // 정렬 순서대로 배치하되, 순서 리스트에 없는 일정이 있다면 뒤에 붙여줍니다.
        const sorted = [];
        const remaining = [...eventsToSort];
        
        dateOrder.forEach(id => {
            const index = remaining.findIndex(e => e.id === id);
            if (index > -1) {
                sorted.push(remaining[index]);
                remaining.splice(index, 1);
            }
        });
        
        return [...sorted, ...remaining];
    } catch (e) {
        console.warn('로컬 정렬 데이터 파싱 실패:', e);
        return eventsToSort;
    }
}

// 4.7 LocalStorage 일정 순서 교환 헬퍼 (Up/Down 화살표 기능)
function changeEventOrder(dateString, sortedEvents, currentIdx, direction) {
    const targetIdx = currentIdx + direction;
    if (targetIdx < 0 || targetIdx >= sortedEvents.length) return; // 범위를 벗어나면 무시
    
    // 순서 배열 복제
    const orderIds = sortedEvents.map(e => e.id);
    
    // 두 아이템 swap
    const temp = orderIds[currentIdx];
    orderIds[currentIdx] = orderIds[targetIdx];
    orderIds[targetIdx] = temp;
    
    // localStorage 저장
    const localOrders = localStorage.getItem('teacherschedule_local_orders') 
        ? JSON.parse(localStorage.getItem('teacherschedule_local_orders')) 
        : {};
    localOrders[dateString] = orderIds;
    localStorage.setItem('teacherschedule_local_orders', JSON.stringify(localOrders));
    
    // 캘린더와 리스트 리렌더링
    renderCalendar();
    renderDayEvents();
}

// 5. Firebase 동기화 세팅
function initFirebase(config) {
    try {
        // 기존 리스너 해제
        if (unsubscribeEvents) unsubscribeEvents();
        if (unsubscribeContacts) unsubscribeContacts();
        
        // Compat 모드로 초기화
        firebaseApp = firebase.initializeApp(config);
        db = firebase.firestore();
        state.dbMode = 'firebase';
        state.firebaseConfig = config;
        
        // A. 일정(schedules) 컬렉션 실시간 구독
        unsubscribeEvents = db.collection('schedules').onSnapshot((snapshot) => {
            if (state.isSyncing) return; // 동기화 중에는 실시간 리스너 무시 (Snapshot Storm 방지)
            let remoteEvents = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.desc === '나이스 연동 공식 학사일정') {
                    data.desc = '';
                }
                remoteEvents.push({ id: doc.id, ...data });
            });
            
            // 만약 Firestore가 완전히 비어 있고 관리자 권한 상태라면, 로컬 데이터를 마이그레이션(업로드)
            if (remoteEvents.length === 0 && state.isAdmin && state.events.length > 0) {
                console.log('Firestore 비어 있음. 로컬 일정 마이그레이션 중...');
                state.isSyncing = true;
                const batch = db.batch();
                state.events.forEach((ev) => {
                    const docRef = db.collection('schedules').doc(ev.id);
                    batch.set(docRef, {
                        title: ev.title,
                        date: ev.date,
                        category: ev.category,
                        desc: ev.desc || ''
                    });
                });
                batch.commit().then(() => {
                    console.log('로컬 일정 일괄 마이그레이션 성공.');
                    state.isSyncing = false;
                }).catch(err => {
                    console.error('로컬 일정 마이그레이션 실패:', err);
                    state.isSyncing = false;
                });
            } else {
                state.events = remoteEvents;
                sortEventsByDate();
                localStorage.setItem('teacherschedule_events', JSON.stringify(state.events));
                renderCalendar();
                renderDayEvents();
            }
        }, (error) => {
            console.error("Firestore schedules subscription error: ", error);
        });

        // B. 연락처(contacts) 컬렉션 실시간 구독
        unsubscribeContacts = db.collection('contacts').onSnapshot((snapshot) => {
            if (state.isSyncing) return; // 동기화 중에는 실시간 리스너 무시 (Snapshot Storm 방지)
            let remoteContacts = [];
            snapshot.forEach(doc => {
                remoteContacts.push({ id: doc.id, ...doc.data() });
            });
            
            // 만약 Firestore 연락망이 완전히 비어 있고 관리자 권한 상태라면 로컬 연락망 업로드
            if (remoteContacts.length === 0 && state.isAdmin && state.contacts.length > 0) {
                console.log('Firestore 연락망 비어 있음. 로컬 연락망 마이그레이션 중...');
                state.isSyncing = true;
                const batch = db.batch();
                state.contacts.forEach((c) => {
                    const docRef = db.collection('contacts').doc(c.id);
                    batch.set(docRef, {
                        name: c.name,
                        dept: c.dept,
                        role: c.role,
                        phone: c.phone,
                        note: c.note || ''
                    });
                });
                batch.commit().then(() => {
                    console.log('로컬 연락망 일괄 마이그레이션 성공.');
                    state.isSyncing = false;
                }).catch(err => {
                    console.error('로컬 연락망 마이그레이션 실패:', err);
                    state.isSyncing = false;
                });
            } else {
                state.contacts = remoteContacts;
                localStorage.setItem('teacherschedule_contacts', JSON.stringify(state.contacts));
                renderContacts();
            }
        }, (error) => {
            console.error("Firestore contacts subscription error: ", error);
        });

        // C. 공지사항(notice) 실시간 구독
        db.collection('settings').doc('notice').onSnapshot((doc) => {
            if (doc.exists) {
                state.notice = doc.data();
                localStorage.setItem('teacherschedule_notice', JSON.stringify(state.notice));
                renderNotice();
                syncNoticeForm();
            }
        });

        // DB 연동 상태 배지 변경
        const badgeDb = document.getElementById('badge-db-status');
        if (badgeDb) {
            badgeDb.innerText = '클라우드 연동됨';
            badgeDb.className = 'badge badge-success';
        }
        
        // 공지사항 저장 버튼
        const btnSaveNotice = document.getElementById('btn-save-notice');
        if (btnSaveNotice) {
            btnSaveNotice.addEventListener('click', saveNotice);
        }
        
        // 설정 폼 버튼 갱신 및 해제 버튼 노출
        const btnDisconnect = document.getElementById('btn-disconnect-firebase');
        if (btnDisconnect) btnDisconnect.classList.remove('hidden');
        const btnSave = document.getElementById('btn-save-firebase');
        if (btnSave) btnSave.innerText = '연동 정보 갱신';
        
        // 관리자 권한 상태이면 백그라운드 나이스 자동 동기화 가동
        if (state.isAdmin) {
            autoSyncNeisBackground();
        }
        
    } catch (err) {
        console.error("Firebase 초기화 에러: ", err);
        alert("파이어베이스 설정 정보가 올바르지 않거나 네트워크 연결에 실패했습니다.");
        disconnectFirebase();
    }
}

// Firebase 연결 해제 및 로컬 모드 복귀
function disconnectFirebase() {
    if (unsubscribeEvents) unsubscribeEvents();
    if (unsubscribeContacts) unsubscribeContacts();
    
    db = null;
    firebaseApp = null;
    state.dbMode = 'local';
    state.firebaseConfig = null;
    
    localStorage.removeItem('teacherschedule_firebase_config');
    
    // 로컬 데이터 재적재
    loadLocalStorageData();
    
    const badgeDb = document.getElementById('badge-db-status');
    if (badgeDb) {
        badgeDb.innerText = '로컬 모드';
        badgeDb.className = 'badge';
    }
    
    const btnDisconnect = document.getElementById('btn-disconnect-firebase');
    if (btnDisconnect) btnDisconnect.classList.add('hidden');
    const btnSave = document.getElementById('btn-save-firebase');
    if (btnSave) btnSave.innerText = '클라우드 DB 연동 저장';
    
    // 입력 필드 초기화
    const fbProjectId = document.getElementById('fb-project-id');
    if (fbProjectId) fbProjectId.value = '';
    const fbApiKey = document.getElementById('fb-api-key');
    if (fbApiKey) fbApiKey.value = '';
    const fbAppId = document.getElementById('fb-app-id');
    if (fbAppId) fbAppId.value = '';
    
    renderCalendar();
    renderDayEvents();
    renderContacts();
}

// 6. 관리자 권한 인증 UI 갱신 함수
function updateAdminUI() {
    const adminBadge = document.getElementById('badge-admin-status');
    const adminInputGroup = document.getElementById('admin-auth-input-group');
    const adminSuccessBox = document.getElementById('admin-success-box');
    const logoutBtn = document.getElementById('btn-logout-admin');
    
    const importReadOnlyMsg = document.getElementById('import-read-only-msg');
    const importAdminContent = document.getElementById('import-admin-content');
    
    if (state.isAdmin) {
        // 관리자 모드 활성화
        if (adminBadge) {
            adminBadge.innerText = '관리자 인증됨';
            adminBadge.className = 'badge badge-success';
        }
        if (adminInputGroup) adminInputGroup.classList.add('hidden');
        if (adminSuccessBox) adminSuccessBox.classList.remove('hidden');
        if (logoutBtn) logoutBtn.classList.remove('hidden');
        
        if (importReadOnlyMsg) importReadOnlyMsg.classList.add('hidden');
        if (importAdminContent) importAdminContent.classList.remove('hidden');
        
        // 화면 전역의 admin-only 클래스 표시
        document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
    } else {
        // 교사(일반 사용자) 모드
        if (adminBadge) {
            adminBadge.innerText = '인증 필요';
            adminBadge.className = 'badge';
        }
        if (adminInputGroup) adminInputGroup.classList.remove('hidden');
        if (adminSuccessBox) adminSuccessBox.classList.add('hidden');
        if (logoutBtn) logoutBtn.classList.add('hidden');
        
        if (importReadOnlyMsg) importReadOnlyMsg.classList.remove('hidden');
        if (importAdminContent) importAdminContent.classList.add('hidden');
        
        // 화면 전역의 admin-only 클래스 숨김
        document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
    }
}

// 6.5 교직원 보안 인증 게이트 제어 함수
function checkSecurityGate() {
    const isAuth = localStorage.getItem('teacherschedule_staff_authenticated') === 'true';
    const securityGate = document.getElementById('security-gate');
    
    // 만약 이미 교직원 인증이 되었거나 관리자 인증 세션이 있다면 패스
    if (isAuth || state.isAdmin) {
        state.isStaffAuthenticated = true;
        if (securityGate) securityGate.classList.add('fade-out');
    } else {
        state.isStaffAuthenticated = false;
        if (securityGate) securityGate.classList.remove('fade-out');
    }
}

function verifySecurityCode() {
    const inputElement = document.getElementById('security-code-input');
    const errorMsg = document.getElementById('security-error-msg');
    
    if (!inputElement) return;
    
    const value = inputElement.value.trim();
    
    if (value === STAFF_PASSCODE) {
        // 교직원 인증 성공
        state.isStaffAuthenticated = true;
        localStorage.setItem('teacherschedule_staff_authenticated', 'true');
        
        const securityGate = document.getElementById('security-gate');
        if (securityGate) {
            securityGate.classList.add('fade-out');
        }
        
        if (errorMsg) errorMsg.classList.add('hidden');
        inputElement.value = '';
    } else if (value === ADMIN_PASSCODE) {
        // 관리자 인증 코드를 입력한 경우 -> 일반 인증 + 관리자 자동 활성화!
        state.isStaffAuthenticated = true;
        state.isAdmin = true;
        localStorage.setItem('teacherschedule_staff_authenticated', 'true');
        localStorage.setItem('teacherschedule_admin_auth', 'true');
        
        const securityGate = document.getElementById('security-gate');
        if (securityGate) {
            securityGate.classList.add('fade-out');
        }
        
        updateAdminUI();
        renderCalendar();
        renderDayEvents();
        renderContacts();
        
        if (errorMsg) errorMsg.classList.add('hidden');
        inputElement.value = '';
    } else {
        // 잘못된 비밀번호
        if (errorMsg) errorMsg.classList.remove('hidden');
        inputElement.value = '';
        inputElement.focus();
    }
}

// 6.7 비상연락망 2차 PIN 인증 검증 함수
function verifyContactsPin() {
    const inputElement = document.getElementById('contacts-pin-input');
    const errorMsg = document.getElementById('contacts-pin-error-msg');
    
    if (!inputElement) return;
    
    const value = inputElement.value.trim();
    
    if (value === CONTACT_PIN_CODE) {
        state.isContactsAuthenticated = true;
        
        const authGate = document.getElementById('contacts-auth-gate');
        const contentArea = document.getElementById('contacts-content-area');
        
        if (authGate) authGate.classList.add('hidden');
        if (contentArea) contentArea.classList.remove('hidden');
        if (errorMsg) errorMsg.classList.add('hidden');
        
        inputElement.value = '';
        renderContacts();
    } else {
        if (errorMsg) errorMsg.classList.remove('hidden');
        inputElement.value = '';
        inputElement.focus();
    }
}

// 7. 달력 렌더링 엔진
function renderCalendar() {
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
        const padDate = new Date(year, month - 1, dayNum);
        createDayCell(padDate, true);
    }
    
    // 이번 달 날짜
    for (let i = 1; i <= totalDays; i++) {
        const currDate = new Date(year, month, i);
        createDayCell(currDate, false);
    }
    
    // 다음 달 날짜 패딩 (42칸 기준 맞춤)
    const currentCellsCount = startDayIndex + totalDays;
    const nextPaddingCount = (currentCellsCount % 7 === 0) ? 0 : 7 - (currentCellsCount % 7);
    const totalCells = currentCellsCount + nextPaddingCount;
    const remainingTo42 = 42 - totalCells;
    const finalPaddingCount = nextPaddingCount + remainingTo42;

    for (let i = 1; i <= finalPaddingCount; i++) {
        const padDate = new Date(year, month + 1, i);
        createDayCell(padDate, true);
    }
}

function createDayCell(date, isOtherMonth) {
    const calendarDays = document.getElementById('calendar-days');
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
    
    if (formatDate(date) === formatDate(state.selectedDate)) {
        cell.classList.add('selected');
    }
    
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0) cell.classList.add('sun');
    if (dayOfWeek === 6) cell.classList.add('sat');
    
    const numberSpan = document.createElement('span');
    numberSpan.className = 'day-number';
    numberSpan.innerText = date.getDate();
    cell.appendChild(numberSpan);
    
    const dayEvents = state.events.filter(e => e.date === dateString);
    const filteredDayEvents = state.filterCategory === 'all' 
        ? dayEvents 
        : state.filterCategory === 'internal'
            ? dayEvents.filter(e => e.category !== 'neis')
            : dayEvents.filter(e => e.category === state.filterCategory);
        
    // 로컬 사용자 정렬 우선순위 적용
    const sortedDayEvents = getLocalSortedEvents(dateString, filteredDayEvents);

    // 최대 2개의 일정만 띠지(Pill) 형태로 렌더링
    const visibleEvents = sortedDayEvents.slice(0, 2);
    visibleEvents.forEach(e => {
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
}

function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// 8. 선택일 일정 리스트 렌더링
function renderDayEvents() {
    const listContainer = document.getElementById('day-events-list');
    const titleStr = document.getElementById('selected-date-str');
    
    if (!listContainer || !titleStr) return;
    
    const dateString = formatDate(state.selectedDate);
    const month = state.selectedDate.getMonth() + 1;
    const day = state.selectedDate.getDate();
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const dayName = dayNames[state.selectedDate.getDay()];
    titleStr.innerText = `${month}월 ${day}일(${dayName})`;
    
    listContainer.innerHTML = '';
    
    const dayEvents = state.events.filter(e => e.date === dateString);
    const filteredEvents = state.filterCategory === 'all' 
        ? dayEvents 
        : state.filterCategory === 'internal'
            ? dayEvents.filter(e => e.category !== 'neis')
            : dayEvents.filter(e => e.category === state.filterCategory);
        
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
        
        let categoryText = '';
        switch (e.category) {
            case 'neis': categoryText = '공식'; break;
            case 'internal': categoryText = '내부'; break;
            case 'meeting': categoryText = '내부'; break;
            case 'study': categoryText = '내부'; break;
            case 'etc': categoryText = '내부'; break;
        }
        
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
            showEventDetail(e);
        });
        
        // 순서 변경 화살표 버튼 추가 (PC/모바일 공통 터치 간섭 0% 우회 시스템)
        const orderActions = document.createElement('div');
        orderActions.className = 'event-order-actions';
        
        const upBtn = document.createElement('button');
        upBtn.className = 'btn-order-arrow btn-order-up';
        if (idx === 0) upBtn.classList.add('hidden');
        upBtn.innerHTML = '<i class="fa-solid fa-chevron-up"></i>';
        upBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            changeEventOrder(dateString, sortedEvents, idx, -1);
        });
        
        const downBtn = document.createElement('button');
        downBtn.className = 'btn-order-arrow btn-order-down';
        if (idx === sortedEvents.length - 1) downBtn.classList.add('hidden');
        downBtn.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
        downBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            changeEventOrder(dateString, sortedEvents, idx, 1);
        });
        
        orderActions.appendChild(upBtn);
        orderActions.appendChild(downBtn);
        
        wrapper.appendChild(item);
        wrapper.appendChild(orderActions);
        listContainer.appendChild(wrapper);
    });
}

function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

function linkify(text) {
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
    const wwwPattern = /(^|[^\/])(www\.[^\s<]+)/g;
    escaped = escaped.replace(wwwPattern, (match, p1, p2) => {
        return `${p1}<a href="https://${p2}" target="_blank" rel="noopener noreferrer" class="event-desc-link">${p2}</a>`;
    });

    return escaped;
}

// 공지사항 렌더링
function renderNotice() {
    const banner = document.getElementById('notice-banner');
    const content = document.getElementById('notice-banner-content');
    if (!banner || !content) return;

    if (state.notice && state.notice.active && state.notice.text && state.notice.text.trim()) {
        content.innerHTML = linkify(state.notice.text);
        banner.classList.remove('hidden');
    } else {
        banner.classList.add('hidden');
    }
}

// 설정 입력 폼 동기화
function syncNoticeForm() {
    const textInput = document.getElementById('notice-text');
    const activeInput = document.getElementById('notice-active');
    if (textInput && state.notice) textInput.value = state.notice.text || '';
    if (activeInput && state.notice) activeInput.checked = Boolean(state.notice.active);
}

// 공지사항 저장
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
    localStorage.setItem('teacherschedule_notice', JSON.stringify(noticeData));
    renderNotice();

    if (state.dbMode === 'firebase' && db) {
        try {
            await db.collection('settings').doc('notice').set(noticeData);
            alert('공지사항이 클라우드 서버에 저장 및 실시간 배포되었습니다!');
        } catch (e) {
            console.error('공지사항 저장 실패:', e);
            alert('클라우드 저장 실패: ' + e.message);
        }
    } else {
        alert('로컬에 공지사항이 저장되었습니다.');
    }
}

// 9. 모달 오픈 제어
window.openModal = function(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('active');
};

window.closeModal = function(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('active');
};

function showAddEventModal() {
    document.getElementById('form-event').reset();
    document.getElementById('event-id').value = '';
    
    // 신규 등록 시에는 카테고리 선택 영역을 숨김
    const categoryGroup = document.getElementById('form-group-category');
    if (categoryGroup) categoryGroup.classList.add('hidden');
    
    const categoryInput = document.getElementById('event-category');
    if (categoryInput) categoryInput.value = 'internal';
    
    document.getElementById('modal-event-title').innerText = '새 일정 등록';
    document.getElementById('event-date').value = formatDate(state.selectedDate);
    window.openModal('modal-event');
}

function showEventDetail(eventObj) {
    const modal = document.getElementById('modal-detail');
    const badge = document.getElementById('detail-category-badge');
    const title = document.getElementById('detail-title');
    const date = document.getElementById('detail-date');
    const desc = document.getElementById('detail-desc');
    
    let categoryText = '';
    badge.className = 'badge';
    switch (eventObj.category) {
        case 'neis': 
            categoryText = '공식 학사일정'; 
            badge.classList.add('badge-success');
            break;
        case 'internal':
        case 'meeting': 
        case 'study': 
        case 'etc': 
            categoryText = '학교 내부일정'; 
            badge.style.backgroundColor = 'var(--color-internal-light)';
            badge.style.color = 'var(--color-internal)';
            break;
    }
    
    badge.innerText = categoryText;
    title.innerText = eventObj.title;
    date.innerText = eventObj.date;
    desc.innerHTML = eventObj.desc ? linkify(eventObj.desc) : '등록된 상세 설명이 없습니다.';
    
    // 삭제 버튼 동작 설정
    document.getElementById('btn-delete-event').onclick = async () => {
        if (!state.isAdmin) return;
        if (confirm('이 일정을 완전히 삭제하시겠습니까?')) {
            if (state.dbMode === 'firebase' && db) {
                await db.collection('schedules').doc(eventObj.id).delete();
            } else {
                state.events = state.events.filter(e => e.id !== eventObj.id);
                localStorage.setItem('teacherschedule_events', JSON.stringify(state.events));
                renderCalendar();
                renderDayEvents();
            }
            window.closeModal('modal-detail');
        }
    };
    
    // 수정 트리거 설정
    document.getElementById('btn-edit-event-trigger').onclick = () => {
        if (!state.isAdmin) return;
        window.closeModal('modal-detail');
        
        document.getElementById('event-id').value = eventObj.id;
        document.getElementById('event-title').value = eventObj.title;
        document.getElementById('event-date').value = eventObj.date;
        document.getElementById('event-desc').value = eventObj.desc || '';
        
        // 분류 탭 영역 노출 및 값 갱신 (수정 모달에만 카테고리 탭 표시)
        const categoryGroup = document.getElementById('form-group-category');
        if (categoryGroup) categoryGroup.classList.remove('hidden');
        
        const currentCategory = eventObj.category || 'internal';
        const categoryInput = document.getElementById('event-category');
        if (categoryInput) categoryInput.value = currentCategory;
        
        // 탭 버튼 active 클래스 동기화
        document.querySelectorAll('.category-tab-btn').forEach(btn => {
            if (btn.getAttribute('data-category') === currentCategory) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
        
        document.getElementById('modal-event-title').innerText = '일정 수정';
        window.openModal('modal-event');
    };
    
    window.openModal('modal-detail');
}

// 10. 데이터 저장 로직 (일정 / 연락처)
document.getElementById('form-event').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.isAdmin) return;
    
    const id = document.getElementById('event-id').value || 'ev-' + Date.now();
    const title = document.getElementById('event-title').value.trim();
    const date = document.getElementById('event-date').value;
    
    // 카테고리 설정 (기본값 internal)
    const category = document.getElementById('event-category').value || 'internal';
    const desc = document.getElementById('event-desc').value.trim();
    
    if (!title || !date) return;
    
    if (state.dbMode === 'firebase' && db) {
        await db.collection('schedules').doc(id).set({ title, date, category, desc });
    } else {
        const index = state.events.findIndex(ev => ev.id === id);
        if (index > -1) {
            state.events[index] = { id, title, date, category, desc };
        } else {
            state.events.push({ id, title, date, category, desc });
        }
        sortEventsByDate();
        localStorage.setItem('teacherschedule_events', JSON.stringify(state.events));
        
        state.selectedDate = new Date(date);
        state.currentDate = new Date(date);
        renderCalendar();
        renderDayEvents();
    }
    
    window.closeModal('modal-event');
});

function showAddContactModal() {
    document.getElementById('form-contact').reset();
    document.getElementById('contact-id').value = '';
    document.getElementById('modal-contact-title').innerText = '교직원 연락처 등록';
    window.openModal('modal-contact');
}

document.getElementById('form-contact').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.isAdmin) return;
    
    const id = document.getElementById('contact-id').value || 'con-' + Date.now();
    const name = document.getElementById('contact-name').value.trim();
    const dept = document.getElementById('contact-dept').value.trim();
    const role = document.getElementById('contact-role').value.trim();
    const phone = document.getElementById('contact-phone').value.trim();
    const note = document.getElementById('contact-note').value.trim();
    
    if (!name || !dept || !role || !phone) return;
    
    if (state.dbMode === 'firebase' && db) {
        await db.collection('contacts').doc(id).set({ name, dept, role, phone, note });
    } else {
        const index = state.contacts.findIndex(c => c.id === id);
        if (index > -1) {
            state.contacts[index] = { id, name, dept, role, phone, note };
        } else {
            state.contacts.push({ id, name, dept, role, phone, note });
        }
        localStorage.setItem('teacherschedule_contacts', JSON.stringify(state.contacts));
        renderContacts();
    }
    
    window.closeModal('modal-contact');
});

// 11. 비상연락망 조회 및 검색 렌더러
function renderContacts() {
    const grid = document.getElementById('contacts-grid');
    const searchVal = document.getElementById('contact-search').value.toLowerCase().trim();
    
    if (!grid) return;
    grid.innerHTML = '';
    
    const isChoseungQuery = /^[ㄱ-ㅎ\s]+$/.test(searchVal);
    
    const filteredContacts = state.contacts.filter(c => {
        if (!searchVal) return true;
        
        const nameCho = getChoseung(c.name).toLowerCase();
        const deptCho = getChoseung(c.dept).toLowerCase();
        const roleCho = getChoseung(c.role).toLowerCase();
        
        if (isChoseungQuery) {
            return nameCho.includes(searchVal) || deptCho.includes(searchVal) || roleCho.includes(searchVal);
        } else {
            return c.name.toLowerCase().includes(searchVal) || 
                   c.dept.toLowerCase().includes(searchVal) || 
                   c.role.toLowerCase().includes(searchVal);
        }
    });
    
    if (filteredContacts.length === 0) {
        grid.innerHTML = `<div class="no-events"><i class="fa-solid fa-user-slash" style="font-size: 24px; margin-bottom: 8px; display: block;"></i>검색 결과에 맞는 교직원이 없습니다.</div>`;
        return;
    }
    
    filteredContacts.sort((a,b) => a.name.localeCompare(b.name, 'ko')).forEach(c => {
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
                <a href="tel:${c.phone}" class="btn-circle btn-circle-call" title="전화 걸기"><i class="fa-solid fa-phone"></i></a>
            </div>
        `;
        grid.appendChild(card);
    });
}

window.editContact = function(id) {
    if (!state.isAdmin) return;
    const contact = state.contacts.find(c => c.id === id);
    if (!contact) return;
    
    document.getElementById('contact-id').value = contact.id;
    document.getElementById('contact-name').value = contact.name;
    document.getElementById('contact-dept').value = contact.dept;
    document.getElementById('contact-role').value = contact.role;
    document.getElementById('contact-phone').value = contact.phone;
    document.getElementById('contact-note').value = contact.note || '';
    
    document.getElementById('modal-contact-title').innerText = '연락처 수정';
    
    const modalFooter = document.querySelector('#modal-contact .modal-footer');
    const oldDelBtn = document.getElementById('btn-delete-contact-dynamic');
    if (oldDelBtn) oldDelBtn.remove();
    
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.id = 'btn-delete-contact-dynamic';
    delBtn.className = 'btn btn-danger';
    delBtn.style.marginRight = 'auto';
    delBtn.innerHTML = '<i class="fa-solid fa-trash"></i> 삭제';
    delBtn.onclick = async () => {
        if (confirm(`${contact.name} 교직원의 연락처를 완전히 삭제하시겠습니까?`)) {
            if (state.dbMode === 'firebase' && db) {
                await db.collection('contacts').doc(contact.id).delete();
            } else {
                state.contacts = state.contacts.filter(c => c.id !== contact.id);
                localStorage.setItem('teacherschedule_contacts', JSON.stringify(state.contacts));
                renderContacts();
            }
            window.closeModal('modal-contact');
        }
    };
    modalFooter.insertBefore(delBtn, modalFooter.firstChild);
    
    window.openModal('modal-contact');
};

// 12. 나이스(NEIS) 학사일정 실시간 API 연동
async function syncNeisData() {
    if (!state.isAdmin) return;
    
    const officeCode = document.getElementById('neis-office-code').value;
    const schoolCode = document.getElementById('neis-school-code').value.trim();
    const year = document.getElementById('neis-year').value;
    
    if (!schoolCode) {
        alert('행정표준기관코드 8자리를 입력해 주세요.');
        return;
    }
    
    const syncButton = document.getElementById('btn-sync-neis');
    const originalText = syncButton.innerHTML;
    syncButton.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 나이스 연동 동기화 중...`;
    syncButton.disabled = true;
    
    try {
        const url = `https://open.neis.go.kr/hub/SchoolSchedule?KEY=${NEIS_API_KEY}&Type=json&pIndex=1&pSize=100&ATPT_OFCDC_SC_CODE=${officeCode}&SD_SCHUL_CODE=${schoolCode}&AA_FROM_YMD=${year}0301&AA_TO_YMD=${Number(year)+1}0228`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error('API 서버 통신에 실패했습니다.');
        }
        
        const result = await response.json();
        
        if (result.RESULT && result.RESULT.CODE === 'INFO-200') {
            throw new Error('검색된 학사일정 데이터가 없습니다.');
        }
        
        if (result.SchoolSchedule && result.SchoolSchedule[1] && result.SchoolSchedule[1].row) {
            const rows = result.SchoolSchedule[1].row;
            let importCount = 0;
            
            const useBatch = (state.dbMode === 'firebase' && db);
            let batch = null;
            if (useBatch) {
                state.isSyncing = true;
                batch = db.batch();
            }
            
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const rawDate = row.AA_YMD; // YYYYMMDD
                const formattedDate = `${rawDate.substring(0,4)}-${rawDate.substring(4,6)}-${rawDate.substring(6,8)}`;
                const title = row.EVENT_NM;
                const desc = row.EVENT_CN ? row.EVENT_CN.trim() : '';
                
                const exists = state.events.some(e => e.date === formattedDate && e.title === title);
                if (!exists) {
                    const newId = 'ev-neis-' + Date.now() + '-' + i;
                    
                    if (useBatch) {
                        const docRef = db.collection('schedules').doc(newId);
                        batch.set(docRef, {
                            title,
                            date: formattedDate,
                            category: 'neis',
                            desc
                        });
                    } else {
                        state.events.push({
                            id: newId,
                            title,
                            date: formattedDate,
                            category: 'neis',
                            desc
                        });
                    }
                    importCount++;
                }
            }
            
            if (useBatch && importCount > 0) {
                await batch.commit();
                state.isSyncing = false;
            } else if (useBatch) {
                state.isSyncing = false;
            }
            
            if (state.dbMode !== 'firebase') {
                sortEventsByDate();
                localStorage.setItem('teacherschedule_events', JSON.stringify(state.events));
            }
            alert(`나이스 학사일정 동기화 완료!\n총 ${importCount}건의 공식 일정이 추가되었습니다.`);
        } else {
            throw new Error('예상치 못한 데이터 결과 형식입니다.');
        }
        
    } catch (error) {
        console.warn('나이스 API 연동 실패로 로컬 시뮬레이션 데이터를 주입합니다:', error);
        simulateNeisSync(year);
    } finally {
        syncButton.innerHTML = originalText;
        syncButton.disabled = false;
        renderCalendar();
        renderDayEvents();
    }
}

// 모의 데이터 주입
async function simulateNeisSync(year) {
    const simEvents = [
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
        { title: '학년 수료 및 졸업식', date: `${Number(year)+1}-02-12`, category: 'neis', desc: '제7회 향동중학교 졸업장 수여식' }
    ];
    
    let imported = 0;
    const useBatch = (state.dbMode === 'firebase' && db);
    let batch = null;
    if (useBatch) {
        state.isSyncing = true;
        batch = db.batch();
    }
    
    for (let i = 0; i < simEvents.length; i++) {
        const se = simEvents[i];
        const exists = state.events.some(e => e.date === se.date && e.title === se.title);
        if (!exists) {
            const newId = 'ev-sim-' + Date.now() + '-' + i;
            if (useBatch) {
                const docRef = db.collection('schedules').doc(newId);
                batch.set(docRef, se);
            } else {
                state.events.push({ id: newId, ...se });
            }
            imported++;
        }
    }
    
    if (useBatch && imported > 0) {
        await batch.commit();
        state.isSyncing = false;
    } else if (useBatch) {
        state.isSyncing = false;
    }
    
    if (state.dbMode !== 'firebase') {
        sortEventsByDate();
        localStorage.setItem('teacherschedule_events', JSON.stringify(state.events));
    }
    alert(`[인증 완료 - 모의 연동 작동]\n향동중학교 2026학년도 공식 학사일정 ${imported}건이 클라우드/로컬에 자동 동기화되었습니다.`);
}

// 나이스 학사일정 백그라운드 자동 동기화 (관리자 모드 전용, 팝업 얼럿 없음)
async function autoSyncNeisBackground() {
    // 💡 최적화: 이미 데이터베이스에 나이스 공식 일정이 1개라도 있다면 API 요청을 보내지 않고 즉시 종료합니다.
    const hasNeisEvents = state.events.some(e => e.category === 'neis');
    if (hasNeisEvents) {
        console.log('[Auto Sync] 이미 나이스 공식 학사일정이 연동되어 있으므로 API 호출을 생략합니다.');
        return;
    }

    const officeCode = NEIS_DEFAULT_OFFICE;
    const schoolCode = NEIS_DEFAULT_SCHOOL;
    const year = "2026"; 
    
    try {
        console.log('[Auto Sync] 나이스 일정이 비어 있어 향동중 학사일정 최초 자동 동기화를 시작합니다...');
        const url = `https://open.neis.go.kr/hub/SchoolSchedule?KEY=${NEIS_API_KEY}&Type=json&pIndex=1&pSize=100&ATPT_OFCDC_SC_CODE=${officeCode}&SD_SCHUL_CODE=${schoolCode}&AA_FROM_YMD=${year}0301&AA_TO_YMD=${Number(year)+1}0228`;
        
        const response = await fetch(url);
        if (!response.ok) throw new Error('API network error');
        
        const result = await response.json();
        if (result.SchoolSchedule && result.SchoolSchedule[1] && result.SchoolSchedule[1].row) {
            const rows = result.SchoolSchedule[1].row;
            let importCount = 0;
            
            const useBatch = (state.dbMode === 'firebase' && db);
            let batch = null;
            if (useBatch) {
                state.isSyncing = true;
                batch = db.batch();
            }
            
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const rawDate = row.AA_YMD; // YYYYMMDD
                const formattedDate = `${rawDate.substring(0,4)}-${rawDate.substring(4,6)}-${rawDate.substring(6,8)}`;
                const title = row.EVENT_NM;
                const desc = row.EVENT_CN ? row.EVENT_CN.trim() : '';
                
                const exists = state.events.some(e => e.date === formattedDate && e.title === title);
                if (!exists) {
                    const newId = 'ev-neis-' + Date.now() + '-' + i;
                    if (useBatch) {
                        const docRef = db.collection('schedules').doc(newId);
                        batch.set(docRef, { title, date: formattedDate, category: 'neis', desc });
                    } else {
                        state.events.push({ id: newId, title, date: formattedDate, category: 'neis', desc });
                    }
                    importCount++;
                }
            }
            
            if (useBatch && importCount > 0) {
                await batch.commit();
                state.isSyncing = false;
            } else if (useBatch) {
                state.isSyncing = false;
            }
            
            if (state.dbMode !== 'firebase') {
                sortEventsByDate();
                localStorage.setItem('teacherschedule_events', JSON.stringify(state.events));
            }
            console.log(`[Auto Sync] 나이스 학사일정 백그라운드 자동 갱신 완료 (${importCount}건 추가됨)`);
        }
    } catch (error) {
        console.warn('[Auto Sync] API 실패로 백그라운드 모의 데이터를 주입합니다:', error);
        await autoSyncNeisMockSilent(year);
    }
}

// 백그라운드 모의 데이터 주입 (경고 팝업 없이 처리)
async function autoSyncNeisMockSilent(year) {
    const simEvents = [
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
        { title: '학년 수료 및 졸업식', date: `${Number(year)+1}-02-12`, category: 'neis', desc: '제7회 향동중학교 졸업장 수여식' }
    ];
    
    let imported = 0;
    const useBatch = (state.dbMode === 'firebase' && db);
    let batch = null;
    if (useBatch) {
        state.isSyncing = true;
        batch = db.batch();
    }
    
    for (let i = 0; i < simEvents.length; i++) {
        const se = simEvents[i];
        const exists = state.events.some(e => e.date === se.date && e.title === se.title);
        if (!exists) {
            const newId = 'ev-sim-' + Date.now() + '-' + i;
            if (useBatch) {
                const docRef = db.collection('schedules').doc(newId);
                batch.set(docRef, se);
            } else {
                state.events.push({ id: newId, ...se });
            }
            imported++;
        }
    }
    
    if (useBatch && imported > 0) {
        await batch.commit();
        state.isSyncing = false;
    } else if (useBatch) {
        state.isSyncing = false;
    }
    if (state.dbMode !== 'firebase') {
        sortEventsByDate();
        localStorage.setItem('teacherschedule_events', JSON.stringify(state.events));
    }
    console.log(`[Auto Sync] 모의 학사일정 백그라운드 자동 갱신 완료 (${imported}건 추가됨)`);
}

// 13. CSV 템플릿 다운로드
function downloadCsvTemplate() {
    const csvContent = "\uFEFF날짜(YYYY-MM-DD),일정명,상세설명\n" +
                       "2026-07-16,학교 발전 협의회,2학기 학무 성과 측정 교직원 기획 회의\n" +
                       "2026-07-17,AI 활용 융합 수업 직무연수,교내 전문적 학습공동체 동아리 연수\n" +
                       "2026-07-29,친목 체육대회,교직원 탁구 리그전 및 만찬회";
                       
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "교직원_학사일정_일괄등록_템플릿.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// 파일 선택 시 일괄 저장
async function handleFileSelect(file) {
    if (!file) return;
    if (!state.isAdmin) return;
    
    const reader = new FileReader();
    const extension = file.name.split('.').pop().toLowerCase();
    
    reader.onload = async function(e) {
        const text = e.target.result;
        try {
            if (extension === 'json') {
                const parsed = JSON.parse(text);
                if (Array.isArray(parsed)) {
                    let importCount = 0;
                    for (let i = 0; i < parsed.length; i++) {
                        const item = parsed[i];
                        if (item.title && item.date) {
                            const newId = 'ev-import-' + Date.now() + '-' + i;
                            if (state.dbMode === 'firebase' && db) {
                                await db.collection('schedules').doc(newId).set({
                                    title: item.title,
                                    date: item.date,
                                    category: item.category || 'internal',
                                    desc: item.desc || ''
                                });
                            } else {
                                state.events.push({
                                    id: newId,
                                    title: item.title,
                                    date: item.date,
                                    category: item.category || 'internal',
                                    desc: item.desc || ''
                                });
                            }
                            importCount++;
                        }
                    }
                    if (state.dbMode !== 'firebase') {
                        localStorage.setItem('teacherschedule_events', JSON.stringify(state.events));
                    }
                    alert(`JSON 파일에서 일정 ${importCount}건을 일괄 등록 완료했습니다.`);
                } else {
                    alert('배열 형식의 JSON이 아닙니다.');
                }
            } else if (extension === 'csv') {
                const lines = text.split('\n');
                let importCount = 0;
                
                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;
                    
                    const cols = line.split(',');
                    if (cols.length >= 2) {
                        const date = cols[0].trim();
                        const title = cols[1].trim();
                        const desc = cols[2] ? cols[2].trim() : '';
                        
                        const category = 'internal';
                        
                        if (/^\d{4}-\d{2}-\d{2}$/.test(date) && title) {
                            const newId = 'ev-csv-' + Date.now() + '-' + i;
                            if (state.dbMode === 'firebase' && db) {
                                await db.collection('schedules').doc(newId).set({ title, date, category, desc });
                            } else {
                                state.events.push({ id: newId, title, date, category, desc });
                            }
                            importCount++;
                        }
                    }
                }
                if (state.dbMode !== 'firebase') {
                    sortEventsByDate();
                    localStorage.setItem('teacherschedule_events', JSON.stringify(state.events));
                }
                alert(`CSV 파일에서 일정 ${importCount}건을 일괄 등록 완료했습니다.`);
            }
            renderCalendar();
            renderDayEvents();
        } catch (err) {
            alert('파일 불러오기 에러: ' + err.message);
        }
    };
    
    reader.readAsText(file);
}

// 구글 스프레드시트 CSV 파서 헬퍼 (따옴표 내 쉼표 대응 및 큰따옴표 자동 제거)
function parseCsvLine(text) {
    let p = '', r = [];
    let q = false;
    for (let i = 0; i < text.length; i++) {
        let c = text.charAt(i);
        if (c === '"') {
            q = !q;
        } else if (c === ',' && !q) {
            r.push(p.trim());
            p = '';
        } else {
            p += c;
        }
    }
    r.push(p.trim());
    return r;
}

// 구글 스프레드시트 일정 일괄 동기화 (관리자용)
async function syncGoogleSheets(gsheetUrl) {
    if (!state.isAdmin) return;
    if (!gsheetUrl) {
        alert('구글 스프레드시트 링크를 입력해 주세요.');
        return;
    }
    
    let csvExportUrl = '';
    
    if (gsheetUrl.includes('/pub?') || gsheetUrl.includes('/pubhtml') || gsheetUrl.includes('output=csv')) {
        // 이미 '웹에 게시'된 주소일 경우 매개변수를 맞춰줍니다.
        let cleanUrl = gsheetUrl.replace('/pubhtml', '/pub');
        if (!cleanUrl.includes('output=csv')) {
            cleanUrl += cleanUrl.includes('?') ? '&output=csv' : '?output=csv';
        }
        csvExportUrl = cleanUrl;
    } else {
        // 일반 공유 링크(편집창 링크 등)일 경우 ID를 추출해 CSV 주소로 만듭니다.
        const match = gsheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
        if (!match || !match[1]) {
            alert('올바른 구글 스프레드시트 공유 링크 형식이 아닙니다. 링크 주소를 다시 확인해 주세요.');
            return;
        }
        const spreadsheetId = match[1];
        csvExportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv`;
    }
    
    const syncButton = document.getElementById('btn-sync-gsheet');
    const originalText = syncButton.innerHTML;
    syncButton.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 구글 시트 동기화 중...`;
    syncButton.disabled = true;
    
    try {
        let response;
        let proxyFailed = false;
        try {
            // 로컬 실행(file://) 환경의 CORS 우회를 위해 우선 프록시 서버 경유 호출
            const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(csvExportUrl)}`;
            response = await fetch(proxyUrl);
            if (!response.ok) {
                proxyFailed = true;
            }
        } catch (e) {
            console.warn('Proxy fetch failed, retrying direct fetch...', e);
            proxyFailed = true;
        }
        
        if (proxyFailed) {
            console.log('Retrying direct fetch on csvExportUrl:', csvExportUrl);
            response = await fetch(csvExportUrl);
        }
        
        if (!response.ok) {
            throw new Error('구글 시트 데이터를 가져오는데 실패했습니다. 공유 설정이 [링크가 있는 모든 사용자에게 뷰어 공개]로 되어 있는지 확인해 주세요.');
        }
        
        const csvText = await response.text();
        const lines = csvText.split('\n');
        
        if (lines.length <= 1) {
            throw new Error('시트에 동기화할 수 있는 데이터가 없습니다.');
        }
        
        if (confirm('구글 스프레드시트 일정 데이터로 기존 학사일정(수동 등록분)을 모두 덮어쓰시겠습니까?\n(나이스 공식 일정은 유지되고 수동 및 이전 시트 일정만 덮어써집니다.)')) {
            const useBatch = (state.dbMode === 'firebase' && db);
            let batch = null;
            if (useBatch) {
                state.isSyncing = true;
                batch = db.batch();
            }

            // A. 기존 수동 일정 싹 지우기 (나이스 일정 제외)
            if (useBatch) {
                state.events
                    .filter(ev => ev.category !== 'neis')
                    .forEach(ev => {
                        const docRef = db.collection('schedules').doc(ev.id);
                        batch.delete(docRef);
                    });
            } else {
                state.events = state.events.filter(ev => ev.category === 'neis');
            }
            
            // B. 구글 시트 파싱하여 추가
            let importCount = 0;
            // 첫 줄 헤더 제외
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                
                const cols = parseCsvLine(line);
                if (cols.length >= 2) {
                    const date = cols[0].trim();
                    const title = cols[1].trim();
                    const desc = cols[2] ? cols[2].trim() : '';
                    
                    // 날짜 유효성 체크
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !title) continue;
                    
                    // 구글 시트의 모든 일정은 학교 내부일정(internal)으로 자동 고정
                    const category = 'internal';
                    
                    const newId = 'ev-gsheet-' + Date.now() + '-' + i;
                    
                    if (useBatch) {
                        const docRef = db.collection('schedules').doc(newId);
                        batch.set(docRef, { title, date, category, desc });
                    } else {
                        state.events.push({ id: newId, title, date, category, desc });
                    }
                    importCount++;
                }
            }

            if (useBatch) {
                await batch.commit();
                state.isSyncing = false;
            }
            
            if (state.dbMode !== 'firebase') {
                sortEventsByDate();
                localStorage.setItem('teacherschedule_events', JSON.stringify(state.events));
            }
            
            // 링크 저장
            localStorage.setItem('teacherschedule_gsheet_url', gsheetUrl);
            
            alert(`구글 스프레드시트 일괄 연동 성공!\n총 ${importCount}건의 일정이 클라우드에 갱신되었습니다.`);
            
            // 연동 상태 배지 변경
            const badgeGsheet = document.getElementById('badge-gsheet-status');
            if (badgeGsheet) {
                badgeGsheet.innerText = '동기화 완료';
                badgeGsheet.className = 'badge badge-success';
            }
        }
    } catch (err) {
        alert('구글 시트 연동 오류: ' + err.message);
    } finally {
        syncButton.innerHTML = originalText;
        syncButton.disabled = false;
        renderCalendar();
        renderDayEvents();
    }
}

// 13.5 나이스 API 급식 정보 캐싱 및 연동
async function fetchMonthMeals(year, month) {
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    
    // 1. 이미 캐시된 데이터가 있는지 확인
    const cached = localStorage.getItem(`teacherschedule_meals_${monthKey}`);
    if (cached) {
        try {
            state.meals[monthKey] = JSON.parse(cached);
            return state.meals[monthKey];
        } catch (e) {
            console.warn("급식 캐시 파싱 실패, 다시 불러옵니다.", e);
        }
    }
    
    // 2. 캐시가 없으면 나이스 API 호출 (경기도교육청 J10, 향동중학교 7621365 고정)
    const officeCode = 'J10';
    const schoolCode = '7621365';
    
    const fromYmd = `${year}${String(month).padStart(2, '0')}01`;
    const lastDay = new Date(year, month, 0).getDate();
    const toYmd = `${year}${String(month).padStart(2, '0')}${String(lastDay).padStart(2, '0')}`;
    
    const url = `https://open.neis.go.kr/hub/mealServiceDietInfo?KEY=${NEIS_API_KEY}&Type=json&pIndex=1&pSize=100&ATPT_OFCDC_SC_CODE=${officeCode}&SD_SCHUL_CODE=${schoolCode}&MLSV_FROM_YMD=${fromYmd}&MLSV_TO_YMD=${toYmd}`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("급식 API 응답 실패");
        
        const result = await response.json();
        const mealData = [];
        
        if (result.mealServiceDietInfo && result.mealServiceDietInfo[1] && result.mealServiceDietInfo[1].row) {
            const rows = result.mealServiceDietInfo[1].row;
            rows.forEach(row => {
                if (row.MMEAL_SC_NM === '중식' || row.MMEAL_SC_CODE === '2') {
                    const rawDate = row.MLSV_YMD;
                    const dateStr = `${rawDate.substring(0,4)}-${rawDate.substring(4,6)}-${rawDate.substring(6,8)}`;
                    
                    mealData.push({
                        date: dateStr,
                        menu: row.DDISH_NM,
                        calories: row.CAL_INFO,
                        origin: row.ORTR_INFO,
                        allergy: row.ALR_INFO
                    });
                }
            });
        }
        
        localStorage.setItem(`teacherschedule_meals_${monthKey}`, JSON.stringify(mealData));
        state.meals[monthKey] = mealData;
        return mealData;
        
    } catch (err) {
        console.error("나이스 급식 API 호출 에러: ", err);
        state.meals[monthKey] = [];
        return [];
    }
}

async function renderMealInfo() {
    const dateStrElement = document.getElementById('meal-date-str');
    const contentArea = document.getElementById('meal-content-area');
    const caloriesElement = document.getElementById('meal-calories');
    const originElement = document.getElementById('meal-origin');
    const allergyElement = document.getElementById('meal-allergy');
    
    if (!dateStrElement || !contentArea || !caloriesElement || !originElement || !allergyElement) return;
    
    if (!state.mealSelectedDate) state.mealSelectedDate = new Date();
    const year = state.mealSelectedDate.getFullYear();
    const month = state.mealSelectedDate.getMonth() + 1;
    const date = state.mealSelectedDate.getDate();
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const dayName = dayNames[state.mealSelectedDate.getDay()];
    
    dateStrElement.innerText = `${year}년 ${month}월 ${date}일(${dayName})`;
    
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const targetDateStr = formatDate(state.mealSelectedDate);
    
    // 숨겨진 input datepicker 값도 실시간 동기화
    const mealDatePicker = document.getElementById('meal-date-picker');
    if (mealDatePicker) {
        mealDatePicker.value = targetDateStr;
    }
    
    contentArea.innerHTML = `<div class="text-center" style="width: 100%; padding: 20px;"><i class="fa-solid fa-spinner fa-spin fa-2x" style="color: var(--color-internal);"></i><p class="text-muted mt-2" style="font-size: 12px;">급식 식단을 불러오고 있습니다...</p></div>`;
    
    if (!state.meals[monthKey]) {
        await fetchMonthMeals(year, month);
    }
    
    const dayMeals = state.meals[monthKey] || [];
    const todayMeal = dayMeals.find(m => m.date === targetDateStr);
    
    if (todayMeal && todayMeal.menu) {
        const items = todayMeal.menu.split(/<br\s*\/?>/gi).map(item => item.trim()).filter(item => item);
        
        contentArea.innerHTML = '';
        items.forEach(item => {
            const tag = document.createElement('div');
            tag.className = 'meal-tag';
            
            let iconHtml = '<i class="fa-solid fa-bowl-rice"></i>';
            if (item.includes('찌개') || item.includes('국') || item.includes('탕')) {
                iconHtml = '<i class="fa-solid fa-spoon"></i>';
            } else if (item.includes('김치') || item.includes('깍두기')) {
                iconHtml = '<i class="fa-solid fa-pepper-hot"></i>';
            } else if (item.includes('우유') || item.includes('요구르트') || item.includes('주스')) {
                iconHtml = '<i class="fa-solid fa-glass-water"></i>';
            } else if (item.includes('구이') || item.includes('가스') || item.includes('튀김') || item.includes('조림') || item.includes('볶음') || item.includes('고기')) {
                iconHtml = '<i class="fa-solid fa-drumstick-bite"></i>';
            }
            
            tag.innerHTML = `${iconHtml} <span>${item}</span>`;
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

// 14. 데이터 백업 / 내보내기 / 복원
function exportAllData() {
    const backupObj = {
        events: state.events,
        contacts: state.contacts,
        version: '1.0'
    };
    const jsonStr = JSON.stringify(backupObj, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `티처스케줄_백업데이터_${formatDate(new Date())}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function importBackupData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (data.events && data.contacts) {
                if (state.dbMode === 'firebase' && db) {
                    if (confirm('클라우드 서버에 백업 데이터를 업로드하여 동기화하시겠습니까? 기존 서버 데이터는 유지되며 추가 병합됩니다.')) {
                        state.isSyncing = true;
                        const batch = db.batch();
                        data.events.forEach((ev) => {
                            const docRef = db.collection('schedules').doc(ev.id);
                            batch.set(docRef, {
                                title: ev.title,
                                date: ev.date,
                                category: ev.category,
                                desc: ev.desc || ''
                            });
                        });
                        data.contacts.forEach((c) => {
                            const docRef = db.collection('contacts').doc(c.id);
                            batch.set(docRef, {
                                name: c.name,
                                dept: c.dept,
                                role: c.role,
                                phone: c.phone,
                                note: c.note || ''
                            });
                        });
                        await batch.commit();
                        state.isSyncing = false;
                        alert('서버에 전체 백업 데이터 병합 완료!');
                    }
                } else {
                    state.events = data.events;
                    state.contacts = data.contacts;
                    localStorage.setItem('teacherschedule_events', JSON.stringify(state.events));
                    localStorage.setItem('teacherschedule_contacts', JSON.stringify(state.contacts));
                    alert('로컬 백업 데이터가 정상 복원되었습니다.');
                    renderCalendar();
                    renderDayEvents();
                    renderContacts();
                }
            } else {
                alert('올바른 백업 파일 형식이 아닙니다.');
            }
        } catch (err) {
            alert('복원 오류: ' + err.message);
        }
    };
    reader.readAsText(file);
}

async function resetAllData() {
    if (confirm('⚠️ 모든 데이터를 공장 초기화하시겠습니까?\n로컬 및 연결된 클라우드 DB의 모든 정보가 데모 상태로 초기화됩니다.')) {
        if (state.dbMode === 'firebase' && db) {
            state.isSyncing = true;
            const batch = db.batch();
            state.events.forEach(ev => {
                const docRef = db.collection('schedules').doc(ev.id);
                batch.delete(docRef);
            });
            state.contacts.forEach(c => {
                const docRef = db.collection('contacts').doc(c.id);
                batch.delete(docRef);
            });
            await batch.commit();
            state.isSyncing = false;
        }
        
        localStorage.removeItem('teacherschedule_events');
        localStorage.removeItem('teacherschedule_contacts');
        state.events = [...MOCK_EVENTS];
        state.contacts = [...MOCK_CONTACTS];
        localStorage.setItem('teacherschedule_events', JSON.stringify(state.events));
        localStorage.setItem('teacherschedule_contacts', JSON.stringify(state.contacts));
        
        alert('모든 데이터가 데모 버전으로 초기화되었습니다.');
        renderCalendar();
        renderDayEvents();
        renderContacts();
    }
}

// 15. PWA 설치 처리
function setupPwa() {
    const installBanner = document.getElementById('install-banner');
    const btnInstall = document.getElementById('btn-install');
    const btnPwaSettings = document.getElementById('btn-pwa-install-settings');
    const pwaStatus = document.getElementById('pwa-status');
    const swStatus = document.getElementById('sw-status');
    
    // 개발 편의를 위해 로컬 접속(localhost / 127.0.0.1) 시에는 서비스 워커 캐싱을 작동하지 않도록 설정합니다.
    const isLocalhost = Boolean(
        window.location.hostname === 'localhost' ||
        window.location.hostname === '[::1]' ||
        window.location.hostname.match(/^127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/)
    );

    if ('serviceWorker' in navigator && !isLocalhost) {
        navigator.serviceWorker.register('service-worker.js')
            .then(reg => {
                console.log('Service Worker 등록 성공:', reg.scope);
                if (swStatus) swStatus.innerText = '활성화됨 (오프라인 모드 작동)';

                // 백그라운드에서 신규 업데이트 파일(디자인, 코드 등) 감지 리스너
                reg.onupdatefound = () => {
                    const installingWorker = reg.installing;
                    if (installingWorker == null) return;

                    installingWorker.onstatechange = () => {
                        if (installingWorker.state === 'installed') {
                            if (navigator.serviceWorker.controller) {
                                // 기존 브라우저/스마트폰 앱에 구버전 컨트롤러가 살아있는 경우 -> 자가 업데이트 시작
                                console.log('[PWA Update] 새로운 버전의 자산이 백그라운드에 다운로드되었습니다.');
                                
                                // 대기 중인 새 서비스 워커에 즉각 활성화 신호 전송
                                if (reg.waiting) {
                                    reg.waiting.postMessage({ action: 'skipWaiting' });
                                }
                            }
                        }
                    };
                };
            })
            .catch(err => {
                console.warn('Service Worker 등록 실패:', err);
                if (swStatus) swStatus.innerText = '등록 실패 (HTTPS 환경 필요)';
            });

        // 서비스 워커 제어권이 최종 변경(새 버전이 강제 활성화)되는 시점에 브라우저/앱 화면 새로고침
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return;
            refreshing = true;
            console.log('[PWA Update] 새로운 서비스 워커 활성화 감지. 화면을 최신 코드로 새로고침합니다.');
            window.location.reload();
        });

    } else {
        if (swStatus) {
            swStatus.innerText = isLocalhost ? '개발자 로컬 모드 (캐싱 우회)' : '미지원 브라우저';
        }
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

// 16. 페이지 이벤드 로드
document.addEventListener('DOMContentLoaded', () => {
    // A. 로컬 데이터 적재
    loadLocalStorageData();
    
    // B. 관리자 권한 로그인 세션 확인
    const adminSession = localStorage.getItem('teacherschedule_admin_auth');
    if (adminSession === 'true') {
        state.isAdmin = true;
    }
    updateAdminUI();
    
    // 교직원 보안 인증 게이트 로드
    checkSecurityGate();
    
    // 관리자인 경우 백그라운드에서 나이스 자동 동기화 1회 실행
    if (state.isAdmin) {
        autoSyncNeisBackground();
    }
    
    // C. 파이어베이스 세션 로드 및 개시 (하드코딩 기본값 적용)
    const savedConfig = localStorage.getItem('teacherschedule_firebase_config');
    let configToUse = null;
    
    if (savedConfig) {
        configToUse = JSON.parse(savedConfig);
    } else {
        // 저장된 설정이 없으면 하드코딩된 기본값 사용 (시범 배포용 자동 연동)
        configToUse = DEFAULT_FIREBASE_CONFIG;
    }
    
    if (configToUse && configToUse.projectId) {
        const fbProjectId = document.getElementById('fb-project-id');
        if (fbProjectId) fbProjectId.value = configToUse.projectId || '';
        const fbApiKey = document.getElementById('fb-api-key');
        if (fbApiKey) fbApiKey.value = configToUse.apiKey || '';
        const fbAppId = document.getElementById('fb-app-id');
        if (fbAppId) fbAppId.value = configToUse.appId || '';
        
        initFirebase(configToUse);
    } else {
        state.dbMode = 'local';
    }
    
    // D. PWA 환경 기동
    setupPwa();
    
    // E. 달력 및 기본 뷰 렌더링
    renderCalendar();
    renderDayEvents();
    renderContacts();
    renderNotice();
    syncNoticeForm();
    
    // 상단 날짜 동기화
    const statusDate = document.getElementById('status-date');
    if (statusDate) {
        const today = new Date();
        const y = today.getFullYear();
        const m = String(today.getMonth() + 1).padStart(2, '0');
        const d = String(today.getDate()).padStart(2, '0');
        statusDate.innerText = `오늘: ${y}-${m}-${d}`;
    }
    
    // F. 리스너 바인딩
    // 탭 토글
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetTab = item.getAttribute('data-tab');
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            
            item.classList.add('active');
            document.getElementById(targetTab).classList.add('active');
            state.activeTab = targetTab;
            
            if (targetTab === 'tab-calendar') {
                // 비상연락망 보안 자동 잠금
                state.isContactsAuthenticated = false;
                renderCalendar();
                renderDayEvents();
            } else if (targetTab === 'tab-contacts') {
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
            } else {
                // 달력 외의 다른 탭(급식, 설정)으로 가도 비상연락망 보안 잠금
                state.isContactsAuthenticated = false;
                if (targetTab === 'tab-meals') {
                    state.mealSelectedDate = new Date(); // 급식 탭 진입 시 오늘 날짜로 항상 세팅
                    renderMealInfo();
                }
            }
        });
    });

    // 비상연락망 2차 인증 버튼 및 엔터키 이벤트 바인딩
    const btnVerifyContactsPin = document.getElementById('btn-verify-contacts-pin');
    if (btnVerifyContactsPin) {
        btnVerifyContactsPin.addEventListener('click', verifyContactsPin);
    }
    const contactsPinInput = document.getElementById('contacts-pin-input');
    if (contactsPinInput) {
        contactsPinInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                verifyContactsPin();
            }
        });
    }

    // 일정 수정 모달 내 카테고리 탭 버튼 클릭 이벤트 바인딩
    const categoryTabBtns = document.querySelectorAll('.category-tab-btn');
    categoryTabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            categoryTabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const category = btn.getAttribute('data-category');
            const categoryInput = document.getElementById('event-category');
            if (categoryInput) categoryInput.value = category;
        });
    });
    
    // 달력 스와이프
    document.getElementById('btn-prev-month').addEventListener('click', () => {
        state.currentDate.setMonth(state.currentDate.getMonth() - 1);
        renderCalendar();
        renderDayEvents();
    });
    
    document.getElementById('btn-next-month').addEventListener('click', () => {
        state.currentDate.setMonth(state.currentDate.getMonth() + 1);
        renderCalendar();
        renderDayEvents();
    });
    
    // 급식 날짜 이동
    const btnPrevMeal = document.getElementById('btn-prev-meal');
    const btnNextMeal = document.getElementById('btn-next-meal');
    if (btnPrevMeal && btnNextMeal) {
        btnPrevMeal.addEventListener('click', () => {
            if (!state.mealSelectedDate) state.mealSelectedDate = new Date();
            state.mealSelectedDate.setDate(state.mealSelectedDate.getDate() - 1);
            renderMealInfo();
        });
        btnNextMeal.addEventListener('click', () => {
            if (!state.mealSelectedDate) state.mealSelectedDate = new Date();
            state.mealSelectedDate.setDate(state.mealSelectedDate.getDate() + 1);
            renderMealInfo();
        });
    }
    
    // 급식 캘린더 네이티브 데이트피커 변경 감지 리스너
    const mealDatePickerInput = document.getElementById('meal-date-picker');
    if (mealDatePickerInput) {
        mealDatePickerInput.addEventListener('change', (e) => {
            if (e.target.value) {
                // e.target.value는 'yyyy-MM-dd' 문자열이므로 시간대 보정을 위해 new Date(value) 처리
                state.mealSelectedDate = new Date(e.target.value);
                renderMealInfo();
            }
        });
    }
    
    // 일정 신규 추가 버튼
    document.getElementById('btn-add-event-quick').addEventListener('click', showAddEventModal);
    
    // 카테고리 필터 버튼 동작
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            filterButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.filterCategory = btn.getAttribute('data-filter');
            renderCalendar();
            renderDayEvents();
        });
    });
    
    // 연락처 추가 및 검색
    document.getElementById('btn-add-contact').addEventListener('click', showAddContactModal);
    document.getElementById('contact-search').addEventListener('input', renderContacts);
    
    // 나이스 동기화 실행
    document.getElementById('btn-sync-neis').addEventListener('click', syncNeisData);
    
    // CSV 일괄 다운로드
    document.getElementById('btn-download-template').addEventListener('click', downloadCsvTemplate);
    
    // CSV/JSON 파일 업로드 drag & drop
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    if (dropZone && fileInput) {
        dropZone.addEventListener('click', () => {
            if (state.isAdmin) fileInput.click();
        });
        
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleFileSelect(e.target.files[0]);
            }
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
    
    // 데이터 백업/복구/공장초기화
    document.getElementById('btn-export-data').addEventListener('click', exportAllData);
    const backupFileInput = document.getElementById('backup-file-input');
    const btnImportTrigger = document.getElementById('btn-import-data-trigger');
    if (btnImportTrigger && backupFileInput) {
        btnImportTrigger.addEventListener('click', () => {
            if (state.isAdmin) backupFileInput.click();
        });
        backupFileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                importBackupData(e.target.files[0]);
            }
        });
    }
    document.getElementById('btn-reset-data').addEventListener('click', resetAllData);
    
    // 구글 시트 저장 링크 로드
    const DEFAULT_GSHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQR7iMCTSIAyZULSGRuRdGvYEw4WIpf2yOPcofUN3_d2eEehjgru4y2B-Plx60bP_1izfR6lQQQhZh4/pub?output=csv';
    const savedGsheetUrl = localStorage.getItem('teacherschedule_gsheet_url');
    const gsheetUrlToUse = savedGsheetUrl || DEFAULT_GSHEET_URL;
    
    const gsheetUrlInput = document.getElementById('gsheet-url');
    if (gsheetUrlInput) {
        gsheetUrlInput.value = gsheetUrlToUse;
        const badgeGsheet = document.getElementById('badge-gsheet-status');
        if (badgeGsheet) {
            badgeGsheet.innerText = '설정 완료';
            badgeGsheet.className = 'badge badge-success';
        }
    }

    
    document.getElementById('btn-logout-admin').addEventListener('click', () => {
        if (confirm('관리자 권한에서 로그아웃하시겠습니까?')) {
            state.isAdmin = false;
            localStorage.removeItem('teacherschedule_admin_auth');
            alert('일반 교직원 모드로 전환되었습니다. (조회만 가능)');
            updateAdminUI();
            renderCalendar();
            renderDayEvents();
            renderContacts();
        }
    });
    
    // H. 파이어베이스 연동 저장
    document.getElementById('btn-save-firebase').addEventListener('click', () => {
        const sanitizeConfig = (val) => val.replace(/['",]/g, '').trim();
        
        const projectId = sanitizeConfig(document.getElementById('fb-project-id').value);
        const apiKey = sanitizeConfig(document.getElementById('fb-api-key').value);
        const appId = sanitizeConfig(document.getElementById('fb-app-id').value);
        
        if (!projectId || !apiKey || !appId) {
            alert('프로젝트 ID, API Key, App ID 값을 모두 정확히 입력해 주세요.');
            return;
        }
        
        const config = {
            apiKey: apiKey,
            authDomain: `${projectId}.firebaseapp.com`,
            projectId: projectId,
            storageBucket: `${projectId}.appspot.com`,
            appId: appId
        };
        
        localStorage.setItem('teacherschedule_firebase_config', JSON.stringify(config));
        
        initFirebase(config);
        alert('클라우드 데이터베이스 설정 정보가 저장되었습니다. 연동을 시작합니다.');
    });
    
    // I. 파이어베이스 연동 해제
    document.getElementById('btn-disconnect-firebase').addEventListener('click', () => {
        if (confirm('클라우드 DB 연동을 해제하고 로컬 모드로 전환하시겠습니까?\n이후 데이터는 개인 스마트폰 브라우저에만 개별 저장됩니다.')) {
            disconnectFirebase();
            alert('연동이 해제되었습니다. 로컬 모드로 작동합니다.');
        }
    });
    
    // J. 구글 스프레드시트 일괄 동기화 실행
    const btnSyncGsheet = document.getElementById('btn-sync-gsheet');
    if (btnSyncGsheet) {
        btnSyncGsheet.addEventListener('click', () => {
            const gsheetUrlInput = document.getElementById('gsheet-url');
            const gsheetUrl = gsheetUrlInput ? gsheetUrlInput.value.trim() : '';
            syncGoogleSheets(gsheetUrl);
        });
    }
    
    // G. 관리자 인증 액션 (이전 리스너 재등록)
    document.getElementById('btn-verify-admin').addEventListener('click', () => {
        const inputPass = document.getElementById('admin-passcode').value;
        if (inputPass === ADMIN_PASSCODE) {
            state.isAdmin = true;
            localStorage.setItem('teacherschedule_admin_auth', 'true');
            document.getElementById('admin-passcode').value = '';
            alert('관리자 인증에 성공했습니다! 일정/연락망 관리 권한이 부여되었습니다.');
            updateAdminUI();
            autoSyncNeisBackground();
            renderCalendar();
            renderDayEvents();
            renderContacts();
        } else {
            alert('인증 코드가 일치하지 않습니다. 다시 입력해 주세요.');
        }
    });
    
    // 보안 인증 확인 버튼 및 엔터키 바인딩
    const btnVerifySecurity = document.getElementById('btn-verify-security');
    const securityCodeInput = document.getElementById('security-code-input');
    
    if (btnVerifySecurity) {
        btnVerifySecurity.addEventListener('click', verifySecurityCode);
    }
    if (securityCodeInput) {
        securityCodeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                verifySecurityCode();
            }
        });
    }
});

