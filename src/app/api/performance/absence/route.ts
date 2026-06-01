import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (!from || !to) return NextResponse.json({ error: 'from, to 필수' }, { status: 400 });

  const absences = await prisma.driverAbsence.findMany({
    where: { date: { gte: from, lte: to } },
    orderBy: { date: 'asc' },
  });
  return NextResponse.json({ absences });
}

export async function POST(req: Request) {
  const { driverName, date, absenceType, reason } = await req.json();
  if (!driverName || !date || !absenceType)
    return NextResponse.json({ error: 'driverName, date, absenceType 필수' }, { status: 400 });

  const record = await prisma.driverAbsence.upsert({
    where: { driverName_date: { driverName, date } },
    update: { absenceType, reason: reason ?? null },
    create: { driverName, date, absenceType, reason: reason ?? null },
  });
  return NextResponse.json(record);
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const driverName = searchParams.get('driverName');
  const date = searchParams.get('date');
  if (!driverName || !date)
    return NextResponse.json({ error: 'driverName, date 필수' }, { status: 400 });

  await prisma.driverAbsence.deleteMany({ where: { driverName, date } });
  return NextResponse.json({ success: true });
}
