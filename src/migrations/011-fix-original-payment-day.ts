import mongoose from "mongoose";
import Contract from "../schemas/contract.schema";
import logger from "../utils/logger";
import dayjs from "dayjs";
import * as dotenv from "dotenv";

dotenv.config();

export async function up(): Promise<void> {
  logger.info("🔄 Starting migration: Fix originalPaymentDay");

  try {
    const contracts = await Contract.find({
      isDeleted: false,
    }).select("_id initialPaymentDueDate nextPaymentDate originalPaymentDay startDate");

    logger.info(`📊 Found ${contracts.length} contracts to check`);

    let updatedCount = 0;
    let skippedCount = 0;

    for (const contract of contracts) {
      let shouldUpdate = false;
      let newOriginalPaymentDay: number | undefined;

      if (!contract.originalPaymentDay) {
        shouldUpdate = true;
        
        if (contract.initialPaymentDueDate) {
          newOriginalPaymentDay = dayjs(contract.initialPaymentDueDate).date();
          logger.debug(`  Contract ${contract._id}: originalPaymentDay null → ${newOriginalPaymentDay} (from initialPaymentDueDate)`);
        } 
        else if (contract.nextPaymentDate) {
          newOriginalPaymentDay = dayjs(contract.nextPaymentDate).date();
          logger.debug(`  Contract ${contract._id}: originalPaymentDay null → ${newOriginalPaymentDay} (from nextPaymentDate)`);
        }
        else if (contract.startDate) {
          newOriginalPaymentDay = dayjs(contract.startDate).date();
          logger.debug(`  Contract ${contract._id}: originalPaymentDay null → ${newOriginalPaymentDay} (from startDate)`);
        }
      }
      else if (contract.initialPaymentDueDate) {
        const correctDay = dayjs(contract.initialPaymentDueDate).date();
        if (contract.originalPaymentDay !== correctDay) {
          shouldUpdate = true;
          newOriginalPaymentDay = correctDay;
          logger.debug(`  Contract ${contract._id}: originalPaymentDay ${contract.originalPaymentDay} → ${newOriginalPaymentDay} (corrected)`);
        }
      }

      if (shouldUpdate && newOriginalPaymentDay) {
        await Contract.updateOne(
          { _id: contract._id },
          { $set: { originalPaymentDay: newOriginalPaymentDay } }
        );
        updatedCount++;
      } else {
        skippedCount++;
      }
    }

    logger.info(`✅ Migration completed:`);
    logger.info(`   - Updated: ${updatedCount}`);
    logger.info(`   - Skipped: ${skippedCount}`);
  } catch (error) {
    logger.error("❌ Migration failed:", error);
    throw error;
  }
}

export async function down(): Promise<void> {
  logger.info("⏪ Rolling back migration: Fix originalPaymentDay");
  logger.info("⚠️ This migration cannot be rolled back safely");
  logger.info("   Original values were not backed up");
}

if (require.main === module) {
  const MONGO_DB = process.env.MONGO_DB;
  
  if (!MONGO_DB) {
    logger.error("❌ MONGO_DB environment variable not set");
    process.exit(1);
  }

  mongoose
    .connect(MONGO_DB)
    .then(async () => {
      logger.info("✅ Connected to MongoDB");
      await up();
      await mongoose.disconnect();
      logger.info("✅ Disconnected from MongoDB");
      process.exit(0);
    })
    .catch((error) => {
      logger.error("❌ Error:", error);
      process.exit(1);
    });
}
