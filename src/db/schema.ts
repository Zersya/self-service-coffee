import { pgTable, serial, text, integer, numeric, timestamp } from 'drizzle-orm/pg-core';

export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  orderId: text('order_id').notNull().unique(),
  amount: integer('amount').notNull(),
  grams: numeric('grams').notNull(),
  status: text('status').notNull().default('pending'),
  snapToken: text('snap_token'), // NEW: Store snap token for later use
  // NEW: MDR fee tracking (0.7% of amount for QRIS)
  mdrFee: integer('mdr_fee').notNull().default(0),
  netAmount: integer('net_amount').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

export const configs = pgTable('configs', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// NEW: Disbursements table for withdrawal requests
export const disbursements = pgTable('disbursements', {
  id: serial('id').primaryKey(),
  requestId: text('request_id').notNull().unique(),
  amount: integer('amount').notNull(),
  withdrawalFee: integer('withdrawal_fee').notNull().default(5000), // Rp 5,000
  netAmount: integer('net_amount').notNull().default(0), // amount - fee
  status: text('status').notNull().default('pending'),
  description: text('description').notNull(),
  requestedBy: text('requested_by').notNull().default('anonymous'),
  requestedAt: timestamp('requested_at').defaultNow(),
  processedAt: timestamp('processed_at'),
  processedBy: text('processed_by'),
});
