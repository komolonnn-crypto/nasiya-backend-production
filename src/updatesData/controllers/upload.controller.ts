import { Request, Response } from "express";
import { importContractsFromCSV } from "../services/upload.service";
import logger from "../../utils/logger";

export const uploadContracts = async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ message: "Fayl topilmadi" });
  }

  try {
    const result = await importContractsFromCSV(req.file.path);
    res
      .status(201)
      .json({ message: "Ma'lumotlar qo‘shildi", count: result.length });
  } catch (err) {
    logger.error("Xatolik:", err);
    res.status(500).json({ message: "Ichki xatolik", error: err });
  }
};
