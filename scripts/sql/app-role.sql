-- Quyền của role app next_store_app (ADR-0010 quyết định A; README, mục "Role app").
--
-- Chạy bằng ĐÚNG role mà db:migrate dùng (role chủ trong DATABASE_URL, trên Neon là neondb_owner): ALTER DEFAULT
-- PRIVILEGES chỉ áp cho bảng / sequence do chính role chạy script tạo ra sau này, tức các bảng migration sẽ tạo.
-- Điều kiện: role next_store_app đã tồn tại (chủ dự án tạo, đặt mật khẩu trong Neon console). Script này không tạo
-- role và không chứa mật khẩu. Chạy lại bao nhiêu lần cũng được; một lỗi bất kỳ thì không có quyền nào được cấp.
--
-- Script không sửa thuộc tính của role (SUPERUSER, CREATEDB, …) và không gỡ thành viên: role chủ trên Neon không phải
-- superuser nên Postgres từ chối ALTER ROLE … NOSUPERUSER, và REVOKE một membership do role khác cấp chỉ báo WARNING
-- rồi không làm gì. Vì vậy script kiểm và dừng; cách sửa là tạo lại role bằng SQL (README, mục "Role app").

BEGIN;

DO $$
DECLARE
  app pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO app FROM pg_roles WHERE rolname = 'next_store_app';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'app-role.sql: role next_store_app chưa tồn tại; tạo role trước (README, mục "Role app").';
  END IF;
  IF current_user = 'next_store_app' THEN
    RAISE EXCEPTION 'app-role.sql: đang chạy bằng next_store_app; phải chạy bằng role mà db:migrate dùng (role chủ).';
  END IF;
  -- The owner of the database is the role db:migrate connects as (the integration injects it); any other role would
  -- attach the default privileges below to itself, and tables created by migrations would get no grant.
  IF (SELECT datdba FROM pg_database WHERE datname = current_database())
     <> (SELECT oid FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'app-role.sql: role đang chạy không phải chủ database; phải chạy bằng role mà db:migrate dùng.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = current_user)
  ) THEN
    RAISE EXCEPTION 'app-role.sql: có bảng / sequence trong public không thuộc role đang chạy; phải chạy bằng role mà db:migrate dùng.';
  END IF;
  IF app.rolsuper OR app.rolcreatedb OR app.rolcreaterole OR app.rolbypassrls OR app.rolreplication THEN
    RAISE EXCEPTION 'app-role.sql: next_store_app có SUPERUSER / CREATEDB / CREATEROLE / BYPASSRLS / REPLICATION; '
      'xoá và tạo lại role bằng SQL (README, mục "Role app").';
  END IF;
  -- Membership of any role (neon_superuser on Neon, or the owner itself) hands over that role's rights via SET ROLE.
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = app.oid) THEN
    RAISE EXCEPTION 'app-role.sql: next_store_app là thành viên của role khác (ví dụ neon_superuser); '
      'xoá và tạo lại role bằng SQL (README, mục "Role app").';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class WHERE relowner = app.oid
    UNION ALL SELECT 1 FROM pg_namespace WHERE nspowner = app.oid
    UNION ALL SELECT 1 FROM pg_database WHERE datdba = app.oid
  ) THEN
    RAISE EXCEPTION 'app-role.sql: next_store_app đang sở hữu đối tượng trong database; chủ sở hữu có mọi quyền DDL.';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO next_store_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO next_store_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO next_store_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO next_store_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO next_store_app;

-- Converge on DML only even if an earlier hand-made grant went further; a no-op when nothing was granted.
REVOKE CREATE ON SCHEMA public FROM next_store_app;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM next_store_app;
REVOKE UPDATE ON ALL SEQUENCES IN SCHEMA public FROM next_store_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM next_store_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE UPDATE ON SEQUENCES FROM next_store_app;

COMMIT;
