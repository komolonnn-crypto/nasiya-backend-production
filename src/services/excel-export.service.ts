import ExcelJS from "exceljs";
import * as fs from "fs";
import * as path from "path";
import logger from "../utils/logger";
import Customer from "../schemas/customer.schema";
import Contract from "../schemas/contract.schema";
import Payment, { PaymentType } from "../schemas/payment.schema";
import Employee from "../schemas/employee.schema";
import dayjs from "dayjs";

class ExcelExportService {
  private exportDir = path.join(process.cwd(), "exports");

  constructor() {
    if (!fs.existsSync(this.exportDir)) {
      fs.mkdirSync(this.exportDir, { recursive: true });
    }
  }

  
  async exportDatabase(): Promise<{ success: boolean; filePath?: string; message: string }> {
    try {
      logger.info("📊 Starting Excel export...");

      const contracts = await Contract.find({
        isDeleted: false,
      })
        .populate("customer")
        .populate("payments")
        .lean();

      if (contracts.length === 0) {
        return {
          success: false,
          message: "Export qilish uchun shartnomalar topilmadi",
        };
      }

      logger.info(`✅ Found ${contracts.length} contract(s) to export`);

      const excelData: any[] = [];

      const headerRow1 = [
        "startDate",
        "initialPaymentDueDate",
        "nextPaymentDate",
        "customer",
        "productName",
        "ID",
        "originalPrice",
        "price",
        "initialPayment",
        "period",
        "monthlyPayment",
        "totalPrice",
        "percentage",
        "notes",
        "box",
        "mbox",
      ];

      const headerRow2 = [
        "Chiqqan sana",
        "To'lov kuni",
        "To'lov sanasi",
        "Kimga",
        "Texnika",
        "Shartnoma ID raqami",
        "Tani",
        "Etilgan",
        "1-vznos",
        "Oy",
        "Oyiga",
        "Umumiy summa",
        "foiz",
        "izoh",
        "Karobka",
        "Muslim Karobka",
      ];

      let minDate: Date | null = null;
      let maxDate: Date | null = null;

      for (const contract of contracts) {
        const payments = (contract.payments as any[]).filter(
          (p) => p.paymentType === PaymentType.MONTHLY && p.isPaid
        );

        for (const payment of payments) {
          const date = new Date(payment.date);
          if (!minDate || date < minDate) minDate = date;
          if (!maxDate || date > maxDate) maxDate = date;
        }
      }

      const monthColumns: string[] = [];
      if (minDate && maxDate) {
        let current = dayjs(minDate).startOf("month");
        const end = dayjs(maxDate).startOf("month");

        while (current.isBefore(end) || current.isSame(end)) {
          monthColumns.push(current.format("MM/YYYY"));
          current = current.add(1, "month");
        }
      }

      headerRow1.push(...monthColumns);

      const emptyMonthHeaders = monthColumns.map(() => "");
      headerRow2.push(...emptyMonthHeaders);

      excelData.push(headerRow1);
      excelData.push(headerRow2);

      for (const contract of contracts) {
        const customer = contract.customer as any;
        const contractAny = contract as any;

        const monthlyPayment = Math.round(contract.monthlyPayment || 0);
        const totalPrice = Math.round((contract.initialPayment || 0) + (monthlyPayment * (contract.period || 12)));

        const paymentDay = contract.originalPaymentDay || dayjs(contract.startDate).date();

        const nextPaymentDate = dayjs(contract.nextPaymentDate).format("DD/MM/YYYY");

        const row: any[] = [
          dayjs(contract.startDate).format("DD/MM/YYYY"),
          paymentDay,
          nextPaymentDate,
          customer?.fullName || "Unknown",
          contract.productName || "",
          contract.customId || "",
          Math.round(contract.originalPrice || 0),
          Math.round(contract.price || 0),
          Math.round(contract.initialPayment || 0),
          contract.period || 12,
          monthlyPayment,
          totalPrice,
          contract.percentage || 30,
          "",
          contractAny.box ? "bor" : "",
          contractAny.mbox ? "bor" : "",
        ];

        const payments = (contract.payments as any[]).filter(
          (p) => p.paymentType === PaymentType.MONTHLY && p.isPaid
        );

        for (const monthCol of monthColumns) {
          const payment = payments.find((p) => {
            const paymentMonth = dayjs(p.date).format("MM/YYYY");
            return paymentMonth === monthCol;
          });

          row.push(payment ? Math.round(payment.actualAmount || payment.amount || 0) : "");
        }

        excelData.push(row);
      }

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Shartnomalar");

      excelData.forEach(row => {
        worksheet.addRow(row);
      });

      worksheet.columns = [
        { width: 12 },
        { width: 8 },
        { width: 12 },
        { width: 25 },
        { width: 35 },
        { width: 12 },
        { width: 12 },
        { width: 10 },
        { width: 12 },
        { width: 8 },
        { width: 12 },
        { width: 12 },
        { width: 8 },
        { width: 15 },
        { width: 10 },
        { width: 15 },
        ...monthColumns.map(() => ({ width: 10 })),
      ];

      const headerRow1Cells = worksheet.getRow(1);
      headerRow1Cells.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF4472C4' }
        };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });

      const headerRow2Cells = worksheet.getRow(2);
      headerRow2Cells.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFB4C7E7' }
        };
        cell.font = { bold: true };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });

      for (let i = 3; i <= worksheet.rowCount; i++) {
        const cell = worksheet.getCell(i, 4);
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFF2CC' }
        };
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
      }

      for (let i = 3; i <= worksheet.rowCount; i++) {
        const cell = worksheet.getCell(i, 12);
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFC6EFCE' }
        };
        cell.font = { bold: true };
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      }

      const timestamp = dayjs().format("YYYY-MM-DD_HH-mm-ss");
      const fileName = `database-backup-${timestamp}.xlsx`;
      const filePath = path.join(this.exportDir, fileName);

      await workbook.xlsx.writeFile(filePath);

      logger.info(`✅ Excel export completed: ${fileName}`);

      return {
        success: true,
        filePath,
        message: `${contracts.length} ta shartnoma export qilindi`,
      };
    } catch (error: any) {
      logger.error("❌ Excel export failed:", error.message);
      return {
        success: false,
        message: `Export failed: ${error.message}`,
      };
    }
  }

  
  async cleanOldExports(): Promise<void> {
    try {
      const files = fs.readdirSync(this.exportDir)
        .filter(file => file.endsWith(".xlsx"))
        .map(file => ({
          name: file,
          path: path.join(this.exportDir, file),
          time: fs.statSync(path.join(this.exportDir, file)).mtime.getTime(),
        }))
        .sort((a, b) => b.time - a.time);

      const filesToDelete = files.slice(5);

      for (const file of filesToDelete) {
        fs.unlinkSync(file.path);
        logger.debug(`🗑️ Deleted old export: ${file.name}`);
      }

      if (filesToDelete.length > 0) {
        logger.info(`🧹 Cleaned ${filesToDelete.length} old export(s)`);
      }
    } catch (error: any) {
      logger.error("❌ Failed to clean old exports:", error.message);
    }
  }
}

export default new ExcelExportService();
