import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import logger from "../utils/logger";
import { Telegraf } from "telegraf";
import excelExportService from "./excel-export.service";

class BackupService {
  private lastBackupHash: string | null = null;
  private telegramChannelId = process.env.TELEGRAM_CHAT_ID;
  private backupBot: Telegraf | null = null;

  constructor() {
    const backupBotToken = process.env.TELEGRAM_BOT_TOKEN;
    if (backupBotToken) {
      this.backupBot = new Telegraf(backupBotToken);
      logger.info("✅ Backup bot initialized");
    } else {
      logger.warn("⚠️ TELEGRAM_BOT_TOKEN not set for backup bot");
    }
  }

  
  async createBackup(): Promise<{
    success: boolean;
    message: string;
    filePath?: string;
  }> {
    try {
      logger.info("📊 Starting Excel database backup...");

      const exportResult = await excelExportService.exportDatabase();

      if (!exportResult.success || !exportResult.filePath) {
        logger.error("❌ Excel export failed:", exportResult.message);
        return {
          success: false,
          message: exportResult.message,
        };
      }

      logger.info("✅ Excel export created successfully");

      const excelFilePath = exportResult.filePath;

      const fileHash = await this.calculateFileHash(excelFilePath);

      if (this.lastBackupHash === fileHash) {
        logger.info("⏭️ Backup unchanged (duplicate), skipping upload");
        fs.unlinkSync(excelFilePath);
        return {
          success: true,
          message: "Backup unchanged, skipped",
        };
      }

      if (this.telegramChannelId) {
        await this.sendToTelegram(excelFilePath);
        this.lastBackupHash = fileHash;

        try {
          if (fs.existsSync(excelFilePath)) {
            fs.unlinkSync(excelFilePath);
            logger.debug(
              "🗑️ Excel backup file deleted after upload:",
              path.basename(excelFilePath),
            );
          }
        } catch (deleteError: any) {
          logger.warn("⚠️ Failed to delete backup file:", deleteError.message);
        }
      } else {
        logger.warn("⚠️ TELEGRAM_CHAT_ID not set, backup saved locally only");
      }

      if (this.telegramChannelId) {
        await this.cleanAllExports();
      } else {
        await excelExportService.cleanOldExports();
      }

      return {
        success: true,
        message: "Excel backup completed successfully",
        filePath: excelFilePath,
      };
    } catch (error: any) {
      logger.error("❌ Excel backup failed:", error.message);
      return {
        success: false,
        message: `Backup failed: ${error.message}`,
      };
    }
  }

  
  private async calculateFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("md5");
      const stream = fs.createReadStream(filePath);

      stream.on("data", (chunk: string | Buffer) => {
        hash.update(chunk);
      });
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });
  }

  
  private async sendToTelegram(filePath: string): Promise<void> {
    try {
      if (!this.telegramChannelId) {
        throw new Error("TELEGRAM_CHAT_ID not configured");
      }

      if (!this.backupBot) {
        throw new Error(
          "Backup bot not initialized (TELEGRAM_BOT_TOKEN missing)",
        );
      }

      const stats = fs.statSync(filePath);
      const fileSizeKB = (stats.size / 1024).toFixed(0);

      const now = new Date();
      const date = now.toLocaleDateString("uz-UZ");
      const time = now.toLocaleTimeString("uz-UZ", {
        hour: "2-digit",
        minute: "2-digit",
      });

      const caption =
        `📊 Excel Backup\n\n` +
        `📅 ${date}\n` +
        `🕐 ${time}\n` +
        `📦 ${fileSizeKB}KB\n\n` +
        `✅ Import qilishga tayyor`;

      logger.info(
        `📤 Sending backup to Telegram channel: ${this.telegramChannelId}...`,
      );

      await this.backupBot.telegram.sendDocument(
        this.telegramChannelId,
        {
          source: filePath,
          filename: path.basename(filePath),
        },
        {
          caption,
        },
      );

      logger.info("✅ Backup sent to Telegram successfully");
    } catch (error: any) {
      logger.error("❌ Failed to send backup to Telegram:", error.message);
      throw error;
    }
  }

  
  private async cleanAllExports(): Promise<void> {
    try {
      const exportDir = path.join(process.cwd(), "exports");

      if (!fs.existsSync(exportDir)) {
        return;
      }

      const files = fs
        .readdirSync(exportDir)
        .filter((file) => file.endsWith(".xlsx"))
        .map((file) => path.join(exportDir, file));

      for (const file of files) {
        try {
          fs.unlinkSync(file);
        } catch (err) {
        }
      }

      if (files.length > 0) {
        logger.debug(
          `🧹 Cleaned all ${files.length} backup file(s) from exports/`,
        );
      }
    } catch (error: any) {
      logger.error("❌ Failed to clean exports:", error.message);
    }
  }

  
  startScheduledBackup(): void {
    logger.info("🕒 Starting scheduled Excel backup (every 1 minute)...");

    setTimeout(() => {
      this.createBackup();
    }, 10000);

    setInterval(
      () => {
        this.createBackup();
      },
      50 * 60 * 1000,
    );

    logger.info("✅ Excel backup service started (1 min interval)");
  }
}

export default new BackupService();
