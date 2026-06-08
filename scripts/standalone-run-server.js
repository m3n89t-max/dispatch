// Server wrapper
// - DATABASE_URL이 한글 경로면 자동으로 로컬 ASCII 경로로 fallback
// - 서버 DB와 로컬 DB 자동 sync

const fs = require('fs');
const path = require('path');

const LOCAL_DIR = 'C:\\dispatch_app';
const LOCAL_DB = LOCAL_DIR + '\\dispatch.db';
const LOCAL_URL = 'file:C:/dispatch_app/dispatch.db';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function urlToPath(url) {
  if (!url || !url.startsWith('file:')) return null;
  return url.replace(/^file:(?:\/\/\/)?/, '').replace(/^\//, '').replace(/\//g, '\\');
}

function hasKorean(s) {
  return /[ㄱ-ㆎ가-힣]/.test(s);
}

let dbUrl = process.env.DATABASE_URL || LOCAL_URL;
let originalServerPath = null;

// 한글 경로면 로컬로 fallback
if (hasKorean(dbUrl)) {
  console.log('[wrapper] ⚠ DATABASE_URL에 한글 포함 - 로컬 ASCII 경로로 fallback');
  originalServerPath = urlToPath(dbUrl);

  // 서버 DB가 있으면 로컬로 복사
  if (originalServerPath && fs.existsSync(originalServerPath)) {
    ensureDir(LOCAL_DIR);
    try {
      fs.copyFileSync(originalServerPath, LOCAL_DB);
      console.log('[wrapper] 서버 DB → 로컬 복사:', originalServerPath, '→', LOCAL_DB);
    } catch (e) {
      console.warn('[wrapper] ⚠ 서버 DB 복사 실패:', e.message);
    }
  }

  dbUrl = LOCAL_URL;
}

// 로컬 DB가 없으면 시드에서 복사
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

// DB 파일 확인
const dbPath = urlToPath(dbUrl);
if (dbPath) {
  try {
    const stat = fs.statSync(dbPath);
    console.log('[wrapper] DB 파일:', dbPath, '(' + stat.size + ' bytes)');
  } catch (e) {
    console.warn('[wrapper] ⚠ DB 파일 접근 불가:', dbPath);
  }
}

// 종료 시 로컬 → 서버 sync
function syncBackToServer() {
  if (originalServerPath && fs.existsSync(LOCAL_DB)) {
    try {
      fs.copyFileSync(LOCAL_DB, originalServerPath);
      console.log('[wrapper] 로컬 → 서버 sync 완료:', originalServerPath);
    } catch (e) {
      console.warn('[wrapper] ⚠ 서버 sync 실패:', e.message);
    }
  }
}

process.on('SIGINT', () => { syncBackToServer(); process.exit(0); });
process.on('SIGTERM', () => { syncBackToServer(); process.exit(0); });
process.on('exit', syncBackToServer);

// 다른 환경변수도 기본값 보장
if (!process.env.NEXTAUTH_SECRET) process.env.NEXTAUTH_SECRET = 'dispatch-secret-key-change-in-production';
if (!process.env.PORT) process.env.PORT = '3000';
if (!process.env.HOSTNAME) process.env.HOSTNAME = '0.0.0.0';

console.log('[wrapper] server.js 시작 중...');
require('./server.js');
