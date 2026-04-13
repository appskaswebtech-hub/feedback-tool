-- AlterTable
ALTER TABLE `survey` ADD COLUMN `language` VARCHAR(191) NOT NULL DEFAULT 'default';

-- CreateIndex
CREATE INDEX `Survey_shop_language_idx` ON `Survey`(`shop`, `language`);
