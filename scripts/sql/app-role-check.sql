-- Kiểm quyền của next_store_app sau app-role.sql (README, mục "Role app"). Chạy bằng role mà db:migrate dùng.
--
-- Kết quả đúng: một dòng.
--   Nhánh đã migrate (main của production, preview/develop của resource 2): MỌI cột false, riêng can_dml true.
--   Nhánh cha của resource 2 (chưa có bảng): MỌI cột false, kể cả can_dml (không có bảng nào để có quyền);
--   missing_default_privileges false cho biết bảng do migration tạo sau này sẽ tự có quyền.
-- Chỉ đọc catalog, không đổi gì. Chạy được trên Postgres 16, 17, 18 (MAINTAIN đọc từ ACL, không qua
-- has_table_privilege, vì Postgres 16 không biết tên quyền đó).

WITH app AS (
  SELECT oid, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolreplication
  FROM pg_roles WHERE rolname = 'next_store_app'
),
-- Objects of an extension are not created by migrations and are not the app's business (audit PR #39 L4).
-- MATERIALIZED and the CASE guards below: the planner may otherwise call has_sequence_privilege on rows that are not
-- sequences before the relkind filter, which raises "… is not a sequence".
public_objects AS MATERIALIZED (
  SELECT c.oid, c.relkind, c.relacl FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
    )
),
tables AS MATERIALIZED (SELECT oid, relacl FROM public_objects WHERE relkind IN ('r', 'p')),
sequences AS MATERIALIZED (SELECT oid, relacl FROM public_objects WHERE relkind = 'S'),
-- Explicit ACL entries for the app role or PUBLIC (grantee 0) on public tables / sequences, the schema and the database.
acl AS (
  SELECT 'r' AS objtype, a.grantee, a.privilege_type, a.is_grantable
  FROM tables t CROSS JOIN LATERAL aclexplode(t.relacl) a
  UNION ALL
  SELECT 'S', a.grantee, a.privilege_type, a.is_grantable
  FROM sequences s CROSS JOIN LATERAL aclexplode(s.relacl) a
  UNION ALL
  SELECT 'n', a.grantee, a.privilege_type, a.is_grantable
  FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'd', a.grantee, a.privilege_type, a.is_grantable
  FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a WHERE d.datname = current_database()
),
-- Default privileges of the role running this script (the migration role), in public and global
-- (defaclnamespace = 0, from ALTER DEFAULT PRIVILEGES without IN SCHEMA; audit PR #39 L2).
defaults AS (
  SELECT d.defaclobjtype AS objtype, a.privilege_type, a.is_grantable
  FROM pg_default_acl d
  LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
  CROSS JOIN LATERAL aclexplode(d.defaclacl) a
  WHERE (d.defaclnamespace = 0 OR n.nspname = 'public')
    AND d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = current_user)
    AND a.grantee = (SELECT oid FROM app)
),
settings AS (
  SELECT unnest(s.setconfig) AS setting
  FROM pg_db_role_setting s
  WHERE s.setrole = (SELECT oid FROM app) AND s.setdatabase = 0
)
SELECT
  (SELECT count(*) FROM app) <> 1 AS role_missing,
  EXISTS (SELECT 1 FROM tables t WHERE has_table_privilege((SELECT oid FROM app), t.oid, 'TRUNCATE')) AS can_truncate,
  EXISTS (SELECT 1 FROM tables t WHERE has_table_privilege((SELECT oid FROM app), t.oid, 'REFERENCES')) AS can_reference,
  EXISTS (SELECT 1 FROM tables t WHERE has_table_privilege((SELECT oid FROM app), t.oid, 'TRIGGER')) AS can_trigger,
  EXISTS (
    SELECT 1 FROM acl WHERE objtype = 'r' AND privilege_type = 'MAINTAIN' AND grantee IN (0, (SELECT oid FROM app))
  ) AS can_maintain,
  EXISTS (SELECT 1 FROM sequences s WHERE has_sequence_privilege((SELECT oid FROM app), s.oid, 'UPDATE')) AS can_setval,
  has_schema_privilege((SELECT oid FROM app), 'public', 'CREATE') AS can_create_in_public,
  has_database_privilege((SELECT oid FROM app), current_database(), 'CREATE') AS can_create_schema,
  EXISTS (SELECT 1 FROM acl WHERE grantee = (SELECT oid FROM app) AND is_grantable)
    OR EXISTS (SELECT 1 FROM defaults WHERE is_grantable) AS has_grant_option,
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
  EXISTS (
    SELECT 1 FROM defaults
    WHERE NOT (objtype = 'r' AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
      AND NOT (objtype = 'S' AND privilege_type IN ('USAGE', 'SELECT'))
  ) AS default_grants_too_much,
  NOT ((SELECT count(DISTINCT privilege_type) FROM defaults WHERE objtype = 'r'
         AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) = 4
    AND (SELECT count(DISTINCT privilege_type) FROM defaults WHERE objtype = 'S'
         AND privilege_type IN ('USAGE', 'SELECT')) = 2) AS missing_default_privileges,
  -- ALTER ROLE … SET statement_timeout = '6s' in app-role.sql; Postgres stores the value as written.
  NOT EXISTS (SELECT 1 FROM settings WHERE setting = 'statement_timeout=6s') AS statement_timeout_not_6s,
  -- True only when there is at least one table, every table has all four DML rights and every sequence USAGE and
  -- SELECT. False on a branch without tables (the parent of resource 2), which is expected there.
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
    AS can_dml;
