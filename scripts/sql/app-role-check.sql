-- Kiểm quyền của next_store_app sau app-role.sql (README, mục "Role app"). Chạy bằng role mà db:migrate dùng, trên
-- một nhánh đã migrate (có bảng): main của production, preview/develop của resource 2. Nhánh cha của resource 2
-- không có bảng nên can_dml ở đó là false, không chạy script này trên nhánh cha (ADR-0010, audit ADR-0010 M3).
--
-- Kết quả đúng: một dòng, MỌI cột false, riêng can_dml true. Chỉ đọc catalog, không đổi gì.

WITH app AS (
  SELECT oid, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolreplication
  FROM pg_roles WHERE rolname = 'next_store_app'
),
tables AS (
  SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
),
sequences AS (
  SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'S'
),
-- Default privileges the role running this script (the migration role) attaches to its future objects in public.
defaults AS (
  SELECT d.defaclobjtype AS objtype, a.privilege_type
  FROM pg_default_acl d
  JOIN pg_namespace n ON n.oid = d.defaclnamespace
  CROSS JOIN LATERAL aclexplode(d.defaclacl) a
  WHERE n.nspname = 'public'
    AND d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = current_user)
    AND a.grantee = (SELECT oid FROM app)
)
SELECT
  (SELECT count(*) FROM app) <> 1 AS role_missing,
  EXISTS (SELECT 1 FROM tables t WHERE has_table_privilege((SELECT oid FROM app), t.oid, 'TRUNCATE')) AS can_truncate,
  EXISTS (SELECT 1 FROM tables t WHERE has_table_privilege((SELECT oid FROM app), t.oid, 'REFERENCES')) AS can_reference,
  EXISTS (SELECT 1 FROM tables t WHERE has_table_privilege((SELECT oid FROM app), t.oid, 'TRIGGER')) AS can_trigger,
  EXISTS (SELECT 1 FROM sequences s WHERE has_sequence_privilege((SELECT oid FROM app), s.oid, 'UPDATE')) AS can_setval,
  has_schema_privilege((SELECT oid FROM app), 'public', 'CREATE') AS can_create_in_public,
  has_database_privilege((SELECT oid FROM app), current_database(), 'CREATE') AS can_create_schema,
  coalesce((SELECT rolsuper FROM app), false) AS rolsuper,
  coalesce((SELECT rolcreatedb FROM app), false) AS rolcreatedb,
  coalesce((SELECT rolcreaterole FROM app), false) AS rolcreaterole,
  coalesce((SELECT rolbypassrls FROM app), false) AS rolbypassrls,
  coalesce((SELECT rolreplication FROM app), false) AS rolreplication,
  EXISTS (SELECT 1 FROM pg_class WHERE relowner = (SELECT oid FROM app))
    OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner = (SELECT oid FROM app)) AS owns_objects,
  EXISTS (
    SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
    WHERE m.member = (SELECT oid FROM app) AND r.rolname = 'neon_superuser'
  ) AS is_neon_superuser,
  EXISTS (SELECT 1 FROM pg_auth_members WHERE member = (SELECT oid FROM app)) AS member_of_any_role,
  EXISTS (SELECT 1 FROM defaults WHERE privilege_type NOT IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'USAGE'))
    AS default_grants_too_much,
  -- True only when every table has all four DML rights, every sequence USAGE and SELECT, and future tables and
  -- sequences created by this role get the same through default privileges.
  EXISTS (SELECT 1 FROM tables)
    AND NOT EXISTS (
      SELECT 1 FROM tables t
      WHERE NOT (has_table_privilege((SELECT oid FROM app), t.oid, 'SELECT')
        AND has_table_privilege((SELECT oid FROM app), t.oid, 'INSERT')
        AND has_table_privilege((SELECT oid FROM app), t.oid, 'UPDATE')
        AND has_table_privilege((SELECT oid FROM app), t.oid, 'DELETE'))
    )
    AND NOT EXISTS (
      SELECT 1 FROM sequences s
      WHERE NOT (has_sequence_privilege((SELECT oid FROM app), s.oid, 'USAGE')
        AND has_sequence_privilege((SELECT oid FROM app), s.oid, 'SELECT'))
    )
    AND has_schema_privilege((SELECT oid FROM app), 'public', 'USAGE')
    AND (SELECT count(DISTINCT privilege_type) FROM defaults WHERE objtype = 'r'
         AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) = 4
    AND (SELECT count(DISTINCT privilege_type) FROM defaults WHERE objtype = 'S'
         AND privilege_type IN ('USAGE', 'SELECT')) = 2
    AS can_dml;
