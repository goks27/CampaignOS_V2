# Put CampaignOS online

You'll end up with a private website such as `https://campaignos.pages.dev` (or `https://campaign.octech.in`) that only invited people can sign in to. It takes about 30 minutes and costs nothing on the free plans.

You need:

- a GitHub account with the CampaignOS repo pushed;
- a Supabase account (supabase.com);
- a Cloudflare account (cloudflare.com).

## 1. Create the Supabase project (10 min)

1. Go to supabase.com → **New project**. Name it `campaignos` and pick the **Mumbai (ap-south-1)** region. Save the database password somewhere safe.
2. On your computer, in the CampaignOS folder:
   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF     # the ref is in the project URL
   npx supabase db push                                 # creates all tables, permissions and storage buckets
   ```
   Do **not** run `seed.sql` against this project: it creates demo users with a known password.
3. In the Supabase dashboard, open **Authentication → Sign In / Providers → Email** and turn **off** “Allow new users to sign up”. CampaignOS is invite-only.
4. Open **Project Settings → API** and copy the **Project URL** and the **anon / publishable key**. You need them in step 2. Never copy the `service_role` key anywhere.

## 2. Create the website on Cloudflare Pages (10 min)

1. In Cloudflare: **Workers & Pages → Create → Pages → Connect to Git**, then pick the CampaignOS repo.
2. Build settings:
   | Setting | Value |
   |---|---|
   | Framework preset | None |
   | Build command | `npm install && npm run build -w apps/web` |
   | Build output directory | `apps/web/dist` |
   | Root directory | *(leave empty)* |
3. **Environment variables** (Production and Preview):
   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | the Project URL from 1.4 |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | the anon / publishable key from 1.4 |
   | `NODE_VERSION` | `20` |
4. Click **Save and deploy**. When it finishes you'll get `https://campaignos.pages.dev` (the exact name may differ).

Deep links like `/campaigns/…` work because `apps/web/public/_redirects` sends every path to the app (SPA fallback). `_headers` adds basic security headers.

**Optional, your own domain:** Pages project → **Custom domains** → add `campaign.octech.in` and follow the DNS step.

## 3. Connect the two (2 min)

In Supabase, open **Authentication → URL Configuration**:

- **Site URL:** `https://campaignos.pages.dev` (or your domain)
- **Redirect URLs:** add `https://campaignos.pages.dev/auth/callback` (and the custom-domain version if you use one)

Without this, invite and password-reset links won't come back to the app.

## 4. Invite yourself first (2 min)

1. Supabase → **Authentication → Users → Invite user** → your email.
2. Open the email, choose a password. **The first person to join becomes Admin automatically**; everyone after joins as Viewer until an Admin changes their role on the Team page.
3. Invite the team the same way, then set roles in **Team**.

## 5. Connect the AI PC

Follow `services/local-ai-worker/README.md`. Create the worker account with **Add user** (not invite), set its role to **AI worker** in Team, and start the worker. The top bar shows **AI online**.

## Updating the site later

Push to the main branch and Cloudflare rebuilds automatically. Run `npx supabase db push` whenever a new file appears in `supabase/migrations/`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| “Connect to Supabase” page | Env vars missing in Cloudflare; add them and **Retry deployment** |
| Invite link opens a blank or error page | Add the `/auth/callback` redirect URL in step 3 |
| “No access to this workspace” | An Admin must give the account a role on the Team page |
| Everything stopped loading after a quiet week | Free project paused; restore it in the Supabase dashboard |
| “AI offline · jobs will wait” | The AI PC or worker is off. Jobs run when it reconnects |
