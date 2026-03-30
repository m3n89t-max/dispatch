/**
 * Prisma seed script - 초기 데이터 생성
 * Run: npx prisma db seed
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  // Create admin user
  const hashedPassword = await bcrypt.hash('admin1234', 10)
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      password: hashedPassword,
      role: 'ADMIN',
    },
  })

  await prisma.user.upsert({
    where: { username: 'dispatch' },
    update: {},
    create: {
      username: 'dispatch',
      password: await bcrypt.hash('dispatch1234', 10),
      role: 'DISPATCH',
    },
  })

  console.log('Users created.')

  // Create sample drivers - 서귀포 (0601)
  const seogwipoTeams = [
    { teamCode: 'S001', teamName: '김철수팀' },
    { teamCode: 'S002', teamName: '이영희팀' },
    { teamCode: 'S003', teamName: '박민준팀' },
    { teamCode: 'S004', teamName: '최지현팀' },
    { teamCode: 'S005', teamName: '정수빈팀' },
    { teamCode: 'S006', teamName: '강동현팀' },
    { teamCode: 'S007', teamName: '윤서연팀' },
    { teamCode: 'S008', teamName: '임준혁팀' },
    { teamCode: 'S009', teamName: '한소희팀' },
    { teamCode: 'S010', teamName: '오민준팀' },
    { teamCode: 'S011', teamName: '서지영팀' },
    { teamCode: 'S012', teamName: '권태호팀' },
    { teamCode: 'S013', teamName: '신민경팀' },
    { teamCode: 'S014', teamName: '황성훈팀' },
    { teamCode: 'S015', teamName: '장지원팀' },
    { teamCode: 'S016', teamName: '배성민팀' },
    { teamCode: 'S017', teamName: '홍길동팀' },
  ]

  // Create sample drivers - 제주시 (0602)
  const jejuTeams = [
    { teamCode: 'J001', teamName: '고상현팀' },
    { teamCode: 'J002', teamName: '남기호팀' },
    { teamCode: 'J003', teamName: '도지민팀' },
    { teamCode: 'J004', teamName: '류수진팀' },
    { teamCode: 'J005', teamName: '문현준팀' },
    { teamCode: 'J006', teamName: '백승호팀' },
    { teamCode: 'J007', teamName: '성민재팀' },
    { teamCode: 'J008', teamName: '안지원팀' },
    { teamCode: 'J009', teamName: '엄태준팀' },
    { teamCode: 'J010', teamName: '전서연팀' },
    { teamCode: 'J011', teamName: '조민수팀' },
    { teamCode: 'J012', teamName: '차지영팀' },
    { teamCode: 'J013', teamName: '천성민팀' },
    { teamCode: 'J014', teamName: '추성훈팀' },
    { teamCode: 'J015', teamName: '탁민준팀' },
    { teamCode: 'J016', teamName: '하지현팀' },
    { teamCode: 'J017', teamName: '허성재팀' },
  ]

  let driverCount = 0
  for (const team of seogwipoTeams) {
    await prisma.driver.upsert({
      where: { teamCode: team.teamCode },
      update: {},
      create: {
        teamCode: team.teamCode,
        teamName: team.teamName,
        route: '0601',
        status: 'ACTIVE',
      },
    })
    driverCount++
  }

  for (const team of jejuTeams) {
    await prisma.driver.upsert({
      where: { teamCode: team.teamCode },
      update: {},
      create: {
        teamCode: team.teamCode,
        teamName: team.teamName,
        route: '0602',
        status: 'ACTIVE',
      },
    })
    driverCount++
  }

  console.log(`${driverCount} drivers created.`)

  // Create sample performance data for the last 7 days
  const drivers = await prisma.driver.findMany()
  let perfCount = 0

  for (const driver of drivers) {
    for (let daysAgo = 1; daysAgo <= 7; daysAgo++) {
      const perfDate = new Date()
      perfDate.setDate(perfDate.getDate() - daysAgo)
      perfDate.setHours(0, 0, 0, 0)

      // Random performance data
      const completionRate = 70 + Math.random() * 30
      const op2Score = 60 + Math.random() * 40
      const npsScore = 65 + Math.random() * 35
      const defectRate = Math.random() * 10
      const deliveryConfirmRate = 75 + Math.random() * 25
      const deliveryMaintainRate = 80 + Math.random() * 20

      try {
        await prisma.dailyPerformance.upsert({
          where: {
            driverId_perfDate: {
              driverId: driver.id,
              perfDate,
            },
          },
          update: {},
          create: {
            driverId: driver.id,
            perfDate,
            completionRate,
            op2Score,
            npsScore,
            defectRate,
            deliveryConfirmRate,
            deliveryMaintainRate,
            totalScore:
              completionRate * 0.3 +
              deliveryConfirmRate * 0.15 +
              deliveryMaintainRate * 0.15 +
              op2Score * 0.15 +
              npsScore * 0.1 +
              (100 - defectRate) * 0.1,
          },
        })
        perfCount++
      } catch {
        // Skip duplicates
      }
    }
  }

  console.log(`${perfCount} performance records created.`)
  console.log('\nSeed completed!')
  console.log('Login credentials:')
  console.log('  admin / admin1234')
  console.log('  dispatch / dispatch1234')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
