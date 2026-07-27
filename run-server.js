// Server wrapper - DATABASE_URL 한글 경로 자동 fallback + download-sap.ps1을 ASCII 경로로 복사
const fs = require('fs');
const path = require('path');

const LOCAL_DIR = 'C:\\dispatch_app';
const LOCAL_DB = LOCAL_DIR + '\\dispatch.db';
const LOCAL_URL = 'file:C:/dispatch_app/dispatch.db';

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
function urlToPath(url) {
    if (!url || !url.startsWith('file:')) return null;
    return url.replace(/^file:(?:\/\/\/)?/, '').replace(/^\//, '').replace(/\//g, '\\');
}
function hasKorean(s) { return /[ㄱ-ㆎ가-힣]/.test(s); }

// 공유 DB(23.20.121.23) 후보 — 드라이브 매핑(Z:)이 안 되어 있어도 UNC로 직접 접근 시도.
// 안전관리/VADS 모두 같은 DB를 쓰므로 여기서 결정되면 전 탭이 서버 공유가 된다.
const SHARE_CANDIDATES = [
    { path: 'Z:\\dispatch\\dispatch.db', url: 'file:Z:/dispatch/dispatch.db', label: 'Z: 매핑' },
    { path: '\\\\23.20.121.23\\common\\dispatch\\dispatch.db', url: 'file://23.20.121.23/common/dispatch/dispatch.db', label: 'UNC 직접' },
];
// 공유 DB 폴더가 살아있으면 (파일이 아직 없어도) 그 경로를 쓴다 — 첫 실행 시 자동 생성되도록
function pickShared() {
    for (const c of SHARE_CANDIDATES) {
        const dir = path.dirname(c.path);
        try {
            if (fs.existsSync(c.path)) return { ...c, exists: true };
            if (fs.existsSync(dir)) return { ...c, exists: false };
        } catch (e) { /* 접근 불가 → 다음 후보 */ }
    }
    return null;
}

let dbUrl = process.env.DATABASE_URL || LOCAL_URL;
let originalServerPath = null;

// 1) 명시된 DATABASE_URL이 없거나 로컬이면, 공유 DB가 살아있는지 먼저 확인해 그쪽을 우선 사용
if (!process.env.DATABASE_URL || dbUrl === LOCAL_URL) {
    const sh = pickShared();
    if (sh) {
        dbUrl = sh.url;
        console.log('[wrapper] 공유 DB 사용 (' + sh.label + '):', sh.path, sh.exists ? '' : '(신규 생성)');
    } else {
        console.log('[wrapper] ⚠ 공유 DB(23.20.121.23) 접근 불가 - 로컬 DB 사용 (이 PC 전용, 데이터 미공유)');
    }
}

// 2) 지정된 공유 경로가 실제로는 접근 불가면 로컬로 폴백 (서버 다운 시 앱이 죽지 않도록)
if (dbUrl !== LOCAL_URL && !hasKorean(dbUrl)) {
    const p = urlToPath(dbUrl);
    const dir = p ? path.dirname(p) : null;
    let ok = false;
    try { ok = !!(dir && fs.existsSync(dir)); } catch (e) { ok = false; }
    if (!ok) {
        console.log('[wrapper] ⚠ DB 경로 접근 불가:', p, '- 로컬 DB로 폴백 (데이터 미공유)');
        dbUrl = LOCAL_URL;
    }
}

// 3) 한글 경로면 로컬 ASCII로 복사해 쓰고 종료 시 서버로 되돌림 (기존 동작 유지)
if (hasKorean(dbUrl)) {
    console.log('[wrapper] ⚠ DATABASE_URL 한글 포함 - 로컬 ASCII 경로로 fallback');
    originalServerPath = urlToPath(dbUrl);
    if (originalServerPath && fs.existsSync(originalServerPath)) {
        ensureDir(LOCAL_DIR);
        try { fs.copyFileSync(originalServerPath, LOCAL_DB); console.log('[wrapper] 서버 DB → 로컬:', LOCAL_DB); }
        catch (e) { console.warn('[wrapper] 복사 실패:', e.message); }
    }
    dbUrl = LOCAL_URL;
}

if (dbUrl === LOCAL_URL && !fs.existsSync(LOCAL_DB)) {
    const seedPath = path.join(__dirname, 'seed', 'dispatch.db');
    if (fs.existsSync(seedPath)) {
        ensureDir(LOCAL_DIR);
        fs.copyFileSync(seedPath, LOCAL_DB);
        console.log('[wrapper] 시드 DB → 로컬 복사');
    }
}

process.env.DATABASE_URL = dbUrl;
console.log('[wrapper] DATABASE_URL:', dbUrl);

const dbPath = urlToPath(dbUrl);
if (dbPath) {
    try { const stat = fs.statSync(dbPath); console.log('[wrapper] DB:', dbPath, '(' + stat.size + ' bytes)'); }
    catch (e) { console.warn('[wrapper] DB 접근 불가:', dbPath); }
}

function syncBack() {
    if (originalServerPath && fs.existsSync(LOCAL_DB)) {
        try { fs.copyFileSync(LOCAL_DB, originalServerPath); console.log('[wrapper] 로컬 → 서버 sync'); }
        catch (e) { console.warn('[wrapper] sync 실패:', e.message); }
    }
}
process.on('SIGINT', () => { syncBack(); process.exit(0); });
process.on('SIGTERM', () => { syncBack(); process.exit(0); });
process.on('exit', syncBack);

if (!process.env.NEXTAUTH_SECRET) process.env.NEXTAUTH_SECRET = 'dispatch-secret-key-change-in-production';
if (!process.env.PORT) process.env.PORT = '3000';
if (!process.env.HOSTNAME) process.env.HOSTNAME = '0.0.0.0';

// download-sap.ps1을 C:\dispatch_app\로 복사 (한글 경로 회피)
try {
    const src = path.join(__dirname, 'download-sap.ps1');
    if (fs.existsSync(src)) {
        ensureDir(LOCAL_DIR);
        const dst = path.join(LOCAL_DIR, 'download-sap.ps1');
        fs.copyFileSync(src, dst);
        process.env.SAP_SCRIPT_PATH = dst;
        console.log('[wrapper] download-sap.ps1 → ASCII 경로 복사:', dst);
    }
} catch (e) { console.warn('[wrapper] PS1 복사 실패:', e.message); }

console.log('[wrapper] server.js 시작...');
require('./server.js');
