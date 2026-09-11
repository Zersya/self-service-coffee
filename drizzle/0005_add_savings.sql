CREATE TABLE "members" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "email" text,
  "phone" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now()
);
CREATE TABLE "savings_transactions" (
  "id" serial PRIMARY KEY NOT NULL,
  "member_id" integer NOT NULL,
  "type" text NOT NULL,
  "amount" integer NOT NULL,
  "note" text,
  "created_at" timestamp DEFAULT now()
);
ALTER TABLE "savings_transactions" ADD CONSTRAINT "savings_transactions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
