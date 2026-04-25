# Supabase + Prisma Setup

This project uses Prisma with Supabase Postgres for account, RPG world, character, and progress data.

## 1. Create a Supabase Project

1. Go to https://supabase.com/dashboard.
2. Create a new project.
3. Save your database password somewhere safe.
4. Wait for the project to finish provisioning.

## 2. Create a Prisma Database User

In the Supabase project dashboard, open SQL Editor and run this SQL.

Replace `custom_password` with a strong generated password.

```sql
create user "prisma" with password 'custom_password' bypassrls createdb;

grant "prisma" to "postgres";

grant usage on schema public to prisma;
grant create on schema public to prisma;
grant all on all tables in schema public to prisma;
grant all on all routines in schema public to prisma;
grant all on all sequences in schema public to prisma;

alter default privileges for role postgres in schema public grant all on tables to prisma;
alter default privileges for role postgres in schema public grant all on routines to prisma;
alter default privileges for role postgres in schema public grant all on sequences to prisma;
```

This follows Supabase's Prisma guidance and keeps Prisma's database access separate from the default `postgres` user.

## 3. Copy Connection Strings

In Supabase, click **Connect** on your project dashboard.

For local development and migrations, use the Supavisor **Session pooler** string. It should end with port `5432`.

For serverless hosting later, use the Supavisor **Transaction pooler** string. It should end with port `6543`.

In `.env`, set:

```env
DATABASE_URL="postgresql://prisma.PROJECT_REF:PRISMA_PASSWORD@REGION.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://prisma.PROJECT_REF:PRISMA_PASSWORD@REGION.pooler.supabase.com:5432/postgres"
SESSION_SECRET="replace_with_a_long_random_secret"
```

Use your Prisma user's password, not the default Supabase database password.

## 4. Generate Prisma Client

```bash
npm run db:generate
```

## 5. Create Database Tables

After `DATABASE_URL` and `DIRECT_URL` are set, run:

```bash
npm run db:migrate -- --name initial_app_schema
```

This creates the initial tables for:

- users
- sessions
- source documents
- RPG worlds
- characters
- quests
- character progress
- concepts
- concept mastery
- skills
- character skills

## 6. Future Hosted Demo Notes

For a hosted demo, set:

```env
APP_MODE=demo
DATABASE_URL="transaction_pooler_url_on_port_6543"
DIRECT_URL="session_pooler_url_on_port_5432"
```

Run migrations from your development machine with `DIRECT_URL` available. On hosting providers like Vercel, the app should use the pooled `DATABASE_URL`.
