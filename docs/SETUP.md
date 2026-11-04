# Running CampaignOS

## Roles

| Role | Can do |
|---|---|
| Admin | Everything, plus roles, deactivation, workspace settings, automation and limits |
| Manager | Create and manage all campaigns, upload SOWs, accept requirements, run reviews, accept/dismiss/assign findings, record approvals |
| Team member | See assigned campaigns, change the status of their own tasks, submit designs and staging builds, comment |
| Viewer | Read-only access to assigned campaigns |
| AI worker | Service account for the local worker. It can't sign in to the website and can't read campaigns directly |

Permissions are enforced in the database (Row Level Security), not only by hiding buttons. `supabase/tests/` proves this.

## Inviting people

Supabase → Authentication → Users → **Invite user**. The first user becomes Admin; later users start as Viewer. Set roles on the **Team** page, then add people to campaigns from each campaign's **Overview → Team** panel.

## Backups (weekly; the free plan has none)

```bash
npx supabase db dump --linked -f backups/campaignos-$(date +%F).sql          # schema + data
npx supabase db dump --linked --data-only -f backups/campaignos-data-$(date +%F).sql
```

Uploaded files live in Storage. Download the `sow`, `designs` and `documents` buckets from the dashboard occasionally, or upgrade to a paid plan for managed backups.

**Restore test (do it once):** create a scratch project, then `psql "<its connection string>" -f backups/campaignos-YYYY-MM-DD.sql`.

## Local development without Docker

`scripts/db-test-local.sh` applies every migration to a plain Postgres 16 (with pgTAP) using `scripts/supabase-shim.sql` and runs the tests. It's for CI or machines without Docker; normal development uses `supabase start`.

## Regenerating database types

After a migration: `npm run db:types` (local stack running). Commit `apps/web/src/types/database.ts`.

## Automatic analysis

**Settings → Automatic analysis** can queue reviews when a SOW, design or build is uploaded. It only creates a pending job: findings always wait for a manager, and identical content is never re-analysed.

## Limits

**Settings → Resource limits:**

- max screens per review (12)
- max PDF pages (30)
- image long edge (1600 px)
- max inference time (180 s)
- retries (2)
- job timeout (30 min)

When a limit is hit, the job fails with a message naming the limit and what to do.
