

import { Request, Response } from "express";
import PrepaidRecord from "../../schemas/prepaid-record.schema";
import Contract from "../../schemas/contract.schema";
import logger from "../../utils/logger";
import IJwtUser from "../../types/user";

class PrepaidController {
  
  async getPrepaidHistory(req: Request, res: Response) {
    try {
      const { customerId } = req.params;
      const { contractId } = req.query;
      const user = req.user as IJwtUser;

      logger.debug("📊 Getting prepaid records for customer:", {
        customerId,
        contractId: contractId || "all",
        requestedBy: user?.sub,
      });

      const query: any = { customer: customerId };

      if (contractId) {
        query.contract = contractId;
      }

      const records = await PrepaidRecord.find(query)
        .populate("createdBy", "firstName lastName")
        .populate("customer", "fullName")
        .populate("contract", "customId productName")
        .sort({ date: -1, createdAt: -1 })
        .lean();

      logger.debug("✅ Prepaid records fetched:", {
        count: records.length,
        customerId,
      });

      res.json({
        success: true,
        data: records,
        count: records.length,
      });
    } catch (error) {
      logger.error("❌ Error getting prepaid records:", error);
      res.status(500).json({
        success: false,
        message: "Zapas tarihini o'qishda xatolik",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  
  async getPrepaidByContract(req: Request, res: Response) {
    try {
      const { contractId } = req.params;
      const user = req.user as IJwtUser;

      logger.debug("📊 Getting prepaid records for contract:", {
        contractId,
        requestedBy: user?.sub,
      });

      const records = await PrepaidRecord.find({ contract: contractId })
        .populate("createdBy", "firstName lastName")
        .populate("customer", "fullName")
        .populate("contract", "customId productName")
        .sort({ date: -1, createdAt: -1 })
        .lean();

      const summary = {
        totalAmount: records.reduce((sum, r) => sum + r.amount, 0),
        recordCount: records.length,
        lastRecord: records[0] || null,
      };

      logger.debug("✅ Contract prepaid records fetched:", {
        contractId,
        count: records.length,
        totalAmount: summary.totalAmount,
      });

      res.json({
        success: true,
        data: records,
        count: records.length,
        summary,
      });
    } catch (error) {
      logger.error("❌ Error getting contract prepaid records:", error);
      res.status(500).json({
        success: false,
        message: "Shartnoma zapas tarihini o'qishda xatolik",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  
  async getPrepaidStats(req: Request, res: Response) {
    try {
      const { customerId } = req.params;
      const user = req.user as IJwtUser;

      logger.debug("📊 Getting prepaid statistics for customer:", {
        customerId,
        requestedBy: user?.sub,
      });

      const records = await PrepaidRecord.find({ customer: customerId }).lean();
      const totalPrepaidFromRecords = records.reduce(
        (sum, r) => sum + r.amount,
        0,
      );

      const contracts = await Contract.find({ customer: customerId }).lean();
      const totalPrepaidFromContracts = contracts.reduce(
        (sum, c) => sum + (c.prepaidBalance || 0),
        0,
      );

      const totalPrepaid = Math.max(
        totalPrepaidFromRecords,
        totalPrepaidFromContracts,
      );

      const stats = {
        totalPrepaid: totalPrepaid,
        totalPrepaidFromRecords: totalPrepaidFromRecords,
        totalPrepaidFromContracts: totalPrepaidFromContracts,
        recordCount: records.length,
        contractCount: contracts.length,
        byPaymentMethod: {} as {
          [key: string]: { count: number; amount: number };
        },
        latestDate:
          records.length > 0 ?
            Math.max(...records.map((r) => new Date(r.date).getTime()))
          : null,
        oldestDate:
          records.length > 0 ?
            Math.min(...records.map((r) => new Date(r.date).getTime()))
          : null,
      };

      for (const record of records) {
        const method = record.paymentMethod || "unknown";
        if (!stats.byPaymentMethod[method]) {
          stats.byPaymentMethod[method] = { count: 0, amount: 0 };
        }
        stats.byPaymentMethod[method].count++;
        stats.byPaymentMethod[method].amount += record.amount;
      }

      logger.debug("✅ Prepaid statistics calculated:", stats);

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      logger.error("❌ Error getting prepaid statistics:", error);
      res.status(500).json({
        success: false,
        message: "Zapas statistikasini hisoblashda xatolik",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  
  async getContractBalance(req: Request, res: Response) {
    try {
      const { contractId } = req.params;
      const contract = await Contract.findById(contractId).select("prepaidBalance").lean();
      res.json({
        success: true,
        prepaidBalance: contract?.prepaidBalance || 0,
      });
    } catch (error) {
      logger.error("❌ Error getting contract prepaid balance:", error);
      res.status(500).json({
        success: false,
        message: "Zapas balansini olishda xatolik",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  
  async deletePrepaidRecord(req: Request, res: Response) {
    try {
      const { recordId } = req.params;
      const user = req.user as IJwtUser;

      logger.debug("🗑️ Deleting prepaid record:", {
        recordId,
        deletedBy: user?.sub,
      });

      const record = await PrepaidRecord.findByIdAndDelete(recordId);

      if (!record) {
        return res.status(404).json({
          success: false,
          message: "Zapas record'i topilmadi",
        });
      }

      logger.debug("✅ Prepaid record deleted:", {
        recordId,
        amount: record.amount,
      });

      res.json({
        success: true,
        message: "Zapas record'i o'chirildi",
        data: record,
      });
    } catch (error) {
      logger.error("❌ Error deleting prepaid record:", error);
      res.status(500).json({
        success: false,
        message: "Zapas record'ini o'chirishda xatolik",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  
  async updatePrepaidRecord(req: Request, res: Response) {
    try {
      const { recordId } = req.params;
      const { notes } = req.body;
      const user = req.user as IJwtUser;

      logger.debug("✏️ Updating prepaid record:", {
        recordId,
        updatedBy: user?.sub,
      });

      if (!notes) {
        return res.status(400).json({
          success: false,
          message: "Izoh maydoni bo'sh bo'lishi mumkin emas",
        });
      }

      const record = await PrepaidRecord.findByIdAndUpdate(
        recordId,
        { notes, updatedAt: new Date() },
        { new: true },
      );

      if (!record) {
        return res.status(404).json({
          success: false,
          message: "Zapas record'i topilmadi",
        });
      }

      logger.debug("✅ Prepaid record updated:", {
        recordId,
        newNotes: notes,
      });

      res.json({
        success: true,
        message: "Zapas record'i yangilandi",
        data: record,
      });
    } catch (error) {
      logger.error("❌ Error updating prepaid record:", error);
      res.status(500).json({
        success: false,
        message: "Zapas record'ini yangilashda xatolik",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  
  async getAllPrepaidRecords(req: Request, res: Response) {
    try {
      const user = req.user as IJwtUser;
      const {
        limit = 50,
        skip = 0,
        sortBy = "date",
        sortOrder = "desc",
      } = req.query;

      logger.debug("📊 Getting all prepaid records:", {
        limit,
        skip,
        sortBy,
        sortOrder,
        requestedBy: user?.sub,
      });

      const sortObj: any = {};
      sortObj[sortBy as string] = sortOrder === "asc" ? 1 : -1;

      const records = await PrepaidRecord.find()
        .populate("createdBy", "firstName lastName")
        .populate("customer", "fullName")
        .populate("contract", "customId productName")
        .sort(sortObj)
        .limit(Number(limit))
        .skip(Number(skip))
        .lean();

      const total = await PrepaidRecord.countDocuments();

      logger.debug("✅ All prepaid records fetched:", {
        count: records.length,
        total,
      });

      res.json({
        success: true,
        data: records,
        pagination: {
          total,
          limit: Number(limit),
          skip: Number(skip),
          pages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (error) {
      logger.error("❌ Error getting all prepaid records:", error);
      res.status(500).json({
        success: false,
        message: "Barcha zapas recordlarini o'qishda xatolik",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
}

export default new PrepaidController();
