import { pgTable, serial, text, integer, numeric, timestamp } from 'drizzle-orm/pg-core';

export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  orderId: text('order_id').notNull().unique(),
  amount: integer('amount').notNull(),
  grams: numeric('grams').notNull(),
  status: text('status').notNull().default('pending'),
  snapToken: text('snap_token'), // NEW: Store snap token for later use
  createdAt: timestamp('created_at').defaultNow(),
});

export const configs = pgTable('configs', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
