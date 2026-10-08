/* ==========================================================================
   services/firebaseService.js
   - Cloud Firestore 실시간 DB 연동을 전담하는 서비스 모듈
   - index.html에 <script> 태그로 이미 로드된 Firebase Compat SDK
     (firebase-app-compat.js, firebase-firestore-compat.js)의 전역 `firebase`
     객체를 그대로 활용하며, 별도의 번들러/모듈 import 없이 동작한다
   - 파이어베이스 연동 정보는 로컬 스토리지에 저장된 사용자 입력값을 최우선 적용하고,
     없을 때만 state.js의 DEFAULT_FIREBASE_CONFIG로 안전하게 폴백한다
   - 대량 쓰기(마이그레이션, 일괄 등록) 시 실시간 리스너가 자기 자신의 쓰기를
     되받아 무한 루프에 빠지는 "Snapshot Storm"을 state.isSyncing 락으로 방지한다
   ========================================================================== */

import { state, DEFAULT_FIREBASE_CONFIG } from '../core/state.js';
import { sanitizeConfig, sortEventsByDate } from '../utils/helpers.js';
import {
    STORAGE_KEYS,
    loadLocalStorageData,
    saveLocalEvents,
    saveLocalContacts,
    saveLocalNotice,
    saveLocalNotices
} from './storageService.js';

// ------------------------------------------------------------------
// 내부 헬퍼: 전역 Firebase Compat SDK 참조
// ------------------------------------------------------------------

/**
 * index.html에서 로드된 전역 Firebase Compat SDK 객체를 반환한다.
 * 스크립트가 아직 로드되지 않았거나 실패한 경우 undefined를 반환한다.
 * @returns {object|undefined} 전역 firebase 객체
 */
function getFirebaseSdk() {
    return typeof window !== 'undefined' ? window.firebase : undefined;
}

// notice(단일 문서) / notices(게시판 목록) 구독 해제 함수.
// events/contacts 구독 해제 함수는 다른 서비스/뷰에서도 참조할 수 있도록 state에 보관하지만,
// 이 둘은 firebaseService 내부에서만 사용되므로 모듈 스코프 변수로 관리한다.
let unsubscribeNoticeDoc = null;
let unsubscribeNoticesBoard = null;

/**
 * 현재 활성화된 모든 Firestore 실시간 구독을 해제한다.
 * 재연동(연동 정보 갱신) 또는 연동 해제 시 중복 구독을 방지하기 위해 호출한다.
 */
function unsubscribeAll() {
    if (state.unsubscribeEvents) {
        state.unsubscribeEvents();
        state.unsubscribeEvents = null;
    }
    if (state.unsubscribeContacts) {
        state.unsubscribeContacts();
        state.unsubscribeContacts = null;
    }
    if (unsubscribeNoticeDoc) {
        unsubscribeNoticeDoc();
        unsubscribeNoticeDoc = null;
    }
    if (unsubscribeNoticesBoard) {
        unsubscribeNoticesBoard();
        unsubscribeNoticesBoard = null;
    }
}

// ------------------------------------------------------------------
// 1. 파이어베이스 연동 정보 getter/setter (로컬 재정의 우선, 기본값 폴백)
// ------------------------------------------------------------------

/**
 * 현재 사용할 파이어베이스 연동 정보를 반환한다.
 * 사용자가 설정 화면에서 저장한 로컬 재정의 값이 있으면 그 값을 우선 사용하고,
 * 없거나 손상된 경우에만 state.js에 하드코딩된 기본 연동 정보(DEFAULT_FIREBASE_CONFIG)로 폴백한다.
 * @returns {{apiKey: string, authDomain: string, projectId: string, storageBucket: string, appId: string}} 사용할 Firebase Config
 */
export function getFirebaseConfig() {
    try {
        const saved = localStorage.getItem(STORAGE_KEYS.FIREBASE_CONFIG);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed && parsed.projectId && parsed.apiKey && parsed.appId) {
                return parsed;
            }
        }
    } catch (e) {
        console.warn('Firebase 연동 정보 조회 실패:', e);
    }
    return { ...DEFAULT_FIREBASE_CONFIG };
}

/**
 * 설정 화면에서 입력받은 프로젝트 ID / API Key / App ID로 파이어베이스 연동 정보를
 * 구성해 즉시 로컬 스토리지에 저장하고, 곧바로 재연동(initFirebase)까지 수행한다.
 * @param {{projectId: string, apiKey: string, appId: string}} input - 사용자 입력값 (공백/따옴표/쉼표는 자동 정제됨)
 * @returns {Promise<{success: boolean, config?: object, error?: string}>} 저장 및 연동 결과
 */
export async function saveFirebaseConfig({ projectId, apiKey, appId } = {}) {
    const cleanProjectId = sanitizeConfig(projectId);
    const cleanApiKey = sanitizeConfig(apiKey);
    const cleanAppId = sanitizeConfig(appId);

    if (!cleanProjectId || !cleanApiKey || !cleanAppId) {
        return { success: false, error: '프로젝트 ID, API Key, App ID 값을 모두 정확히 입력해 주세요.' };
    }

    const config = {
        apiKey: cleanApiKey,
        authDomain: `${cleanProjectId}.firebaseapp.com`,
        projectId: cleanProjectId,
        storageBucket: `${cleanProjectId}.appspot.com`,
        appId: cleanAppId
    };

    try {
        localStorage.setItem(STORAGE_KEYS.FIREBASE_CONFIG, JSON.stringify(config));
    } catch (e) {
        console.warn('Firebase 연동 정보 저장 실패:', e);
    }

    const result = await initFirebase(config);
    return { ...result, config };
}

// ------------------------------------------------------------------
// 2. 실시간 구독 등록 (schedules / contacts / notice / notices)
// ------------------------------------------------------------------

/**
 * 로컬에만 있던 일정을 Firestore가 완전히 비어 있을 때 일괄 업로드(마이그레이션)한다.
 * 마이그레이션 진행 중에는 state.isSyncing을 true로 잠가, 이 쓰기 작업이 다시
 * onSnapshot으로 되돌아와 무한 루프를 일으키는 것(Snapshot Storm)을 방지한다.
 * @param {object} db - Firestore 인스턴스
 */
function migrateLocalEventsToFirestore(db) {
    console.log('[firebaseService] Firestore 일정이 비어 있어 로컬 일정을 마이그레이션합니다...');
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
    batch.commit()
        .then(() => {
            console.log('[firebaseService] 로컬 일정 마이그레이션 성공.');
            state.isSyncing = false;
        })
        .catch((err) => {
            console.error('[firebaseService] 로컬 일정 마이그레이션 실패:', err);
            state.isSyncing = false;
        });
}

/**
 * 로컬에만 있던 연락처를 Firestore가 완전히 비어 있을 때 일괄 업로드(마이그레이션)한다.
 * @param {object} db - Firestore 인스턴스
 */
function migrateLocalContactsToFirestore(db) {
    console.log('[firebaseService] Firestore 연락망이 비어 있어 로컬 연락망을 마이그레이션합니다...');
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
    batch.commit()
        .then(() => {
            console.log('[firebaseService] 로컬 연락망 마이그레이션 성공.');
            state.isSyncing = false;
        })
        .catch((err) => {
            console.error('[firebaseService] 로컬 연락망 마이그레이션 실패:', err);
            state.isSyncing = false;
        });
}

/**
 * schedules 컬렉션을 실시간 구독한다.
 * Firestore가 비어 있고 관리자 권한 + 로컬 일정이 있으면 자동 마이그레이션하고,
 * 그 외에는 원격 데이터를 state.events에 반영하고 오프라인 대비 로컬에도 캐싱한다.
 * @param {object} db - Firestore 인스턴스
 */
function subscribeSchedules(db) {
    state.unsubscribeEvents = db.collection('schedules').onSnapshot((snapshot) => {
        if (state.isSyncing) return; // 대량 동기화 중에는 실시간 리스너 무시 (Snapshot Storm 방지)

        const remoteEvents = [];
        snapshot.forEach((doc) => {
            const data = doc.data();
            if (data.desc === '나이스 연동 공식 학사일정') data.desc = '';
            remoteEvents.push({ id: doc.id, ...data });
        });

        if (remoteEvents.length === 0 && state.isAdmin && state.events.length > 0) {
            migrateLocalEventsToFirestore(db);
            return;
        }

        state.events = sortEventsByDate(remoteEvents);
        saveLocalEvents(state.events);
    }, (error) => {
        console.error('[firebaseService] schedules 구독 에러:', error);
    });
}

/**
 * contacts 컬렉션을 실시간 구독한다. (동작 방식은 subscribeSchedules와 동일)
 * @param {object} db - Firestore 인스턴스
 */
function subscribeContacts(db) {
    state.unsubscribeContacts = db.collection('contacts').onSnapshot((snapshot) => {
        if (state.isSyncing) return;

        const remoteContacts = [];
        snapshot.forEach((doc) => remoteContacts.push({ id: doc.id, ...doc.data() }));

        if (remoteContacts.length === 0 && state.isAdmin && state.contacts.length > 0) {
            migrateLocalContactsToFirestore(db);
            return;
        }

        state.contacts = remoteContacts;
        saveLocalContacts(state.contacts);
    }, (error) => {
        console.error('[firebaseService] contacts 구독 에러:', error);
    });
}

/**
 * 상단 롤링 공지사항 단일 문서(settings/notice)를 실시간 구독한다.
 * @param {object} db - Firestore 인스턴스
 */
function subscribeNoticeDoc(db) {
    unsubscribeNoticeDoc = db.collection('settings').doc('notice').onSnapshot((doc) => {
        if (!doc.exists) return;
        state.notice = doc.data();
        saveLocalNotice(state.notice);
    }, (error) => {
        console.error('[firebaseService] notice 구독 에러:', error);
    });
}

/**
 * 누적 공지사항 게시판(notices) 컬렉션을 최신순으로 실시간 구독한다.
 * @param {object} db - Firestore 인스턴스
 */
function subscribeNoticesBoard(db) {
    unsubscribeNoticesBoard = db.collection('notices').orderBy('date', 'desc').onSnapshot((snapshot) => {
        const remoteNotices = [];
        snapshot.forEach((doc) => remoteNotices.push({ id: doc.id, ...doc.data() }));
        state.notices = remoteNotices;
        saveLocalNotices(state.notices);
    }, (error) => {
        console.error('[firebaseService] notices 구독 에러:', error);
    });
}

// ------------------------------------------------------------------
// 3. 연동 시작 / 해제
// ------------------------------------------------------------------

/**
 * 파이어베이스 앱을 초기화하고 schedules/contacts/notice/notices 실시간 구독을 시작한다.
 * config를 생략하면 getFirebaseConfig()로 로컬 재정의 값 또는 기본값을 자동으로 가져와 연동한다.
 * 이미 초기화된 앱이 있으면 먼저 안전하게 정리한 뒤 재초기화하여
 * "설정 갱신 후 재저장" 시 발생할 수 있는 중복 초기화 에러를 방지한다.
 * @param {object} [config] - Firebase Config 객체 (미지정 시 getFirebaseConfig() 사용)
 * @returns {Promise<{success: boolean, error?: string}>} 연동 결과
 */
export async function initFirebase(config = getFirebaseConfig()) {
    const fb = getFirebaseSdk();
    if (!fb) {
        console.error('[firebaseService] Firebase SDK가 로드되지 않았습니다. index.html의 firebase-app-compat.js / firebase-firestore-compat.js 스크립트를 확인해 주세요.');
        return { success: false, error: 'Firebase SDK 미로드' };
    }

    unsubscribeAll();

    // 기존에 초기화된 앱 인스턴스가 있다면 안전하게 종료 후 재생성한다.
    if (Array.isArray(fb.apps) && fb.apps.length) {
        await Promise.all(fb.apps.map((app) => app.delete().catch(() => {})));
    }
    state.firebaseApp = null;
    state.db = null;

    try {
        const app = fb.initializeApp(config);
        const db = fb.firestore();

        state.firebaseApp = app;
        state.db = db;
        state.dbMode = 'firebase';
        state.firebaseConfig = config;

        subscribeSchedules(db);
        subscribeContacts(db);
        subscribeNoticeDoc(db);
        subscribeNoticesBoard(db);

        return { success: true };
    } catch (err) {
        console.error('[firebaseService] Firebase 초기화 에러:', err);
        await disconnectFirebase();
        return { success: false, error: err.message || String(err) };
    }
}

/**
 * 파이어베이스 연동을 해제하고 로컬(local) 모드로 되돌린다.
 * 모든 실시간 구독과 앱 인스턴스를 정리하고, 저장된 연동 재정의 정보를 삭제한 뒤
 * localStorage에 있던 데이터를 다시 state에 적재한다.
 * @returns {Promise<boolean>} 항상 true (해제 완료)
 */
export async function disconnectFirebase() {
    unsubscribeAll();

    const fb = getFirebaseSdk();
    if (fb && Array.isArray(fb.apps) && fb.apps.length) {
        await Promise.all(fb.apps.map((app) => app.delete().catch(() => {})));
    }

    state.db = null;
    state.firebaseApp = null;
    state.dbMode = 'local';
    state.firebaseConfig = null;

    try {
        localStorage.removeItem(STORAGE_KEYS.FIREBASE_CONFIG);
    } catch (e) {
        console.warn('Firebase 연동 정보 삭제 실패:', e);
    }

    loadLocalStorageData();
    return true;
}

// ------------------------------------------------------------------
// 4. 다른 서비스(importExportService 등)가 재사용할 공용 헬퍼
// ------------------------------------------------------------------

/**
 * 현재 파이어베이스 실시간 DB 모드로 정상 연동되어 있는지 여부를 반환한다.
 * @returns {boolean} 연동 여부
 */
export function isFirebaseConnected() {
    return state.dbMode === 'firebase' && !!state.db;
}

/**
 * state.isSyncing 락으로 보호되는 Firestore batch 쓰기를 실행한다.
 * 대량 등록/삭제(CSV·구글시트 일괄 동기화, 백업 복원, 팩토리 리셋 등)가
 * 실시간 리스너와 충돌해 Snapshot Storm을 일으키지 않도록 공통으로 사용한다.
 * @param {(batch: object, db: object) => void} buildFn - batch에 set/delete 작업을 채워 넣는 콜백
 * @returns {Promise<boolean>} 파이어베이스 미연동 상태면 false, 정상 커밋되면 true
 */
export async function runFirestoreBatch(buildFn) {
    if (!isFirebaseConnected()) return false;

    state.isSyncing = true;
    try {
        const batch = state.db.batch();
        buildFn(batch, state.db);
        await batch.commit();
        return true;
    } finally {
        state.isSyncing = false;
    }
}
