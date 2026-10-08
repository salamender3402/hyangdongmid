/* ==========================================================================
   services/importExportService.js
   - CSV/JSON 파일 파서, 템플릿 다운로드, 전체 데이터 백업/복원/팩토리 리셋을
     전담하는 서비스 모듈
   - 파이어베이스 연동 중이면 firebaseService의 batch 헬퍼로 Firestore에 반영하고,
     로컬 모드이면 storageService를 통해 localStorage에 반영한다 (이중 모드 완전 지원)
   - 이 모듈은 데이터 처리만 담당하며 confirm()/alert() 같은 사용자 확인 UI는 다루지 않는다.
     되돌릴 수 없는 동작(덮어쓰기, 팩토리 리셋 등)은 호출부(뷰)에서 반드시 사용자 확인을
     먼저 받은 뒤 이 모듈의 함수를 호출해야 한다.
   ========================================================================== */

import { state, MOCK_EVENTS, MOCK_CONTACTS } from '../core/state.js';
import { formatDate, sortEventsByDate } from '../utils/helpers.js';
import { STORAGE_KEYS, saveLocalEvents, saveLocalContacts } from './storageService.js';
import { isFirebaseConnected, runFirestoreBatch } from './firebaseService.js';

// ------------------------------------------------------------------
// 내부 헬퍼: 브라우저 파일 다운로드
// ------------------------------------------------------------------

/**
 * 문자열 콘텐츠를 파일로 만들어 브라우저 다운로드를 트리거한다.
 * @param {string} content - 파일 내용
 * @param {string} filename - 다운로드될 파일명
 * @param {string} mimeType - 파일 MIME 타입
 */
function downloadBlob(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// ------------------------------------------------------------------
// 1. CSV 템플릿 다운로드
// ------------------------------------------------------------------

const CSV_TEMPLATE_HEADER = '날짜(YYYY-MM-DD),일정명,상세설명';
const CSV_TEMPLATE_SAMPLE_ROWS = [
    '2026-07-16,학교 발전 협의회,2학기 학무 성과 측정 교직원 기획 회의',
    '2026-07-17,AI 활용 융합 수업 직무연수,교내 전문적 학습공동체 동아리 연수',
    '2026-07-29,친목 체육대회,교직원 탁구 리그전 및 만찬회'
];

/**
 * 일정 일괄 등록용 CSV 템플릿 파일을 다운로드한다.
 * 한셀 및 엑셀에서 바로 열어도 한글이 깨지지 않도록 UTF-8 BOM(\uFEFF)과 CRLF 개행을 적용한다.
 */
export function downloadCsvTemplate() {
    const csvContent = '\uFEFF' + [CSV_TEMPLATE_HEADER, ...CSV_TEMPLATE_SAMPLE_ROWS].join('\r\n');
    downloadBlob(csvContent, '교직원_학사일정_일괄등록_템플릿.csv', 'text/csv;charset=utf-8;');
}

// ------------------------------------------------------------------
// 2. CSV/JSON 파서 및 공통 일정 등록 헬퍼
// ------------------------------------------------------------------

/**
 * 큰따옴표로 감싼 필드 안의 쉼표를 값의 일부로 취급하는 CSV 한 줄 파서.
 * 한셀/엑셀에서 저장한 CSV 파일 모두를 대응한다.
 * @param {string} line - 파싱할 CSV 한 줄
 * @returns {string[]} 쉼표로 분리되고 큰따옴표가 제거된 값 배열
 */
export function parseCsvLine(line) {
    let field = '';
    const row = [];
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line.charAt(i);
        if (ch === '"') {
            inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            row.push(field.trim());
            field = '';
        } else {
            field += ch;
        }
    }
    row.push(field.trim());
    return row;
}

/**
 * CSV 텍스트(헤더 1행 포함)를 일정 행 배열로 파싱한다.
 * 날짜(YYYY-MM-DD 또는 한셀/엑셀 형식 YYYY.MM.DD 등)와 제목이 없는 행은 건너뛴다.
 * @param {string} csvText - CSV 원문
 * @param {string} [defaultCategory='internal'] - 파싱된 일정에 부여할 카테고리
 * @returns {Array<{date: string, title: string, desc: string, category: string}>} 파싱된 일정 행 배열
 */
function parseCsvEventRows(csvText, defaultCategory = 'internal') {
    const lines = csvText.split(/\r?\n/);
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cols = parseCsvLine(line);
        if (cols.length < 2) continue;

        let rawDate = (cols[0] || '').trim();
        const title = (cols[1] || '').trim();
        const desc = (cols[2] || '').trim();

        // 날짜 정규화: 2026.07.16, 2026/07/16, 2026. 7. 16 등 한셀/엑셀 서식을 표준 YYYY-MM-DD로 변환
        let date = rawDate.replace(/[./]/g, '-').replace(/\s+/g, '');
        const dateParts = date.split('-');
        if (dateParts.length === 3) {
            const y = dateParts[0];
            const m = dateParts[1].padStart(2, '0');
            const d = dateParts[2].replace(/[^0-9]/g, '').padStart(2, '0');
            date = `${y}-${m}-${d}`;
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !title) continue;
        rows.push({ date, title, desc, category: defaultCategory });
    }
    return rows;
}

/**
 * 배열 형식 JSON 텍스트를 일정 행 배열로 파싱한다.
 * title/date가 없는 항목은 제외된다.
 * @param {string} jsonText - JSON 원문
 * @returns {Array<{date: string, title: string, desc: string, category: string}>} 파싱된 일정 행 배열
 */
function parseJsonEventRows(jsonText) {
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) throw new Error('배열 형식의 JSON이 아닙니다.');

    return parsed
        .filter((item) => item && item.title && item.date)
        .map((item) => ({
            date: item.date,
            title: item.title,
            desc: item.desc || '',
            category: item.category || 'internal'
        }));
}

/**
 * 파싱된 일정 행 배열에 고유 id를 부여해 현재 dbMode(local/firebase)에 맞게 등록한다.
 * @param {Array<{date: string, title: string, desc: string, category: string}>} rows - 등록할 일정 행 배열
 * @param {string} idPrefix - 생성할 일정 id 접두사 (예: 'ev-csv', 'ev-import')
 * @returns {Promise<number>} 실제로 등록된 건수
 */
async function addEventRows(rows, idPrefix) {
    if (rows.length === 0) return 0;

    const newEvents = rows.map((row, i) => ({ id: `${idPrefix}-${Date.now()}-${i}`, ...row }));

    if (isFirebaseConnected()) {
        await runFirestoreBatch((batch, db) => {
            newEvents.forEach((ev) => {
                const docRef = db.collection('schedules').doc(ev.id);
                batch.set(docRef, { title: ev.title, date: ev.date, category: ev.category, desc: ev.desc || '' });
            });
        });
    } else {
        state.events = sortEventsByDate([...state.events, ...newEvents]);
        saveLocalEvents(state.events);
    }

    return newEvents.length;
}

/**
 * 파일 ArrayBuffer 데이터를 분석해 UTF-8(BOM 포함/미포함) 또는
 * EUC-KR(한셀/엑셀 기본 저장 포맷) 인코딩을 자동 판별하여 디코딩한다.
 * @param {ArrayBuffer} buffer - 파일 바이너리 데이터
 * @returns {string} 디코딩된 텍스트
 */
export function decodeTextBuffer(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes.length === 0) return '';

    // 1. UTF-8 BOM (0xEF, 0xBB, 0xBF) 감지
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        return new TextDecoder('utf-8').decode(bytes.subarray(3));
    }

    // 2. strict UTF-8 디코딩 시도 (잘못된 바이트 시퀀스 발생 시 예외 발생)
    try {
        const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
        return utf8Decoder.decode(bytes);
    } catch (e) {
        // 3. 한셀/엑셀 기본 인코딩인 EUC-KR (CP949)로 자동 폴백
        try {
            const eucKrDecoder = new TextDecoder('euc-kr');
            return eucKrDecoder.decode(bytes);
        } catch (err) {
            return new TextDecoder().decode(bytes);
        }
    }
}

/**
 * 사용자가 드래그 앤 드롭 또는 파일 선택으로 업로드한 CSV/JSON 파일을 파싱해
 * 일정으로 일괄 등록한다. 관리자 권한이 없으면 거부된다.
 * 한셀(EUC-KR) 및 일반(UTF-8) 인코딩을 자동 감지하여 처리한다.
 * @param {File} file - 업로드된 파일 (.csv 또는 .json)
 * @returns {Promise<{success: boolean, count: number, error?: string}>} 등록 결과
 */
export function importScheduleFile(file) {
    return new Promise((resolve) => {
        if (!state.isAdmin) {
            resolve({ success: false, count: 0, error: '관리자 권한이 필요합니다.' });
            return;
        }
        if (!file) {
            resolve({ success: false, count: 0, error: '파일이 없습니다.' });
            return;
        }

        const extension = file.name.split('.').pop().toLowerCase();
        if (extension !== 'csv' && extension !== 'json') {
            resolve({ success: false, count: 0, error: '지원하지 않는 파일 형식입니다. (csv 또는 json 파일만 가능)' });
            return;
        }

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const buffer = e.target.result;
                const text = decodeTextBuffer(buffer);
                const rows = extension === 'json' ? parseJsonEventRows(text) : parseCsvEventRows(text);
                const idPrefix = extension === 'json' ? 'ev-import' : 'ev-csv';
                const count = await addEventRows(rows, idPrefix);
                resolve({ success: true, count });
            } catch (err) {
                resolve({ success: false, count: 0, error: '파일 불러오기 에러: ' + err.message });
            }
        };
        reader.onerror = () => resolve({ success: false, count: 0, error: '파일을 읽을 수 없습니다.' });
        reader.readAsArrayBuffer(file);
    });
}


// ------------------------------------------------------------------
// 4. 전체 데이터 JSON 백업 / 복원 / 팩토리 리셋
// ------------------------------------------------------------------

/**
 * 현재 일정/연락처 전체 데이터를 JSON 백업 파일로 다운로드한다.
 */
export function exportAllData() {
    const backupObj = {
        events: state.events,
        contacts: state.contacts,
        version: '1.0'
    };
    const jsonStr = JSON.stringify(backupObj, null, 2);
    downloadBlob(jsonStr, `티처스케줄_백업데이터_${formatDate(new Date())}.json`, 'application/json');
}

/**
 * JSON 백업 파일을 읽어 데이터를 복원한다.
 * 파이어베이스 연동 중이면 기존 서버 데이터를 유지한 채 병합(set)하고,
 * 로컬 모드이면 현재 데이터를 백업 내용으로 완전히 교체한다.
 * 되돌릴 수 없는 동작이므로 호출부(뷰)에서 사용자 확인을 먼저 받아야 한다.
 * @param {File} file - 업로드된 JSON 백업 파일
 * @returns {Promise<{success: boolean, mode?: 'local'|'firebase', error?: string}>} 복원 결과
 */
export function importBackupData(file) {
    return new Promise((resolve) => {
        if (!file) {
            resolve({ success: false, error: '파일이 없습니다.' });
            return;
        }

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const buffer = e.target.result;
                const text = decodeTextBuffer(buffer);
                const data = JSON.parse(text);
                if (!data.events || !data.contacts) {
                    resolve({ success: false, error: '올바른 백업 파일 형식이 아닙니다.' });
                    return;
                }

                if (isFirebaseConnected()) {
                    await runFirestoreBatch((batch, db) => {
                        data.events.forEach((ev) => {
                            batch.set(db.collection('schedules').doc(ev.id), {
                                title: ev.title,
                                date: ev.date,
                                category: ev.category,
                                desc: ev.desc || ''
                            });
                        });
                        data.contacts.forEach((c) => {
                            batch.set(db.collection('contacts').doc(c.id), {
                                name: c.name,
                                dept: c.dept,
                                role: c.role,
                                phone: c.phone,
                                note: c.note || ''
                            });
                        });
                    });
                    resolve({ success: true, mode: 'firebase' });
                } else {
                    state.events = sortEventsByDate(data.events);
                    state.contacts = data.contacts;
                    saveLocalEvents(state.events);
                    saveLocalContacts(state.contacts);
                    resolve({ success: true, mode: 'local' });
                }
            } catch (err) {
                resolve({ success: false, error: '복원 오류: ' + err.message });
            }
        };
        reader.onerror = () => resolve({ success: false, error: '파일을 읽을 수 없습니다.' });
        reader.readAsArrayBuffer(file);
    });
}

/**
 * 일정/연락처 데이터를 공장 초기화(데모 상태)로 되돌린다.
 * 파이어베이스 연동 중이면 Firestore의 schedules/contacts 문서를 모두 삭제한 뒤
 * 로컬 데이터도 함께 초기화한다. 되돌릴 수 없는 동작이므로 호출부(뷰)에서
 * 사용자 확인을 먼저 받아야 한다.
 * @returns {Promise<{success: boolean, error?: string}>} 초기화 결과
 */
export async function resetAllData() {
    if (!state.isAdmin) {
        return { success: false, error: '관리자 권한이 필요합니다.' };
    }

    if (isFirebaseConnected()) {
        await runFirestoreBatch((batch, db) => {
            state.events.forEach((ev) => batch.delete(db.collection('schedules').doc(ev.id)));
            state.contacts.forEach((c) => batch.delete(db.collection('contacts').doc(c.id)));
        });
    }

    state.events = [...MOCK_EVENTS];
    state.contacts = [...MOCK_CONTACTS];
    saveLocalEvents(state.events);
    saveLocalContacts(state.contacts);

    return { success: true };
}
