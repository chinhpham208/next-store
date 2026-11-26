CREATE TABLE "error_events" (
	"fingerprint" text PRIMARY KEY NOT NULL,
	"route_type" text NOT NULL,
	"route_path" text NOT NULL,
	"method" text NOT NULL,
	"digest" text,
	"error_name" text NOT NULL,
	"message" text,
	"count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"items" jsonb NOT NULL,
	"total" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"refund_reason" text,
	"provider" text NOT NULL,
	"payment_ref" text,
	"cart_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_payment_ref_unique" UNIQUE("payment_ref"),
	CONSTRAINT "orders_total_positive" CHECK ("orders"."total" > 0),
	CONSTRAINT "orders_status_known" CHECK ("orders"."status" IN ('pending', 'paid', 'needs_refund', 'cancelled')),
	CONSTRAINT "orders_refund_reason_known" CHECK ("orders"."refund_reason" IS NULL OR "orders"."refund_reason" IN ('out-of-stock', 'amount-mismatch')),
	CONSTRAINT "orders_refund_reason_matches_status" CHECK (("orders"."status" = 'needs_refund') = ("orders"."refund_reason" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "error_events_last_seen_at_idx" ON "error_events" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "orders_created_at_idx" ON "orders" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_status_created_at_idx" ON "orders" USING btree ("status","created_at" DESC NULLS LAST);