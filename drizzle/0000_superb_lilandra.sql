CREATE TABLE "configs" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "disbursements" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"amount" integer NOT NULL,
	"withdrawal_fee" integer DEFAULT 5000 NOT NULL,
	"net_amount" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"description" text NOT NULL,
	"requested_by" text DEFAULT 'anonymous' NOT NULL,
	"requested_at" timestamp DEFAULT now(),
	"processed_at" timestamp,
	"processed_by" text,
	CONSTRAINT "disbursements_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"amount" integer NOT NULL,
	"grams" numeric NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"snap_token" text,
	"mdr_fee" integer DEFAULT 0 NOT NULL,
	"net_amount" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "orders_order_id_unique" UNIQUE("order_id")
);
