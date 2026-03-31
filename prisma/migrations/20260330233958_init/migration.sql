-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CONTRACT_ENDED', 'ON_LEAVE');

-- CreateEnum
CREATE TYPE "DispatchType" AS ENUM ('NORMAL', 'ADDITIONAL', 'MINIMUM_GUARANTEED');

-- CreateEnum
CREATE TYPE "ModelType" AS ENUM ('WALL_MOUNT', 'STAND', 'HOME_MULTI', 'SYSTEM_AC', 'PRE_VISIT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ViolationType" AS ENUM ('NO_HELMET', 'NO_SEATBELT', 'NO_SAFETY_HOOK');

-- CreateEnum
CREATE TYPE "LeaveReason" AS ENUM ('PERSONAL', 'HOSPITAL', 'VEHICLE', 'OTHER');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'DISPATCH', 'DATA_ENTRY', 'VIEWER');

-- CreateTable
CREATE TABLE "Driver" (
    "id" TEXT NOT NULL,
    "teamCode" TEXT NOT NULL,
    "teamName" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "status" "DriverStatus" NOT NULL DEFAULT 'ACTIVE',
    "center" TEXT,
    "vehicleNumber" TEXT,
    "vehicleType" TEXT,
    "vehicleStructure" TEXT,
    "cellName" TEXT,
    "cellRole" TEXT,
    "residency" TEXT,
    "contractDone" BOOLEAN NOT NULL DEFAULT false,
    "contractExpectedDate" TIMESTAMP(3),
    "contractEndDate" TIMESTAMP(3),
    "safetyEduDone" BOOLEAN NOT NULL DEFAULT false,
    "safetyEduDate" TIMESTAMP(3),
    "expertSecured" BOOLEAN NOT NULL DEFAULT false,
    "expertExpectedDate" TIMESTAMP(3),
    "expertRelation" TEXT,
    "canSupportOther" BOOLEAN NOT NULL DEFAULT false,
    "supportableCenters" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchUpload" (
    "id" TEXT NOT NULL,
    "uploadDate" TIMESTAMP(3) NOT NULL,
    "fileName" TEXT NOT NULL,
    "rawData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DispatchUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispatch" (
    "id" TEXT NOT NULL,
    "dispatchDate" TIMESTAMP(3) NOT NULL,
    "driverId" TEXT NOT NULL,
    "uploadId" TEXT,
    "prevCount" INTEGER NOT NULL DEFAULT 0,
    "confirmedCount" INTEGER,
    "installCount" INTEGER NOT NULL DEFAULT 0,
    "completedCount" INTEGER,
    "deliveryRate" DOUBLE PRECISION,
    "dispatchType" "DispatchType" NOT NULL DEFAULT 'NORMAL',
    "area" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchItem" (
    "id" TEXT NOT NULL,
    "dispatchId" TEXT NOT NULL,
    "matnr" TEXT NOT NULL,
    "augru" TEXT,
    "modelType" "ModelType" NOT NULL,
    "installCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DispatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyPerformance" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "perfDate" TIMESTAMP(3) NOT NULL,
    "completionRate" DOUBLE PRECISION,
    "op2Score" DOUBLE PRECISION,
    "npsScore" DOUBLE PRECISION,
    "defectRate" DOUBLE PRECISION,
    "deliveryConfirmRate" DOUBLE PRECISION,
    "deliveryMaintainRate" DOUBLE PRECISION,
    "totalScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyPerformance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyViolation" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "violationType" "ViolationType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "action" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafetyViolation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "requestDate" TIMESTAMP(3) NOT NULL,
    "reason" "LeaveReason" NOT NULL,
    "note" TEXT,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Driver_teamCode_key" ON "Driver"("teamCode");

-- CreateIndex
CREATE UNIQUE INDEX "DailyPerformance_driverId_perfDate_key" ON "DailyPerformance"("driverId", "perfDate");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "DispatchUpload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchItem" ADD CONSTRAINT "DispatchItem_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "Dispatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPerformance" ADD CONSTRAINT "DailyPerformance_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyViolation" ADD CONSTRAINT "SafetyViolation_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
