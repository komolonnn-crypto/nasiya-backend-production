import mongoose from "mongoose";
import logger from "../utils/logger";

export const up = async () => {
  try {
    logger.info("🔄 Running migration 010: Add paymentMethod field");

    const db = mongoose.connection.db;
    if (!db) {
      throw new Error("Database connection not established");
    }

    const paymentsCollection = db.collection("payments");

    const result = await paymentsCollection.updateMany(
      { paymentMethod: { $exists: false } },
      { $set: { paymentMethod: null } }
    );

    logger.info(`✅ Migration 010 completed: Updated ${result.modifiedCount} payments`);
  } catch (error) {
    logger.error("❌ Migration 010 failed:", error);
    throw error;
  }
};

export const down = async () => {
  try {
    logger.info("🔄 Rolling back migration 010");

    const db = mongoose.connection.db;
    if (!db) {
      throw new Error("Database connection not established");
    }

    const paymentsCollection = db.collection("payments");

    const result = await paymentsCollection.updateMany(
      {},
      { $unset: { paymentMethod: "" } }
    );

    logger.info(`✅ Migration 010 rollback completed: ${result.modifiedCount} payments updated`);
  } catch (error) {
    logger.error("❌ Migration 010 rollback failed:", error);
    throw error;
  }
};
