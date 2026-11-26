-- NS-120 (ADR-0019 11A), backfill of products.created_at added in 0002. Can run again: a row already backfilled has
-- created_at = updated_at and no longer matches. Before M5 nothing edits products, so updated_at is the creation time.
UPDATE "products" SET "created_at" = "updated_at" WHERE "created_at" > "updated_at";
