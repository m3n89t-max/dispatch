import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const records = await prisma.monthClose.findMany({ orderBy: { yearMonth: 'asc' } });
  return NextResponse.json(records);
}

export async function POST(req: Request) {
  const { yearMonth, note, closedBy } = await req.json();
  if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth))
    return NextResponse.json({ error: 'yearMonth 형식 오류 (YYYY-MM)' }, { status: 400 });

  const record = await prisma.monthClose.upsert({
    where: { yearMonth },
    update: { closedAt: new Date(), note: note ?? null, closedBy: closedBy ?? null },
    create: { yearMonth, note: note ?? null, closedBy: closedBy ?? null },
  });
  return NextResponse.json(record);
}

export async function DELETE(req: Request) {
  const ym = new URL(req.url).searchParams.get('ym');
  if (!ym) return NextResponse.json({ error: 'ym 필수' }, { status: 400 });

  await prisma.monthClose.deleteMany({ where: { yearMonth: ym } });
  return NextResponse.json({ success: true });
}
