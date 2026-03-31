-- CreateEnum
CREATE TYPE "UploadType" AS ENUM ('DISPATCH', 'CONFIRM', 'COMPLETE');

-- AlterEnum
ALTER TYPE "ModelType" ADD VALUE 'MOVE_INSTALL';

-- CreateTable
CREATE TABLE "WorkDate" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "isRainy" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkDate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliverySession" (
    "id" TEXT NOT NULL,
    "workDateId" TEXT NOT NULL,
    "uploadType" "UploadType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliverySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryRecord" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "deliveryNo" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "matnr" TEXT NOT NULL,
    "modelType" TEXT NOT NULL,
    "installCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DeliveryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkDate_date_key" ON "WorkDate"("date");

-- CreateIndex
CREATE INDEX "DeliveryRecord_deliveryNo_idx" ON "DeliveryRecord"("deliveryNo");

-- CreateIndex
CREATE INDEX "DeliveryRecord_customerName_idx" ON "DeliveryRecord"("customerName");

-- CreateIndex
CREATE INDEX "DeliveryRecord_sessionId_idx" ON "DeliveryRecord"("sessionId");

-- AddForeignKey
ALTER TABLE "DeliverySession" ADD CONSTRAINT "DeliverySession_workDateId_fkey" FOREIGN KEY ("workDateId") REFERENCES "WorkDate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRecord" ADD CONSTRAINT "DeliveryRecord_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DeliverySession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
