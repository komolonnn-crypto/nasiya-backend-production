

import reminderCleanupService from "../services/reminder-cleanup.service";
import logger from "../utils/logger";

export function startReminderCleanupCron() {
  logger.info("🔄 Starting reminder cleanup cron job...");
  
  setTimeout(async () => {
    try {
      await reminderCleanupService.cleanupExpiredReminders();
    } catch (error) {
      logger.error("❌ Error in initial reminder cleanup:", error);
    }
  }, 5000);
  
  setInterval(async () => {
    try {
      logger.info("⏰ Running scheduled reminder cleanup...");
      await reminderCleanupService.cleanupExpiredReminders();
    } catch (error) {
      logger.error("❌ Error in scheduled reminder cleanup:", error);
    }
  }, 24 * 60 * 60 * 1000);
  
  logger.info("✅ Reminder cleanup cron job started successfully");
}
