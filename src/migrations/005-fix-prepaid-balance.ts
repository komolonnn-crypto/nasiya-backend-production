

import mongoose from "mongoose";
import Contract from "../schemas/contract.schema";
import Payment, { PaymentStatus } from "../schemas/payment.schema";
import logger from "../utils/logger";

export async function up() {
  logger.info("🔄 Migration 005: Fixing prepaidBalance for contracts...");

  try {
    const contracts = await Contract.find({
      status: { $in: ["active", "completed"] },
    }).populate("payments");

    logger.info(`📊 Found ${contracts.length} contracts to process`);

    let updatedCount = 0;
    let totalPrepaidAdded = 0;

    for (const contract of contracts) {
      const payments = await Payment.find({
        _id: { $in: contract.payments },
      });

      let totalPaid = 0;
      let totalExcess = 0;

      for (const payment of payments) {
        if (payment.isPaid && payment.status === PaymentStatus.PAID) {
          totalPaid += payment.actualAmount || payment.amount;
        }

        if (payment.status === PaymentStatus.OVERPAID && payment.expectedAmount) {
          const excess =
            (payment.actualAmount || payment.amount) - payment.expectedAmount;
          if (excess > 0) {
            totalExcess += excess;
          }
        }
      }

      const expectedTotal = contract.totalPrice;

      const excessAmount = totalPaid - expectedTotal;

      if (excessAmount > 0.01 && (contract.prepaidBalance || 0) < 0.01) {
        contract.prepaidBalance = excessAmount;
        await contract.save();

        logger.info(
          `✅ Contract ${contract._id}: prepaidBalance updated to ${excessAmount.toFixed(2)}$`
        );
        logger.info(
          `   Customer: ${contract.customer}, Product: ${contract.productName}`
        );
        logger.info(
          `   Total paid: ${totalPaid.toFixed(2)}$, Expected: ${expectedTotal.toFixed(2)}$`
        );

        updatedCount++;
        totalPrepaidAdded += excessAmount;
      }
    }

    logger.info(`\n✅ Migration 005 completed!`);
    logger.info(`   Updated contracts: ${updatedCount}`);
    logger.info(
      `   Total prepaid balance added: ${totalPrepaidAdded.toFixed(2)}$`
    );
  } catch (error) {
    logger.error("❌ Migration 005 failed:", error);
    throw error;
  }
}

export async function down() {
  logger.info("🔄 Rollback Migration 005: Removing prepaidBalance...");

  try {
    const result = await Contract.updateMany(
      {},
      { $set: { prepaidBalance: 0 } }
    );

    logger.info(`✅ Rollback completed! Reset ${result.modifiedCount} contracts`);
  } catch (error) {
    logger.error("❌ Rollback failed:", error);
    throw error;
  }
}
