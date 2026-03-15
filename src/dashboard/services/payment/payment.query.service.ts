

import Payment, { PaymentStatus, PaymentType } from "../../../schemas/payment.schema";
import Contract from "../../../schemas/contract.schema";
import { Types } from "mongoose";
import logger from "../../../utils/logger";
import BaseError from "../../../utils/base.error";

export class PaymentQueryService {
  
  async getPaymentHistory(
    customerId?: string,
    contractId?: string,
    filters?: {
      status?: PaymentStatus[];
      paymentType?: PaymentType[];
      dateFrom?: Date;
      dateTo?: Date;
      isPaid?: boolean;
    }
  ) {
    try {
      logger.debug("📜 Getting payment history for:", {
        customerId,
        contractId,
        filters,
      });

      let matchCondition: any = {};

      if (filters?.isPaid !== undefined) {
        matchCondition.isPaid = filters.isPaid;
      } else if (!filters?.status) {
        matchCondition.isPaid = true;
      }

      if (filters?.status && filters.status.length > 0) {
        matchCondition.status = { $in: filters.status };
      }

      if (filters?.paymentType && filters.paymentType.length > 0) {
        matchCondition.paymentType = { $in: filters.paymentType };
      }

      if (filters?.dateFrom || filters?.dateTo) {
        matchCondition.date = {};
        if (filters.dateFrom) {
          matchCondition.date.$gte = filters.dateFrom;
        }
        if (filters.dateTo) {
          matchCondition.date.$lte = filters.dateTo;
        }
      }

      if (customerId) {
        matchCondition.customerId = new Types.ObjectId(customerId);
      }

      if (contractId) {
        const contract = await Contract.findById(contractId);
        if (contract) {
          matchCondition.customerId = new Types.ObjectId(
            contract.customer.toString()
          );
        }
      }

      const payments = await Payment.aggregate([
        { $match: matchCondition },
        {
          $lookup: {
            from: "customers",
            localField: "customerId",
            foreignField: "_id",
            as: "customer",
          },
        },
        { $unwind: "$customer" },
        {
          $lookup: {
            from: "employees",
            localField: "managerId",
            foreignField: "_id",
            as: "manager",
          },
        },
        { $unwind: "$manager" },
        {
          $lookup: {
            from: "notes",
            localField: "notes",
            foreignField: "_id",
            as: "notes",
          },
        },
        {
          $addFields: {
            customerName: {
              $concat: [
                "$customer.fullName",
              ],
            },
            managerName: {
              $concat: [
                "$manager.firstName",
                " ",
                { $ifNull: ["$manager.lastName", ""] },
              ],
            },
            notes: { $ifNull: [{ $arrayElemAt: ["$notes.text", 0] }, ""] },
          },
        },
        {
          $project: {
            _id: 1,
            amount: 1,
            date: 1,
            paymentType: 1,
            customerName: 1,
            managerName: 1,
            notes: 1,
            status: 1,
            actualAmount: 1,
            expectedAmount: 1,
            remainingAmount: 1,
            excessAmount: 1,
            isPaid: 1,
            confirmedAt: 1,
            createdAt: 1,
            contractId: 1,
            targetMonth: 1,
          },
        },
        { $sort: { date: -1 } },
      ]);

      logger.debug("✅ Found payments:", payments.length);
      logger.debug("✅ Filters applied:", matchCondition);

      return {
        status: "success",
        data: payments,
      };
    } catch (error) {
      logger.error("❌ Error getting payment history:", error);
      throw BaseError.InternalServerError("To'lovlar tarixini olishda xatolik");
    }
  }

  
  async getPaymentById(paymentId: string) {
    try {
      const payment = await Payment.findById(paymentId)
        .populate("customerId")
        .populate("managerId")
        .populate("notes");

      if (!payment) {
        throw BaseError.NotFoundError("To'lov topilmadi");
      }

      return {
        status: "success",
        data: payment,
      };
    } catch (error) {
      logger.error("❌ Error getting payment by ID:", error);
      throw error;
    }
  }

  
  async getPendingPayments(limit: number = 100) {
    try {
      const payments = await Payment.find({
        status: PaymentStatus.PENDING,
        isPaid: false,
      })
        .populate("customerId")
        .populate("managerId")
        .populate("notes")
        .sort({ createdAt: -1 })
        .limit(limit);

      return {
        status: "success",
        data: payments,
        count: payments.length,
      };
    } catch (error) {
      logger.error("❌ Error getting pending payments:", error);
      throw BaseError.InternalServerError("PENDING to'lovlarni olishda xatolik");
    }
  }

  
  async getPaymentsByContract(contractId: string) {
    try {
      const contract = await Contract.findById(contractId);
      
      if (!contract) {
        throw BaseError.NotFoundError("Shartnoma topilmadi");
      }

      const payments = await Payment.find({
        _id: { $in: contract.payments },
      })
        .populate("managerId")
        .populate("notes")
        .sort({ date: 1 });

      return {
        status: "success",
        data: payments,
        count: payments.length,
      };
    } catch (error) {
      logger.error("❌ Error getting payments by contract:", error);
      throw error;
    }
  }

  
  async getPaymentsByCustomer(customerId: string) {
    try {
      const payments = await Payment.find({
        customerId: new Types.ObjectId(customerId),
      })
        .populate("managerId")
        .populate("notes")
        .sort({ date: -1 });

      return {
        status: "success",
        data: payments,
        count: payments.length,
      };
    } catch (error) {
      logger.error("❌ Error getting payments by customer:", error);
      throw error;
    }
  }
}

export default new PaymentQueryService();
