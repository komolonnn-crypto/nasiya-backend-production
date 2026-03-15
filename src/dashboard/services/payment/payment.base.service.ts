import Contract, { ContractStatus } from "../../../schemas/contract.schema";
import PrepaidRecord from "../../../schemas/prepaid-record.schema";
import { PaymentMethod } from "../../../schemas/payment.schema";
import { Balance } from "../../../schemas/balance.schema";

import logger from "../../../utils/logger";
import { PAYMENT_CONSTANTS } from "../../../utils/helpers/payment";

import contractQueryService from "../contract/contract.query.service";
import auditLogService from "../../../services/audit-log.service";

export class PaymentBaseService {
  protected async updateBalance(
    managerId: string,
    changes: {
      dollar?: number;
      sum?: number;
    },
    session?: any,
    userId?: string,
    metadata?: {
      customerName?: string;
      contractId?: string;
      paymentType?: string;
    },
  ): Promise<any> {
    try {
      let balance = await Balance.findOne({ managerId }).session(
        session || null,
      );

      let managerName = "Noma'lum";

      if (!balance) {
        const newBalances = await Balance.create(
          [
            {
              managerId,
              dollar: changes.dollar || 0,
              sum: changes.sum || 0,
            },
          ],
          { session: session || undefined },
        );
        balance = newBalances[0];
        logger.debug("✅ New balance created:", balance._id);
      } else {
        balance.dollar += changes.dollar || 0;
        if (balance.sum !== undefined && changes.sum !== undefined) {
          balance.sum += changes.sum;
        }
        await balance.save({ session: session || undefined });
        logger.debug("✅ Balance updated:", balance._id);
      }

      if (userId) {
        try {
          const Employee = (await import("../../../schemas/employee.schema"))
            .default;
          const manager =
            await Employee.findById(managerId).select("firstName lastName");
          managerName =
            manager ? `${manager.firstName} ${manager.lastName}` : "Noma'lum";

          await auditLogService.logBalanceUpdate(
            managerId,
            managerName,
            changes.dollar || 0,
            changes.sum || 0,
            userId,
            metadata,
          );
        } catch (auditErr) {
          logger.error("❌ Balance audit log xatolik:", auditErr);
        }
      }

      return balance;
    } catch (error) {
      logger.error("❌ Error updating balance:", error);
      throw error;
    }
  }

  protected async addToPrepaidBalance(
    excessAmount: number,
    contract: any,
  ): Promise<void> {
    if (excessAmount <= PAYMENT_CONSTANTS.TOLERANCE) {
      return;
    }

    contract.prepaidBalance = (contract.prepaidBalance || 0) + excessAmount;

    logger.debug(`💰 Zapas qo'shildi: ${excessAmount.toFixed(2)} $`);
    logger.debug(`💎 Jami zapas: ${contract.prepaidBalance.toFixed(2)} $`);
  }

  protected async recordPrepaidTransaction(
    amount: number,
    payment: any,
    contract: any,
    paymentMethod?: PaymentMethod,
    notes?: string,
  ): Promise<any> {
    try {
      if (amount <= PAYMENT_CONSTANTS.TOLERANCE) {
        logger.debug(
          "ℹ️ Ortiqcha summa juda kichik - PrepaidRecord qo'shilmadi",
        );
        return null;
      }

      const customer = await (
        await import("../../../schemas/customer.schema")
      ).default.findById(payment.customerId);
      const customerName = customer?.fullName || "Noma'lum";

      const manager = await (
        await import("../../../schemas/employee.schema")
      ).default.findById(payment.managerId);
      const managerName =
        manager ?
          `${manager.firstName || ""} ${manager.lastName || ""}`.trim()
        : "Noma'lum";

      const formattedNote = this.formatPrepaidNote({
        date: payment.date,
        amount,
        paymentMethod,
        managerName,
        contractCustomId: contract.customId || "N/A",
        additionalNotes: notes,
      });

      const prepaidRecord = await PrepaidRecord.create({
        amount,
        date: new Date(payment.date),
        paymentMethod: paymentMethod,
        createdBy: payment.managerId,
        customer: payment.customerId,
        contract: contract._id,
        contractId: contract.customId,
        notes: formattedNote,
        relatedPaymentId: payment._id.toString(),
      });

      logger.debug("✅ PrepaidRecord yaratildi:", {
        id: prepaidRecord._id,
        amount: amount.toFixed(2),
        customerId: payment.customerId,
        contractId: contract.customId,
        paymentMethod: paymentMethod,
      });

      return prepaidRecord;
    } catch (error) {
      logger.error("❌ Error creating PrepaidRecord:", error);
      return null;
    }
  }

  private formatPaymentMethod(method?: PaymentMethod): string {
    const methods: { [key: string]: string } = {
      som_cash: "So'm naqd",
      som_card: "So'm karta",
      dollar_cash: "Dollar naqd",
      dollar_card_visa: "Dollar karta (Visa)",
    };
    return methods[method || ""] || "Noma'lum";
  }

  protected formatPrepaidNote(params: {
    date: Date;
    amount: number;
    paymentMethod?: PaymentMethod;
    managerName: string;
    contractCustomId: string;
    additionalNotes?: string;
  }): string {
    const {
      date,
      amount,
      paymentMethod,
      managerName,
      contractCustomId,
      additionalNotes,
    } = params;

    const dateStr = new Date(date).toLocaleDateString("uz-UZ", {
      day: "2-digit",
      year: "numeric",
      month: "2-digit",
    });
    const timeStr = new Date(date).toLocaleTimeString("uz-UZ", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const amountStr = `$${amount.toFixed(2)}`;
    const methodStr = `To'lash usuli: ${this.formatPaymentMethod(paymentMethod)}`;
    const managerStr = `${managerName}`;

    const formatString = `${dateStr} - ${timeStr} | ${amountStr} | ${methodStr} | ${managerStr}${additionalNotes ? ` | ${additionalNotes}` : ""}`;

    return formatString;
  }

  protected async checkContractCompletion(contractId: string): Promise<void> {
    try {
      const contractWithTotals =
        await contractQueryService.getContractById(contractId);

      if (!contractWithTotals) {
        logger.error(
          `❌ Contract not found during completion check: ${contractId}`,
        );
        return;
      }

      const {
        remainingDebt,
        status: currentStatus,
        prepaidBalance,
      } = contractWithTotals;
      const finalRemainingDebt = remainingDebt - (prepaidBalance || 0);

      logger.debug("📊 Contract completion check (using QueryService):", {
        contractId,
        totalPaid: contractWithTotals.totalPaid,
        remainingDebt: contractWithTotals.remainingDebt,
        prepaidBalance: contractWithTotals.prepaidBalance,
        finalRemainingDebt: finalRemainingDebt,
        isComplete: finalRemainingDebt <= PAYMENT_CONSTANTS.TOLERANCE,
        currentStatus,
      });

      const contractToUpdate = await Contract.findById(contractId);
      if (!contractToUpdate) {
        return;
      }

      if (finalRemainingDebt <= PAYMENT_CONSTANTS.TOLERANCE) {
        if (currentStatus !== ContractStatus.COMPLETED) {
          contractToUpdate.status = ContractStatus.COMPLETED;
          await contractToUpdate.save();
          logger.debug("✅ Contract status changed to COMPLETED:", contractId);
        }
      } else {
        if (currentStatus === ContractStatus.COMPLETED) {
          contractToUpdate.status = ContractStatus.ACTIVE;
          await contractToUpdate.save();
          logger.debug(
            "⚠️ Contract status changed back to ACTIVE:",
            contractId,
            `(${finalRemainingDebt.toFixed(2)} $ qoldi)`,
          );
        }
      }
    } catch (error) {
      logger.error("❌ Error checking contract completion:", error);
      throw error;
    }
  }

  protected async createAuditLog(params: {
    action: any;
    entity: any;
    entityId: string;
    userId: string;
    changes?: any[];
    metadata?: any;
  }): Promise<void> {
    try {
      const auditLogService = (
        await import("../../../services/audit-log.service")
      ).default;

      await auditLogService.createLog({
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        userId: params.userId,
        changes: params.changes,
        metadata: params.metadata,
      });

      logger.debug("✅ Audit log created");
    } catch (auditError) {
      logger.error("❌ Error creating audit log:", auditError);
    }
  }
}

export default new PaymentBaseService();
