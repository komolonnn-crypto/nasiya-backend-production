import { Request, Response, NextFunction } from "express";

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { handleValidationErrors } from "../../validators/format";
import {
  CreateContractDto,
  UpdateContractDto,
} from "../../validators/contract";

import BaseError from "../../utils/base.error";
import contractService from "../services/contract.service";

class ContractController {
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await contractService.getAll();
      res.status(200).json(data);
    } catch (error) {
      return next(error);
    }
  }

  async getNewAll(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await contractService.getAllNewContract();
      res.status(200).json(data);
    } catch (error) {
      return next(error);
    }
  }

  async getAllCompleted(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await contractService.getAllCompleted();
      res.status(200).json(data);
    } catch (error) {
      return next(error);
    }
  }

  async getContractById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id;
      const data = await contractService.getContractById(id);
      res.status(200).json(data);
    } catch (error) {
      return next(error);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user;
      const contractData = plainToInstance(CreateContractDto, req.body || {});
      const errors = await validate(contractData);

      if (errors.length > 0) {
        const formattedErrors = handleValidationErrors(errors);
        return next(
          BaseError.BadRequest("Shartnoma ma'lumotlari xato.", formattedErrors),
        );
      }

      const data = await contractService.create(contractData, user);
      res.status(201).json(data);
    } catch (error) {
      return next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user;
      if (!user) {
        return next(
          BaseError.UnauthorizedError(
            "Foydalanuvchi autentifikatsiya qilinmagan",
          ),
        );
      }

      const contractData = plainToInstance(UpdateContractDto, req.body || {});
      const errors = await validate(contractData);

      if (errors.length > 0) {
        const formattedErrors = handleValidationErrors(errors);
        return next(
          BaseError.BadRequest("Shartnoma ma'lumotlari xato.", formattedErrors),
        );
      }

      const result = await contractService.update(contractData, user);

      const response = {
        success: true,
        message: result.message,
        data: {
          changes: result.changes,
          impactSummary: {
            underpaidCount: result.impactSummary.underpaidCount,
            overpaidCount: result.impactSummary.overpaidCount,
            totalShortage: result.impactSummary.totalShortage,
            totalExcess: result.impactSummary.totalExcess,
            additionalPaymentsCreated:
              result.impactSummary.additionalPaymentsCreated,
          },
          affectedPaymentsCount: result.affectedPayments,
        },
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      return next(error);
    }
  }

  async sellerCreate(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user;
      const contractData = plainToInstance(CreateContractDto, req.body || {});
      const errors = await validate(contractData);
      if (errors.length > 0) {
        const formattedErrors = handleValidationErrors(errors);
        return next(
          BaseError.BadRequest("Shartnoma ma'lumotlari xato.", formattedErrors),
        );
      }
      const data = await contractService.sellerCreate(contractData, user);
      res.status(201).json(data);
    } catch (error) {
      return next(error);
    }
  }

  async approveContract(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const user = req.user;
      const data = await contractService.approveContract(id, user);
      res.status(200).json(data);
    } catch (error) {
      return next(error);
    }
  }

  
  async analyzeImpact(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { monthlyPayment, initialPayment, totalPrice } = req.body;

      if (!monthlyPayment || monthlyPayment < 0) {
        throw BaseError.BadRequest("Oylik to'lov noto'g'ri");
      }

      if (initialPayment !== undefined && initialPayment < 0) {
        throw BaseError.BadRequest("Boshlang'ich to'lov noto'g'ri");
      }

      if (totalPrice !== undefined && totalPrice <= initialPayment) {
        throw BaseError.BadRequest(
          "Umumiy narx boshlang'ich to'lovdan katta bo'lishi kerak",
        );
      }

      const result = await contractService.analyzeContractEditImpact(id, {
        monthlyPayment,
        initialPayment,
        totalPrice,
      });

      res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  }

  
  async deleteContract(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const user = req.user;

      if (!user) {
        return next(
          BaseError.UnauthorizedError(
            "Foydalanuvchi autentifikatsiya qilinmagan",
          ),
        );
      }

      const result = await contractService.deleteContract(id, user);

      res.status(200).json({
        success: true,
        message: result.message,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return next(error);
    }
  }

  async hardDeleteContract(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const user = req.user;

      if (!user) {
        return next(
          BaseError.UnauthorizedError(
            "Foydalanuvchi autentifikatsiya qilinmagan",
          ),
        );
      }

      const result = await contractService.hardDeleteContract(id, user);

      res.status(200).json({
        success: true,
        message: result.message,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return next(error);
    }
  }

  async bulkHardDeleteContracts(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { contractIds } = req.body;
      const user = req.user;

      if (!user) {
        return next(
          BaseError.UnauthorizedError(
            "Foydalanuvchi autentifikatsiya qilinmagan",
          ),
        );
      }

      if (!Array.isArray(contractIds) || contractIds.length === 0) {
        return next(
          BaseError.BadRequest("contractIds bo'sh bo'lishi mumkin emas"),
        );
      }

      const results: { id: string; success: boolean; message: string }[] = [];
      const errors: { id: string; success: boolean; message: string }[] = [];

      for (const id of contractIds) {
        try {
          const result = await contractService.hardDeleteContract(id, user);
          results.push({ id, success: true, message: result.message });
        } catch (err: any) {
          errors.push({ id, success: false, message: err.message });
        }
      }

      res.status(200).json({
        success: true,
        message: `${results.length} ta shartnoma o'chirildi`,
        data: { results, errors },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return next(error);
    }
  }
}

export default new ContractController();
