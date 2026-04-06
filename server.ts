import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/config", (req, res) => {
    res.json({
      clientKey: (process.env.MIDTRANS_CLIENT_KEY || "").trim(),
      isProduction: process.env.MIDTRANS_IS_PRODUCTION === "true"
    });
  });

  app.post("/api/charge", async (req, res) => {
    try {
      const { amount, grams } = req.body;

      if (!amount || amount <= 0) {
        return res.status(400).json({ error: "Invalid amount" });
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
          custom_field3: 'coffee-officee',
        }),
      });

      const data = await response.json();

      if (data.error_messages) {
        console.error("Midtrans Snap Error:", JSON.stringify(data, null, 2));
        return res.status(400).json({ error: `Midtrans Error: ${data.error_messages.join(', ')}` });
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

      // If 404, it might mean the transaction was just created and not yet in the status API,
      // or it doesn't exist. Midtrans returns 404 for non-existent orders.
      if (data.status_code === "404") {
        return res.json({ status: "pending" }); // Treat as pending if not found immediately
      }

      res.json({
        orderId: data.order_id,
        status: data.transaction_status || "pending",
      });
    } catch (error) {
      console.error("Status Error:", error);
      res.status(500).json({ error: "Internal server error" });
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
