

import Payment from "../schemas/payment.schema";
import logger from "../utils/logger";

export async function up() {
  try {
    logger.info("🔄 Running migration: 008-add-reminder-date");

    
    const result = await Payment.updateMany(
      { reminderDate: { $exists: false } },
      { $set: { reminderDate: null } }
    );

    logger.info(`✅ Migration completed: ${result.modifiedCount} payments updated`);
    logger.info("✅ reminderDate field added to all payments");
  } catch (error) {
    logger.error("❌ Migration failed:", error);
    throw error;
  }
}

export async function down() {
  try {
    logger.info("🔄 Rolling back migration: 008-add-reminder-date");

    await Payment.updateMany(
      {},
      { $unset: { reminderDate: "" } }
    );

    logger.info("✅ Rollback completed: reminderDate field removed");
  } catch (error) {
    logger.error("❌ Rollback failed:", error);
    throw error;
  }
}
