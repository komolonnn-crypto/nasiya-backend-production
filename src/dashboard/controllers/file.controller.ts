import { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import BaseError from "../../utils/base.error";

class FileController {
  async downloadFile(req: Request, res: Response, next: NextFunction) {
    try {
      const { type, filename } = req.params;

      const allowedTypes = ["passport", "shartnoma", "photo"];
      if (!allowedTypes.includes(type)) {
        throw BaseError.BadRequest("Noto'g'ri fayl turi");
      }
      const filePath = path.join(__dirname, "../../../uploads", type, filename);

      if (!fs.existsSync(filePath)) {
        throw BaseError.NotFoundError("Fayl topilmadi");
      }

      const ext = path.extname(filename).toLowerCase();
      let contentType = "application/octet-stream";

      if (ext === ".pdf") {
        contentType = "application/pdf";
      } else if ([".jpg", ".jpeg"].includes(ext)) {
        contentType = "image/jpeg";
      } else if (ext === ".png") {
        contentType = "image/png";
      }

      res.setHeader("Content-Type", contentType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );

      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
    } catch (error) {
      return next(error);
    }
  }

  async deleteFile(req: Request, res: Response, next: NextFunction) {
    try {
      const { customerId, type } = req.params;

      const allowedTypes = ["passport", "shartnoma", "photo"];
      if (!allowedTypes.includes(type)) {
        throw BaseError.BadRequest("Noto'g'ri fayl turi");
      }

      const Customer = (await import("../../schemas/customer.schema")).default;

      const customer = await Customer.findById(customerId);
      if (!customer) {
        throw BaseError.NotFoundError("Mijoz topilmadi");
      }

      const fileField = type as "passport" | "shartnoma" | "photo";
      const filePath = customer.files?.[fileField];

      if (!filePath) {
        throw BaseError.NotFoundError("Fayl topilmadi");
      }

      const fullPath = path.join(__dirname, "../../../", filePath);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }

      if (customer.files) {
        customer.files[fileField] = undefined;
        await customer.save();
      }

      res.json({ message: "Fayl o'chirildi" });
    } catch (error) {
      return next(error);
    }
  }
}

export default new FileController();
