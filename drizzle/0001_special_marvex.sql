CREATE TABLE "beans" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"image_url" text,
	"price_per_250g" integer DEFAULT 100000 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "beans_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "bean_slug" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "bean_name" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "is_blend" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "blend_data" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "webhook_message" text;