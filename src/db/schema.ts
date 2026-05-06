import { pgTable, serial, text, integer, numeric, timestamp, boolean } from 'drizzle-orm/pg-core';

export const beans = pgTable('beans', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  imageUrl: text('image_url'),
  pricePer250g: integer('price_per_250g').notNull().default(100000),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  orderId: text('order_id').notNull().unique(),
  amount: integer('amount').notNull(),
  grams: numeric('grams').notNull(),
  beanSlug: text('bean_slug'),
  beanName: text('bean_name'),
  isBlend: boolean('is_blend').notNull().default(false),
  blendData: text('blend_data'),
  status: text('status').notNull().default('pending'),
  snapToken: text('snap_token'),
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
