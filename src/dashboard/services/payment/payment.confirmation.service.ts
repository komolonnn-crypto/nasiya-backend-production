/**
 * Payment Confirmation Service
 *
 * Kassa operatsiyalari - To'lovlarni tasdiqlash va rad etish
 * Extends PaymentBaseService for common functionality
 */

import { PaymentBaseService } from "./payment.base.service";
import Payment, {
  PaymentStatus,
  PaymentType,
} from "../../../schemas/payment.schema";
import Contract, { ContractStatus } from "../../../schemas/contract.schema";
import { Debtor } from "../../../schemas/debtor.schema";
import Notes from "../../../schemas/notes.schema";
import Customer from "../../../schemas/customer.schema";
import Employee from "../../../schemas/employee.schema";
import logger from "../../../utils/logger";
import BaseError from "../../../utils/base.error";
import IJwtUser from "../../../types/user";
import { withTransaction } from "../../../utils/transaction.wrapper";
import {
  PAYMENT_CONSTANTS,
  calculatePaymentAmounts,
  createAutoRejectionNote,
  isAmountPositive,
} from "../../../utils/helpers/payment";

export class PaymentConfirmationService extends PaymentBaseService {
  /**
   * To'lovni tasdiqlash (Kassa tomonidan)
   * Requirements: 8.2, 8.3, 8.4
   * ✅ ORTIQCHA TO'LOV BO'LSA, KEYINGI OYLAR UCHUN AVTOMATIK TO'LOVLAR YARATISH
   */
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

      // Status aniqlash
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

      // Payment'ni tasdiqlash
      payment.isPaid = true;
      payment.confirmedAt = new Date();
      payment.confirmedBy = user.sub as any;
      await payment.save();

      // ✅ INITIAL to'lov tasdiqlanganida — Notes'ga aniq ma'lumot yozish
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

      // Contract topish
      const contract = await Contract.findOne({
        customer: payment.customerId,
        status: ContractStatus.ACTIVE,
      });

      if (!contract) {
        throw BaseError.NotFoundError("Faol shartnoma topilmadi");
      }

      // Payment'ni Contract.payments ga qo'shish (agar yo'q bo'lsa)
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

      // Ortiqcha to'lovni qayta ishlash
      const createdPayments = [];
      if (payment.excessAmount && isAmountPositive(payment.excessAmount)) {
        const originalActualAmount = payment.actualAmount || payment.amount;
        const correctedActualAmount = payment.expectedAmount || payment.amount;
        const excessAmountValue = originalActualAmount - correctedActualAmount;

        payment.actualAmount = correctedActualAmount;
        payment.excessAmount = 0;
        payment.status = PaymentStatus.PAID;
        await payment.save();

        logger.debug(
          `✅ Current payment actualAmount corrected: ${originalActualAmount} → ${payment.actualAmount}`,
        );
        logger.debug(
          `✅ Excess amount (${excessAmountValue.toFixed(2)} $) will be added to prepaid balance`,
        );

        // ✅ YANGI: Ortiqcha summani zapasga qo'shish (avtomatik to'lov yaratilmaydi)
        await this.addToPrepaidBalance(excessAmountValue, contract);

        // ✅ YANGI: Ortiqcha summani PrepaidRecord'ga yozish (Zapas Tarixi)
        await this.recordPrepaidTransaction(
          excessAmountValue,
          payment,
          contract,
          payment.paymentMethod,
          payment.notes ? payment.notes.text : undefined,
        );
        // createdPayments.push(...result); // ❌ COMMENTED: Endi avtomatik to'lovlar yaratilmaydi
      }

      await contract.save();

      // ✅ TUZATISH: nextPaymentDate ni to'g'ri hisoblash
      // Eng oxirgi to'langan oydan keyingi oyga o'rnatish
      if (payment.paymentType === PaymentType.MONTHLY) {
        // Barcha to'lovlarni olish va to'langan oylarni aniqlash
        const allPayments = await Payment.find({
          _id: { $in: contract.payments },
        }).sort({ targetMonth: 1 });

        // Eng oxirgi to'langan oyni topish
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

        // Keyingi to'lov oyi
        const nextPaymentMonth = lastPaidMonth + 1;

        // Agar barcha oylar to'langan bo'lsa, contract COMPLETED
        if (nextPaymentMonth > contract.period) {
          logger.debug("✅ Barcha oylar to'landi - shartnoma yakunlanadi");
          // checkContractCompletion bu holatni hal qiladi
        } else {
          // nextPaymentDate ni hisoblash
          const startDate = new Date(contract.startDate);
          const originalDay =
            contract.originalPaymentDay || startDate.getDate();

          // Keyingi to'lov sanasini hisoblash
          const newNextPaymentDate = new Date(startDate);
          newNextPaymentDate.setMonth(startDate.getMonth() + nextPaymentMonth);
          // Kun to'g'riligi (oyning oxirgi kunidan oshib ketmaslik)
          if (newNextPaymentDate.getDate() !== originalDay) {
            newNextPaymentDate.setDate(0); // Oyning oxirgi kuni
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

          // Agar originalPaymentDay undefined bo'lsa, o'rnatish
          if (!contract.originalPaymentDay) {
            contract.originalPaymentDay = originalDay;
            logger.debug("📅 originalPaymentDay o'rnatildi:", originalDay);
          }

          // Kechiktirilgan ma'lumotlarni tozalash (agar mavjud bo'lsa)
          if (contract.previousPaymentDate || contract.postponedAt) {
            contract.previousPaymentDate = undefined;
            contract.postponedAt = undefined;
            logger.debug("🔄 Kechiktirilgan ma'lumotlar tozalandi");
          }
        }
      }

      await contract.save();
      logger.debug("💾 Contract saved with updated nextPaymentDate");

      // ✅ TUZATILDI: To'lov qilinganda o'sha oy VA oldingi barcha oylarning eslatmalarini o'chirish
      if (payment.targetMonth) {
        const deletedReminders = await Payment.deleteMany({
          customerId: payment.customerId,
          targetMonth: { $lte: payment.targetMonth }, // ✅ O'sha oy va oldingi oylar
          isReminderNotification: true,
          isPaid: false,
        });

        if (deletedReminders.deletedCount > 0) {
          logger.debug(
            `🗑️ ${deletedReminders.deletedCount} eslatma notification o'chirildi (${payment.targetMonth}-oy va oldingi oylar uchun)`,
          );
        }
      }

      // Audit log yaratish - customerName va paymentCreator bilan
      const customer = await Customer.findById(payment.customerId);
      const customerName = customer?.fullName || "Noma'lum mijoz";

      // ✅ YANGI: Pulni yig'ib to'lovni qilgan odamni olish (managerId)
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
          customerName, // ✅ Mijoz ismi
          contractId: contract.customId, // ✅ YANGI: Shartnoma ID
          paymentType: "monthly",
          paymentStatus: payment.status,
          paymentMethod: payment.paymentMethod, // ✅ YANGI: To'lov usuli
          amount: payment.actualAmount || payment.amount,
          targetMonth: payment.targetMonth,
          paymentCreatorId: paymentCreator?._id?.toString(), // ✅ YANGI: To'lov qilgan odam ID
          paymentCreatorName, // ✅ YANGI: To'lov qilgan odam ismi
        },
      });

      // Balance yangilash
      const confirmedActualAmount = payment.actualAmount || payment.amount;
      await this.updateBalance(
        payment.managerId.toString(),
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

      // ✅ YANGI LOGIKA: Debtor faqat barcha muddati o'tgan to'lovlar to'langanda o'chirilsin
      // Barcha to'lovlarni olish
      const allPayments = await Payment.find({
        _id: { $in: contract.payments },
      });

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Muddati o'tgan va to'lanmagan to'lovlarni hisoblash
      const overdueUnpaidPayments = allPayments.filter(
        (p) => !p.isPaid && new Date(p.date) < today,
      );

      logger.debug("📊 Overdue unpaid payments check:", {
        totalPayments: allPayments.length,
        overdueUnpaid: overdueUnpaidPayments.length,
        contractId: contract._id,
      });

      // ✅ Faqat muddati o'tgan to'lanmagan to'lovlar yo'q bo'lsa, Debtor o'chirish
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

        // ✅ BONUS: Debtor ma'lumotlarini yangilash (overdueDays, debtAmount)
        // Eng birinchi muddati o'tgan to'lovni topish
        const firstOverduePayment = overdueUnpaidPayments.sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
        )[0];

        if (firstOverduePayment) {
          const overdueDays = Math.floor(
            (today.getTime() - new Date(firstOverduePayment.date).getTime()) /
              (1000 * 60 * 60 * 24),
          );

          // Debtor'ni yangilash
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

      // Contract completion tekshirish
      await this.checkContractCompletion(String(contract._id));

      logger.debug("✅ Payment confirmed successfully");

      // Database notification yaratish
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

  /**
   * To'lovni rad etish (Kassa tomonidan)
   * Requirements: 8.5
   */
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

      // Payment status'ni o'zgartirish
      payment.status = PaymentStatus.REJECTED;
      await payment.save();

      // Notes'ga rad etish sababini qo'shish
      if (payment.notes) {
        payment.notes.text += `\n[RAD ETILDI: ${reason}]`;
        await payment.notes.save();
      }

      // Payment'ni Contract.payments dan o'chirish
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

      // Audit log yaratish
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
          customerName, // ✅ Mijoz ismi
          contractId: contract?.customId, // ✅ YANGI: Shartnoma ID
          paymentType: "monthly",
          paymentStatus: PaymentStatus.REJECTED,
          paymentMethod: payment.paymentMethod,
          amount: payment.actualAmount || payment.amount,
          targetMonth: payment.targetMonth,
          paymentCreatorId: paymentCreator?._id?.toString(),
          paymentCreatorName,
        },
      });

      // Database notification yaratish
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

  /**
   * PENDING to'lovlarni tekshirish va muddati o'tganlarni avtomatik rad etish
   * Requirements: 9.1 - PENDING to'lovlar timeout
   */
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
