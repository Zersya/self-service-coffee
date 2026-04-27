import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
import { db } from "./src/db";
import { orders, configs, disbursements } from "./src/db/schema";
import { eq, desc, sql } from "drizzle-orm";

dotenv.config();

async function verifyTurnstileToken(token: string, ip?: string): Promise<boolean> {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    // If no secret key is configured, assume Turnstile is disabled and let it pass
    console.warn("Turnstile secret key not configured, skipping verification");
    return true;
  }
  
  if (!token) return false;

  try {
    const formData = new URLSearchParams();
    formData.append('secret', secretKey);
    formData.append('response', token);
    if (ip) formData.append('remoteip', ip);

    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();
    return data.success;
  } catch (error) {
    console.error("Turnstile verification error:", error);
    return false;
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Trust proxy if you are behind a reverse proxy (like Nginx/Cloudflare) to get the correct IP
  app.set('trust proxy', 1);
  app.use(express.json());

  // API Routes
  app.get("/api/config", (req, res) => {
    const config: any = {
      clientKey: (process.env.MIDTRANS_CLIENT_KEY || "").trim(),
      isProduction: process.env.MIDTRANS_IS_PRODUCTION === "true",
    };
    
    if (process.env.TURNSTILE_SITE_KEY) {
      config.turnstileSiteKey = process.env.TURNSTILE_SITE_KEY.trim();
    }
    
    res.json(config);
  });

  // Pricing endpoint - fetches from database or uses default
  app.get("/api/pricing", async (req, res) => {
    try {
      const DEFAULT_PRICE_PER_250G = 100000;
      
      let pricePer250g = DEFAULT_PRICE_PER_250G;
      
      if (db) {
        try {
          const configResult = await db.select().from(configs).where(eq(configs.key, 'PRICE_PER_250G'));
          if (configResult.length > 0) {
            const parsedValue = parseInt(configResult[0].value, 10);
            if (!isNaN(parsedValue) && parsedValue > 0) {
              pricePer250g = parsedValue;
            }
          }
        } catch (dbError) {
          console.error("Database error fetching pricing config:", dbError);
          // Fall back to default on DB error
        }
      }
      
      const pricePerGram = pricePer250g / 250;
      
      res.json({
        pricePer250g,
        pricePerGram
      });
    } catch (error) {
      console.error("Pricing endpoint error:", error);
      res.status(500).json({ error: "Failed to fetch pricing" });
    }
  });

  app.post("/api/charge", async (req, res) => {
    try {
      const { amount, grams, turnstileToken } = req.body;

      if (!amount || amount <= 0) {
        return res.status(400).json({ error: "Invalid amount" });
      }

      // Verify Turnstile token
      const isTurnstileValid = await verifyTurnstileToken(turnstileToken, req.ip);
      if (!isTurnstileValid) {
        return res.status(400).json({ error: "Invalid Turnstile token" });
      }

      const serverKey = (process.env.MIDTRANS_SERVER_KEY || "").trim();
      const isProduction = process.env.MIDTRANS_IS_PRODUCTION === "true";
      const snapApiUrl = isProduction
        ? "https://app.midtrans.com/snap/v1/transactions"
        : "https://app.sandbox.midtrans.com/snap/v1/transactions";

      if (!serverKey) {
        return res.status(500).json({ error: "Midtrans Server Key is not configured" });
      }

      const orderId = `coffee-${uuidv4()}`;
      const authString = Buffer.from(`${serverKey}:`).toString("base64");

      const response = await fetch(snapApiUrl, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "Authorization": `Basic ${authString}`,
        },
        body: JSON.stringify({
          transaction_details: {
            order_id: orderId,
            gross_amount: Math.round(amount),
          },
          enabled_payments: ["qris", "gopay", "shopeepay"],
          custom_field1: `Coffee: ${grams}g`,
          custom_field3: 'coffee-office',
        }),
      });

      const data = await response.json();

      if (data.error_messages) {
        console.error("Midtrans Snap Error:", JSON.stringify(data, null, 2));
        return res.status(400).json({ error: `Midtrans Error: ${data.error_messages.join(', ')}` });
      }

      if (db) {
        try {
          // Calculate MDR fee (0.7% of amount) and net amount
          const mdrFee = Math.round(amount * 0.007);
          const netAmount = amount - mdrFee;

          await db.insert(orders).values({
            orderId,
            amount: Math.round(amount),
            grams: grams.toString(),
            status: "pending",
            snapToken: data.token,
            mdrFee: mdrFee,
            netAmount: netAmount,
          });
        } catch (e) {
          console.error("DB Insert Error:", e);
        }
      }

      res.json({
        orderId,
        token: data.token,
        redirectUrl: data.redirect_url,
        amount: Math.round(amount),
        status: "pending",
      });
    } catch (error) {
      console.error("Charge Error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/status/:orderId", async (req, res) => {
    try {
      const { orderId } = req.params;

      const serverKey = (process.env.MIDTRANS_SERVER_KEY || "").trim();
      const isProduction = process.env.MIDTRANS_IS_PRODUCTION === "true";
      const apiUrl = isProduction
        ? "https://api.midtrans.com/v2"
        : "https://api.sandbox.midtrans.com/v2";

      if (!serverKey) {
        return res.status(500).json({ error: "Midtrans Server Key is not configured" });
      }

      const authString = Buffer.from(`${serverKey}:`).toString("base64");

      const response = await fetch(`${apiUrl}/${orderId}/status`, {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "Authorization": `Basic ${authString}`,
        },
      });

      const data = await response.json();

      const currentStatus = data.status_code === "404" ? "pending" : (data.transaction_status || "pending");

      if (db && data.status_code !== "404") {
        try {
          await db.update(orders)
            .set({ status: currentStatus })
            .where(eq(orders.orderId, orderId));
        } catch (e) {
          console.error("DB Update Error:", e);
        }
      }

      // If 404, it might mean the transaction was just created and not yet in the status API,
      // or it doesn't exist. Midtrans returns 404 for non-existent orders.
      if (data.status_code === "404") {
        return res.json({ status: "pending" }); // Treat as pending if not found immediately
      }

      res.json({
        orderId: data.order_id,
        status: currentStatus,
      });
    } catch (error) {
      console.error("Status Error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Cancel transaction endpoint
  app.post("/api/cancel/:orderId", async (req, res) => {
    try {
      const { orderId } = req.params;
      
      const serverKey = (process.env.MIDTRANS_SERVER_KEY || "").trim();
      const isProduction = process.env.MIDTRANS_IS_PRODUCTION === "true";
      const apiUrl = isProduction
        ? "https://api.midtrans.com/v2"
        : "https://api.sandbox.midtrans.com/v2";

      if (!serverKey) {
        return res.status(500).json({ error: "Midtrans Server Key is not configured" });
      }

      const authString = Buffer.from(`${serverKey}:`).toString("base64");

      // Call Midtrans cancel API
      const response = await fetch(`${apiUrl}/${orderId}/cancel`, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "Authorization": `Basic ${authString}`,
        },
      });

      const data = await response.json();

      // 200 = success, 412 = transaction already expired/cancelled
      if (data.status_code === "200" || data.status_code === "412") {
        const newStatus = "cancel";
        
        if (db) {
          try {
            await db.update(orders)
              .set({ status: newStatus })
              .where(eq(orders.orderId, orderId));
          } catch (e) {
            console.error("DB Update Error in cancel:", e);
          }
        }

        return res.json({ 
          success: true, 
          message: "Payment cancelled successfully",
          status: newStatus
        });
      } else {
        return res.status(400).json({ 
          success: false, 
          message: data.status_message || "Failed to cancel payment"
        });
      }
    } catch (error) {
      console.error("Cancel Error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Continue payment endpoint - creates NEW order with fresh token (Midtrans doesn't allow reusing order_id)
  app.post("/api/continue-payment/:orderId", async (req, res) => {
    console.log("[Continue Payment] Request for order:", req.params.orderId);
    
    try {
      const { orderId } = req.params;
      const { turnstileToken } = req.body;
      
      // Verify Turnstile token
      const isTurnstileValid = await verifyTurnstileToken(turnstileToken, req.ip);
      if (!isTurnstileValid) {
        return res.status(400).json({ error: "Invalid Turnstile token" });
      }

      if (!db) {
        console.log("[Continue Payment] Database not configured");
        return res.status(503).json({ error: "Database not configured" });
      }

      // Look up the existing order
      const existingOrders = await db.select().from(orders).where(eq(orders.orderId, orderId));
      if (existingOrders.length === 0) {
        console.log("[Continue Payment] Order not found:", orderId);
        return res.status(404).json({ error: "Order not found" });
      }

      const oldOrder = existingOrders[0];
      console.log("[Continue Payment] Found order:", oldOrder.orderId, "status:", oldOrder.status);
      
      // Only allow continuing for pending orders
      if (oldOrder.status !== "pending") {
        console.log("[Continue Payment] Order not pending:", oldOrder.status);
        return res.status(400).json({ error: `Cannot continue payment for ${oldOrder.status} order` });
      }

      const serverKey = (process.env.MIDTRANS_SERVER_KEY || "").trim();
      const isProduction = process.env.MIDTRANS_IS_PRODUCTION === "true";
      const snapApiUrl = isProduction
        ? "https://app.midtrans.com/snap/v1/transactions"
        : "https://app.sandbox.midtrans.com/snap/v1/transactions";

      if (!serverKey) {
        console.log("[Continue Payment] Server key not configured");
        return res.status(500).json({ error: "Midtrans Server Key is not configured" });
      }

      const authString = Buffer.from(`${serverKey}:`).toString("base64");

      // Create NEW order with fresh UUID (Midtrans doesn't allow reusing order_id)
      const newOrderId = `coffee-${uuidv4()}`;
      console.log("[Continue Payment] Creating new order:", newOrderId);

      const response = await fetch(snapApiUrl, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "Authorization": `Basic ${authString}`,
        },
        body: JSON.stringify({
          transaction_details: {
            order_id: newOrderId,
            gross_amount: oldOrder.amount,
          },
          enabled_payments: ["qris", "gopay", "shopeepay"],
          custom_field1: oldOrder.grams ? `Coffee: ${oldOrder.grams}g` : 'Coffee purchase',
          custom_field3: 'coffee-office',
        }),
      });

      const data = await response.json();
      console.log("[Continue Payment] Snap response status:", response.status);

      if (data.error_messages) {
        console.error("[Continue Payment] Midtrans Error:", JSON.stringify(data, null, 2));
        return res.status(400).json({ error: `Midtrans Error: ${data.error_messages.join(', ')}` });
      }

      // Calculate MDR fee (0.7% of amount) and net amount
      const mdrFee = Math.round(oldOrder.amount * 0.007);
      const netAmount = oldOrder.amount - mdrFee;

      // Insert NEW order into database with fresh token
      console.log("[Continue Payment] Inserting new order into database...");
      await db.insert(orders).values({
        orderId: newOrderId,
        amount: oldOrder.amount,
        grams: oldOrder.grams,
        status: "pending",
        snapToken: data.token,
        mdrFee,
        netAmount,
      });

      // Mark the old order as replaced
      console.log("[Continue Payment] Marking old order as replaced...");
      await db.update(orders)
        .set({ status: "replaced" })
        .where(eq(orders.orderId, orderId));

      console.log("[Continue Payment] Success! New order created:", newOrderId);
      res.json({
        orderId: newOrderId,
        oldOrderId: orderId,
        token: data.token,
        redirectUrl: data.redirect_url,
        grams: oldOrder.grams,
        amount: oldOrder.amount,
      });
    } catch (error) {
      console.error("[Continue Payment] Error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/history", async (req, res) => {
    if (!db) return res.status(503).json({ error: "Database not configured" });
    try {
      const history = await db.select().from(orders).orderBy(desc(orders.createdAt)).limit(50);
      res.json(history);
    } catch (e) {
      console.error("DB History Error:", e);
      res.status(500).json({ error: "Failed to fetch history" });
    }
  });

  app.get("/api/balance", async (req, res) => {
    if (!db) return res.status(503).json({ error: "Database not configured" });
    try {
      // Calculate total income from completed orders
      const incomeResult = await db.execute(sql`SELECT SUM(amount) as total FROM orders WHERE status IN ('settlement', 'capture')`);
      const totalIncome = incomeResult[0]?.total ? parseInt(incomeResult[0].total as string, 10) : 0;
      
      // Calculate total MDR fees from completed orders
      const mdrResult = await db.execute(sql`SELECT SUM(mdr_fee) as total FROM orders WHERE status IN ('settlement', 'capture')`);
      const totalMdrFees = mdrResult[0]?.total ? parseInt(mdrResult[0].total as string, 10) : 0;
      
      // Calculate total approved disbursements
      const disbursedResult = await db.execute(sql`SELECT SUM(amount) as total FROM disbursements WHERE status = 'approved'`);
      const totalDisbursed = disbursedResult[0]?.total ? parseInt(disbursedResult[0].total as string, 10) : 0;
      
      // Calculate total withdrawal fees from approved disbursements
      const withdrawalFeeResult = await db.execute(sql`SELECT SUM(withdrawal_fee) as total FROM disbursements WHERE status = 'approved'`);
      const totalWithdrawalFees = withdrawalFeeResult[0]?.total ? parseInt(withdrawalFeeResult[0].total as string, 10) : 0;
      
      // Calculate net income after MDR
      const netIncome = totalIncome - totalMdrFees;
      
      // Available balance = net income - approved disbursements - withdrawal fees
      const availableBalance = netIncome - totalDisbursed - totalWithdrawalFees;
      
      res.json({ 
        balance: Math.max(0, availableBalance),
        totalIncome,
        totalMdrFees,
        netIncome,
        totalDisbursed,
        totalWithdrawalFees,
        totalFees: totalMdrFees + totalWithdrawalFees,
      });
    } catch (e) {
      console.error("DB Balance Error:", e);
      res.status(500).json({ error: "Failed to fetch balance" });
    }
  });

  // Get all disbursement requests
  app.get("/api/disbursements", async (req, res) => {
    if (!db) return res.status(503).json({ error: "Database not configured" });
    try {
      const allDisbursements = await db.select().from(disbursements).orderBy(desc(disbursements.requestedAt));
      res.json(allDisbursements);
    } catch (e) {
      console.error("DB Disbursements Error:", e);
      res.status(500).json({ error: "Failed to fetch disbursements" });
    }
  });

  // Create new disbursement request with Turnstile bot protection
  app.post("/api/disbursements", async (req, res) => {
    if (!db) return res.status(503).json({ error: "Database not configured" });
    
    try {
      const { amount, description, requestedBy, turnstileToken } = req.body;
      
      // Verify Turnstile token for bot protection
      const isTurnstileValid = await verifyTurnstileToken(turnstileToken, req.ip);
      if (!isTurnstileValid) {
        return res.status(400).json({ error: "Invalid Turnstile token" });
      }
      
      // Validation
      if (!amount || amount <= 0) {
        return res.status(400).json({ error: "Amount must be greater than 0" });
      }
      if (!description || description.trim().length === 0) {
        return res.status(400).json({ error: "Description is required" });
      }
      
      const requestId = `disb-${uuidv4()}`;
      const withdrawalFee = 5000; // Rp 5,000 flat fee
      const netAmount = Math.max(0, amount - withdrawalFee);
      
      const result = await db.insert(disbursements).values({
        requestId,
        amount: Math.round(amount),
        withdrawalFee: withdrawalFee,
        netAmount: netAmount,
        status: "pending",
        description: description.trim(),
        requestedBy: requestedBy?.trim() || 'anonymous',
        requestedAt: new Date(),
      }).returning();
      
      res.status(201).json({
        success: true,
        disbursement: result[0],
      });
    } catch (e) {
      console.error("Create Disbursement Error:", e);
      res.status(500).json({ error: "Failed to create disbursement request" });
    }
  });

  // Approve a disbursement request
  app.post("/api/disbursements/:requestId/approve", async (req, res) => {
    if (!db) return res.status(503).json({ error: "Database not configured" });
    
    try {
      const { requestId } = req.params;
      const { processedBy } = req.body;
      
      // Find the request
      const existing = await db.select().from(disbursements).where(eq(disbursements.requestId, requestId));
      if (existing.length === 0) {
        return res.status(404).json({ error: "Disbursement request not found" });
      }
      
      const request = existing[0];
      if (request.status !== "pending") {
        return res.status(400).json({ error: `Cannot approve ${request.status} request` });
      }
      
      // Wrap balance check and update in a transaction for atomicity
      const result = await db.transaction(async (tx) => {
        // Calculate available balance (same logic as /api/balance)
        const incomeResult = await tx.execute(sql`SELECT SUM(amount) as total FROM orders WHERE status IN ('settlement', 'capture')`);
        const totalIncome = incomeResult[0]?.total ? parseInt(incomeResult[0].total as string, 10) : 0;
        
        const mdrResult = await tx.execute(sql`SELECT SUM(mdr_fee) as total FROM orders WHERE status IN ('settlement', 'capture')`);
        const totalMdrFees = mdrResult[0]?.total ? parseInt(mdrResult[0].total as string, 10) : 0;
        
        const disbursedResult = await tx.execute(sql`SELECT SUM(amount) as total FROM disbursements WHERE status = 'approved'`);
        const totalDisbursed = disbursedResult[0]?.total ? parseInt(disbursedResult[0].total as string, 10) : 0;
        
        const withdrawalFeeResult = await tx.execute(sql`SELECT SUM(withdrawal_fee) as total FROM disbursements WHERE status = 'approved'`);
        const totalWithdrawalFees = withdrawalFeeResult[0]?.total ? parseInt(withdrawalFeeResult[0].total as string, 10) : 0;
        
        const netIncome = totalIncome - totalMdrFees;
        const availableBalance = netIncome - totalDisbursed - totalWithdrawalFees;
        
        // Check if there's enough balance (need to cover both amount + withdrawal fee)
        const totalNeeded = request.amount + request.withdrawalFee;
        
        if (totalNeeded > availableBalance) {
          throw { type: 'INSUFFICIENT_BALANCE', availableBalance, requestedAmount: request.amount, withdrawalFee: request.withdrawalFee, totalNeeded };
        }
        
        // Update status to approved
        return await tx.update(disbursements)
          .set({ 
            status: "approved", 
            processedAt: new Date(),
            processedBy: processedBy?.trim() || 'admin'
          })
          .where(eq(disbursements.requestId, requestId))
          .returning();
      });
      
      res.json({
        success: true,
        disbursement: result[0],
        message: "Disbursement approved successfully"
      });
    } catch (e) {
      if ((e as any)?.type === 'INSUFFICIENT_BALANCE') {
        return res.status(400).json({ 
          error: "Insufficient balance", 
          availableBalance: e.availableBalance,
          requestedAmount: e.requestedAmount,
          withdrawalFee: e.withdrawalFee,
          totalNeeded: e.totalNeeded,
        });
      }
      console.error("Approve Disbursement Error:", e);
      res.status(500).json({ error: "Failed to approve disbursement" });
    }
  });

  // Reject a disbursement request
  app.post("/api/disbursements/:requestId/reject", async (req, res) => {
    if (!db) return res.status(503).json({ error: "Database not configured" });
    
    try {
      const { requestId } = req.params;
      const { processedBy } = req.body;
      
      const existing = await db.select().from(disbursements).where(eq(disbursements.requestId, requestId));
      if (existing.length === 0) {
        return res.status(404).json({ error: "Disbursement request not found" });
      }
      
      const request = existing[0];
      if (request.status !== "pending") {
        return res.status(400).json({ error: `Cannot reject ${request.status} request` });
      }
      
      const result = await db.update(disbursements)
        .set({ 
          status: "rejected", 
          processedAt: new Date(),
          processedBy: processedBy?.trim() || 'admin'
        })
        .where(eq(disbursements.requestId, requestId))
        .returning();
      
      res.json({
        success: true,
        disbursement: result[0],
        message: "Disbursement rejected"
      });
    } catch (e) {
      console.error("Reject Disbursement Error:", e);
      res.status(500).json({ error: "Failed to reject disbursement" });
    }
  });

  // Cancel a disbursement request (user cancels their own)
  app.post("/api/disbursements/:requestId/cancel", async (req, res) => {
    if (!db) return res.status(503).json({ error: "Database not configured" });
    
    try {
      const { requestId } = req.params;
      
      const existing = await db.select().from(disbursements).where(eq(disbursements.requestId, requestId));
      if (existing.length === 0) {
        return res.status(404).json({ error: "Disbursement request not found" });
      }
      
      const request = existing[0];
      if (request.status !== "pending") {
        return res.status(400).json({ error: `Cannot cancel ${request.status} request` });
      }
      
      const result = await db.update(disbursements)
        .set({ 
          status: "cancelled",
          processedAt: new Date(),
          processedBy: 'self'
        })
        .where(eq(disbursements.requestId, requestId))
        .returning();
      
      res.json({
        success: true,
        disbursement: result[0],
        message: "Disbursement cancelled"
      });
    } catch (e) {
      console.error("Cancel Disbursement Error:", e);
      res.status(500).json({ error: "Failed to cancel disbursement" });
    }
  });

  // Midtrans Webhook - receives payment notifications
  app.post("/api/webhooks/midtrans", async (req, res) => {
    try {
      const { order_id, transaction_status, status_code, gross_amount, payment_type } = req.body;

      console.log("Midtrans Webhook Received:", {
        order_id,
        transaction_status,
        status_code,
        gross_amount,
        payment_type,
        timestamp: new Date().toISOString()
      });

      if (!order_id || !transaction_status) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Midtrans transaction statuses that indicate successful payment
      const successStatuses = ["settlement", "capture"];
      // Statuses that indicate failed/cancelled payment
      const failedStatuses = ["cancel", "deny", "expire", "failure"];

      let newStatus = transaction_status;

      if (successStatuses.includes(transaction_status)) {
        newStatus = "settlement";
      } else if (failedStatuses.includes(transaction_status)) {
        newStatus = "failed";
      } else if (transaction_status === "pending") {
        newStatus = "pending";
      }

      if (db) {
        try {
          await db.update(orders)
            .set({ status: newStatus })
            .where(eq(orders.orderId, order_id));
          console.log(`Order ${order_id} status updated to: ${newStatus}`);
        } catch (e) {
          console.error("DB Update Error in webhook:", e);
          // Still return 200 to Midtrans to prevent retries for DB errors
        }
      }

      // Always return 200 OK to Midtrans to acknowledge receipt
      // Midtrans will retry if it doesn't receive 200
      res.status(200).json({ 
        message: "Notification received",
        order_id,
        status: newStatus
      });
    } catch (error) {
      console.error("Webhook Error:", error);
      // Return 200 even on error to prevent Midtrans from retrying
      // Log the error for investigation
      res.status(200).json({ message: "Notification processed" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
