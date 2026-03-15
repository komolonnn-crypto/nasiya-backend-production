

import Payment, { PaymentType } from "../schemas/payment.schema";
import Contract from "../schemas/contract.schema";

async function addTargetMonthToPayments() {
  try {
    console.log("🚀 Starting migration: Add targetMonth to payments");

    const payments = await Payment.find({
      targetMonth: { $exists: false },
    }).sort({ date: 1 });

    console.log(`📊 Found ${payments.length} payments without targetMonth`);

    let updatedCount = 0;
    let errorCount = 0;

    for (const payment of payments) {
      try {
        const contract = await Contract.findOne({
          payments: payment._id,
        });

        if (!contract) {
          console.warn(`⚠️ Contract not found for payment ${payment._id}`);
          
          const contractByCustomer = await Contract.findOne({
            customer: payment.customerId,
            status: "active",
          }).sort({ createdAt: -1 });

          if (!contractByCustomer) {
            console.error(`❌ No contract found for payment ${payment._id}`);
            errorCount++;
            continue;
          }

          console.log(`✅ Found contract by customer for payment ${payment._id}`);
        }

        const activeContract = contract || await Contract.findOne({
          customer: payment.customerId,
          status: "active",
        }).sort({ createdAt: -1 });

        if (!activeContract) {
          errorCount++;
          continue;
        }

        const allPayments = await Payment.find({
          _id: { $in: activeContract.payments },
          paymentType: PaymentType.MONTHLY,
        }).sort({ date: 1 });

        const paymentIndex = allPayments.findIndex(
          (p) => p._id.toString() === payment._id.toString()
        );

        if (paymentIndex === -1) {
          console.warn(`⚠️ Payment ${payment._id} not found in contract payments`);
          const contractStartDate = new Date(activeContract.startDate);
          const paymentDate = new Date(payment.date);
          
          const monthsDiff = 
            (paymentDate.getFullYear() - contractStartDate.getFullYear()) * 12 +
            (paymentDate.getMonth() - contractStartDate.getMonth());
          
          payment.targetMonth = Math.max(1, monthsDiff + 1);
        } else {
          payment.targetMonth = paymentIndex + 1;
        }

        await payment.save();
        updatedCount++;

        console.log(`✅ Updated payment ${payment._id} with targetMonth: ${payment.targetMonth}`);
      } catch (error) {
        console.error(`❌ Error processing payment ${payment._id}:`, error);
        errorCount++;
      }
    }

    console.log("\n🎉 Migration completed!");
    console.log(`✅ Successfully updated: ${updatedCount} payments`);
    console.log(`❌ Errors: ${errorCount} payments`);

    return {
      success: true,
      updated: updatedCount,
      errors: errorCount,
    };
  } catch (error) {
    console.error("❌ Migration failed:", error);
    throw error;
  }
}

if (require.main === module) {
  const mongoose = require("mongoose");
  
  const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/nasiya";
  
  mongoose
    .connect(MONGODB_URI)
    .then(async () => {
      console.log("✅ Connected to MongoDB");
      await addTargetMonthToPayments();
      await mongoose.disconnect();
      console.log("✅ Disconnected from MongoDB");
      process.exit(0);
    })
    .catch((error: Error) => {
      console.error("❌ MongoDB connection error:", error);
      process.exit(1);
    });
}

export default addTargetMonthToPayments;
