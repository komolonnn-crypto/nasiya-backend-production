import { PaymentBaseService } from "./payment.base.service";

import Payment, {
  ExcessHandling,
  PaymentMethod,
  PaymentStatus,
  PaymentType,
} from "../../../schemas/payment.schema";
import Contract, { ContractStatus } from "../../../schemas/contract.schema";
import { Debtor } from "../../../schemas/debtor.schema";
import Notes from "../../../schemas/notes.schema";
import Customer from "../../../schemas/customer.schema";
import Employee from "../../../schemas/employee.schema";

import {
  PAYMENT_CONSTANTS,
  calculatePaymentAmounts,
  createAutoRejectionNote,
  isAmountPositive,
} from "../../../utils/helpers/payment";
import { withTransaction } from "../../../utils/transaction.wrapper";
import BaseError from "../../../utils/base.error";
import logger from "../../../utils/logger";

import IJwtUser from "../../../types/user";

export class PaymentConfirmationService extends PaymentBaseService {
  async confirmPayment(paymentId: string, user: IJwtUser) {
    return withTransaction(async (session) => {
      logger.debug("✅ === CONFIRMING PAYMENT (WITH TRANSACTION SUPPORT) ===");
      logger.debug("Payment ID:", paymentId);

      const payment = await Payment.findById(paymentId);

      if (!payment) {
        throw BaseError.NotFoundError("To'lov topilmadi");
      }

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

      if (payment.paymentType === PaymentType.INITIAL) {
        try {
          const confirmer = await Employee.findById(user.sub);
          const confirmerName =
            confirmer ?
              `${confirmer.firstName} ${confirmer.lastName}`.trim()
            : "Kassa";
          const now = new Date();
          const pad = (n: number) => n.toString().padStart(2, "0");
          const confirmTime = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
          const confirmedAmount = payment.actualAmount || payment.amount;
          const noteText = `Boshlang'ich to'lov to'landi $${confirmedAmount.toLocaleString()} — ${confirmerName} — ${confirmTime}`;

          if (payment.notes) {
            await Notes.findByIdAndUpdate(payment.notes, { text: noteText });
          } else {
            const newNote = await Notes.create({
              text: noteText,
              customer: payment.customerId,
              createBy: user.sub,
            });
            payment.notes = newNote._id as any;
            await payment.save();
          }
          logger.debug(`✅ Initial payment notes updated: "${noteText}"`);
        } catch (e) {
          logger.warn("⚠️ Could not update initial payment notes:", e);
        }
      }

      logger.debug("✅ Payment confirmed:", {
        status: payment.status,
        actualAmount: payment.actualAmount,
        remainingAmount: payment.remainingAmount,
        excessAmount: payment.excessAmount,
      });

      const contract = await Contract.findOne({
        customer: payment.customerId,
        status: ContractStatus.ACTIVE,
      });

      if (!contract) {
        throw BaseError.NotFoundError("Faol shartnoma topilmadi");
      }

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
      let excessAmountForLog = 0;
      let originalAmountForLog = 0;
      let prepaidRecordIdForLog: string | undefined;

      if (payment.excessAmount && isAmountPositive(payment.excessAmount)) {
        const originalActualAmount = payment.actualAmount || payment.amount;
        const correctedActualAmount = payment.expectedAmount || payment.amount;
        const excessAmountValue = originalActualAmount - correctedActualAmount;

        excessAmountForLog = excessAmountValue;
        originalAmountForLog = originalActualAmount;

        payment.actualAmount = correctedActualAmount;
        payment.excessAmount = 0;
        payment.status = PaymentStatus.PAID;
        await payment.save();

        logger.debug(
          `✅ Current payment actualAmount corrected: ${originalActualAmount} → ${payment.actualAmount}`,
        );

        if (payment.excessHandling === ExcessHandling.NEXT_MONTH) {
          logger.debug(
            `🔄 excessHandling=next_month: ${excessAmountValue.toFixed(2)}$ keyingi oyga o'tkaziladi`,
          );

          await contract.populate("payments");
          const nextPayment = (contract.payments as any[])
            .filter(
              (p) =>
                p.paymentType === PaymentType.MONTHLY &&
                !p.isPaid &&
                p.status === PaymentStatus.SCHEDULED &&
                (p.targetMonth || 0) > (payment.targetMonth || 0),
            )
            .sort(
              (a: any, b: any) => (a.targetMonth || 0) - (b.targetMonth || 0),
            )[0];

          if (nextPayment) {
            const nextPaymentDoc = await Payment.findById(nextPayment._id);
            if (nextPaymentDoc) {
              const newAmount = Math.max(
                0,
                nextPaymentDoc.amount - excessAmountValue,
              );
              const newExpected = Math.max(
                0,
                (nextPaymentDoc.expectedAmount || nextPaymentDoc.amount) -
                  excessAmountValue,
              );
              nextPaymentDoc.amount = newAmount;
              nextPaymentDoc.expectedAmount = newExpected;
              if (newAmount <= 0) {
                nextPaymentDoc.isPaid = true;
                nextPaymentDoc.status = PaymentStatus.PAID;
                nextPaymentDoc.confirmedAt = new Date();
                nextPaymentDoc.confirmedBy = payment.confirmedBy;
              }
              await nextPaymentDoc.save();
              logger.debug(
                `✅ Keyingi oy (${nextPaymentDoc.targetMonth}-oy) to'lovi kamaytirildi: ${excessAmountValue.toFixed(2)}$ → yangi summa: ${newAmount.toFixed(2)}$`,
              );
            }
          } else {
            logger.debug(
              `⚠️ Keyingi SCHEDULED oy topilmadi — zapasga qo'shiladi`,
            );
            await this.addToPrepaidBalance(excessAmountValue, contract);
            const prepaidRecord = await this.recordPrepaidTransaction(
              excessAmountValue,
              payment,
              contract,
              payment.paymentMethod,
              payment.notes ? (payment.notes as any).text : undefined,
            );
            if (prepaidRecord?._id)
              prepaidRecordIdForLog = prepaidRecord._id.toString();
          }
        } else {
          logger.debug(
            `💰 excessHandling=zapas: ${excessAmountValue.toFixed(2)}$ zapasga qo'shiladi`,
          );
          await this.addToPrepaidBalance(excessAmountValue, contract);

          const prepaidRecord = await this.recordPrepaidTransaction(
            excessAmountValue,
            payment,
            contract,
            payment.paymentMethod,
            payment.notes ? (payment.notes as any).text : undefined,
          );
          if (prepaidRecord?._id) {
            prepaidRecordIdForLog = prepaidRecord._id.toString();
          }
        }
      }

      await contract.save();

      if (payment.paymentType === PaymentType.INITIAL) {
        const confirmedInitialAmount = payment.actualAmount || payment.amount;

        if (contract.period > 0 && contract.price > 0) {
          const remainingAfterInitial = contract.price - confirmedInitialAmount;
          const percentage = contract.percentage ?? 0;
          const amountWithInterest =
            remainingAfterInitial * (1 + percentage / 100);
          const newMonthlyPayment = Math.round(
            amountWithInterest / contract.period,
          );
          const newTotalPrice = Math.round(
            confirmedInitialAmount + newMonthlyPayment * contract.period,
          );

          if (
            newMonthlyPayment > 0 &&
            Math.abs(newMonthlyPayment - contract.monthlyPayment) > 0.01
          ) {
            logger.debug(
              `🔄 INITIAL to'lov tasdiqlandi — oylik to'lov qayta hisoblanmoqda:`,
              {
                price: contract.price,
                percentage,
                confirmedInitialAmount,
                remainingAfterInitial,
                amountWithInterest,
                period: contract.period,
                oldMonthlyPayment: contract.monthlyPayment,
                newMonthlyPayment,
                oldTotalPrice: contract.totalPrice,
                newTotalPrice,
              },
            );

            contract.initialPayment = confirmedInitialAmount;
            contract.monthlyPayment = newMonthlyPayment;
            contract.totalPrice = newTotalPrice;
            await contract.save();

            const unpaidMonthlyIds = (contract.payments as any[])
              .filter(
                (p) =>
                  !p.isPaid &&
                  p.status === PaymentStatus.SCHEDULED &&
                  p.paymentType === PaymentType.MONTHLY,
              )
              .map((p) => p._id);

            if (unpaidMonthlyIds.length > 0) {
              const updateResult = await Payment.updateMany(
                { _id: { $in: unpaidMonthlyIds } },
                {
                  $set: {
                    amount: newMonthlyPayment,
                    expectedAmount: newMonthlyPayment,
                    remainingAmount: newMonthlyPayment,
                  },
                },
              );

              logger.debug(
                `✅ ${updateResult.modifiedCount} ta oylik to'lov yangilandi → ${newMonthlyPayment} $`,
              );
            }
          } else {
            logger.debug(
              `ℹ️ Oylik to'lov o'zgarmadi (diff: ${Math.abs(newMonthlyPayment - contract.monthlyPayment).toFixed(2)})`,
            );
          }
        }
      }
      if (payment.paymentType === PaymentType.MONTHLY) {
        const allPayments = await Payment.find({
          _id: { $in: contract.payments },
        }).sort({ targetMonth: 1 });

        const paidPayments = allPayments.filter((p) => p.isPaid);
        const lastPaidMonth =
          paidPayments.length > 0 ?
            Math.max(...paidPayments.map((p) => p.targetMonth || 0))
          : 0;

        logger.debug("📊 To'lov holati:", {
          totalPayments: allPayments.length,
          paidPayments: paidPayments.length,
          lastPaidMonth: lastPaidMonth,
          period: contract.period,
        });

        const nextPaymentMonth = lastPaidMonth + 1;

        if (nextPaymentMonth > contract.period) {
          logger.debug("✅ Barcha oylar to'landi - shartnoma yakunlanadi");
        } else {
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
            logger.debug("📅 originalPaymentDay o'rnatildi:", originalDay);
          }

          if (contract.previousPaymentDate || contract.postponedAt) {
            contract.previousPaymentDate = undefined;
            contract.postponedAt = undefined;
            logger.debug("🔄 Kechiktirilgan ma'lumotlar tozalandi");
          }
        }
      }

      if (payment.paymentMethod === PaymentMethod.FROM_ZAPAS) {
        const zapasAmount = payment.actualAmount || payment.amount;
        if (
          (contract.prepaidBalance || 0) <
          zapasAmount - PAYMENT_CONSTANTS.TOLERANCE
        ) {
          throw BaseError.BadRequest(
            `Zapas balansi yetarli emas (mavjud: $${(contract.prepaidBalance || 0).toFixed(2)}, kerak: $${zapasAmount.toFixed(2)})`,
          );
        }
        contract.prepaidBalance = Math.max(
          0,
          (contract.prepaidBalance || 0) - zapasAmount,
        );
        await contract.save();
        logger.debug(
          `💰 Zapasdan to'landi: ${zapasAmount.toFixed(2)}$, qolgan zapas: ${contract.prepaidBalance.toFixed(2)}$`,
        );
      }

      await contract.save();
      logger.debug("💾 Contract saved with updated nextPaymentDate");

      if (payment.targetMonth) {
        const deletedReminders = await Payment.deleteMany({
          customerId: payment.customerId,
          targetMonth: { $lte: payment.targetMonth },
          isReminderNotification: true,
          isPaid: false,
        });

        if (deletedReminders.deletedCount > 0) {
          logger.debug(
            `🗑️ ${deletedReminders.deletedCount} eslatma notification o'chirildi (${payment.targetMonth}-oy va oldingi oylar uchun)`,
          );
        }
      }

      const customer = await Customer.findById(payment.customerId);
      const customerName = customer?.fullName || "Noma'lum mijoz";

      await payment.populate("managerId");
      const paymentCreator = payment.managerId as any;
      const paymentCreatorName =
        paymentCreator ?
          `${paymentCreator.firstName || ""} ${paymentCreator.lastName || ""}`.trim()
        : "Noma'lum";

      await this.createAuditLog({
        action: (await import("../../../schemas/audit-log.schema")).AuditAction
          .CONFIRM,
        entity: (await import("../../../schemas/audit-log.schema")).AuditEntity
          .PAYMENT,
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
          customerName,
          customerId: payment.customerId.toString(),
          contractId: contract.customId,
          paymentType: "monthly",
          paymentStatus: payment.status,
          paymentMethod: payment.paymentMethod,
          amount: payment.actualAmount || payment.amount,
          targetMonth: payment.targetMonth,
          paymentCreatorId: paymentCreator?._id?.toString(),
          paymentCreatorName,
          affectedEntities: [
            {
              entityType: "payment",
              entityId: paymentId,
              entityName: `${customerName} - ${payment.actualAmount || payment.amount}`,
            },
            {
              entityType: "contract",
              entityId: contract._id.toString(),
              entityName: `Contract: ${customerName}`,
            },
            {
              entityType: "customer",
              entityId: payment.customerId.toString(),
              entityName: customerName,
            },
          ],
          ...(excessAmountForLog > 0 && {
            originalAmount: originalAmountForLog,
            excessAmount: excessAmountForLog,
            prepaidRecordId: prepaidRecordIdForLog,
          }),
        },
      });

      const confirmedActualAmount = payment.actualAmount || payment.amount;
      if (payment.paymentMethod !== PaymentMethod.FROM_ZAPAS) {
        await this.updateBalance(
          payment.managerId.toString(),
          {
            dollar: confirmedActualAmount,
            sum: 0,
          },
          session,
          user.sub,
          {
            customerName,
            contractId: contract.customId,
            paymentType: payment.paymentType,
          },
        );
      }

      logger.debug(
        "💵 Balance updated with actualAmount:",
        confirmedActualAmount,
      );

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
            debtAmount:
              firstOverduePayment.remainingAmount || firstOverduePayment.amount,
          });
        }
      }

      await this.checkContractCompletion(String(contract._id));

      logger.debug("✅ Payment confirmed successfully");

      try {
        const customer = await Customer.findById(payment.customerId);

        if (customer) {
          const botNotificationService = (
            await import("../../../bot/services/notification.service")
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

        await contract.save();
      }

      logger.debug("✅ Payment rejected successfully");

      const customer = await Customer.findById(payment.customerId);
      const customerName = customer?.fullName || "Noma'lum mijoz";

      await payment.populate("managerId");
      const paymentCreator = payment.managerId as any;
      const paymentCreatorName =
        paymentCreator ?
          `${paymentCreator.firstName || ""} ${paymentCreator.lastName || ""}`.trim()
        : "Noma'lum";

      await this.createAuditLog({
        action: (await import("../../../schemas/audit-log.schema")).AuditAction
          .REJECT,
        entity: (await import("../../../schemas/audit-log.schema")).AuditEntity
          .PAYMENT,
        entityId: paymentId,
        userId: user.sub,
        changes: [
          {
            field: "status",
            oldValue: "PENDING",
            newValue: PaymentStatus.REJECTED,
          },
          { field: "reason", oldValue: null, newValue: reason },
        ],
        metadata: {
          customerName,
          customerId: payment.customerId.toString(),
          contractId: contract?.customId,
          paymentType: "monthly",
          paymentStatus: PaymentStatus.REJECTED,
          paymentMethod: payment.paymentMethod,
          amount: payment.actualAmount || payment.amount,
          targetMonth: payment.targetMonth,
          paymentCreatorId: paymentCreator?._id?.toString(),
          paymentCreatorName,
          affectedEntities: [
            {
              entityType: "payment",
              entityId: paymentId,
              entityName: `${customerName} - ${payment.actualAmount || payment.amount}`,
            },
            {
              entityType: "contract",
              entityId: contract?._id.toString(),
              entityName: `Contract: ${customerName}`,
            },
            {
              entityType: "customer",
              entityId: payment.customerId.toString(),
              entityName: customerName,
            },
          ],
        },
      });

      try {
        if (customer && contract) {
          const botNotificationService = (
            await import("../../../bot/services/notification.service")
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
          logger.debug(`✅ Payment ${payment._id} automatically rejected`);
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
}

export default new PaymentConfirmationService();
