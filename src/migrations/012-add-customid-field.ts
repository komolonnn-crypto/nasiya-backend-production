import { MongoClient } from "mongodb";
import logger from "../utils/logger";

const MONGO_URL = process.env.MONGO_DB || "mongodb://localhost:27017/nasiya_db";

async function migrate() {
  const client = new MongoClient(MONGO_URL);

  try {
    await client.connect();
    const db = client.db();
    const contractsCollection = db.collection("contracts");

    logger.info("🔄 Migration 012: Adding customId field to contracts...");

    const contracts = await contractsCollection.find({}).toArray();
    logger.info(`Found ${contracts.length} contracts`);

    let updated = 0;
    for (let i = 0; i < contracts.length; i++) {
      const contract = contracts[i];

      if (contract.customId) {
        logger.debug(`  ✓ Contract ${contract._id} already has customId: ${contract.customId}`);
        continue;
      }

      const year = new Date().getFullYear().toString().slice(-2);
      const sequence = String(i + 1).padStart(5, "0");
      const customId = `${year}T${sequence}`;

      await contractsCollection.updateOne(
        { _id: contract._id },
        { $set: { customId } }
      );

      updated++;
      logger.debug(`  ✓ Updated contract ${contract._id} with customId: ${customId}`);
    }

    logger.info(`✅ Migration completed: ${updated} contracts updated`);
  } catch (error) {
    logger.error("❌ Migration failed:", error);
    throw error;
  } finally {
    await client.close();
  }
}

migrate().catch((error) => {
  logger.error("Migration error:", error);
  process.exit(1);
});
