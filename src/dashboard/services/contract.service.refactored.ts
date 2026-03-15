

import BaseError from "../../utils/base.error";
import Contract, { ContractStatus } from "../../schemas/contract.schema";
import logger from "../../utils/logger";
import {
  CreateContractDto,
  UpdateContractDto,
} from "../../validators/contract";
import IJwtUser from "../../types/user";
import Employee from "../../schemas/employee.schema";
import Notes from "../../schemas/notes.schema";
import Customer from "../../schemas/customer.schema";

import contractQueryService from "./contract/contract.query.service";
import contractEditHandler from "./contract/contract.edit.handler";
import contractBalanceHelper from "./contract/contract.balance.helper";
import contractPaymentHelper from "./contract/contract.payment.helper";

class ContractService {
  async getAll() {
    return contractQueryService.getAll();
  }

  async getAllNewContract() {
    return contractQueryService.getAllNewContract();
  }

  async getAllCompleted() {
    return contractQueryService.getAllCompleted();
  }

  async getContractById(contractId: string) {
    return contractQueryService.getContractById(contractId);
  }

  async update(data: UpdateContractDto, user: IJwtUser) {
    return contractEditHandler.update(data, user);
  }

  
  async analyzeContractEditImpact(
    contractId: string,
    changes: {
      monthlyPayment?: number;
      initialPayment?: number;
      totalPrice?: number;
    }
  ) {
    try {
      const contract = await Contract.findById(contractId).populate("payments");
      if (!contract) {
        throw BaseError.NotFoundError("Shartnoma topilmadi");
      }

      const changesArray: Array<{
        field: string;
        oldValue: any;
        newValue: any;
        difference: number;
      }> = [];

      if (changes.monthlyPayment !== undefined) {
        changesArray.push({
          field: "monthlyPayment",
          oldValue: contract.monthlyPayment,
          newValue: changes.monthlyPayment,
          difference: changes.monthlyPayment - contract.monthlyPayment,
        });
      }

      if (changes.initialPayment !== undefined) {
        changesArray.push({
          field: "initialPayment",
          oldValue: contract.initialPayment,
          newValue: changes.initialPayment,
          difference: changes.initialPayment - contract.initialPayment,
        });
      }

      if (changes.totalPrice !== undefined) {
        changesArray.push({
          field: "totalPrice",
          oldValue: contract.totalPrice,
          newValue: changes.totalPrice,
          difference: changes.totalPrice - contract.totalPrice,
        });
      }

      const Payment = (await import("../../schemas/payment.schema")).default;
      const { PaymentType } = await import("../../schemas/payment.schema");
      
      const impact = {
        underpaidCount: 0,
        overpaidCount: 0,
        totalShortage: 0,
        totalExcess: 0,
        additionalPaymentsCreated: 0,
      };

      const monthlyPaymentChange = changesArray.find(
        (c) => c.field === "monthlyPayment"
      );

      if (monthlyPaymentChange) {
        const paidMonthlyPayments = await Payment.find({
          _id: { $in: contract.payments },
          paymentType: PaymentType.MONTHLY,
          isPaid: true,
        });

        for (const payment of paidMonthlyPayments) {
          const diff = payment.amount - monthlyPaymentChange.newValue;

          if (diff < -0.01) {
            const shortage = Math.abs(diff);
            impact.underpaidCount++;
            impact.totalShortage += shortage;
            impact.additionalPaymentsCreated++;
          } else if (diff > 0.01) {
            const excess = diff;
            impact.overpaidCount++;
            impact.totalExcess += excess;
          }
        }
      }

      return {
        success: true,
        changes: changesArray,
        impact,
      };
    } catch (error) {
      logger.error("❌ Error analyzing impact:", error);
      throw error;
    }
  }

  
  async create(data: CreateContractDto, user: IJwtUser) {
    try {
      logger.debug("🚀 === CONTRACT CREATION STARTED ===");
      logger.debug("📋 Input data:", {
        customer: data.customer,
        productName: data.productName,
        initialPayment: data.initialPayment,
        totalPrice: data.totalPrice,
      });

      const {
        customer,
        productName,
        originalPrice,
        price,
        initialPayment,
        percentage,
        period,
        monthlyPayment,
        initialPaymentDueDate,
        notes,
        totalPrice,
        box,
        mbox,
        receipt,
        iCloud,
        startDate,
      } = data;

      const createBy = await Employee.findById(user.sub);
      if (!createBy) {
        throw BaseError.ForbiddenError("Mavjud bo'lmagan xodim");
      }
      logger.debug("👤 Employee found:", createBy._id);

      const customerDoc = await Customer.findById(customer);
      if (!customerDoc) {
        throw BaseError.NotFoundError("Mijoz topilmadi");
      }
      logger.debug("🤝 Customer found:", customerDoc._id);

      const newNotes = new Notes({
        text: notes || "Shartnoma yaratildi",
        customer,
        createBy: createBy._id,
      });
      await newNotes.save();
      logger.info("📝 Notes created:", newNotes._id);

      const contractStartDate = startDate ? new Date(startDate) : new Date();

      const nextPaymentDate = new Date(contractStartDate);
      nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);

      const contract = new Contract({
        customer,
        productName,
        originalPrice,
        price,
        initialPayment,
        percentage,
        period,
        monthlyPayment,
        initialPaymentDueDate: contractStartDate,
        notes: newNotes._id,
        totalPrice,
        startDate: contractStartDate,
        nextPaymentDate: nextPaymentDate,
        isActive: true,
        createBy: createBy._id,
        info: {
          box: box || false,
          mbox: mbox || false,
          receipt: receipt || false,
          iCloud: iCloud || false,
        },
        payments: [],
        isDeclare: false,
        status: ContractStatus.ACTIVE,
      });

      await contract.save();
      logger.debug("📋 Contract created:", contract._id);

      if (initialPayment && initialPayment > 0) {
        await contractPaymentHelper.createInitialPayment(
          contract,
          initialPayment,
          user
        );

        await contractBalanceHelper.updateBalance(createBy._id, {
          dollar: initialPayment,
          sum: 0,
        });
        logger.debug("💵 Balance updated with initial payment:", initialPayment);
      }

      logger.debug("🎉 === CONTRACT CREATION COMPLETED ===");
      return {
        message: "Shartnoma yaratildi.",
        contractId: contract._id,
      };
    } catch (error) {
      logger.error("❌ === CONTRACT CREATION FAILED ===");
      logger.error("Error:", error);
      throw error;
    }
  }

  
  async sellerCreate(data: CreateContractDto, user: IJwtUser) {
    try {
      logger.debug("🚀 === SELLER CONTRACT CREATION STARTED ===");

      const {
        customer,
        productName,
        originalPrice,
        price,
        initialPayment,
        percentage,
        period,
        monthlyPayment,
        initialPaymentDueDate,
        notes,
        totalPrice,
        box,
        mbox,
        receipt,
        iCloud,
        startDate,
      } = data;

      const createBy = await Employee.findById(user.sub);
      if (!createBy) {
        throw BaseError.ForbiddenError("Mavjud bo'lmagan xodim");
      }

      const customerDoc = await Customer.findById(customer);
      if (!customerDoc) {
        throw BaseError.NotFoundError("Mijoz topilmadi");
      }

      const newNotes = new Notes({
        text: notes || "Shartnoma yaratildi (Sotuvchi)",
        customer,
        createBy: createBy._id,
      });
      await newNotes.save();

      const contractStartDate = startDate ? new Date(startDate) : new Date();
      const nextPaymentDate = new Date(contractStartDate);
      nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);

      const contract = new Contract({
        customer,
        productName,
        originalPrice,
        price,
        initialPayment,
        percentage,
        period,
        monthlyPayment,
        initialPaymentDueDate: contractStartDate,
        notes: newNotes._id,
        totalPrice,
        startDate: contractStartDate,
        nextPaymentDate: nextPaymentDate,
        isActive: false,
        createBy: createBy._id,
        info: {
          box: box || false,
          mbox: mbox || false,
          receipt: receipt || false,
          iCloud: iCloud || false,
        },
        payments: [],
        isDeclare: false,
        status: ContractStatus.ACTIVE,
      });

      await contract.save();

      logger.debug("🎉 === SELLER CONTRACT CREATION COMPLETED ===");
      return {
        message: "Shartnoma yaratildi. Tasdiqlashni kutmoqda.",
        contractId: contract._id,
      };
    } catch (error) {
      logger.error("❌ === SELLER CONTRACT CREATION FAILED ===");
      throw error;
    }
  }

  
  async approveContract(contractId: string, user: IJwtUser) {
    try {
      logger.debug("✅ === CONTRACT APPROVAL STARTED ===");

      const contract = await Contract.findById(contractId).populate("customer");
      if (!contract) {
        throw BaseError.NotFoundError("Shartnoma topilmadi");
      }

      if (contract.isActive) {
        throw BaseError.BadRequest("Shartnoma allaqachon tasdiqlangan");
      }

      contract.isActive = true;
      await contract.save();

      if (contract.initialPayment && contract.initialPayment > 0) {
        await contractPaymentHelper.createInitialPayment(
          contract,
          contract.initialPayment,
          user
        );

        const employee = await Employee.findById(user.sub);
        if (employee) {
          await contractBalanceHelper.updateBalance(employee._id, {
            dollar: contract.initialPayment,
            sum: 0,
          });
        }
      }

      logger.debug("🎉 === CONTRACT APPROVAL COMPLETED ===");
      return {
        message: "Shartnoma tasdiqlandi",
        contractId: contract._id,
      };
    } catch (error) {
      logger.error("❌ === CONTRACT APPROVAL FAILED ===");
      throw error;
    }
  }
}

export default new ContractService();
