import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const NPS_DEFAULTS = {
  id: null,
  acTotal: 0, acRecommend: 0, acNeutral: 0, acNotRecommend: 0,
  acServiceNPS: null, acInstallNPS: null,
  mvTotal: 0, mvRecommend: 0, mvNeutral: 0, mvNotRecommend: 0,
  mvServiceNPS: null, mvInstallNPS: null,
  vocTotal: 0, vocRecommend: 0, vocNeutral: 0, vocNotRecommend: 0,
  vocRepurchase: null, vocScore: null,
};

export async function GET(req: Request) {
  try {
    const ym = new URL(req.url).searchParams.get('ym');
    if (!ym) return NextResponse.json({ error: 'ym 필수' }, { status: 400 });

    const [npsRecords, drivers] = await Promise.all([
      prisma.driverNPS.findMany({ where: { yearMonth: ym }, orderBy: { driverName: 'asc' } }),
      prisma.driver.findMany({
        where: { status: 'ACTIVE' },
        select: { teamName: true, vehicleNumber: true },
        orderBy: { teamName: 'asc' },
      }),
    ]);

    const npsMap = new Map(npsRecords.map((r) => [r.driverName, r]));
    const result = drivers.map((d) => ({
      ...NPS_DEFAULTS,
      ...npsMap.get(d.teamName),
      driverName: d.teamName,
      vehicleNo: d.vehicleNumber ?? '',
      yearMonth: ym,
    }));

    return NextResponse.json(result);
  } catch (e) {
    console.error('NPS GET error:', e);
    return NextResponse.json({ error: '조회 오류' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { driverName, vehicleNo, yearMonth, id: _id, ...rest } = await req.json();
    if (!driverName || !yearMonth)
      return NextResponse.json({ error: 'driverName, yearMonth 필수' }, { status: 400 });

    const data = { vehicleNo: vehicleNo ?? null, ...rest };
    const record = await prisma.driverNPS.upsert({
      where: { driverName_yearMonth: { driverName, yearMonth } },
      update: data,
      create: { driverName, yearMonth, ...data },
    });
    return NextResponse.json(record);
  } catch (e) {
    console.error('NPS POST error:', e);
    return NextResponse.json({ error: '저장 오류' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const driverName = searchParams.get('driverName');
    const ym = searchParams.get('ym');
    if (!driverName || !ym)
      return NextResponse.json({ error: '파라미터 필수' }, { status: 400 });

    await prisma.driverNPS.deleteMany({ where: { driverName, yearMonth: ym } });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('NPS DELETE error:', e);
    return NextResponse.json({ error: '삭제 오류' }, { status: 500 });
  }
}
