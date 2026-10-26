-- Runs once, when the postgres container initialises an empty data directory.
--
-- lep_owner (POSTGRES_USER) owns the schema and runs migrations.
-- lep_app is the login role for the API and the workers. Through lep_app_rw it can
-- read and write rows in the tables the migrations grant it, and nothing else: no DDL,
-- no ownership, so a compromised API process cannot drop or alter a table.
-- The password is read from the mounted secret inside psql, never passed on a command line.

\set ON_ERROR_STOP on
\set app_password `cat /run/secrets/lep_db_password`

CREATE ROLE lep_app_rw NOLOGIN;
CREATE ROLE lep_app LOGIN PASSWORD :'app_password' IN ROLE lep_app_rw;

DO $$
BEGIN
    EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO lep_app_rw', current_database());
END
$$;
