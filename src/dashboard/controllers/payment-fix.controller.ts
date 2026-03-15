

import { Request, Response, NextFunction } from "express";
import Payment from "../../schemas/payment.schema";
import Contract from "../../schemas/contract.schema";
import logger from "../../utils/logger";
import BaseError from "../../utils/base.error";

class PaymentFixController {
  
  async fixUnpaidPayments(req: Request, res: Response, next: NextFunction) {
    try {
      const { contractId } = req.params;
      
      logger.info(`🔧 Fixing unpaid payments for contract: ${contractId}`);
      
      const contract = await Contract.findById(contractId);
      if (!contract) {
        throw BaseError.NotFoundError("Shartnoma topilmadi");
      }
      
      const payments = await Payment.find({
        _id: { $in: contract.payments }
      }).sort({ targetMonth: 1 });
      
      logger.info(`📊 Total payments: ${payments.length}`);
      
      const paymentsInfo = payments.map(p => ({
        id: p._id,
        type: p.paymentType,
        targetMonth: p.targetMonth,
        date: p.date,
        isPaid: p.isPaid,
        actualAmount: p.actualAmount,
      }));
      
      const unpaidPaymentIds = payments
        .filter(p => !p.actualAmount || p.actualAmount === 0)
        .map(p => p._id);
      
      logger.info(`🔍 Found ${unpaidPaymentIds.length} unpaid payments`);
      
      const result = await Payment.updateMany(
        {
          _id: { $in: unpaidPaymentIds }
        },
        {
          $set: {
            isPaid: false,
            confirmedAt: null,
            confirmedBy: null,
          }
        }
      );
      
      logger.info(`✅ Fixed ${result.modifiedCount} payments`);
      
      const updatedPayments = await Payment.find({
        _id: { $in: contract.payments }
      }).sort({ targetMonth: 1 });
      
      const updatedInfo = updatedPayments.map(p => ({
        id: p._id,
        type: p.paymentType,
        targetMonth: p.targetMonth,
        date: p.date,
        isPaid: p.isPaid,
        actualAmount: p.actualAmount,
      }));
      
      res.status(200).json({
        message: "To'lovlar muvaffaqiyatli tuzatildi",
        contractId,
        before: paymentsInfo,
        after: updatedInfo,
        fixed: result.modifiedCount,
      });
    } catch (error) {
      logger.error("❌ Error fixing payments:", error);
      next(error);
    }
  }
}

export default new PaymentFixController();
