CREATE TABLE "admin_login_failures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ip_hash" text NOT NULL,
	"failed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "admin_login_failures_ip_failed_at_idx" ON "admin_login_failures" USING btree ("ip_hash","failed_at");--> statement-breakpoint
CREATE INDEX "admin_login_failures_failed_at_idx" ON "admin_login_failures" USING btree ("failed_at");