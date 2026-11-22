-- Quyền của role app next_store_app (ADR-0010 quyết định A; README, mục "Role app").
--
-- Chạy bằng ĐÚNG role mà db:migrate dùng (role chủ trong DATABASE_URL, trên Neon là neondb_owner): ALTER DEFAULT
-- PRIVILEGES chỉ áp cho bảng / sequence do chính role chạy script tạo ra sau này, tức các bảng migration sẽ tạo.
-- Điều kiện: role next_store_app đã tồn tại (chủ dự án tạo bằng SQL với verifier SCRAM, README). Script này không tạo
-- role và không chứa mật khẩu. Chạy lại bao nhiêu lần cũng được; một lỗi bất kỳ thì cả script rollback.
--
-- Script không sửa thuộc tính của role (SUPERUSER, CREATEDB, …) và không gỡ thành viên: role chủ trên Neon không phải
-- superuser nên Postgres từ chối ALTER ROLE … NOSUPERUSER, và REVOKE một membership do role khác cấp chỉ báo WARNING
-- rồi không làm gì. Vì vậy script kiểm và dừng; cách sửa là tạo lại role bằng SQL (README, mục "Role app").

BEGIN;

-- Pre-conditions: who runs the script, and what the app role already is.
DO $$
DECLARE
  app pg_roles%ROWTYPE;
  runner oid := (SELECT oid FROM pg_roles WHERE rolname = current_user);
  foreign_object text;
BEGIN
  SELECT * INTO app FROM pg_roles WHERE rolname = 'next_store_app';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'app-role.sql: role next_store_app chưa tồn tại; tạo role trước (README, mục "Role app").';
  END IF;
  IF current_user = 'next_store_app' THEN
    RAISE EXCEPTION 'app-role.sql: đang chạy bằng next_store_app; phải chạy bằng role mà db:migrate dùng (role chủ).';
  END IF;
  -- The owner of the database is the role db:migrate connects as (the integration injects it); any other role would
  -- attach the default privileges below to itself, and tables created by migrations would get no grant. On a parent
  -- branch without tables this is the only check that catches the wrong runner (audit PR #39 L3).
  IF (SELECT datdba FROM pg_database WHERE datname = current_database()) <> runner THEN
    RAISE EXCEPTION 'app-role.sql: role đang chạy không phải chủ database; phải chạy bằng role mà db:migrate dùng.';
  END IF;
  -- Objects that belong to an extension are owned by whoever installed it (often a superuser) and are not created
  -- by migrations, so they say nothing about the runner (audit PR #39 L4). Named in the message: not a secret.
  SELECT format('%I.%I', n.nspname, c.relname) INTO foreign_object
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    AND c.relowner <> runner
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
    )
  ORDER BY 1 LIMIT 1;
  IF foreign_object IS NOT NULL THEN
    RAISE EXCEPTION 'app-role.sql: % không thuộc role đang chạy; phải chạy bằng role mà db:migrate dùng.', foreign_object;
  END IF;
  IF app.rolsuper OR app.rolcreatedb OR app.rolcreaterole OR app.rolbypassrls OR app.rolreplication THEN
    RAISE EXCEPTION 'app-role.sql: next_store_app có SUPERUSER / CREATEDB / CREATEROLE / BYPASSRLS / REPLICATION; '
      'xoá và tạo lại role bằng SQL (README, mục "Role app").';
  END IF;
  -- Membership of any role (neon_superuser on Neon, the owner, pg_* predefined roles) hands over that role's rights.
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

-- Start from nothing, then grant exactly DML (audit PR #39 L2): REVOKE ALL also removes WITH GRANT OPTION, MAINTAIN
-- (Postgres 17+) and any right a hand-made grant added, on every Postgres version without naming them.
REVOKE ALL ON SCHEMA public FROM next_store_app;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM next_store_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM next_store_app;
-- Default privileges both in public and global (no IN SCHEMA, any schema) of the runner.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM next_store_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM next_store_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM next_store_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TYPES FROM next_store_app;
ALTER DEFAULT PRIVILEGES REVOKE ALL ON TABLES FROM next_store_app;
ALTER DEFAULT PRIVILEGES REVOKE ALL ON SEQUENCES FROM next_store_app;
ALTER DEFAULT PRIVILEGES REVOKE ALL ON FUNCTIONS FROM next_store_app;
ALTER DEFAULT PRIVILEGES REVOKE ALL ON TYPES FROM next_store_app;
ALTER DEFAULT PRIVILEGES REVOKE ALL ON SCHEMAS FROM next_store_app;

GRANT USAGE ON SCHEMA public TO next_store_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO next_store_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO next_store_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO next_store_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO next_store_app;

-- A query the app never finishes must not hold locks or a pooled connection forever. Just above the 5 s limit of
-- dbQuery (NS-55 / NS-73), so dbQuery normally reports first and this only catches a path that bypasses it.
-- Start from no setting at all (audit PR #39 L-A): the app role can run ALTER ROLE … SET on itself, both role-wide
-- and IN DATABASE, and a per-database value outranks the role-wide one (e.g. statement_timeout = 0). The database
-- name is only known at run time; every database with a setting of the role is cleared (pg_db_role_setting is shared
-- by the whole cluster, so app-role-check.sql sees rows of other databases too).
DO $$
DECLARE
  db text;
BEGIN
  FOR db IN
    SELECT d.datname FROM pg_db_role_setting s JOIN pg_database d ON d.oid = s.setdatabase
    WHERE s.setrole = 'next_store_app'::regrole
    UNION SELECT current_database()
  LOOP
    EXECUTE format('ALTER ROLE next_store_app IN DATABASE %I RESET ALL', db);
  END LOOP;
END
$$;
ALTER ROLE next_store_app RESET ALL;
ALTER ROLE next_store_app SET statement_timeout = '6s';

-- Post-conditions (audit PR #39 L1): rights that reach the app role through PUBLIC cannot be revoked from the role
-- itself, and changing PUBLIC would affect every other role, so stop and let the owner decide.
DO $$
DECLARE
  app oid := (SELECT oid FROM pg_roles WHERE rolname = 'next_store_app');
BEGIN
  IF has_schema_privilege(app, 'public', 'CREATE') THEN
    RAISE EXCEPTION 'app-role.sql: next_store_app vẫn có CREATE trên schema public (qua PUBLIC); '
      'chạy REVOKE CREATE ON SCHEMA public FROM PUBLIC rồi chạy lại script.';
  END IF;
  IF has_database_privilege(app, current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'app-role.sql: next_store_app vẫn có CREATE trên database (qua PUBLIC); '
      'gỡ CREATE của PUBLIC trên database rồi chạy lại script.';
  END IF;
  -- TEMP through PUBLIC is the Postgres default (temporary tables only, gone at disconnect) and is accepted.
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND (has_table_privilege(app, c.oid, 'TRUNCATE') OR has_table_privilege(app, c.oid, 'REFERENCES')
        OR has_table_privilege(app, c.oid, 'TRIGGER')
        OR EXISTS (SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantee = 0 AND a.privilege_type = 'MAINTAIN'))
  ) OR EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    -- CASE: the planner may evaluate quals in any order, and has_sequence_privilege raises on a non-sequence.
    WHERE n.nspname = 'public' AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege(app, c.oid, 'UPDATE') END
  ) THEN
    RAISE EXCEPTION 'app-role.sql: next_store_app vẫn có TRUNCATE / REFERENCES / TRIGGER / MAINTAIN trên bảng hoặc '
      'UPDATE trên sequence (qua PUBLIC); gỡ quyền đó của PUBLIC rồi chạy lại script.';
  END IF;
END
$$;

COMMIT;
