import Contract, { ContractStatus } from "../../schemas/contract.schema";
import Payment from "../../schemas/payment.schema";
import logger from "../../utils/logger";

export class ContractHelper {
  
  static async checkContractCompletion(contractId: string) {
    try {
      const contract = await Contract.findById(contractId).populate("payments");

      if (!contract) {
        return;
      }

      const totalPaid = (contract.payments as any[])
        .filter((p) => p.isPaid)
        .reduce((sum, p) => sum + (p.actualAmount || p.amount), 0);

      const totalPaidWithPrepaid = totalPaid + (contract.prepaidBalance || 0);

      logger.debug("📊 Contract completion check:", {
        contractId,
        totalPaid,
        prepaidBalance: contract.prepaidBalance || 0,
        totalPaidWithPrepaid,
        totalPrice: contract.totalPrice,
        isComplete: totalPaidWithPrepaid >= contract.totalPrice,
        currentStatus: contract.status,
      });

      if (totalPaidWithPrepaid >= contract.totalPrice) {
        if (contract.status !== ContractStatus.COMPLETED) {
          contract.status = ContractStatus.COMPLETED;
          await contract.save();
          logger.debug("✅ Contract status changed to COMPLETED:", contract._id);
        }
      } else {
        if (contract.status === ContractStatus.COMPLETED) {
          contract.status = ContractStatus.ACTIVE;
          await contract.save();
          logger.debug(
            "⚠️ Contract status changed back to ACTIVE:",
            contract._id
          );
        }
      }
    } catch (error) {
      logger.error("❌ Error checking contract completion:", error);
      throw error;
    }
  }

  
  static async getPaidMonthsCount(contractId: string): Promise<number> {
    try {
      const contract = await Contract.findById(contractId);
      if (!contract) {
        return 0;
      }

      const allPayments = await Payment.find({
        _id: { $in: contract.payments },
      });

      const paidMonthlyPayments = allPayments.filter(
        (p) => p.paymentType === "monthly" && p.isPaid
      );

      return paidMonthlyPayments.length;
    } catch (error) {
      logger.error("❌ Error getting paid months count:", error);
      return 0;
    }
  }

  
  static updateNextPaymentDate(contract: any): Date {
    const currentDate = new Date(contract.nextPaymentDate || new Date());

    if (contract.previousPaymentDate && contract.postponedAt) {
      const originalDay =
        contract.originalPaymentDay ||
        new Date(contract.previousPaymentDate).getDate();

      const today = new Date();
      const nextMonth = new Date(
        today.getFullYear(),
        today.getMonth() + 1,
        originalDay
      );

      logger.debug("🔄 Kechiktirilgan to'lov to'landi - asl sanaga qaytarildi");
      
      contract.previousPaymentDate = undefined;
      contract.postponedAt = undefined;

      return nextMonth;
    }

    const originalDay = contract.originalPaymentDay || currentDate.getDate();
    const nextMonth = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth() + 1,
      originalDay
    );

    logger.debug("📅 Oddiy to'lov - keyingi oyga o'tkazildi:", {
      old: currentDate.toLocaleDateString("uz-UZ"),
      new: nextMonth.toLocaleDateString("uz-UZ"),
      originalDay: originalDay
    });

    return nextMonth;
  }
}
