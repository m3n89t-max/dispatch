// 차량별배차진행정보 폴더 감시 + 자동 업로드
// SAP에서 다운로드된 엑셀이 폴더에 떨어지면 자동으로 /api/delivery/upload 호출
const fs = require('fs');
const path = require('path');
const os = require('os');

// C:\temp — SAP가 ZRLEJ56700.xlsx를 떨구는 폴더 (DRM 예외 임시경로)
const WATCH_DIR = 'C:\\temp';
const PROCESSED_DIR = path.join(WATCH_DIR, 'processed');
const LOCK_FILE = path.join(WATCH_DIR, '.sap-import.lock');
const SERVER_URL = process.env.WATCHER_SERVER_URL || 'http://localhost:3000';
const POLL_MS = 2000;
const STABILITY_MS = 1500; // 파일 쓰기 안정화 대기 (mtime 변경 없음)
const LOCK_MAX_AGE_MS = 5 * 60 * 1000; // 5분 — sap-import 진행 중에는 watcher 스킵

fs.mkdirSync(WATCH_DIR, { recursive: true });
fs.mkdirSync(PROCESSED_DIR, { recursive: true });

const processing = new Set();

function pickUploadType(fileName) {
  // 파일명에 SAMEDAY 포함 시 당일 납기, 아니면 전일 납기 (기본)
  if (/SAMEDAY|SAME_DAY|당일/i.test(fileName)) return 'SAME_DAY_DELIVERY';
  return 'PREV_DELIVERY';
}

function pickInstallDate(fileName) {
  // 파일명에서 YYYYMMDD 또는 YYYY-MM-DD 추출
  const m1 = fileName.match(/(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/);
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
  // 없으면 오늘
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

async function uploadFile(filePath, fileName) {
  const buf = fs.readFileSync(filePath);
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const formData = new FormData();
  formData.append('file', blob, fileName);
  formData.append('uploadType', pickUploadType(fileName));
  formData.append('installDate', pickInstallDate(fileName));

  const res = await fetch(`${SERVER_URL}/api/delivery/upload`, {
    method: 'POST',
    body: formData,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function scan() {
  // sap-import API가 진행 중이면 충돌 방지 위해 스킵
  try {
    const lockStat = fs.statSync(LOCK_FILE);
    if (Date.now() - lockStat.mtimeMs < LOCK_MAX_AGE_MS) return;
    // lock이 너무 오래되면 stale로 간주 — 삭제 후 진행
    try { fs.unlinkSync(LOCK_FILE); } catch {}
  } catch {}

  let entries;
  try {
    entries = fs.readdirSync(WATCH_DIR, { withFileTypes: true });
  } catch (e) {
    return;
  }

  for (const e of entries) {
    if (!e.isFile()) continue;
    // SAP ZRLEJ56700 export (고정 파일명) 또는 구버전 EXPORT_YYYYMMDD_HHMMSS.xlsx
    if (!/^ZRLEJ56700\.xlsx$/i.test(e.name) && !/^EXPORT_\d{8}_\d{6}\.xlsx$/i.test(e.name)) continue;
    if (processing.has(e.name)) continue;

    const full = path.join(WATCH_DIR, e.name);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }

    // 파일 쓰기 중일 수 있으니 mtime 안정화 확인
    if (Date.now() - stat.mtimeMs < STABILITY_MS) continue;
    if (stat.size === 0) continue;

    processing.add(e.name);
    console.log(`[watcher] 새 파일 감지: ${e.name} (${(stat.size/1024).toFixed(1)} KB)`);

    try {
      const data = await uploadFile(full, e.name);
      console.log(`[watcher] 업로드 완료: ${data.totalRows ?? 0}행, ${data.deliveryCount ?? 0}건, 미매칭 차량 ${data.unmatchedVehicles?.length ?? 0}건`);

      // 처리 완료 → processed 폴더로 이동
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const dest = path.join(PROCESSED_DIR, `${ts}_${e.name}`);
      fs.renameSync(full, dest);
      console.log(`[watcher] 이동 → ${dest}`);
    } catch (err) {
      console.error(`[watcher] 업로드 실패 (${e.name}): ${err.message}`);
      // 실패한 파일은 그대로 두고 다음 스캔에서 재시도하지 않도록 .failed 확장자 추가
      try {
        const failedPath = full + '.failed';
        fs.renameSync(full, failedPath);
        console.error(`[watcher] 실패 파일 → ${failedPath} (수동 확인 필요)`);
      } catch {}
    } finally {
      processing.delete(e.name);
    }
  }
}

console.log('========================================');
console.log(' SAP 엑셀 자동 업로드 watcher 시작');
console.log('========================================');
console.log(` 감시 폴더: ${WATCH_DIR}`);
console.log(` 서버: ${SERVER_URL}`);
console.log(` 폴링 주기: ${POLL_MS}ms`);
console.log('');
console.log(' SAP에서 다운받은 엑셀(.xlsx)을 위 폴더에 두면');
console.log(' 자동으로 배차 자동화 시스템에 업로드됩니다.');
console.log('========================================');
console.log('');

setInterval(scan, POLL_MS);
// 시작 직후 한 번 스캔
scan();
