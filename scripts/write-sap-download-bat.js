// download-sap.bat 작성 (download-sap.ps1을 더블클릭으로 실행 가능하게 wrapper)
const fs = require('fs');
const iconv = require('iconv-lite');

const content = [
  '@echo off',
  'chcp 65001 >nul',
  'title SAP 배차 진행정보 자동 다운로드',
  '',
  'echo ========================================',
  'echo  SAP 배차 진행정보 자동 다운로드 시작',
  'echo ========================================',
  'echo.',
  'echo  ▶ 전제: SAP에 이미 로그인되어 있어야 합니다',
  'echo  ▶ SAP가 안 띄워져 있으면 먼저 SAP 로그인 후 다시 실행하세요',
  'echo.',
  'pause',
  '',
  'cd /d "%~dp0"',
  'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0download-sap.ps1"',
  '',
  'echo.',
  'echo ========================================',
  'echo  완료',
  'echo ========================================',
  'pause',
  ''
].join('\r\n');

const cp949 = iconv.encode(content, 'cp949');

const usbPath = 'D:\\제주배차시스템_standalone_20260605\\download-sap.bat';
const localPath = 'c:\\Users\\m3n89\\Desktop\\Dispatch\\dispatch\\.next\\standalone\\Desktop\\Dispatch\\dispatch\\download-sap.bat';
fs.writeFileSync(usbPath, cp949);
fs.writeFileSync(localPath, cp949);
console.log('download-sap.bat 작성 완료 (' + cp949.length + ' bytes)');
