

import mongoose from "mongoose";
import Contract, { ContractStatus } from "../schemas/contract.schema";
import Payment, { PaymentStatus, PaymentType } from "../schemas/payment.schema";
import Customer from "../schemas/customer.schema";
import Employee from "../schemas/employee.schema";
import "dotenv/config";

async function createTestData() {
  try {
    const mongoUri = process.env.MONGO_DB || "mongodb://localhost:27017/nasiya_db";
    await mongoose.connect(mongoUri);
    console.log("✅ Connected to MongoDB");

    let manager = await Employee.findOne({ role: "manager" });
    if (!manager) {
      console.log("❌ Manager topilmadi. Iltimos avval manager yarating.");
      process.exit(1);
    }
    console.log(`✅ Manager: ${manager.firstName} (${manager._id})`);

    const customer = await Customer.create({
      firstName: "TEST",
      lastName: "ORTIQCHA TO'LOV",
      phone: "+998901234567",
      address: "Test address",
      passport: "AA1234567",
      managerId: manager._id,
    });
    console.log(`✅ Customer created: ${customer._id}`);

    const contract = await Contract.create({
      customer: customer._id,
      productName: "TEST MAHSULOT (Ortiqcha to'lov test)",
      productPrice: 1000,
      salePrice: 1200,
      initialPayment: 0,
      monthlyPayment: 100,
      period: 12,
      totalPrice: 1200,
      remainingAmount: 1200,
      status: ContractStatus.ACTIVE,
      managerId: manager._id,
      startDate: new Date(),
      nextPaymentDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      payments: [],
    });
    console.log(`✅ Contract created: ${contract._id}`);
    console.log(`   Product: ${contract.productName}`);
    console.log(`   Monthly: ${contract.monthlyPayment}$`);
    console.log(`   Period: ${contract.period} months`);
    console.log(`   Total: ${contract.totalPrice}$`);

    const payment1 = await Payment.create({
      amount: 100,
      actualAmount: 100,
      date: new Date(),
      isPaid: true,
      paymentType: PaymentType.MONTHLY,
      customerId: customer._id,
      managerId: manager._id,
      status: PaymentStatus.PAID,
      expectedAmount: 100,
      targetMonth: 1,
      confirmedAt: new Date(),
      confirmedBy: manager._id,
    });

    const payment2 = await Payment.create({
      amount: 100,
      actualAmount: 100,
      date: new Date(),
      isPaid: true,
      paymentType: PaymentType.MONTHLY,
      customerId: customer._id,
      managerId: manager._id,
      status: PaymentStatus.PAID,
      expectedAmount: 100,
      targetMonth: 2,
      confirmedAt: new Date(),
      confirmedBy: manager._id,
    });

    contract.payments = [payment1._id.toString(), payment2._id.toString()] as any;
    await contract.save();

    console.log(`✅ Created 2 paid payments (1-oy, 2-oy)`);

    console.log("\n" + "=".repeat(60));
    console.log("🎯 TEST DATA TAYYOR!");
    console.log("=".repeat(60));
    console.log("\n📋 TEST QILISH:");
    console.log("\n1. Bot'dan kirish:");
    console.log(`   Manager: ${(manager as any).phone || manager.firstName}`);
    console.log("\n2. Mijozni topish:");
    console.log(`   Ism: TEST ORTIQCHA TO'LOV`);
    console.log(`   Telefon: +998901234567`);
    console.log("\n3. Shartnomani ochish:");
    console.log(`   Mahsulot: TEST MAHSULOT`);
    console.log(`   Oylik: 100$`);
    console.log(`   To'langan: 2/12 oy (200$)`);
    console.log(`   Qolgan: 1,000$`);
    console.log("\n4. TEST SCENARIO:");
    console.log(`   3-oy uchun 250$ to'lang (100$ kerak)`);
    console.log(`   Ortiqcha: 150$`);
    console.log("\n5. KUTILAYOTGAN NATIJA:");
    console.log(`   3-oy: 100$ TO'LANDI`);
    console.log(`   4-oy: 100$ TO'LANDI (prepaid)`);
    console.log(`   5-oy: 50$ TO'LANDI (prepaid, kam)`);
    console.log(`   JAMI: 250$ ✅`);
    console.log("\n6. Server log'larni kuzating:");
    console.log(`   cd nasiya-server && NODE_ENV=development pnpm dev`);
    console.log("\n" + "=".repeat(60));

    console.log("\n📝 Database IDs:");
    console.log(`   Customer ID: ${customer._id}`);
    console.log(`   Contract ID: ${contract._id}`);
    console.log(`   Manager ID: ${manager._id}`);

    console.log("\n✅ Test data successfully created!");
    console.log("\nCLEANUP (agar kerak bo'lsa):");
    console.log(`   mongo nasiya_db`);
    console.log(`   db.customers.deleteOne({ _id: ObjectId("${customer._id}") })`);
    console.log(`   db.contracts.deleteOne({ _id: ObjectId("${contract._id}") })`);
    console.log(`   db.payments.deleteMany({ customerId: ObjectId("${customer._id}") })`);

  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await mongoose.disconnect();
    console.log("\n✅ Disconnected from MongoDB");
  }
}

createTestData();
