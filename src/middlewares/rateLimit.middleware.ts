import { Request, Response, NextFunction } from "express";
import BaseError from "../utils/base.error";
import logger from "../utils/logger";

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

const store: RateLimitStore = {};

export const rateLimit = (maxRequests: number, windowMs: number) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      const now = Date.now();

      if (!store[ip] || store[ip].resetTime < now) {
        store[ip] = {
          count: 1,
          resetTime: now + windowMs,
        };
        return next();
      }

      store[ip].count++;

      if (store[ip].count > maxRequests) {
        const retryAfter = Math.ceil((store[ip].resetTime - now) / 1000);

        logger.warn(`⚠️ Rate limit exceeded for IP: ${ip}`);

        res.setHeader("Retry-After", retryAfter.toString());
        res.setHeader("X-RateLimit-Limit", maxRequests.toString());
        res.setHeader("X-RateLimit-Remaining", "0");
        res.setHeader(
          "X-RateLimit-Reset",
          new Date(store[ip].resetTime).toISOString()
        );

        return next(
          BaseError.TooManyRequests(
            `Juda ko'p so'rov yuborildi. ${retryAfter} soniyadan keyin qayta urinib ko'ring.`
          )
        );
      }

      res.setHeader("X-RateLimit-Limit", maxRequests.toString());
      res.setHeader(
        "X-RateLimit-Remaining",
        (maxRequests - store[ip].count).toString()
      );
      res.setHeader(
        "X-RateLimit-Reset",
        new Date(store[ip].resetTime).toISOString()
      );

      next();
    } catch (error) {
      logger.error("❌ Error in rate limit middleware:", error);
      next(error);
    }
  };
};

setInterval(() => {
  const now = Date.now();
  Object.keys(store).forEach((ip) => {
    if (store[ip].resetTime < now) {
      delete store[ip];
    }
  });
}, 60000);
