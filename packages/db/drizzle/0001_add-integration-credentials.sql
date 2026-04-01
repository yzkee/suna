CREATE TYPE "kortix"."tunnel_device_auth_status" AS ENUM('pending', 'approved', 'denied', 'expired');--> statement-breakpoint
CREATE TABLE "kortix"."integration_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"provider" varchar(50) DEFAULT 'pipedream' NOT NULL,
	"credentials" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kortix"."tunnel_device_auth_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_code" varchar(9) NOT NULL,
	"device_secret_hash" varchar(128) NOT NULL,
	"status" "kortix"."tunnel_device_auth_status" DEFAULT 'pending' NOT NULL,
	"machine_hostname" varchar(255),
	"account_id" uuid,
	"tunnel_id" uuid,
	"setup_token" varchar(64),
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kortix"."tunnel_device_auth_requests" ADD CONSTRAINT "tunnel_device_auth_requests_tunnel_id_tunnel_connections_tunnel_id_fk" FOREIGN KEY ("tunnel_id") REFERENCES "kortix"."tunnel_connections"("tunnel_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_integration_credentials_account_provider" ON "kortix"."integration_credentials" USING btree ("account_id","provider");--> statement-breakpoint
CREATE INDEX "idx_integration_credentials_account" ON "kortix"."integration_credentials" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tunnel_device_auth_code" ON "kortix"."tunnel_device_auth_requests" USING btree ("device_code");--> statement-breakpoint
CREATE INDEX "idx_tunnel_device_auth_status" ON "kortix"."tunnel_device_auth_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_tunnel_device_auth_expires" ON "kortix"."tunnel_device_auth_requests" USING btree ("expires_at");