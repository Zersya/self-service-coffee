CREATE TABLE "mcp_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_sub" text,
	"client_id" text,
	"tool_name" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" integer,
	"target_slug" text,
	"before_json" text,
	"after_json" text,
	"idempotency_key" text,
	"success" boolean DEFAULT true NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "mcp_audit_logs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "mcp_oauth_clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_hash" text,
	"client_name" text,
	"redirect_uris" text NOT NULL,
	"grant_types" text DEFAULT 'authorization_code' NOT NULL,
	"response_types" text DEFAULT 'code' NOT NULL,
	"token_endpoint_auth_method" text DEFAULT 'client_secret_post' NOT NULL,
	"scope" text DEFAULT 'kopi:read' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "mcp_oauth_clients_client_id_unique" UNIQUE("client_id")
);
