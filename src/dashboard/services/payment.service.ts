import Employee, { IEmployee } from "../../schemas/employee.schema";
import IJwtUser from "../../types/user";
import Payment, {
  PaymentStatus,
  PaymentType,
} from "../../schemas/payment.schema";
import { Debtor } from "../../schemas/debtor.schema";
import BaseError from "../../utils/base.error";
import Notes from "../../schemas/notes.schema";
import { Balance } from "../../schemas/balance.schema";
import Contract, { ContractStatus } from "../../schemas/contract.schema";
import contractQueryService from "./contract/contract.query.service";
import Customer from "../../schemas/customer.schema";
import logger from "../../utils/logger";
import { withTransaction } from "../../utils/transaction.wrapper";
import {
  PAYMENT_CONSTANTS,
  applyPrepaidBalance,
  createPaymentNoteText,
  createPaymentResponseMessage,
  createRemainingPaymentNote,
  createAutoRejectionNote,
  PAYMENT_MESSAGES,
  isAmountPositive,
  calculatePaymentAmounts,
} from "../../utils/helpers/payment";

interface PaymentDto {
  contractId: string;
  amount: number;
  notes?: string;
  currencyDetails: {
    dollar: number;
    sum: number;
  };
  currencyCourse: number;
  paymentMethod?: string;
}

class PaymentService {
  
  private async updateBalance(
    managerId: IEmployee | string,
    changes: {
      dollar?: number;
      sum?: number;
    },
    session?: any,
  ) {
    try {
      let balance = await Balance.findOne({ managerId }).session(
        session || null,
      );

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

      return balance;
    } catch (error) {
      logger.error("❌ Error updating balance:", error);
      throw error;
    }
  }

  

  
  private async addToPrepaidBalance(
    excessAmount: number,
    contract: any,
  ): Promise<void> {
    if (!isAmountPositive(excessAmount)) {
      return;
    }

    contract.prepaidBalance = (contract.prepaidBalance || 0) + excessAmount;

    logger.debug(`💰 Zapas qo'shildi: ${excessAmount.toFixed(2)} $`);
    logger.debug(`💎 Jami zapas: ${contract.prepaidBalance.toFixed(2)} $`);
  }

  
  
  private async checkContractCompletion(contractId: string) {
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
        isComplete: finalRemainingDebt <= 0.01,
        currentStatus,
      });

      const contractToUpdate = await Contract.findById(contractId);
      if (!contractToUpdate) {
        return;
      }

      if (finalRemainingDebt <= 0.01) {
        if (currentStatus !== ContractStatus.COMPLETED) {
          contractToUpdate.status = ContractStatus.COMPLETED;
          await contractToUpdate.save();
          logger.debug("✅ Contract status changed to COMPLETED:", contractId);
        }
      }
      else {
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

  
  async receivePayment(data: PaymentDto, user: IJwtUser) {
    try {
      logger.debug("💰 === RECEIVING PAYMENT (BOT) ===");
      logger.debug("Contract ID:", data.contractId);
      logger.debug("Amount:", data.amount);

      const contract = await Contract.findById(data.contractId);

      if (!contract) {
        throw BaseError.NotFoundError("Shartnoma topilmadi");
      }

      const manager = await Employee.findById(user.sub);

      if (!manager) {
        throw BaseError.NotFoundError("Manager topilmadi");
      }

      const expectedAmount = contract.monthlyPayment;
      const prepaidBalanceBefore = contract.prepaidBalance || 0;

      const { newActualAmount: actualAmount, prepaidUsed } =
        applyPrepaidBalance(data.amount, expectedAmount, prepaidBalanceBefore);

      if (isAmountPositive(prepaidUsed)) {
        logger.debug(
          `💎 PREPAID BALANCE USED: ${prepaidUsed.toFixed(2)} $ (balance: ${prepaidBalanceBefore.toFixed(2)} $)`,
        );
        logger.debug(
          `💵 Total amount after prepaid: ${actualAmount.toFixed(2)} $`,
        );
      }

      const {
        status: paymentStatus,
        remainingAmount,
        excessAmount,
      } = calculatePaymentAmounts(actualAmount, expectedAmount);
      const prepaidAmount = excessAmount;

      if (paymentStatus === PaymentStatus.UNDERPAID) {
        logger.debug(
          `⚠️ UNDERPAID: ${remainingAmount.toFixed(2)} $ kam to'landi`,
        );
      } else if (paymentStatus === PaymentStatus.OVERPAID) {
        logger.debug(`✅ OVERPAID: ${excessAmount.toFixed(2)} $ ko'p to'landi`);
      } else {
        logger.debug(`✓ EXACT PAYMENT: To'g'ri summa to'landi`);
      }

      const noteText = createPaymentNoteText({
        amount: data.amount,
        status: paymentStatus,
        remainingAmount,
        excessAmount,
        prepaidUsed,
        customNote: data.notes,
      });

      const notes = await Notes.create({
        text: noteText || "To'lov amalga oshirildi",
        customer: contract.customer,
        createBy: user.sub,
      });

      const payment = await Payment.create({
        amount: expectedAmount,
        actualAmount: actualAmount,
        date: new Date(),
        isPaid: false,
        paymentType: PaymentType.MONTHLY,
        paymentMethod: data.paymentMethod,
        customerId: contract.customer,
        managerId: user.sub,
        notes: notes._id,
        status: PaymentStatus.PENDING,
        expectedAmount: expectedAmount,
        remainingAmount: remainingAmount,
        excessAmount: excessAmount,
        prepaidAmount: prepaidAmount,
      });

      if (isAmountPositive(prepaidUsed)) {
        contract.prepaidBalance = prepaidBalanceBefore - prepaidUsed;
        await contract.save();
        logger.debug(
          `💎 Prepaid balance updated: ${prepaidBalanceBefore.toFixed(2)} → ${contract.prepaidBalance.toFixed(2)} $ (-${prepaidUsed.toFixed(2)} $)`,
        );
      }

      logger.debug("✅ Payment created:", {
        id: payment._id,
        status: paymentStatus,
        amount: actualAmount,
        expected: expectedAmount,
        remaining: remainingAmount,
        excess: excessAmount,
      });

      logger.debug("⏳ Balance NOT updated - waiting for cash confirmation");

      logger.debug(
        "⏳ Prepaid balance NOT updated - waiting for cash confirmation",
      );
      if (prepaidAmount > 0) {
        logger.debug(
          `ℹ️ Excess amount (${prepaidAmount.toFixed(
            2,
          )} $) saved in payment.excessAmount, will be added to prepaid balance after confirmation`,
        );
      }

      if (!contract.payments) {
        contract.payments = [];
      }
      (contract.payments as any[]).push(payment._id);

      await contract.save();

      logger.debug("✅ PENDING payment added to contract.payments");
      logger.debug("⏳ Will be confirmed or rejected by cash");

      const message = createPaymentResponseMessage({
        status: paymentStatus,
        remainingAmount,
        excessAmount,
        prepaidUsed,
      });

      return {
        status: "success",
        message,
        paymentId: payment._id,
        paymentDetails: {
          status: paymentStatus,
          expectedAmount,
          actualAmount,
          remainingAmount,
          excessAmount,
        },
      };
    } catch (error) {
      logger.error("❌ Error receiving payment:", error);
      throw error;
    }
  }

  
  async confirmPayment(paymentId: string, user: IJwtUser) {
    const paymentConfirmationService = (
      await import("./payment/payment.confirmation.service")
    ).default;
    return paymentConfirmationService.confirmPayment(paymentId, user);
  }

  
  private async _oldConfirmPayment(paymentId: string, user: IJwtUser) {
    return withTransaction(async (session) => {
      logger.debug("✅ === CONFIRMING PAYMENT (WITH TRANSACTION SUPPORT) ===");
      logger.debug("Payment ID:", paymentId);

      const payment = await Payment.findById(paymentId);

      if (!payment) {
        throw BaseError.NotFoundError("To'lov topilmadi");
      }

      logger.debug("📦 Payment object from DB:", {
        _id: payment._id,
        amount: payment.amount,
        actualAmount: payment.actualAmount,
        targetMonth: payment.targetMonth,
        hasTargetMonth: "targetMonth" in payment,
        paymentKeys: Object.keys(payment.toObject()),
      });

      logger.debug("📦 Payment details:", {
        id: payment._id,
        amount: payment.amount,
        actualAmount: payment.actualAmount,
        excessAmount: payment.excessAmount,
        paymentType: payment.paymentType,
        isPaid: payment.isPaid,
        status: payment.status,
      });

      if (payment.isPaid) {
        throw BaseError.BadRequest("To'lov allaqachon tasdiqlangan");
      }

      const actualAmount = payment.actualAmount || payment.amount;
      const expectedAmount = payment.expectedAmount || payment.amount;
      const difference = actualAmount - expectedAmount;

      logger.debug("💰 Payment confirmation details:", {
        actualAmount,
        expectedAmount,
        difference,
        receivedStatus: payment.status,
      });

      const paymentAmounts = calculatePaymentAmounts(
        actualAmount,
        expectedAmount,
      );
      payment.status = paymentAmounts.status;
      payment.remainingAmount = paymentAmounts.remainingAmount;
      payment.excessAmount = paymentAmounts.excessAmount;

      if (payment.status === PaymentStatus.UNDERPAID) {
        logger.debug(
          `⚠️ UNDERPAID: ${payment.remainingAmount.toFixed(2)}$ kam to'landi`,
        );
      } else if (payment.status === PaymentStatus.OVERPAID) {
        logger.debug(
          `✅ OVERPAID: ${payment.excessAmount.toFixed(2)}$ ortiqcha to'landi`,
        );
      }

      payment.isPaid = true;
      payment.confirmedAt = new Date();
      payment.confirmedBy = user.sub as any;
      await payment.save();

      logger.debug("✅ Payment confirmed:", {
        status: payment.status,
        actualAmount: payment.actualAmount,
        remainingAmount: payment.remainingAmount,
        excessAmount: payment.excessAmount,
      });

      logger.debug("✅ Payment confirmed:", payment._id);

      const contract = await Contract.findOne({
        customer: payment.customerId,
        status: ContractStatus.ACTIVE,
      }).populate("customer", "fullName");

      if (!contract) {
        throw BaseError.NotFoundError("Faol shartnoma topilmadi");
      }

      const customerName =
        (contract.customer as any)?.fullName || "Unknown Customer";

      if (!contract.payments) {
        contract.payments = [];
      }

      const paymentExists = (contract.payments as any[]).some(
        (p) => p.toString() === payment._id.toString(),
      );

      if (!paymentExists) {
        (contract.payments as any[]).push(payment._id);
        logger.debug("✅ Payment added to contract.payments");
      } else {
        logger.debug("ℹ️ Payment already in contract.payments");
      }

      await contract.populate("payments");

      const createdPayments = [];
      if (payment.excessAmount && isAmountPositive(payment.excessAmount)) {
        const originalActualAmount = payment.actualAmount || payment.amount;
        const correctedActualAmount = payment.expectedAmount || payment.amount;

        payment.actualAmount = correctedActualAmount;
        payment.excessAmount = 0;
        payment.status = PaymentStatus.PAID;
        await payment.save();

        logger.debug(
          `✅ Current payment actualAmount corrected: ${originalActualAmount} → ${payment.actualAmount}`,
        );
        logger.debug(
          `✅ Excess amount (${(originalActualAmount - correctedActualAmount).toFixed(2)} $) will be added to prepaid balance`,
        );

        await this.addToPrepaidBalance(
          originalActualAmount - correctedActualAmount,
          contract,
        );
      }

      await contract.save();

      if (payment.paymentType === PaymentType.MONTHLY) {
        const allPaymentsForDate = await Payment.find({
          _id: { $in: contract.payments },
        }).sort({ targetMonth: 1 });

        const paidPaymentsForDate = allPaymentsForDate.filter((p) => p.isPaid);
        const lastPaidMonth =
          paidPaymentsForDate.length > 0 ?
            Math.max(...paidPaymentsForDate.map((p) => p.targetMonth || 0))
          : 0;

        logger.debug("📊 To'lov holati:", {
          totalPayments: allPaymentsForDate.length,
          paidPayments: paidPaymentsForDate.length,
          lastPaidMonth: lastPaidMonth,
          period: contract.period,
        });

        const nextPaymentMonth = lastPaidMonth + 1;

        if (nextPaymentMonth <= contract.period) {
          const startDate = new Date(contract.startDate);
          const originalDay =
            contract.originalPaymentDay || startDate.getDate();

          const newNextPaymentDate = new Date(startDate);
          newNextPaymentDate.setMonth(startDate.getMonth() + nextPaymentMonth);

          if (newNextPaymentDate.getDate() !== originalDay) {
            newNextPaymentDate.setDate(0);
          }

          logger.debug("📅 nextPaymentDate yangilandi:", {
            lastPaidMonth: lastPaidMonth,
            nextPaymentMonth: nextPaymentMonth,
            oldNextPaymentDate: contract.nextPaymentDate
              ?.toISOString()
              .split("T")[0],
            newNextPaymentDate: newNextPaymentDate.toISOString().split("T")[0],
            originalDay: originalDay,
          });

          contract.nextPaymentDate = newNextPaymentDate;

          if (!contract.originalPaymentDay) {
            contract.originalPaymentDay = originalDay;
          }

          if (contract.previousPaymentDate || contract.postponedAt) {
            contract.previousPaymentDate = undefined;
            contract.postponedAt = undefined;
          }
        } else {
          logger.debug("✅ Barcha oylar to'landi");
        }
      } else {
        logger.debug(
          "⏭️ Skipping nextPaymentDate update - not monthly payment:",
          {
            paymentType: payment.paymentType,
            expectedType: PaymentType.MONTHLY,
          },
        );
      }

      await contract.save();
      logger.debug("💾 Contract saved with updated nextPaymentDate");

      try {
        const auditLogService = (
          await import("../../services/audit-log.service")
        ).default;
        const { AuditAction, AuditEntity } =
          await import("../../schemas/audit-log.schema");

        logger.debug("🔍 Creating audit log with data:", {
          action: AuditAction.PAYMENT_CONFIRMED,
          entity: AuditEntity.PAYMENT,
          entityId: paymentId,
          userId: user.sub,
          userInfo: { name: user.name, role: user.role },
          payment: {
            targetMonth: payment.targetMonth,
            amount: payment.amount,
            actualAmount: payment.actualAmount,
          },
        });

        await auditLogService.createLog({
          action: AuditAction.PAYMENT_CONFIRMED,
          entity: AuditEntity.PAYMENT,
          entityId: paymentId,
          userId: user.sub,
          changes: [
            { field: "status", oldValue: "PENDING", newValue: payment.status },
            { field: "isPaid", oldValue: false, newValue: payment.isPaid },
            { field: "confirmedBy", oldValue: null, newValue: user.sub },
            {
              field: "confirmedAt",
              oldValue: null,
              newValue: payment.confirmedAt,
            },
          ],
          metadata: {
            paymentType: "monthly",
            paymentStatus: payment.status,
            amount: payment.actualAmount || payment.amount,
            targetMonth: payment.targetMonth,
            customerName: customerName,
          },
        });
        logger.debug("✅ Audit log created for payment confirmation");
      } catch (auditError) {
        logger.error("❌ Error creating audit log:", auditError);
        logger.error("❌ Audit error details:", {
          message: (auditError as Error).message,
          stack: (auditError as Error).stack,
          userId: user.sub,
          paymentId,
        });
      }

      const verifyContract = await Contract.findById(contract._id).select(
        "nextPaymentDate previousPaymentDate",
      );
      logger.debug("🔍 VERIFY - Database'dagi qiymat:", {
        nextPaymentDate: verifyContract?.nextPaymentDate,
        nextPaymentDateISO: verifyContract?.nextPaymentDate?.toISOString(),
        previousPaymentDate: verifyContract?.previousPaymentDate,
      });

      const confirmedActualAmount = payment.actualAmount || payment.amount;
      await this.updateBalance(
        payment.managerId,
        {
          dollar: confirmedActualAmount,
          sum: 0,
        },
        session,
      );

      logger.debug(
        "💵 Balance updated with actualAmount:",
        confirmedActualAmount,
      );

      logger.debug("💵 Balance updated for manager:", payment.managerId);

      const deletedDebtors = await Debtor.deleteMany({
        contractId: contract._id,
      });

      if (deletedDebtors.deletedCount > 0) {
        logger.debug("🗑️ Debtor(s) deleted:", deletedDebtors.deletedCount);
      }

      await this.checkContractCompletion(String(contract._id));

      logger.debug(
        "✅ Payment confirmed successfully (NO TRANSACTION - DEV MODE)",
      );

      try {
        const customer = await Customer.findById(payment.customerId);

        if (customer) {
          const botNotificationService = (
            await import("../../bot/services/notification.service")
          ).default;

          await botNotificationService.createPaymentNotification({
            managerId: payment.managerId.toString(),
            type: "PAYMENT_APPROVED",
            paymentId: payment._id.toString(),
            customerId: customer._id.toString(),
            customerName: customer.fullName,
            contractId: contract._id.toString(),
            productName: contract.productName || "Mahsulot",
            amount: payment.actualAmount || payment.amount,
            status: payment.status,
            paymentType:
              payment.status === "PAID" ? "FULL"
              : payment.status === "OVERPAID" ? "EXCESS"
              : "PARTIAL",
            monthNumber: payment.targetMonth,
            currencyDetails: { dollar: payment.amount, sum: 0 },
          });

          logger.info("✅ Database notification created for payment approval");
        }
      } catch (notifError) {
        logger.error("❌ Error creating notification:", notifError);
      }

      return {
        status: "success",
        message: "To'lov tasdiqlandi",
        paymentId: payment._id,
        contractId: contract._id,
      };
    });
  }

  
  async rejectPayment(paymentId: string, reason: string, user: IJwtUser) {
    const paymentConfirmationService = (
      await import("./payment/payment.confirmation.service")
    ).default;
    return paymentConfirmationService.rejectPayment(paymentId, reason, user);
  }

  
  private async _oldRejectPayment(
    paymentId: string,
    reason: string,
    user: IJwtUser,
  ) {
    return withTransaction(async (session) => {
      logger.debug("❌ === REJECTING PAYMENT (WITH TRANSACTION) ===");
      logger.debug("Payment ID:", paymentId);
      logger.debug("Reason:", reason);

      const payment = await Payment.findById(paymentId).populate("notes");

      if (!payment) {
        throw BaseError.NotFoundError("To'lov topilmadi");
      }

      if (payment.isPaid) {
        throw BaseError.BadRequest("Tasdiqlangan to'lovni rad etib bo'lmaydi");
      }

      payment.status = PaymentStatus.REJECTED;
      await payment.save();

      if (payment.notes) {
        payment.notes.text += `\n[RAD ETILDI: ${reason}]`;
        await payment.notes.save();
      }

      const contract = await Contract.findOne({
        customer: payment.customerId,
        status: ContractStatus.ACTIVE,
      });

      if (contract) {
        const paymentIndex = (contract.payments as any[]).findIndex(
          (p) => p.toString() === payment._id.toString(),
        );

        if (paymentIndex !== -1) {
          (contract.payments as any[]).splice(paymentIndex, 1);
          logger.debug("✅ Payment removed from contract.payments");
        }

        if (payment.excessAmount && payment.excessAmount > 0) {
          logger.debug(
            `ℹ️ Payment had excess amount (${payment.excessAmount.toFixed(
              2,
            )} $), but prepaid balance was not updated (PENDING status)`,
          );
        }

        await contract.save();
      }

      logger.debug(
        "✅ Payment rejected successfully (NO TRANSACTION - DEV MODE)",
      );

      try {
        const customer = await Customer.findById(payment.customerId);

        if (customer && contract) {
          const botNotificationService = (
            await import("../../bot/services/notification.service")
          ).default;

          await botNotificationService.createPaymentNotification({
            managerId: payment.managerId.toString(),
            type: "PAYMENT_REJECTED",
            paymentId: payment._id.toString(),
            customerId: customer._id.toString(),
            customerName: customer.fullName,
            contractId: contract._id.toString(),
            productName: contract.productName || "Mahsulot",
            amount: payment.actualAmount || payment.amount,
            status: payment.status,
            paymentType: "PARTIAL",
            monthNumber: payment.targetMonth,
            currencyDetails: undefined,
          });

          logger.info("✅ Database notification created for payment rejection");
        }
      } catch (notifError) {
        logger.error("❌ Error creating rejection notification:", notifError);
      }

      return {
        status: "success",
        message: "To'lov rad etildi",
        paymentId: payment._id,
      };
    });
  }

  
  async getPaymentHistory(
    customerId?: string,
    contractId?: string,
    filters?: {
      status?: PaymentStatus[];
      paymentType?: PaymentType[];
      dateFrom?: Date;
      dateTo?: Date;
      isPaid?: boolean;
    },
  ) {
    const paymentQueryService = (
      await import("./payment/payment.query.service")
    ).default;
    return paymentQueryService.getPaymentHistory(
      customerId,
      contractId,
      filters,
    );
  }

  
  async payRemaining(
    payData: {
      paymentId: string;
      amount: number;
      notes: string;
      currencyDetails: { dollar: number; sum: number };
      currencyCourse: number;
      paymentMethod?: string;
    },
    user: IJwtUser,
  ) {
    try {
      logger.debug("💰 === PAY REMAINING (SERVICE) ===");
      logger.debug("Payment ID:", payData.paymentId);
      logger.debug("Amount:", payData.amount);

      const existingPayment = await Payment.findById(payData.paymentId);

      if (!existingPayment) {
        throw BaseError.NotFoundError("To'lov topilmadi");
      }

      const currentActualAmount = existingPayment.actualAmount || 0;
      const currentExpectedAmount =
        existingPayment.expectedAmount || existingPayment.amount || 0;
      const currentRemaining = currentExpectedAmount - currentActualAmount;

      logger.debug("✅ Existing payment found:", {
        id: existingPayment._id,
        status: existingPayment.status,
        actualAmount: currentActualAmount,
        expectedAmount: currentExpectedAmount,
        currentRemaining: currentRemaining,
        savedRemainingAmount: existingPayment.remainingAmount,
        isPaid: existingPayment.isPaid,
      });

      if (!isAmountPositive(currentRemaining)) {
        throw BaseError.BadRequest(PAYMENT_MESSAGES.NO_REMAINING_DEBT);
      }

      if (
        existingPayment.status === PaymentStatus.PAID &&
        !isAmountPositive(currentRemaining)
      ) {
        throw BaseError.BadRequest(PAYMENT_MESSAGES.NO_REMAINING_DEBT);
      }

      if (
        existingPayment.status === PaymentStatus.PAID &&
        isAmountPositive(currentRemaining)
      ) {
        logger.warn(
          `⚠️ WARNING: Payment status is PAID but has remaining amount: ${currentRemaining.toFixed(2)}$`,
        );
        logger.warn(
          "⚠️ This should not happen! Continuing with payRemaining...",
        );
      }

      const manager = await Employee.findById(user.sub);
      if (!manager) {
        throw BaseError.NotFoundError("Manager topilmadi");
      }

      const paymentAmount = payData.amount;

      let excessAmount = 0;
      if (paymentAmount > currentRemaining + PAYMENT_CONSTANTS.TOLERANCE) {
        excessAmount = paymentAmount - currentRemaining;
        logger.debug(
          `💰 Excess payment detected: ${excessAmount.toFixed(2)} $ → keyingi oyga o'tkaziladi`,
        );
      }

      const newActualAmount = isAmountPositive(excessAmount)
        ? currentExpectedAmount
        : currentActualAmount + paymentAmount;

      const newRemainingAmount = Math.max(
        0,
        currentExpectedAmount - newActualAmount,
      );

      existingPayment.actualAmount = newActualAmount;
      existingPayment.remainingAmount = newRemainingAmount;
      existingPayment.excessAmount = 0;

      logger.debug(
        `✅ actualAmount: ${currentActualAmount} + ${paymentAmount} = ${newActualAmount} $ (excess ${excessAmount.toFixed(2)} $ → prepaid)`,
      );

      if (isAmountPositive(excessAmount) || !isAmountPositive(newRemainingAmount)) {
        existingPayment.status = PaymentStatus.PAID;
        existingPayment.isPaid = true;
        logger.debug(
          `✅ Payment status changed to PAID (excess ${excessAmount.toFixed(2)} $ → prepaid)`,
        );
      } else {
        logger.debug(`⚠️ Still UNDERPAID: ${newRemainingAmount} $ remaining`);
      }

      if (payData.paymentMethod) {
        existingPayment.paymentMethod = payData.paymentMethod as any;
      }

      await existingPayment.save();

      if (existingPayment.notes) {
        const notes = await Notes.findById(existingPayment.notes);
        if (notes) {
          notes.text += createRemainingPaymentNote({
            paymentAmount,
            customNote: payData.notes,
          });
          await notes.save();
        }
      }

      await this.updateBalance(
        String(manager._id),
        {
          dollar: payData.currencyDetails.dollar || 0,
          sum: payData.currencyDetails.sum || 0,
        },
        null,
      );
      logger.debug("✅ Balance updated (from dashboard)");

      const contract = await Contract.findOne({
        payments: existingPayment._id,
      });

      if (!contract) {
        throw BaseError.NotFoundError("Shartnoma topilmadi");
      }

      await this.addToPrepaidBalance(excessAmount, contract);
      const createdPayments: any[] = [];

      await contract.save();

      if (
        existingPayment.status === PaymentStatus.PAID ||
        existingPayment.status === PaymentStatus.OVERPAID
      ) {
        const allPayments = await Payment.find({
          _id: { $in: contract.payments },
        });

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const overdueUnpaidPayments = allPayments.filter(
          (p) => !p.isPaid && new Date(p.date) < today,
        );

        logger.debug("📊 Overdue unpaid payments check:", {
          totalPayments: allPayments.length,
          overdueUnpaid: overdueUnpaidPayments.length,
          contractId: contract._id,
        });

        if (overdueUnpaidPayments.length === 0) {
          const deletedDebtors = await Debtor.deleteMany({
            contractId: contract._id,
          });
          if (deletedDebtors.deletedCount > 0) {
            logger.debug(
              "✅ Debtor(s) deleted - no more overdue payments:",
              deletedDebtors.deletedCount,
            );
          }
        } else {
          logger.debug(
            `⚠️ Debtor NOT deleted - still has ${overdueUnpaidPayments.length} overdue unpaid payment(s)`,
          );

          const firstOverduePayment = overdueUnpaidPayments.sort(
            (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
          )[0];

          if (firstOverduePayment) {
            const overdueDays = Math.floor(
              (today.getTime() - new Date(firstOverduePayment.date).getTime()) /
                (1000 * 60 * 60 * 24),
            );

            await Debtor.updateMany(
              { contractId: contract._id },
              {
                $set: {
                  dueDate: firstOverduePayment.date,
                  overdueDays: Math.max(0, overdueDays),
                  debtAmount:
                    firstOverduePayment.remainingAmount ||
                    firstOverduePayment.amount,
                },
              },
            );

            logger.debug("✅ Debtor updated with new overdue info:", {
              dueDate: firstOverduePayment.date,
              overdueDays: Math.max(0, overdueDays),
            });
          }
        }

        await this.checkContractCompletion(String(contract._id));
      }

      logger.debug("✅ === PAY REMAINING COMPLETED ===");

      let message = "";

      if (excessAmount > 0.01) {
        message = `Qolgan qarz to'liq to'landi va ${excessAmount.toFixed(
          2,
        )} $ ortiqcha to'landi`;
        if (createdPayments.length > 0) {
          message += `\n✅ ${createdPayments.length} oylik to'lovlar avtomatik yaratildi`;
        }
        if (contract.prepaidBalance && contract.prepaidBalance > 0.01) {
          message += `\n💰 ${contract.prepaidBalance.toFixed(
            2,
          )} $ prepaid balance ga qo'shildi`;
        }
      } else if (newRemainingAmount < 0.01) {
        message = "Qolgan qarz to'liq to'landi";
      } else {
        message = `Qolgan qarz qisman to'landi. Hali ${newRemainingAmount.toFixed(
          2,
        )} $ qoldi`;
      }

      try {
        logger.debug("📝 Creating audit log for payRemaining...");

        if (!user || !user.sub) {
          logger.error("❌ Cannot create audit log: user.sub is missing", {
            user,
          });
        } else {
          const auditLogService = (
            await import("../../services/audit-log.service")
          ).default;
          const { AuditAction, AuditEntity } =
            await import("../../schemas/audit-log.schema");

          const contract = await Contract.findOne({
            payments: existingPayment._id,
          }).populate("customer");

          await auditLogService.createLog({
            action: AuditAction.PAYMENT,
            entity: AuditEntity.PAYMENT,
            entityId: existingPayment._id.toString(),
            userId: user.sub,
            metadata: {
              paymentType: "remaining",
              paymentStatus: existingPayment.status,
              amount: payData.amount,
              actualAmount: existingPayment.actualAmount,
              remainingAmount: existingPayment.remainingAmount,
              targetMonth: existingPayment.targetMonth,
              affectedEntities:
                contract ?
                  [
                    {
                      entityType: "contract",
                      entityId: contract._id.toString(),
                      entityName: contract.productName || "Contract",
                    },
                    {
                      entityType: "customer",
                      entityId:
                        contract.customer._id?.toString() ||
                        contract.customer.toString(),
                      entityName: contract.customer.fullName,
                    },
                  ]
                : [],
            },
          });

          logger.debug("✅ Audit log created for payRemaining");
        }
      } catch (auditError) {
        logger.error("❌ Error creating audit log:", auditError);
      }

      return {
        status: "success",
        message: message,
        paymentId: existingPayment._id,
        payment: {
          _id: existingPayment._id,
          actualAmount: existingPayment.actualAmount,
          remainingAmount: existingPayment.remainingAmount,
          excessAmount: existingPayment.excessAmount,
          status: existingPayment.status,
          isPaid: existingPayment.isPaid,
        },
      };
    } catch (error) {
      logger.error("❌ Error in payRemaining:", error);
      throw error;
    }
  }

  async payByContract(
    payData: {
      contractId: string;
      amount: number;
      notes?: string;
      currencyDetails: { dollar: number; sum: number };
      currencyCourse: number;
      paymentMethod?: string;
    },
    user: IJwtUser,
  ) {
    const auditData: {
      payments: any[];
      contractId: string;
      customerId: string;
      customerName: string;
      contractName: string;
    } = {
      payments: [],
      contractId: "",
      customerId: "",
      customerName: "",
      contractName: "",
    };

    const result = await withTransaction(async (session) => {
      logger.debug("💰 === PAY BY CONTRACT (DASHBOARD - WITH TRANSACTION) ===");

      const contract = await Contract.findById(payData.contractId).populate(
        "customer",
      );

      if (!contract) {
        throw BaseError.NotFoundError("Shartnoma topilmadi");
      }

      const manager = await Employee.findById(user.sub);

      if (!manager) {
        throw BaseError.NotFoundError("Manager topilmadi");
      }

      const monthlyPayment = contract.monthlyPayment;
      const totalAmount = payData.amount;

      const createdPayments = [];
      let remainingAmount = totalAmount;
      let currentMonthIndex = 0;

      const allPayments = await Payment.find({
        _id: { $in: contract.payments },
      }).sort({ date: 1 });

      const paidMonthlyPayments = allPayments.filter(
        (p) => p.paymentType === PaymentType.MONTHLY && p.isPaid,
      );
      currentMonthIndex = paidMonthlyPayments.length;

      logger.debug("📊 Payment distribution:", {
        totalAmount,
        monthlyPayment,
        currentMonthIndex,
        totalMonths: contract.period,
      });

      while (remainingAmount > 0.01 && currentMonthIndex < contract.period) {
        const monthNumber = currentMonthIndex + 1;
        let paymentAmount = 0;
        let paymentStatus = PaymentStatus.PAID;
        let excessAmount = 0;
        let shortageAmount = 0;

        if (remainingAmount >= monthlyPayment) {
          paymentAmount = monthlyPayment;
          paymentStatus = PaymentStatus.PAID;
          logger.debug(
            `✅ Month ${monthNumber}: PAID (${paymentAmount.toFixed(2)} $)`,
          );
        } else {
          paymentAmount = remainingAmount;
          paymentStatus = PaymentStatus.UNDERPAID;
          shortageAmount = monthlyPayment - remainingAmount;
          logger.debug(
            `⚠️ Month ${monthNumber}: UNDERPAID (${paymentAmount.toFixed(
              2,
            )} $ / ${monthlyPayment} $, shortage: ${shortageAmount.toFixed(
              2,
            )} $)`,
          );
        }

        let noteText =
          payData.notes || `${monthNumber}-oy to'lovi: ${paymentAmount} $`;
        if (paymentStatus === PaymentStatus.UNDERPAID) {
          noteText += `\n⚠️ Qisman to'landi: ${shortageAmount.toFixed(
            2,
          )} $ yetishmayapti`;
        }

        const notes = await Notes.create({
          text: noteText,
          customer: contract.customer,
          createBy: String(manager._id),
        });

        const contractStartDate = new Date(contract.startDate);
        const originalDay =
          contract.originalPaymentDay || contractStartDate.getDate();
        const scheduledDate = new Date(contractStartDate);
        scheduledDate.setMonth(contractStartDate.getMonth() + monthNumber);
        scheduledDate.setDate(originalDay);

        const payment = await Payment.create({
          amount: monthlyPayment,
          actualAmount: paymentAmount,
          date: scheduledDate,
          isPaid: true,
          paymentType: PaymentType.MONTHLY,
          paymentMethod: payData.paymentMethod,
          customerId: contract.customer,
          managerId: String(manager._id),
          notes: notes._id,
          status: paymentStatus,
          expectedAmount: monthlyPayment,
          remainingAmount: shortageAmount,
          excessAmount: 0,
          confirmedAt: new Date(),
          confirmedBy: user.sub,
          targetMonth: monthNumber,
        });

        createdPayments.push(payment);

        if (!contract.payments) {
          contract.payments = [];
        }
        (contract.payments as any[]).push(payment._id);

        logger.debug(`✅ Payment created for month ${monthNumber}:`, {
          id: payment._id,
          status: paymentStatus,
          amount: paymentAmount,
          expected: monthlyPayment,
          shortage: shortageAmount,
        });

        remainingAmount -= paymentAmount;
        currentMonthIndex++;
      }

      if (remainingAmount > 0.01) {
        contract.prepaidBalance =
          (contract.prepaidBalance || 0) + remainingAmount;
        logger.debug(
          `💰 Prepaid balance updated: ${contract.prepaidBalance.toFixed(2)} $`,
        );
        logger.debug(
          `ℹ️ Remaining ${remainingAmount.toFixed(
            2,
          )} $ added to prepaid balance (all months paid)`,
        );
      }

      const allContractPayments = await Payment.find({
        _id: { $in: contract.payments },
        paymentType: PaymentType.MONTHLY,
      }).sort({ targetMonth: 1 });

      const paidMonthlyPaymentsForDate = allContractPayments.filter(
        (p) => p.isPaid,
      );
      const lastPaidMonth =
        paidMonthlyPaymentsForDate.length > 0 ?
          Math.max(...paidMonthlyPaymentsForDate.map((p) => p.targetMonth || 0))
        : 0;

      const nextPaymentMonth = lastPaidMonth + 1;

      if (nextPaymentMonth <= contract.period) {
        const contractStartDate = new Date(contract.startDate);
        const originalDay =
          contract.originalPaymentDay || contractStartDate.getDate();

        const newNextPaymentDate = new Date(contractStartDate);
        newNextPaymentDate.setMonth(
          contractStartDate.getMonth() + nextPaymentMonth,
        );

        if (newNextPaymentDate.getDate() !== originalDay) {
          newNextPaymentDate.setDate(0);
        }

        logger.debug("📅 nextPaymentDate yangilandi (payByContract):", {
          lastPaidMonth,
          nextPaymentMonth,
          old: contract.nextPaymentDate?.toISOString().split("T")[0],
          new: newNextPaymentDate.toISOString().split("T")[0],
        });

        contract.nextPaymentDate = newNextPaymentDate;

        if (!contract.originalPaymentDay) {
          contract.originalPaymentDay = originalDay;
        }
      }

      await contract.save();
      logger.debug(
        `✅ ${createdPayments.length} payment(s) added to contract (Dashboard)`,
      );

      await this.updateBalance(
        String(manager._id),
        {
          dollar: payData.currencyDetails.dollar || 0,
          sum: payData.currencyDetails.sum || 0,
        },
        session,
      );
      logger.debug("✅ Balance updated (Dashboard)");

      const deletedDebtors = await Debtor.deleteMany({
        contractId: contract._id,
      });
      if (deletedDebtors.deletedCount > 0) {
        logger.debug("🗑️ Debtor(s) deleted:", deletedDebtors.deletedCount);
      }

      await this.checkContractCompletion(String(contract._id));

      logger.debug(
        "✅ payByContract completed successfully (NO TRANSACTION - DEV MODE)",
      );

      auditData.payments = createdPayments.map((p) => ({
        _id: p._id.toString(),
        status: p.status,
        amount: p.actualAmount || p.amount,
        targetMonth: p.targetMonth,
      }));
      auditData.contractId = contract._id.toString();
      auditData.customerId =
        contract.customer._id?.toString() || contract.customer.toString();
      auditData.customerName = contract.customer.fullName;
      auditData.contractName = contract.productName || "Contract";

      logger.debug(
        `📝 Audit data collected: ${auditData.payments.length} payment(s)`,
      );

      const lastPayment = createdPayments[createdPayments.length - 1];
      let message = `${createdPayments.length} oylik to'lov muvaffaqiyatli amalga oshirildi`;

      if (lastPayment?.status === PaymentStatus.UNDERPAID) {
        message += `. Oxirgi oyda ${lastPayment.remainingAmount?.toFixed(
          2,
        )} $ yetishmayapti`;
      }

      if (remainingAmount > 0.01) {
        message += `. ${remainingAmount.toFixed(
          2,
        )} $ ortiqcha summa keyingi oyga o'tkazildi`;
      }

      return {
        status: "success",
        message,
        contractId: contract._id,
        paymentsCreated: createdPayments.length,
        paymentIds: createdPayments.map((p) => p._id),
        paymentDetails: {
          totalAmount: totalAmount,
          monthlyPayment: monthlyPayment,
          monthsPaid: createdPayments.length,
          prepaidBalance: contract.prepaidBalance,
          lastPaymentStatus: lastPayment?.status,
        },
      };
    });

    try {
      logger.debug("📝 Creating audit log after transaction completion...");
      logger.debug("📝 Audit data:", {
        paymentsCount: auditData.payments.length,
        userId: user.sub,
        contractId: auditData.contractId,
      });

      if (!user || !user.sub) {
        logger.error("❌ Cannot create audit log: user.sub is missing", {
          user,
        });
        return result;
      }

      if (auditData.payments.length === 0) {
        logger.warn("⚠️ No payments created, skipping audit log");
        return result;
      }

      const auditLogService = (await import("../../services/audit-log.service"))
        .default;
      const { AuditAction, AuditEntity } =
        await import("../../schemas/audit-log.schema");

      for (const payment of auditData.payments) {
        await auditLogService.createLog({
          action: AuditAction.PAYMENT,
          entity: AuditEntity.PAYMENT,
          entityId: payment._id,
          userId: user.sub,
          metadata: {
            paymentType: "monthly",
            paymentStatus: payment.status,
            amount: payment.amount,
            targetMonth: payment.targetMonth,
            customerName: auditData.customerName,
            affectedEntities: [
              {
                entityType: "contract",
                entityId: auditData.contractId,
                entityName: auditData.contractName,
              },
              {
                entityType: "customer",
                entityId: auditData.customerId,
                entityName: auditData.customerName,
              },
            ],
          },
        });
      }

      logger.debug(
        `✅ Audit log created successfully for ${auditData.payments.length} payment(s)`,
      );
    } catch (auditError) {
      logger.error("❌ Error creating audit log:", auditError);
      logger.error("❌ Audit error details:", {
        message: (auditError as Error).message,
        stack: (auditError as Error).stack,
        userId: user.sub,
        auditData,
      });
    }

    return result;
  }

  
  async update(
    payData: {
      id: string;
      amount: number;
      notes?: string;
      currencyDetails: { dollar: number; sum: number };
      currencyCourse: number;
    },
    user: IJwtUser,
  ) {
    return withTransaction(async (session) => {
      logger.debug("💰 === DEBTOR PAYMENT (DASHBOARD - WITH TRANSACTION) ===");

      const existingDebtor = await Debtor.findById(payData.id).populate(
        "contractId",
      );

      if (!existingDebtor) {
        throw BaseError.NotFoundError("Qarizdorlik topilmadi yoki o'chirilgan");
      }

      const customer = existingDebtor.contractId.customer;
      const manager = await Employee.findById(user.sub);

      if (!manager) {
        throw BaseError.NotFoundError("Manager topilmadi yoki o'chirilgan");
      }

      const contract = await Contract.findById(existingDebtor.contractId._id);

      if (!contract) {
        throw BaseError.NotFoundError("Shartnoma topilmadi");
      }

      const monthlyPayment = contract.monthlyPayment;
      const totalAmount = payData.amount;

      const createdPayments = [];
      let remainingAmount = totalAmount;
      let currentMonthIndex = 0;

      const allPayments = await Payment.find({
        _id: { $in: contract.payments },
      }).sort({ date: 1 });

      const paidMonthlyPayments = allPayments.filter(
        (p) => p.paymentType === PaymentType.MONTHLY && p.isPaid,
      );
      currentMonthIndex = paidMonthlyPayments.length;

      logger.debug("📊 Payment distribution:", {
        totalAmount,
        monthlyPayment,
        currentMonthIndex,
        totalMonths: contract.period,
      });

      const customerData = await Customer.findById(customer);
      const customerName = customerData?.fullName || "Unknown Customer";

      while (remainingAmount > 0.01 && currentMonthIndex < contract.period) {
        const monthNumber = currentMonthIndex + 1;
        let paymentAmount = 0;
        let paymentStatus = PaymentStatus.PAID;
        let shortageAmount = 0;

        if (remainingAmount >= monthlyPayment) {
          paymentAmount = monthlyPayment;
          paymentStatus = PaymentStatus.PAID;
          logger.debug(
            `✅ Month ${monthNumber}: PAID (${paymentAmount.toFixed(2)} $)`,
          );
        } else {
          paymentAmount = remainingAmount;
          paymentStatus = PaymentStatus.UNDERPAID;
          shortageAmount = monthlyPayment - remainingAmount;
          logger.debug(
            `⚠️ Month ${monthNumber}: UNDERPAID (${paymentAmount.toFixed(
              2,
            )} $ / ${monthlyPayment} $, shortage: ${shortageAmount.toFixed(
              2,
            )} $)`,
          );
        }

        let noteText =
          payData.notes || `${monthNumber}-oy to'lovi: ${paymentAmount} $`;
        if (paymentStatus === PaymentStatus.UNDERPAID) {
          noteText += `\n⚠️ Qisman to'landi: ${shortageAmount.toFixed(
            2,
          )} $ yetishmayapti`;
        }

        const notes = await Notes.create({
          text: noteText,
          customer,
          createBy: String(manager._id),
        });

        const payment = await Payment.create({
          amount: monthlyPayment,
          actualAmount: paymentAmount,
          date: new Date(),
          isPaid: true,
          paymentType: PaymentType.MONTHLY,
          customerId: customer,
          managerId: String(manager._id),
          notes: notes._id,
          status: paymentStatus,
          expectedAmount: monthlyPayment,
          remainingAmount: shortageAmount,
          excessAmount: 0,
          confirmedAt: new Date(),
          confirmedBy: user.sub,
          targetMonth: monthNumber,
        });

        createdPayments.push(payment);

        if (!contract.payments) {
          contract.payments = [];
        }
        (contract.payments as any[]).push(payment._id);

        logger.debug(`✅ Payment created for month ${monthNumber}:`, {
          id: payment._id,
          status: paymentStatus,
          amount: paymentAmount,
          expected: monthlyPayment,
          shortage: shortageAmount,
        });

        remainingAmount -= paymentAmount;
        currentMonthIndex++;
      }

      if (remainingAmount > 0.01) {
        contract.prepaidBalance =
          (contract.prepaidBalance || 0) + remainingAmount;
        logger.debug(
          `💰 Prepaid balance updated: ${contract.prepaidBalance.toFixed(2)} $`,
        );
        logger.debug(
          `ℹ️ Remaining ${remainingAmount.toFixed(
            2,
          )} $ added to prepaid balance (all months paid)`,
        );
      }

      await contract.save();
      logger.debug(
        `✅ ${createdPayments.length} payment(s) added to contract (Dashboard)`,
      );

      await this.updateBalance(
        String(manager._id),
        {
          dollar: payData.currencyDetails.dollar || 0,
          sum: payData.currencyDetails.sum || 0,
        },
        session,
      );
      logger.debug("✅ Balance updated (Dashboard)");

      await Debtor.findByIdAndDelete(payData.id);
      logger.debug("🗑️ Debtor deleted");

      await this.checkContractCompletion(String(contract._id));

      try {
        const auditLogService = (
          await import("../../services/audit-log.service")
        ).default;
        const { AuditAction, AuditEntity } =
          await import("../../schemas/audit-log.schema");

        for (const payment of createdPayments) {
          await auditLogService.createLog({
            action: AuditAction.PAYMENT,
            entity: AuditEntity.PAYMENT,
            entityId: payment._id.toString(),
            userId: user.sub,
            metadata: {
              paymentType: "monthly",
              paymentStatus: payment.status,
              amount: payment.actualAmount || payment.amount,
              targetMonth: payment.targetMonth,
              customerName: customerName,
              affectedEntities: [
                {
                  entityType: "contract",
                  entityId: contract._id.toString(),
                  entityName: contract.productName || "Shartnoma",
                },
                {
                  entityType: "customer",
                  entityId: customer.toString(),
                  entityName: customerName,
                },
              ],
            },
          });
        }
        logger.debug(
          `✅ Audit log created for ${createdPayments.length} debtor payment(s)`,
        );
      } catch (auditError) {
        logger.error("❌ Error creating audit log:", auditError);
      }

      const lastPayment = createdPayments[createdPayments.length - 1];
      let message = `${createdPayments.length} oylik to'lov muvaffaqiyatli amalga oshirildi`;

      if (lastPayment?.status === PaymentStatus.UNDERPAID) {
        message += `. Oxirgi oyda ${lastPayment.remainingAmount?.toFixed(
          2,
        )} $ yetishmayapti`;
      }

      if (remainingAmount > 0.01) {
        message += `. ${remainingAmount.toFixed(
          2,
        )} $ ortiqcha summa keyingi oyga o'tkazildi`;
      }

      return {
        status: "success",
        message,
        paymentsCreated: createdPayments.length,
        paymentIds: createdPayments.map((p) => p._id),
        paymentDetails: {
          totalAmount: totalAmount,
          monthlyPayment: monthlyPayment,
          monthsPaid: createdPayments.length,
          prepaidBalance: contract.prepaidBalance,
          lastPaymentStatus: lastPayment?.status,
        },
      };
    });
  }

  
  async payAllRemainingMonths(
    payData: {
      contractId: string;
      amount: number;
      notes?: string;
      currencyDetails: { dollar: number; sum: number };
      currencyCourse: number;
      paymentMethod?: string;
    },
    user: IJwtUser,
  ) {
    try {
      logger.debug("💰 === PAY ALL REMAINING MONTHS ===");
      logger.debug("From: DASHBOARD (Admin/Moderator/Manager)");

      const contract = await Contract.findById(payData.contractId).populate(
        "customer",
      );

      if (!contract) {
        throw BaseError.NotFoundError("Shartnoma topilmadi");
      }

      const manager = await Employee.findById(user.sub);

      if (!manager) {
        throw BaseError.NotFoundError("Manager topilmadi");
      }

      const allPayments = await Payment.find({
        _id: { $in: contract.payments },
      }).sort({ date: 1 });

      const paidMonthlyPayments = allPayments.filter(
        (p) => p.paymentType === PaymentType.MONTHLY && p.isPaid,
      );

      const paidMonthsCount = paidMonthlyPayments.length;
      const totalMonths = contract.period;
      const remainingMonths = totalMonths - paidMonthsCount;

      logger.debug("📊 Payment analysis:", {
        totalMonths,
        paidMonthsCount,
        remainingMonths,
        monthlyPayment: contract.monthlyPayment,
      });

      if (remainingMonths <= 0) {
        throw BaseError.BadRequest("Barcha oylar allaqachon to'langan");
      }

      const expectedTotalAmount = contract.monthlyPayment * remainingMonths;
      const actualAmount = payData.amount;
      const difference = actualAmount - expectedTotalAmount;

      logger.debug("💵 Amount analysis:", {
        expectedTotal: expectedTotalAmount,
        actualAmount: actualAmount,
        difference: difference,
        isUnderpaid: difference < -0.01,
        isOverpaid: difference > 0.01,
      });

      const createdPayments = [];
      let remainingAmount = actualAmount;

      for (let i = 0; i < remainingMonths; i++) {
        const monthNumber = paidMonthsCount + i + 1;
        const isLastMonth = i === remainingMonths - 1;

        let paymentAmount: number;
        let paymentStatus: PaymentStatus;
        let shortageAmount = 0;

        if (isLastMonth) {
          paymentAmount = remainingAmount;
        } else {
          paymentAmount = Math.min(remainingAmount, contract.monthlyPayment);
        }

        if (paymentAmount >= contract.monthlyPayment - 0.01) {
          paymentStatus = PaymentStatus.PAID;
        } else {
          paymentStatus = PaymentStatus.UNDERPAID;
          shortageAmount = contract.monthlyPayment - paymentAmount;
        }

        let noteText = `${monthNumber}-oy to'lovi: ${paymentAmount.toFixed(
          2,
        )} $ (Barchasini to'lash orqali)`;

        if (paymentStatus === PaymentStatus.UNDERPAID) {
          noteText += `\n⚠️ Kam to'landi: ${shortageAmount.toFixed(
            2,
          )} $ yetishmayapti`;
        }

        const notes = await Notes.create({
          text: noteText,
          customer: contract.customer,
          createBy: String(manager._id),
        });

        const payment = await Payment.create({
          amount: contract.monthlyPayment,
          actualAmount: paymentAmount,
          date: new Date(),
          isPaid: true,
          paymentType: PaymentType.MONTHLY,
          paymentMethod: payData.paymentMethod,
          customerId: contract.customer,
          managerId: String(manager._id),
          notes: notes._id,
          status: paymentStatus,
          expectedAmount: contract.monthlyPayment,
          remainingAmount: shortageAmount,
          confirmedAt: new Date(),
          confirmedBy: user.sub,
          targetMonth: monthNumber,
        });

        createdPayments.push(payment);

        if (!contract.payments) {
          contract.payments = [];
        }
        (contract.payments as any[]).push(payment._id);

        remainingAmount -= paymentAmount;

        logger.debug(`✅ Payment created for month ${monthNumber}:`, {
          id: payment._id,
          status: paymentStatus,
          amount: paymentAmount,
          expected: contract.monthlyPayment,
          shortage: shortageAmount,
        });
      }

      if (remainingAmount > 0.01) {
        contract.prepaidBalance =
          (contract.prepaidBalance || 0) + remainingAmount;
        logger.debug(
          `💰 Prepaid balance updated: ${contract.prepaidBalance.toFixed(
            2,
          )} $ (excess from pay all)`,
        );
      }

      await contract.save();

      await this.updateBalance(
        String(manager._id),
        {
          dollar: payData.currencyDetails.dollar || 0,
          sum: payData.currencyDetails.sum || 0,
        },
        null,
      );
      logger.debug("✅ Balance updated (from dashboard)");

      const deletedDebtors = await Debtor.deleteMany({
        contractId: contract._id,
      });
      if (deletedDebtors.deletedCount > 0) {
        logger.debug("🗑️ Debtor(s) deleted:", deletedDebtors.deletedCount);
      }

      await this.checkContractCompletion(String(contract._id));

      const underpaidPayments = createdPayments.filter(
        (p) => p.status === PaymentStatus.UNDERPAID,
      );
      const totalShortage = underpaidPayments.reduce(
        (sum, p) => sum + (p.remainingAmount || 0),
        0,
      );

      let message = `${remainingMonths} oylik to'lovlar muvaffaqiyatli amalga oshirildi`;

      if (underpaidPayments.length > 0) {
        message += `\n⚠️ ${
          underpaidPayments.length
        } oyda kam to'landi (jami: ${totalShortage.toFixed(2)} $)`;
      }

      if (remainingAmount > 0.01) {
        message += `\n💰 ${remainingAmount.toFixed(
          2,
        )} $ ortiqcha summa prepaid balance ga qo'shildi`;
      }

      try {
        logger.debug("📝 Creating audit log for payAllRemainingMonths...");

        if (!user || !user.sub) {
          logger.error("❌ Cannot create audit log: user.sub is missing", {
            user,
          });
        } else if (createdPayments.length === 0) {
          logger.warn("⚠️ No payments created, skipping audit log");
        } else {
          const auditLogService = (
            await import("../../services/audit-log.service")
          ).default;
          const { AuditAction, AuditEntity } =
            await import("../../schemas/audit-log.schema");

          for (const payment of createdPayments) {
            await auditLogService.createLog({
              action: AuditAction.PAYMENT,
              entity: AuditEntity.PAYMENT,
              entityId: payment._id.toString(),
              userId: user.sub,
              metadata: {
                paymentType: "pay_all_remaining",
                paymentStatus: payment.status,
                amount: payment.actualAmount || payment.amount,
                targetMonth: payment.targetMonth,
                affectedEntities: [
                  {
                    entityType: "contract",
                    entityId: contract._id.toString(),
                    entityName: contract.productName || "Contract",
                  },
                  {
                    entityType: "customer",
                    entityId:
                      contract.customer._id?.toString() ||
                      contract.customer.toString(),
                    entityName: contract.customer.fullName,
                  },
                ],
              },
            });
          }

          logger.debug(
            `✅ Audit log created for ${createdPayments.length} payment(s) in payAllRemainingMonths`,
          );
        }
      } catch (auditError) {
        logger.error("❌ Error creating audit log:", auditError);
      }

      return {
        status: "success",
        message: message,
        contractId: contract._id,
        paymentsCreated: createdPayments.length,
        totalAmount: actualAmount,
        prepaidBalance: contract.prepaidBalance || 0,
      };
    } catch (error) {
      logger.error("❌ Error in payAllRemainingMonths:", error);
      throw error;
    }
  }

  
  async checkAndRejectExpiredPayments(): Promise<{
    rejectedCount: number;
    rejectedPaymentIds: string[];
  }> {
    try {
      logger.debug("🕐 === CHECKING EXPIRED PENDING PAYMENTS ===");

      const TIMEOUT_HOURS = PAYMENT_CONSTANTS.PENDING_TIMEOUT_HOURS;
      const timeoutDate = new Date();
      timeoutDate.setHours(timeoutDate.getHours() - TIMEOUT_HOURS);

      const expiredPayments = await Payment.find({
        status: PaymentStatus.PENDING,
        isPaid: false,
        createdAt: { $lt: timeoutDate },
      }).populate("notes");

      logger.debug(
        `📊 Found ${expiredPayments.length} expired PENDING payment(s)`,
      );

      const rejectedPaymentIds: string[] = [];

      for (const payment of expiredPayments) {
        try {
          payment.status = PaymentStatus.REJECTED;
          await payment.save();

          if (payment.notes) {
            const notes = await Notes.findById(payment.notes);
            if (notes) {
              notes.text += createAutoRejectionNote(TIMEOUT_HOURS);
              await notes.save();
            }
          }

          rejectedPaymentIds.push(payment._id.toString());

          logger.debug(
            `✅ Payment ${payment._id} automatically rejected (created at: ${payment.createdAt})`,
          );

          logger.info(
            `⏳ Payment auto-rejected (no notification sent): ${payment._id}`,
          );
        } catch (error) {
          logger.error(`❌ Error rejecting payment ${payment._id}:`, error);
        }
      }

      logger.debug(
        `✅ ${rejectedPaymentIds.length} payment(s) automatically rejected`,
      );

      return {
        rejectedCount: rejectedPaymentIds.length,
        rejectedPaymentIds,
      };
    } catch (error) {
      logger.error("❌ Error checking expired payments:", error);
      throw error;
    }
  }

  async editPaymentAmount(
    paymentId: string,
    newActualAmount: number,
    user: IJwtUser,
  ) {
    const payment = await Payment.findById(paymentId);
    if (!payment) {
      throw BaseError.NotFoundError("To'lov topilmadi");
    }

    if (!payment.isPaid) {
      throw BaseError.BadRequest(
        "Faqat tasdiqlangan (isPaid=true) to'lovni tahrirlash mumkin",
      );
    }

    const employee = await Employee.findById(user.sub).populate("role");
    const roleName = (employee?.role as any)?.name;
    const canEdit = roleName === "admin" || roleName === "moderator";
    if (!canEdit) {
      throw BaseError.ForbiddenError(
        "Tahrirlash uchun Admin yoki Moderator huquqi kerak",
      );
    }

    const oldActualAmount = payment.actualAmount ?? payment.amount;
    const difference = newActualAmount - oldActualAmount;

    payment.actualAmount = newActualAmount;

    const expected = payment.expectedAmount ?? payment.amount;
    const newRemaining = expected - newActualAmount;

    if (newRemaining > 0.001) {
      payment.remainingAmount = newRemaining;
      payment.excessAmount = 0;
      payment.status = PaymentStatus.UNDERPAID;
    } else if (newRemaining < -0.001) {
      payment.remainingAmount = 0;
      payment.excessAmount = Math.abs(newRemaining);
      payment.status = PaymentStatus.OVERPAID;
    } else {
      payment.remainingAmount = 0;
      payment.excessAmount = 0;
      payment.status = PaymentStatus.PAID;
    }

    await payment.save();

    if (payment.notes) {
      const notesDoc = await Notes.findById(payment.notes);
      if (notesDoc) {
        let baseText = notesDoc.text
          .replace(/\n⚠️ Qisman to'landi:[^\n]*/g, "")
          .replace(/\n✏️ \[TAHRIRLANDI\]:[^\n]*/g, "")
          .replace(/\n✅ To'liq to'landi \(tahrirlangan\)[^\n]*/g, "")
          .trim();

        if (payment.status === PaymentStatus.UNDERPAID) {
          baseText += `\n⚠️ Qisman to'landi: ${payment.remainingAmount?.toFixed(2)} $ yetishmayapti`;
        } else if (payment.status === PaymentStatus.PAID) {
          baseText += `\n✅ To'liq to'landi (tahrirlangan)`;
        } else if (payment.status === PaymentStatus.OVERPAID) {
          baseText += `\n✅ To'liq to'landi, ${payment.excessAmount?.toFixed(2)} $ ortiqcha (tahrirlangan)`;
        }

        baseText += `\n✏️ [TAHRIRLANDI]: ${oldActualAmount} $ → ${newActualAmount} $`;
        notesDoc.text = baseText;
        await notesDoc.save();
        logger.info(`📝 Notes updated for payment ${paymentId}`);
      }
    }

    if (Math.abs(difference) > 0.001 && payment.managerId) {
      await Balance.findOneAndUpdate(
        { managerId: payment.managerId },
        { $inc: { dollar: difference } },
      );
      logger.info(
        `💰 Balance updated: managerId=${payment.managerId}, diff=${difference}`,
      );
    }

    const { AuditAction, AuditEntity } =
      await import("../../schemas/audit-log.schema");
    const auditLogService = (await import("../../services/audit-log.service"))
      .default;

    await auditLogService.createLog({
      action: AuditAction.UPDATE,
      entity: AuditEntity.PAYMENT,
      entityId: paymentId,
      userId: user.sub,
      changes: [
        {
          field: "actualAmount",
          oldValue: oldActualAmount,
          newValue: newActualAmount,
        },
      ],
      metadata: {
        amount: newActualAmount,
        actualAmount: newActualAmount,
        paymentStatus: payment.status,
        remainingAmount: payment.remainingAmount,
      },
    });

    logger.info(
      `✅ Payment amount edited: paymentId=${paymentId}, old=${oldActualAmount}, new=${newActualAmount}`,
    );

    return {
      message: "To'lov summasi muvaffaqiyatli yangilandi",
      paymentId,
      oldActualAmount,
      newActualAmount,
      difference,
      newStatus: payment.status,
    };
  }
}

export default new PaymentService();
