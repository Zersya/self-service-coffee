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
  status: text('status').notNull().default('pending'),
  snapToken: text('snap_token'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const configs = pgTable('configs', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
