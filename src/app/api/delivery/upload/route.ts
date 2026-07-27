import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import * as ExcelJS from 'exceljs'
import { classifyUncob, resolveModelType, getInstallCount, type ModelType } from '@/lib/modelJudge'
import { parsePdaStatus, emptyPdaCounts, type PdaCategory, type PdaCounts } from '@/lib/pdaStatus'
import { getRegionByZipcode, REGION_ORDER, REGION_NAMES, emptyRegionCounter, type RegionCode } from '@/lib/zipcodeRegion'
import { batchAddressToZipcode } from '@/lib/kakaoGeocoder'

// ─── ZRLEJ56700 리포트(헤더 기준) 파싱 ──────────────────────────────
// 컬럼은 위치가 아니라 헤더명으로 찾는다 (열 순서가 바뀌어도 견고).
//   Route               601=서귀포 / 602=제주시
//   Material            모델명 (표시용)
//   UNCOB               모델군 → 설치대수 판정 기준
//   SO Reason           ZL4 → 사전방문(제외)
//   SalesDLTime         고객요청일 (과거=연기, 미래=선설치)
//   ShipToPostalCode    우편번호 → ABCD 구역
//   ShipToAddress       배달주소
//   Vehicle Number(Full) 차량번호 → 기사 매칭
//   Freight Order       배차(Delivery) 단위 키
//   ShipToPartyName     고객명(마스킹)

function norm(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/[\s_().\-/]/g, '')
}

// ExcelJS 셀 값(rich text / 수식 / 날짜 등) → 문자열
function cellValToStr(v: unknown): string {
  if (v == null) return ''
  if (v instanceof Date) {
    const y = v.getFullYear()
    const m = String(v.getMonth() + 1).padStart(2, '0')
    const d = String(v.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  if (typeof v === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyV = v as any
    if (anyV.richText) return anyV.richText.map((t: { text?: string }) => t.text ?? '').join('')
    if (anyV.text != null) return String(anyV.text)
    if (anyV.result != null) return String(anyV.result)
    if (anyV.hyperlink != null) return String(anyV.text ?? anyV.hyperlink)
    return String(v)
  }
  return String(v)
}

// MHTML quoted-printable 디코드 (=XX 바이트 → UTF-8)
function decodeQuotedPrintable(s: string): string {
  const noSoft = s.replace(/=\r?\n/g, '')
  const bytes: number[] = []
  for (let i = 0; i < noSoft.length; i++) {
    const hex = noSoft.slice(i + 1, i + 3)
    if (noSoft[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16)); i += 2
    } else {
      bytes.push(noSoft.charCodeAt(i) & 0xff)
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

function stripTags(s: string): string { return s.replace(/<[^>]*>/g, '') }
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
}

// HTML/MHTML <table> → 행렬
function htmlToMatrix(html: string): string[][] {
  const matrix: string[][] = []
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi
  let trm: RegExpExecArray | null
  while ((trm = trRe.exec(html)) !== null) {
    const cells: string[] = []
    let tdm: RegExpExecArray | null
    tdRe.lastIndex = 0
    while ((tdm = tdRe.exec(trm[1])) !== null) {
      cells.push(decodeEntities(stripTags(tdm[1])).replace(/\s+/g, ' ').trim())
    }
    if (cells.length > 0) matrix.push(cells)
  }
  return matrix
}

// 버퍼 → 행렬(string[][]) : xlsx(zip) / MHTML / HTML / TSV·CSV 자동 판별
async function bufferToMatrix(buffer: Buffer): Promise<string[][]> {
  // 0) DRM 암호화 감지 (보안 PC 문서보안: NASCA DRM 등)
  //    Excel은 DRM이 자동 복호화하지만 node.exe가 raw로 읽으면 암호문이라 처리 불가
  const head = buffer.subarray(0, 128).toString('latin1')
  if (head.includes('NASCA DRM FILE') || head.includes('DRM FILE - VER')) {
    throw new Error(
      'DRM(문서보안)으로 암호화된 파일입니다. 보안 PC의 DRM이 SAP 엑셀을 자동 암호화해서 파일 업로드(자동·수동 모두)로는 읽을 수 없습니다. ' +
      '▶ 즉시 우회: 아래 "SAP 화면 복사 → 붙여넣기 업로드"를 사용하세요(클립보드는 보통 DRM 미적용). ' +
      '▶ 근본 해결: 저장 폴더(또는 C:\\temp)를 DRM 예외로 등록 / 앱을 DRM 허용 프로세스로 등록 — IT·보안담당 요청.'
    )
  }

  // 1) 진짜 xlsx (zip 시그니처 'PK')
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
    const workbook = new ExcelJS.Workbook()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(buffer as any)
    // 데이터가 가장 많은 워크시트 선택 (멀티시트 대비)
    let ws = workbook.worksheets[0]
    for (const w of workbook.worksheets) if ((w.rowCount ?? 0) > (ws?.rowCount ?? 0)) ws = w
    if (!ws) throw new Error('워크시트를 찾을 수 없습니다')
    const matrix: string[][] = []
    ws.eachRow((row: ExcelJS.Row) => {
      const vals = row.values as unknown[]
      const arr: string[] = []
      for (let i = 1; i < vals.length; i++) arr.push(cellValToStr(vals[i]))
      matrix.push(arr)
    })
    return matrix
  }

  // 2) 텍스트 계열로 디코드
  let text: string
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) text = buffer.toString('utf16le')
  else text = buffer.toString('utf8')

  // MHTML이면 quoted-printable 디코드
  if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(text)) text = decodeQuotedPrintable(text)

  // SAP "Excel in MHTML" / HTML 표
  if (/<table/i.test(text) || /<tr[\s>]/i.test(text)) return htmlToMatrix(text)

  // TSV / CSV
  const sep = text.includes('\t') ? '\t' : ','
  return text.split(/\r?\n/).filter(l => l.length > 0).map(l => l.split(sep).map(c => c.trim()))
}

// 날짜 문자열 → YYYY-MM-DD (없으면 '')
function toYmd(s: string): string {
  const m = s.trim().match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  return ''
}

interface ColMap {
  uncob: number
  material: number
  qty: number
  route: number
  soReason: number
  reqDate: number
  zip: number
  addr: number
  vehicle: number
  freight: number
  customer: number
  pda: number
}

function findCol(map: Map<string, number>, ...cands: string[]): number {
  for (const c of cands) {
    const k = norm(c)
    if (map.has(k)) return map.get(k)!
  }
  return -1
}

interface ParsedRecord {
  deliveryNo: string
  customerName: string
  vehicleNo: string
  driverName: string
  matched: boolean
  matnr: string
  uncob: string
  modelType: ModelType
  installCount: number
  sapCustomer: string
  zipcode: string
  address: string
  region: RegionCode
  requestDate: string  // 고객요청일 (YYYY-MM-DD)
  pdaCode: string      // W열 원본 코드 (A/B/1/2 …)
  pdaStatus: string    // 상태명 (설치/당일연기/취소 …)
  pdaCategory: PdaCategory  // 집계용 카테고리
}

async function parseExcel(
  buffer: Buffer,
  vehicleMap: Map<string, string>
): Promise<{ records: ParsedRecord[]; unmatchedVehicles: string[] }> {
  // 버퍼 → 행렬 (xlsx / MHTML / HTML / TSV 자동 판별)
  const magic = buffer.subarray(0, 4).toString('hex')
  const matrix = await bufferToMatrix(buffer)
  console.log(`[upload] 형식 magic=${magic} 행수=${matrix.length} 첫행칸수=${matrix[0]?.length ?? 0}`)
  if (matrix.length === 0) throw new Error('빈 파일이거나 표를 찾을 수 없습니다')

  // ZRLEJ56700 표준 컬럼 위치 (0-based, A=0). 헤더명 못 찾을 때 fallback
  //  E=Route(4) G=FreightOrder(6) K=Material(10) T=UNCOB(19) AA=SOReason(26)
  //  AS=SalesDLDate(44) BS=ShipToPartyName(70) BU=ShipToPostalCode(72) BV=ShipToAddress(73) CG=Vehicle(84)
  //  ※ AT(45)=SalesDLTime은 시간값(20100) → 날짜 아님. 고객요청일은 날짜 후보 중 자동 선택
  //  L=Qty(11) — 수량(설치대수)   W=PDA Step Status(22) — 설치/연기/취소/반품/통불
  const FIXED = { route: 4, freight: 6, material: 10, qty: 11, uncob: 19, pda: 22, soReason: 26, reqDate: 44, zip: 72, addr: 73, customer: 70, vehicle: 84 }

  // 헤더 행 탐지 (UNCOB 우선, 없으면 Material/Freight Order 행, 상위 50행 스캔)
  let headerRowIdx = -1
  let headerMap = new Map<string, number>()
  let fbIdx = -1
  let fbMap = new Map<string, number>()
  for (let r = 0; r < Math.min(50, matrix.length); r++) {
    const m = new Map<string, number>()
    matrix[r].forEach((v, i) => { const k = norm(v); if (k && !m.has(k)) m.set(k, i) })
    if (m.has('uncob')) { headerRowIdx = r; headerMap = m; break }
    if (fbIdx < 0 && (m.has('material') || m.has('freightorder'))) { fbIdx = r; fbMap = m }
  }
  let foundHeader = headerRowIdx >= 0
  if (!foundHeader && fbIdx >= 0) { headerRowIdx = fbIdx; headerMap = fbMap; foundHeader = true }

  // 헤더명으로 찾되, 없으면 고정 위치 사용
  const pick = (fixed: number, ...names: string[]): number => {
    const c = findCol(headerMap, ...names)
    return c >= 0 ? c : fixed
  }
  const cols: ColMap = {
    uncob:    pick(FIXED.uncob, 'uncob'),
    material: pick(FIXED.material, 'material'),
    qty:      pick(FIXED.qty, 'qty', 'quantity'),
    route:    pick(FIXED.route, 'route'),
    soReason: pick(FIXED.soReason, 'soreason'),
    reqDate:  pick(FIXED.reqDate, 'salesdldate', 'salesdltime', 'requestdeliverydate', 'requestdate'),
    zip:      pick(FIXED.zip, 'shiptopostalcode', 'postalcode', 'shiptopostal'),
    addr:     pick(FIXED.addr, 'shiptoaddress', 'address'),
    vehicle:  pick(FIXED.vehicle, 'vehiclenumberfull', 'vehiclenumber', 'deliverytruckno'),
    freight:  pick(FIXED.freight, 'freightorder', 'deliveryno', 'delivery'),
    customer: pick(FIXED.customer, 'shiptopartyname'),
    pda:      pick(FIXED.pda, 'pdastepstatus', 'stepstatus', 'pdastatus'),
  }
  // 데이터 시작 행: 헤더 찾았으면 다음 행, 못 찾았으면(헤더 없는 export) 0행부터
  const dataStart = foundHeader ? headerRowIdx + 1 : 0

  // 표 폭이 UNCOB(T=20번째)에 못 미치면 구조 인식 실패 → 진단 에러
  const maxWidth = matrix.slice(0, 20).reduce((mx, r) => Math.max(mx, r.length), 0)
  if (maxWidth <= cols.uncob) {
    const preview = matrix.slice(0, 4)
      .map((r, i) => `행${i}[${r.length}칸]: ${r.slice(0, 25).join(' | ')}`)
      .join('   //   ')
    console.log(`[upload] 표 폭 부족. magic=${magic} 행수=${matrix.length} maxWidth=${maxWidth} uncobIdx=${cols.uncob}`)
    console.log(`[upload] 미리보기: ${preview}`)
    throw new Error(
      `표 구조를 인식하지 못했습니다 (UNCOB=T열 필요). [형식 ${magic} · ${matrix.length}행 · 최대 ${maxWidth}칸] ` +
      `미리보기 ${preview.slice(0, 500)}`
    )
  }
  console.log(`[upload] 컬럼 매핑 headerFound=${foundHeader} dataStart=${dataStart} uncob=${cols.uncob} freight=${cols.freight} 행수=${matrix.length}`)

  const cell = (row: string[], idx: number): string =>
    (idx >= 0 && idx < row.length ? (row[idx] ?? '') : '').toString().trim()

  // 고객요청일: 날짜 후보 컬럼들 중 실제 YYYY-MM-DD가 든 칸을 행마다 자동 선택
  // (SalesDLTime=20100 같은 시간값은 toYmd가 ''로 거르므로 자동 회피)
  //  AS=SalesDLDate(44), AT=SalesDLTime(45), AU=RequestDeliveryDate(46), AR=DeliveryDate(43)
  const reqDateCols = [...new Set([
    cols.reqDate,
    findCol(headerMap, 'salesdldate'),
    findCol(headerMap, 'requestdeliverydate'),
    findCol(headerMap, 'salesdltime'),
    44, 46, 43,
  ].filter(c => c >= 0))]
  const pickReqDate = (row: string[]): string => {
    for (const c of reqDateCols) { const d = toYmd(cell(row, c)); if (d) return d }
    return ''
  }

  // ── 1차 파싱: 행 단위 raw 수집 ──────────────────────────────────
  interface RawRow {
    deliveryNo: string
    uncob: string
    matnr: string
    qty: number
    isPreVisit: boolean
    requestDate: string
    zipcode: string
    address: string
    vehicleNo: string
    sapCustomer: string
    pda: string
  }
  // Qty(수량) 파싱: 없거나 0이면 1.
  //  ※ SAP ALV는 수량을 "1.000"(=1, 소수점 3자리)처럼 표시함(엑셀 내보내기는 "1").
  //    따라서 끝의 소수부([.,] 뒤 1~3자리)를 먼저 제거하고 정수부만 사용한다.
  //    (예: "1.000"→1, "10.000"→10, "1"→1) — ALV/엑셀/붙여넣기 모두 호환.
  const parseQty = (s: string): number => {
    let t = (s || '').replace(/\s/g, '')
    t = t.replace(/[.,]\d{1,3}$/, '')          // 소수부 제거
    const n = parseInt(t.replace(/[^\d-]/g, ''), 10)
    return Number.isFinite(n) && n > 0 ? n : 1
  }
  const raws: RawRow[] = []
  for (let r = dataStart; r < matrix.length; r++) {
    const row = matrix[r]
    const deliveryNo = cell(row, cols.freight)
    if (!deliveryNo) continue  // 배차(Freight Order) 없는 행 = 데이터 아님
    // 헤더 행 누수 방지 (헤더 미검출 export에서 헤더가 데이터로 섞이는 경우)
    if (norm(deliveryNo) === 'freightorder' || norm(cell(row, cols.uncob)) === 'uncob') continue

    const zipMatch = cell(row, cols.zip).match(/\b(\d{5})\b/)
    raws.push({
      deliveryNo,
      uncob: cell(row, cols.uncob),
      matnr: cell(row, cols.material).toUpperCase(),
      qty: parseQty(cell(row, cols.qty)),
      isPreVisit: cell(row, cols.soReason).toUpperCase() === 'ZL4',
      requestDate: pickReqDate(row),
      zipcode: zipMatch ? zipMatch[1] : '',
      address: cell(row, cols.addr),
      vehicleNo: cell(row, cols.vehicle),
      sapCustomer: cell(row, cols.customer),
      pda: cell(row, cols.pda),
    })
  }

  // ── 2차: Delivery(고객) 단위로 HMRAC 존재 여부 집계 ──────────────
  const hmracByDelivery = new Set<string>()
  for (const r of raws) {
    if (classifyUncob(r.uncob) === 'HMRAC') hmracByDelivery.add(r.deliveryNo)
  }

  // ── 3차: 최종 레코드 생성 ────────────────────────────────────────
  const rows: ParsedRecord[] = []
  for (const r of raws) {
    const kind = classifyUncob(r.uncob)
    const modelType = resolveModelType(kind, {
      hasHmrac: hmracByDelivery.has(r.deliveryNo),
      isPreVisit: r.isPreVisit,
    })
    // 설치대수 = 카운트 대상이면 수량(Qty) 반영, 제외(0)면 0
    const installCount = getInstallCount(modelType) * r.qty

    const vehicleKey = r.vehicleNo.replace(/\s/g, '').toUpperCase()
    const matchedName = vehicleMap.get(vehicleKey)
    const driverName = matchedName || r.vehicleNo || 'UNKNOWN'
    const matched = !!matchedName

    const region = getRegionByZipcode(r.zipcode, r.address)
    const baseLabel = matched ? `${driverName} (${r.vehicleNo})` : r.vehicleNo || 'UNKNOWN'
    const customerName = r.sapCustomer ? `${baseLabel}|${r.sapCustomer}` : baseLabel

    rows.push({
      deliveryNo: r.deliveryNo,
      customerName,
      vehicleNo: r.vehicleNo,
      driverName,
      matched,
      matnr: r.matnr,
      uncob: r.uncob,
      modelType,
      installCount,
      sapCustomer: r.sapCustomer,
      zipcode: r.zipcode,
      address: r.address,
      region,
      requestDate: r.requestDate,
      ...(() => { const p = parsePdaStatus(r.pda); return { pdaCode: p.code, pdaStatus: p.status, pdaCategory: p.category } })(),
    })
  }

  const unmatchedVehicles = [...new Set(
    rows.filter(r => !r.matched && r.vehicleNo).map(r => r.vehicleNo)
  )]

  // 우편번호 없고 주소만 있는 row → 카카오 REST API로 우편번호 보완
  const needGeocoding = rows.filter(r => !r.zipcode && r.address)
  if (needGeocoding.length > 0 && process.env.KAKAO_REST_API_KEY) {
    try {
      const addrs = needGeocoding.map(r => r.address)
      const map = await batchAddressToZipcode(addrs)
      for (const r of needGeocoding) {
        const geo = map.get(r.address)
        if (geo?.zipcode) {
          r.zipcode = geo.zipcode
          r.region = getRegionByZipcode(r.zipcode, r.address)
        }
      }
      console.log(`[upload] 카카오 geocoder: ${needGeocoding.length}개 주소 변환`)
    } catch (e) {
      console.warn('[upload] 카카오 geocoder 실패:', e)
    }
  }

  return { records: rows, unmatchedVehicles }
}

interface DriverSummary {
  driverName: string
  vehicleNo: string
  matched: boolean
  deliveryNos: string[]
  deliveryCount: number
  totalInstall: number
  wallMount: number
  stand: number
  homeMulti: number
  systemAc: number
  commercial: number
  preVisit: number
  moveInstall: number
}

function buildDriverSummary(records: ParsedRecord[]): DriverSummary[] {
  // 1단계: Delivery 단위 집계
  const deliveryMap: Record<string, {
    driverName: string; vehicleNo: string; matched: boolean
    totalInstall: number; wallMount: number; stand: number
    homeMulti: number; systemAc: number; commercial: number; preVisit: number; moveInstall: number
  }> = {}

  // PRE_VISIT은 Delivery 단위 1회만 카운트 (installCount=0이라 합산 불가)
  const preVisitSeen = new Set<string>()

  for (const r of records) {
    if (!deliveryMap[r.deliveryNo]) {
      deliveryMap[r.deliveryNo] = {
        driverName: r.driverName, vehicleNo: r.vehicleNo, matched: r.matched,
        totalInstall: 0, wallMount: 0, stand: 0, homeMulti: 0, systemAc: 0, commercial: 0, preVisit: 0, moveInstall: 0,
      }
    }
    const d = deliveryMap[r.deliveryNo]
    d.totalInstall += r.installCount
    if (r.modelType === 'WALL_MOUNT') d.wallMount += r.installCount
    else if (r.modelType === 'STAND') d.stand += r.installCount
    else if (r.modelType === 'HOME_MULTI') d.homeMulti += r.installCount
    else if (r.modelType === 'SYSTEM_4WAY' || r.modelType === 'SYSTEM_1WAY' || r.modelType === 'SYSTEM_AC') d.systemAc += r.installCount
    else if (r.modelType === 'COMMERCIAL') d.commercial += r.installCount
    else if (r.modelType === 'MOVE_INSTALL') d.moveInstall += r.installCount
    else if (r.modelType === 'PRE_VISIT') {
      if (!preVisitSeen.has(r.deliveryNo)) {
        d.preVisit += 1
        preVisitSeen.add(r.deliveryNo)
      }
    }
  }

  // 2단계: 기사별 집계
  const driverMap: Record<string, DriverSummary> = {}
  for (const [deliveryNo, d] of Object.entries(deliveryMap)) {
    const key = d.driverName || 'UNKNOWN'
    if (!driverMap[key]) {
      driverMap[key] = {
        driverName: d.driverName, vehicleNo: d.vehicleNo, matched: d.matched,
        deliveryNos: [], deliveryCount: 0, totalInstall: 0,
        wallMount: 0, stand: 0, homeMulti: 0, systemAc: 0, commercial: 0, preVisit: 0, moveInstall: 0,
      }
    }
    const c = driverMap[key]
    c.deliveryNos.push(deliveryNo)
    c.deliveryCount++
    c.totalInstall += d.totalInstall
    c.wallMount += d.wallMount
    c.stand += d.stand
    c.homeMulti += d.homeMulti
    c.systemAc += d.systemAc
    c.commercial += d.commercial
    c.preVisit += d.preVisit
    c.moveInstall += d.moveInstall
  }

  return Object.values(driverMap).sort((a, b) => b.totalInstall - a.totalInstall)
}

// 고객요청일 vs 설치일 → 연기/선설치/정상 (Delivery 단위)
interface DateStats {
  postponed: number   // 고객요청일 < 설치일 → 연기된 건
  preInstall: number  // 고객요청일 > 설치일 → 선설치
  normal: number      // 고객요청일 = 설치일
  unknown: number     // 요청일 없음
}

function buildDateStats(records: ParsedRecord[], installDate: string): DateStats {
  const seen = new Map<string, string>() // deliveryNo → requestDate
  for (const r of records) {
    if (!seen.has(r.deliveryNo)) seen.set(r.deliveryNo, r.requestDate)
    else if (!seen.get(r.deliveryNo) && r.requestDate) seen.set(r.deliveryNo, r.requestDate)
  }
  const stats: DateStats = { postponed: 0, preInstall: 0, normal: 0, unknown: 0 }
  for (const req of seen.values()) {
    if (!req) { stats.unknown++; continue }
    if (req < installDate) stats.postponed++
    else if (req > installDate) stats.preInstall++
    else stats.normal++
  }
  return stats
}

interface ComparisonDriver {
  driverName: string
  vehicleNo: string
  prevDeliveryCount: number
  prevInstallCount: number
  sameDayDeliveryCount: number
  sameDayInstallCount: number
  maintained: number
  postponed: number
  added: number
}

function parseCustomerName(cn: string): { driverName: string; vehicleNo: string; sapCustomer: string } {
  const parts = cn.split('|')
  const baseLabel = parts[0]
  const sapCustomer = parts[1] || ''
  const m = baseLabel.match(/^(.+) \((.+)\)$/)
  if (m) return { driverName: m[1], vehicleNo: m[2], sapCustomer }
  return { driverName: baseLabel, vehicleNo: '', sapCustomer }
}

function buildComparison(
  prevRecords: { deliveryNo: string; customerName: string; installCount: number }[],
  sameDayRecords: ParsedRecord[]
): ComparisonDriver[] {
  const prevMap: Record<string, { driverName: string; vehicleNo: string; installCount: number }> = {}
  for (const r of prevRecords) {
    if (!prevMap[r.deliveryNo]) {
      const { driverName, vehicleNo } = parseCustomerName(r.customerName)
      prevMap[r.deliveryNo] = { driverName, vehicleNo, installCount: 0 }
    }
    prevMap[r.deliveryNo].installCount += r.installCount
  }

  const sameDayMap: Record<string, { driverName: string; vehicleNo: string; installCount: number }> = {}
  for (const r of sameDayRecords) {
    if (!sameDayMap[r.deliveryNo]) {
      sameDayMap[r.deliveryNo] = { driverName: r.driverName, vehicleNo: r.vehicleNo, installCount: 0 }
    }
    sameDayMap[r.deliveryNo].installCount += r.installCount
  }

  const allDrivers = new Set([
    ...Object.values(prevMap).map(d => d.driverName),
    ...Object.values(sameDayMap).map(d => d.driverName),
  ])

  return [...allDrivers].map(driverName => {
    const prevEntries = Object.entries(prevMap).filter(([, d]) => d.driverName === driverName)
    const sameDayEntries = Object.entries(sameDayMap).filter(([, d]) => d.driverName === driverName)
    const prevNos = new Set(prevEntries.map(([no]) => no))
    const sameDayNos = new Set(sameDayEntries.map(([no]) => no))

    return {
      driverName,
      vehicleNo: prevEntries[0]?.[1].vehicleNo || sameDayEntries[0]?.[1].vehicleNo || '',
      prevDeliveryCount: prevNos.size,
      prevInstallCount: prevEntries.reduce((s, [, d]) => s + d.installCount, 0),
      sameDayDeliveryCount: sameDayNos.size,
      sameDayInstallCount: sameDayEntries.reduce((s, [, d]) => s + d.installCount, 0),
      maintained: [...prevNos].filter(no => sameDayNos.has(no)).length,
      postponed: [...prevNos].filter(no => !sameDayNos.has(no)).length,
      added: [...sameDayNos].filter(no => !prevNos.has(no)).length,
    }
  }).sort((a, b) => (b.postponed + b.added) - (a.postponed + a.added) || a.driverName.localeCompare(b.driverName))
}

// PDA Step Status 집계 — Delivery(배차) 단위로 1건씩 카테고리 카운트 (총계 + 기사별)
function buildStatusStats(records: ParsedRecord[]): {
  total: PdaCounts
  byDriver: { driverName: string; vehicleNo: string; counts: PdaCounts }[]
} {
  // 배차(Delivery) 단위 대표 상태 (첫 레코드 기준; 한 배차의 W값은 동일)
  const byDelivery = new Map<string, { driver: string; vehicle: string; cat: PdaCategory }>()
  for (const r of records) {
    if (!byDelivery.has(r.deliveryNo)) byDelivery.set(r.deliveryNo, { driver: r.driverName, vehicle: r.vehicleNo, cat: r.pdaCategory })
  }
  const total = emptyPdaCounts()
  const drv = new Map<string, { vehicle: string; counts: PdaCounts }>()
  for (const { driver, vehicle, cat } of byDelivery.values()) {
    total[cat] += 1
    if (!drv.has(driver)) drv.set(driver, { vehicle, counts: emptyPdaCounts() })
    drv.get(driver)!.counts[cat] += 1
  }
  const byDriver = [...drv.entries()]
    .map(([driverName, v]) => ({ driverName, vehicleNo: v.vehicle, counts: v.counts }))
    .sort((a, b) => (b.counts.POSTPONED + b.counts.CANCELLED + b.counts.RETURNED) - (a.counts.POSTPONED + a.counts.CANCELLED + a.counts.RETURNED))
  return { total, byDriver }
}

// 신규 컬럼(zipcode/address/region/pdaStatus) 자가 마이그레이션 — 프로덕션 DB 호환
let schemaEnsured = false
async function ensureDeliveryRecordSchema(): Promise<void> {
  if (schemaEnsured) return
  for (const col of ['zipcode', 'address', 'region', 'pdaStatus', 'pdaCategory']) {
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "DeliveryRecord" ADD COLUMN "${col}" TEXT`)
      console.log(`[migration] DeliveryRecord.${col} 컬럼 추가됨`)
    } catch {
      // 이미 존재 → 무시
    }
  }
  try {
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DeliveryRecord_region_idx" ON "DeliveryRecord"("region")`)
  } catch { /* ignore */ }
  schemaEnsured = true
}

// TSV(탭 구분 텍스트) → xlsx Buffer 변환
async function tsvToXlsxBuffer(tsv: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const ws = workbook.addWorksheet('Sheet1')
  const lines = tsv.split(/\r?\n/)
  for (const line of lines) {
    if (line.length === 0) continue
    ws.addRow(line.split('\t'))
  }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const tsvText = formData.get('tsvText') as string | null
    const uploadType = formData.get('uploadType') as string
    const installDate = formData.get('installDate') as string

    if (!file && !tsvText) return NextResponse.json({ error: '파일 또는 SAP 텍스트가 없습니다' }, { status: 400 })
    if (!['PREV_DELIVERY', 'SAME_DAY_DELIVERY'].includes(uploadType)) {
      return NextResponse.json({ error: '유효하지 않은 uploadType' }, { status: 400 })
    }
    if (!installDate || !/^\d{4}-\d{2}-\d{2}$/.test(installDate)) {
      return NextResponse.json({ error: '날짜 형식 오류 (YYYY-MM-DD)' }, { status: 400 })
    }

    await ensureDeliveryRecordSchema()

    // 차량번호 → 기사명 매핑
    const allDrivers = await prisma.driver.findMany({ select: { teamName: true, vehicleNumber: true } })
    const vehicleMap = new Map<string, string>()
    for (const d of allDrivers) {
      if (d.vehicleNumber) vehicleMap.set(d.vehicleNumber.replace(/\s/g, '').toUpperCase(), d.teamName)
    }

    let buffer: Buffer
    let sourceName: string
    if (tsvText) {
      buffer = await tsvToXlsxBuffer(tsvText)
      sourceName = `SAP-paste_${installDate}.xlsx`
    } else {
      const bytes = await file!.arrayBuffer()
      buffer = Buffer.from(bytes)
      sourceName = file!.name
    }
    const { records, unmatchedVehicles } = await parseExcel(buffer, vehicleMap)

    if (records.length === 0) {
      return NextResponse.json({ error: '유효한 데이터가 없습니다 (Freight Order/Delivery 없음)' }, { status: 400 })
    }

    const workDate = await prisma.workDate.upsert({
      where: { date: installDate },
      update: {},
      create: { date: installDate },
    })

    // 기존 동일 타입 세션 삭제 (재업로드 시 교체)
    const existingSessions = await prisma.deliverySession.findMany({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      where: { workDateId: workDate.id, uploadType: uploadType as any },
      select: { id: true },
    })
    if (existingSessions.length > 0) {
      const ids = existingSessions.map(s => s.id)
      await prisma.deliveryRecord.deleteMany({ where: { sessionId: { in: ids } } })
      await prisma.deliverySession.deleteMany({ where: { id: { in: ids } } })
    }

    // 레코드 기본 데이터 (+ PDA 상태). 구버전 Prisma 클라이언트(신규컬럼 모름)면 폴백.
    const baseRec = records.map(r => ({
      deliveryNo: r.deliveryNo,
      customerName: r.customerName,
      matnr: r.matnr,
      modelType: r.modelType,
      installCount: r.installCount,
      zipcode: r.zipcode || null,
      address: r.address || null,
      region: r.region || null,
    }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const withPda = records.map((r, i) => ({ ...baseRec[i], pdaStatus: r.pdaStatus || null, pdaCategory: r.pdaCategory || null } as any))
    try {
      await prisma.deliverySession.create({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { workDateId: workDate.id, uploadType: uploadType as any, fileName: sourceName, records: { create: withPda } },
      })
    } catch (e) {
      // 신규 컬럼 미지원 클라이언트 → PDA 필드 빼고 재시도 (500 방지)
      console.warn('[upload] PDA 컬럼 저장 실패 → 폴백:', e instanceof Error ? e.message : e)
      await prisma.deliverySession.create({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { workDateId: workDate.id, uploadType: uploadType as any, fileName: sourceName, records: { create: baseRec } },
      })
    }

    const driverSummary = buildDriverSummary(records)
    const dateStats = buildDateStats(records, installDate)
    const statusStats = buildStatusStats(records)  // PDA Step Status (설치/연기/취소/반품/통불)

    // 당일 납기일 경우 전일 납기와 비교
    let comparison: ComparisonDriver[] | null = null
    if (uploadType === 'SAME_DAY_DELIVERY') {
      const prevSession = await prisma.deliverySession.findFirst({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        where: { workDateId: workDate.id, uploadType: 'PREV_DELIVERY' as any },
        include: { records: true },
      })
      if (prevSession) {
        comparison = buildComparison(prevSession.records, records)
      }
    }

    // ── 구역별 집계 ──
    interface DeliveryDot {
      deliveryNo: string
      driverName: string
      vehicleNo: string
      customerName: string
      address: string
      zipcode: string
      region: RegionCode
    }
    const regionTotal = emptyRegionCounter()
    const regionByDriver = new Map<string, Record<RegionCode, number>>()
    const byZipcode = new Map<string, {
      region: RegionCode
      count: number
      sampleAddress: string
      deliveries: DeliveryDot[]
    }>()
    const seenDeliveries = new Set<string>()
    for (const r of records) {
      if (seenDeliveries.has(r.deliveryNo)) continue
      seenDeliveries.add(r.deliveryNo)
      regionTotal[r.region] = (regionTotal[r.region] ?? 0) + 1
      if (!regionByDriver.has(r.driverName)) regionByDriver.set(r.driverName, emptyRegionCounter())
      const dr = regionByDriver.get(r.driverName)!
      dr[r.region] = (dr[r.region] ?? 0) + 1

      if (r.zipcode) {
        const dot: DeliveryDot = {
          deliveryNo: r.deliveryNo,
          driverName: r.driverName,
          vehicleNo: r.vehicleNo,
          customerName: r.sapCustomer || r.driverName,
          address: r.address,
          zipcode: r.zipcode,
          region: r.region,
        }
        const existing = byZipcode.get(r.zipcode)
        if (existing) {
          existing.count += 1
          if (!existing.sampleAddress && r.address) existing.sampleAddress = r.address
          existing.deliveries.push(dot)
        } else {
          byZipcode.set(r.zipcode, {
            region: r.region,
            count: 1,
            sampleAddress: r.address || '',
            deliveries: [dot],
          })
        }
      }
    }
    const regionStats = {
      total: regionTotal,
      byDriver: Array.from(regionByDriver.entries()).map(([driverName, counts]) => ({ driverName, counts })),
      byZipcode: Array.from(byZipcode.entries()).map(([zipcode, info]) => ({ zipcode, ...info })),
      regionOrder: REGION_ORDER,
      regionNames: REGION_NAMES,
    }

    return NextResponse.json({
      success: true,
      installDate,
      uploadType,
      totalRows: records.length,
      deliveryCount: driverSummary.reduce((s, d) => s + d.deliveryCount, 0),
      driverSummary,
      dateStats,
      unmatchedVehicles,
      comparison,
      regionStats,
      statusStats,   // PDA Step Status: { total, byDriver }
    })
  } catch (error) {
    console.error('Delivery upload error:', error)
    const msg = error instanceof Error ? error.message : '업로드 중 오류가 발생했습니다'
    return NextResponse.json({
      error: msg,
      detail: error instanceof Error ? (error.stack ?? '').slice(0, 600) : undefined,
    }, { status: 500 })
  }
}
