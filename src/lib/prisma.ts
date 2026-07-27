import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const url = process.env.DATABASE_URL ?? 'file:./prisma/dispatch.db'
  const authToken = process.env.LIBSQL_CLIENT_AUTH_TOKEN
  const adapter = new PrismaLibSql({ url, ...(authToken ? { authToken } : {}) })
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error'] : [],
  })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

// 네트워크 공유 DB(SMB) 동시접근 대비 (best-effort)
//  - journal_mode=DELETE: WAL은 네트워크 공유에서 -shm 미지원이라 실패 → 롤백 저널 강제
//  - busy_timeout: 락 걸리면 즉시 실패하지 않고 15초 대기 ('database is locked' 완화)
void prisma.$executeRawUnsafe('PRAGMA journal_mode=DELETE').catch(() => {})
void prisma.$executeRawUnsafe('PRAGMA busy_timeout=15000').catch(() => {})
