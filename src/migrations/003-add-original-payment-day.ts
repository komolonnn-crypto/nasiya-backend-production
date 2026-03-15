import mongoose from "mongoose";
import Contract from "../schemas/contract.schema";

export async function up() {
    console.log("🔄 Migration UP: Adding originalPaymentDay to contracts...");

    try {
        const contracts = await Contract.find({
            status: "active",
            nextPaymentDate: { $exists: true },
        });

        console.log(`📊 Found ${contracts.length} contracts to update`);

        let updated = 0;
        for (const contract of contracts) {
            if (!contract.originalPaymentDay && contract.nextPaymentDate) {
                const paymentDay = new Date(contract.nextPaymentDate).getDate();
                contract.originalPaymentDay = paymentDay;
                await contract.save();
                updated++;

                if (updated % 100 === 0) {
                    console.log(`✅ Updated ${updated} contracts...`);
                }
            }
        }

        console.log(`✅ Migration UP completed: ${updated} contracts updated`);
    } catch (error) {
        console.error("❌ Migration UP failed:", error);
        throw error;
    }
}

export async function down() {
    console.log("🔄 Migration DOWN: Removing originalPaymentDay from contracts...");

    try {
        const result = await Contract.updateMany(
            {},
            { $unset: { originalPaymentDay: "" } }
        );

        console.log(`✅ Migration DOWN completed: ${result.modifiedCount} contracts updated`);
    } catch (error) {
        console.error("❌ Migration DOWN failed:", error);
        throw error;
    }
}
