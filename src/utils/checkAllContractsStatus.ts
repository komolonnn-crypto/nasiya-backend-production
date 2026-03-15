import Contract, { ContractStatus } from "../schemas/contract.schema";
import logger from "../utils/logger";

export async function checkAllContractsStatus() {
  try {
    logger.debug("🔍 Checking all contracts status...");

    const contracts = await Contract.find({
      isDeleted: false,
      isActive: true,
    }).populate("payments");

    let updatedCount = 0;
    let completedCount = 0;
    let activeCount = 0;

    for (const contract of contracts) {
      const payments = contract.payments as any[];

      const totalPaid = payments
        .filter((p) => p.isPaid)
        .reduce((sum, p) => sum + (p.actualAmount || p.amount), 0);

      const totalPaidWithPrepaid = totalPaid + (contract.prepaidBalance || 0);

      const shouldBeCompleted = totalPaidWithPrepaid >= contract.totalPrice;
      const currentStatus = contract.status;

      if (shouldBeCompleted && currentStatus !== ContractStatus.COMPLETED) {
        contract.status = ContractStatus.COMPLETED;
        await contract.save();
        updatedCount++;
        completedCount++;
        logger.debug(`✅ Contract ${contract._id} -> COMPLETED`);
      } else if (
        !shouldBeCompleted &&
        currentStatus === ContractStatus.COMPLETED
      ) {
        contract.status = ContractStatus.ACTIVE;
        await contract.save();
        updatedCount++;
        activeCount++;
        logger.debug(`⚠️ Contract ${contract._id} -> ACTIVE`);
      }
    }

    logger.debug("✅ Contract status check completed:", {
      totalContracts: contracts.length,
      updatedCount,
      completedCount,
      activeCount,
    });

    return {
      success: true,
      totalContracts: contracts.length,
      updatedCount,
      completedCount,
      activeCount,
    };
  } catch (error: any) {
    logger.error("❌ Error checking contracts status:", error);
    throw new Error(`Contract status check failed: ${error.message}`);
  }
}
