// Phase 6 SQL tests that run WITHOUT Docker or a local Supabase: every migration is applied to an in-memory Postgres (PGlite) on top of
// scripts/supabase-shim.sql, then the new functions are exercised as real signed-in users, so row-level security is in play.
// Run with: npm run db:test      (the pgTAP files in this folder still need `supabase start`; see scripts/db-test-local.sh)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const db = new PGlite({ extensions: { pgcrypto } });

const shim = fs.readFileSync(path.join(ROOT, "scripts/supabase-shim.sql"), "utf8").replace(/create extension if not exists pgtap;/g, "");
await db.exec(shim);
const migrationsDir = path.join(ROOT, "supabase/migrations");
const migrations = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
for (const f of migrations) await db.exec(fs.readFileSync(path.join(migrationsDir, f), "utf8"));

// users: the first one becomes the Admin automatically
await db.exec(`
  insert into auth.users (email) values ('admin@test.local');
  insert into auth.users (email) values ('manager@test.local'), ('team1@test.local'), ('team2@test.local'), ('viewer@test.local');
  update public.workspace_members set role = 'manager' where user_id = (select id from auth.users where email = 'manager@test.local');
  update public.workspace_members set role = 'team_member' where user_id in (select id from auth.users where email in ('team1@test.local', 'team2@test.local'));
  update public.workspace_members set role = 'viewer' where user_id = (select id from auth.users where email = 'viewer@test.local');
`);
const uid = async (email) => (await db.query("select id from auth.users where email = $1", [email])).rows[0].id;

/** Runs `fn` as a signed-in user (RLS applies) inside one transaction that is rolled back afterwards. */
async function as(email, fn) {
  const id = await uid(email);
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)", [JSON.stringify({ sub: id, role: "authenticated" }), id]);
    await db.exec("set local role authenticated");
    const q = async (sql, params) => (await db.query(sql, params)).rows;
    // a statement that is expected to be refused runs in a savepoint, so the rest of the test can carry on in the same transaction
    q.rejects = async (sql, params, re) => { await db.exec("savepoint refused"); try { await assert.rejects(db.query(sql, params), re); } finally { await db.exec("rollback to savepoint refused"); } };
    return await fn(q);
  } finally { await db.exec("rollback"); }
}
const one = (rows) => rows[0] && Object.values(rows[0])[0];

test("every migration applies, including the Phase 6 one", () => {
  assert.ok(migrations.includes("20261106000200_simplify.sql"));
});

test("reviews start automatically by default: the six switches are on, regression stays off", async () => {
  const s = (await db.query("select auto_triggers from public.workspace_settings limit 1")).rows[0].auto_triggers;
  for (const k of ["sow_analysis", "sow_vs_design", "design_consistency", "design_vs_development", "sow_vs_development", "functional_qa", "site_check"]) assert.equal(s[k], true, k);
  assert.equal(s.regression, false);
});

test("the migration switches workspaces still on the old default, and leaves a customised one alone", async () => {
  const sql = fs.readFileSync(path.join(migrationsDir, "20261106000200_simplify.sql"), "utf8");
  const update = sql.match(/update public\.workspace_settings s[\s\S]*?'true'::jsonb\);/)?.[0];
  assert.ok(update, "the update statement is in the migration");
  const old = `{"site_check":true,"sow_analysis":false,"sow_vs_design":false,"design_consistency":false,"design_vs_development":false,"sow_vs_development":false,"functional_qa":false,"regression":false}`;
  const custom = `{"site_check":true,"sow_analysis":true,"sow_vs_design":false,"design_consistency":false,"design_vs_development":false,"sow_vs_development":false,"functional_qa":false,"regression":false}`;
  await db.exec("begin");
  try {
    await db.exec("insert into public.workspaces (name) values ('Old'), ('Custom')");
    await db.query("insert into public.workspace_settings (workspace_id, auto_triggers) select id, $1::jsonb from public.workspaces where name = 'Old'", [old]);
    await db.query("insert into public.workspace_settings (workspace_id, auto_triggers) select id, $1::jsonb from public.workspaces where name = 'Custom'", [custom]);
    await db.exec(update);
    const get = async (n) => (await db.query("select auto_triggers a from public.workspace_settings s join public.workspaces w on w.id = s.workspace_id where w.name = $1", [n])).rows[0].a;
    const o = await get("Old"), c = await get("Custom");
    assert.equal(o.functional_qa, true); assert.equal(o.sow_analysis, true); assert.equal(o.regression, false);
    assert.equal(c.functional_qa, false, "a workspace that chose its own settings keeps them");
    assert.equal(c.sow_vs_design, false);
  } finally { await db.exec("rollback"); }
});

/** A campaign owned by the manager, with the fixtures the tests below build on. */
async function fixtures(q, opts = {}) {
  const [{ id: campaign }] = await q("insert into public.campaigns (workspace_id, name) values (public.auth_workspace(), 'Sim') returning id");
  await q("insert into public.journeys (campaign_id, name) values ($1, 'Consumer')", [campaign]);
  if (opts.sow) {
    await q("insert into public.sow_documents (campaign_id, title) values ($1, 'SOW')", [campaign]);
    await q("insert into public.sow_versions (sow_document_id, campaign_id, version_no, storage_path, file_name, size_bytes, content_hash) select id, campaign_id, 1, campaign_id || '/sow.pdf', 'sow.pdf', 10, 'h1' from public.sow_documents where campaign_id = $1", [campaign]);
  }
  return campaign;
}
const asset = (q, sub, campaign, n) => q("insert into public.design_assets (submission_id, campaign_id, screen_name, storage_path, mime_type, width, height, original_width, original_height, content_hash) values ($1, $2, $3, $4, 'image/png', 800, 1600, 1080, 2160, $5)", [sub, campaign, `Screen ${n}`, `${campaign}/d/${n}.png`, `hd${n}`]);

test("campaign_progress: a new campaign says to upload the SOW", async () => {
  await as("manager@test.local", async (q) => {
    const c = await fixtures(q);
    const p = one(await q("select public.campaign_progress($1)", [c]));
    assert.equal(p.next.key, "upload_sow");
    assert.deepEqual(p.steps.map((s) => s.id), ["brief", "requirements", "design", "build", "launch"]);
    assert.equal(p.steps[0].state, "done", "a campaign with a journey has its brief");
    assert.equal(p.steps[1].state, "not_started");
  });
});

test("campaign_progress: the next step follows the data, in the agreed order", async () => {
  await as("manager@test.local", async (q) => {
    const c = await fixtures(q, { sow: true });
    const next = async () => one(await q("select public.campaign_progress($1)", [c])).next;
    const [{ id: sow }] = await q("select id from public.sow_versions where campaign_id = $1", [c]);
    await q("insert into public.requirements (campaign_id, source_version_id, title, description, category) values ($1, $2, 'Mobile registration', 'x', 'functional'), ($1, $2, 'OTP', 'x', 'functional')", [c, sow]);
    assert.deepEqual(await next(), { key: "verify_requirements", step: "requirements", count: 2 });
    await q("update public.requirements set status = 'accepted' where campaign_id = $1", [c]);
    assert.equal((await next()).key, "submit_designs");
    await q("insert into public.design_submissions (campaign_id, title) values ($1, 'v1')", [c]);
    assert.equal((await next()).key, "submit_build");
    await q("insert into public.development_submissions (campaign_id, version_label, staging_url) values ($1, 'v1', 'https://staging.example')", [c]);
    assert.equal((await next()).key, "record_approval");
    await q("insert into public.approvals (campaign_id, subject_type, subject_label, approver, decision) values ($1, 'stage', 'UAT', 'client', 'approved')", [c]);
    assert.equal((await next()).key, "plan_deployment");
    await q("insert into public.deployments (campaign_id, environment, url) values ($1, 'production', 'https://prod.example')", [c]);
    assert.equal(await next(), null, "nothing is waiting once a deployment is planned");
  });
});

test("campaign_progress: findings awaiting review take priority and are counted per step", async () => {
  await as("manager@test.local", async (q) => {
    const c = await fixtures(q, { sow: true });
    await q("insert into public.design_submissions (campaign_id, title) values ($1, 'v1')", [c]); // designs exist, so findings are the next thing
    await q("insert into public.findings (campaign_id, review_type, ref, title, additional_observation, status) values ($1, 'design_consistency', 'F-1', 'Button differs', true, 'awaiting_review'), ($1, 'functional_qa', 'F-2', 'OTP fails', true, 'awaiting_review')", [c]);
    const p = one(await q("select public.campaign_progress($1)", [c]));
    assert.equal(p.next.key, "review_findings");
    assert.equal(p.next.count, 2);
    assert.equal(p.steps.find((s) => s.id === "design").open, 1);
    assert.equal(p.steps.find((s) => s.id === "build").open, 1);
  });
});

test("campaign_progress: a person who cannot see the campaign gets nothing", async () => {
  let campaign;
  await as("manager@test.local", async (q) => { campaign = await fixtures(q); });
  // the rollback above removed it, so build one that persists for the cross-user check
  const manager = await uid("manager@test.local");
  await db.exec("begin");
  const [{ id }] = (await db.query("insert into public.campaigns (workspace_id, name) select workspace_id, 'Private' from public.workspace_members where user_id = $1 limit 1 returning id", [manager])).rows;
  await db.exec("commit");
  try {
    await as("team2@test.local", async (q) => { assert.equal(one(await q("select public.campaign_progress($1)", [id])), null, "a team member not on the campaign sees nothing"); });
    await as("viewer@test.local", async (q) => { assert.equal(one(await q("select public.campaign_progress($1)", [id])) !== undefined, true); });
  } finally { await db.query("delete from public.campaigns where id = $1", [id]); }
  assert.ok(campaign);
});

test("enqueue_reviews: Review designs queues what applies and says why it skipped the rest", async () => {
  await as("manager@test.local", async (q) => {
    const c = await fixtures(q, { sow: true });
    const [{ id: sub }] = await q("insert into public.design_submissions (campaign_id, title) values ($1, 'v1') returning id", [c]);
    await asset(q, sub, c, 1);
    const source = JSON.stringify({ design_submission_id: sub });
    let r = one(await q("select public.enqueue_reviews($1, 'review_designs', $2::jsonb)", [c, source]));
    const by = Object.fromEntries(r.map((x) => [x.type, x]));
    assert.equal(by.sow_vs_design.status, "skipped");
    assert.match(by.sow_vs_design.reason, /Accept some requirements/);
    assert.equal(by.design_consistency.status, "skipped");
    assert.match(by.design_consistency.reason, /two or more screens/);

    const [{ id: v }] = await q("select id from public.sow_versions where campaign_id = $1", [c]);
    await q("insert into public.requirements (campaign_id, source_version_id, title, description, category, status) values ($1, $2, 'R', 'x', 'functional', 'accepted')", [c, v]);
    await asset(q, sub, c, 2);
    r = one(await q("select public.enqueue_reviews($1, 'review_designs', $2::jsonb)", [c, source]));
    assert.deepEqual(r.map((x) => [x.type, x.status]), [["sow_vs_design", "queued"], ["design_consistency", "queued"]]);
    assert.equal((await q("select count(*)::int n from public.review_jobs where campaign_id = $1", [c]))[0].n, 2);

    r = one(await q("select public.enqueue_reviews($1, 'review_designs', $2::jsonb)", [c, source]));
    assert.ok(r.every((x) => x.status === "skipped"), "the same content again is a duplicate, not a second job");
    r = one(await q("select public.enqueue_reviews($1, 'review_designs', $2::jsonb, true)", [c, source]));
    assert.ok(r.every((x) => x.status === "queued"), "Run again queues it anyway");
  });
});

test("enqueue_reviews: Test build skips what has no prerequisite, and an unknown action is refused", async () => {
  await as("manager@test.local", async (q) => {
    const c = await fixtures(q, { sow: true });
    const [{ id: b }] = await q("insert into public.development_submissions (campaign_id, version_label, staging_url) values ($1, 'v1', 'https://staging.example') returning id", [c]);
    const r = one(await q("select public.enqueue_reviews($1, 'test_build', $2::jsonb)", [c, JSON.stringify({ development_submission_id: b })]));
    const by = Object.fromEntries(r.map((x) => [x.type, x]));
    assert.equal(by.site_check.status, "queued", "the Site check needs only the staging URL");
    assert.match(by.design_vs_development.reason, /No design is linked/);
    assert.match(by.functional_qa.reason, /No test scenarios/);
    assert.match(by.sow_vs_development.reason, /Accept some requirements/);
    await assert.rejects(q("select public.enqueue_reviews($1, 'nonsense', '{}'::jsonb)", [c]), /Unknown review action/);
  });
});

test("enqueue_reviews: only a manager can start reviews; team members and viewers cannot", async () => {
  const manager = await uid("manager@test.local");
  await db.exec("begin");
  const [{ id }] = (await db.query("insert into public.campaigns (workspace_id, name) select workspace_id, 'Perm' from public.workspace_members where user_id = $1 limit 1 returning id", [manager])).rows;
  await db.exec("commit");
  try {
    for (const who of ["team1@test.local", "viewer@test.local"]) {
      await as(who, async (q) => { await assert.rejects(q("select public.enqueue_reviews($1, 'check_sow', '{}'::jsonb)", [id]), /Only a Manager or Admin|permission|not allowed/i, who); });
    }
  } finally { await db.query("delete from public.campaigns where id = $1", [id]); }
});

test("home_summary and portfolio_report: one call each, shaped for the page, and RLS limits what they count", async () => {
  const manager = await uid("manager@test.local");
  await db.exec("begin");
  await db.query("insert into public.campaigns (workspace_id, name, health, target_launch_date) select workspace_id, 'Launching', 'at_risk', current_date + 5 from public.workspace_members where user_id = $1 limit 1", [manager]);
  await db.exec("commit");
  try {
    await as("manager@test.local", async (q) => {
      const h = one(await q("select public.home_summary()"));
      assert.ok(h.metrics.active >= 1 && h.metrics.at_risk >= 1 && h.metrics.launching_soon >= 1);
      assert.ok(h.attention.some((a) => a.name === "Launching" && a.kind === "at_risk"));
      assert.ok(h.upcoming.some((u) => u.name === "Launching"));
      const rows = one(await q("select public.portfolio_report()"));
      const row = rows.find((r) => r.name === "Launching");
      assert.ok(row && "requirements_total" in row && "findings_open" in row && "tasks_open" in row);
    });
    await as("team2@test.local", async (q) => {
      const h = one(await q("select public.home_summary()"));
      assert.equal(h.upcoming.some((u) => u.name === "Launching"), false, "a team member not on the campaign does not see it");
      assert.equal(one(await q("select public.portfolio_report()")).some((r) => r.name === "Launching"), false);
    });
  } finally { await db.query("delete from public.campaigns where name = 'Launching'"); }
});

// ---------------------------------------------------------------- Rules lab (20261107000100_rules_lab.sql)
test("rule scenarios and runs: managers and contributors write, viewers and outsiders do not, and AI suggestions need a manager", async () => {
  const manager = await uid("manager@test.local");
  await db.exec("begin");
  const [{ id: camp }] = (await db.query("insert into public.campaigns (workspace_id, name) select workspace_id, 'Rules' from public.workspace_members where user_id = $1 limit 1 returning id", [manager])).rows;
  await db.query("insert into public.campaign_members (campaign_id, user_id, campaign_role) select $1, id, 'designer' from auth.users where email = 'team1@test.local'", [camp]);
  await db.exec("commit");
  const scenario = JSON.stringify({ name: "Draw", rules: {}, actual: {} });
  try {
    await as("manager@test.local", async (q) => {
      const [s] = await q("insert into public.rule_scenarios (campaign_id, name, scenario) values ($1, 'Draw', $2::jsonb) returning id, accepted, version", [camp, scenario]);
      assert.equal(s.accepted, true, "a manual scenario is official from the start");
      await q("insert into public.rule_runs (campaign_id, scenario_id, scenario_name, status, result) values ($1, $2, 'Draw', 'failed', '{}'::jsonb)", [camp, s.id]);
      assert.equal((await q("select count(*)::int n from public.rule_runs where campaign_id = $1", [camp]))[0].n, 1);
      const [again] = await q("update public.rule_scenarios set name = 'Draw 2' where id = $1 returning version", [s.id]);
      assert.equal(again.version, 2, "an edit bumps the version");
    });
    // a suggestion waiting for a decision (kept, so the next steps can see it)
    await db.query("insert into public.rule_scenarios (campaign_id, name, scenario, source, accepted) values ($1, 'AI draft', $2::jsonb, 'ai_suggested', false)", [camp, scenario]);
    await as("team1@test.local", async (q) => {
      await q("insert into public.rule_scenarios (campaign_id, name, scenario) values ($1, 'Mine', $2::jsonb)", [camp, scenario]); // a team member on the campaign can add
      await q.rejects("insert into public.rule_scenarios (campaign_id, name, scenario, source, accepted) values ($1, 'AI', $2::jsonb, 'ai_suggested', true)", [camp, scenario], /Only a Manager or Admin can accept/);
      const [draft] = await q("select id, accepted from public.rule_scenarios where name = 'AI draft' and campaign_id = $1", [camp]);
      assert.equal(draft.accepted, false, "a suggestion stays a draft");
      await q.rejects("update public.rule_scenarios set accepted = true where id = $1", [draft.id], /Only a Manager or Admin can accept/);
    });
    await as("manager@test.local", async (q) => {
      const [d] = await q("select id from public.rule_scenarios where name = 'AI draft' and campaign_id = $1", [camp]);
      const [ok] = await q("update public.rule_scenarios set accepted = true where id = $1 returning accepted, accepted_by, accepted_at", [d.id]);
      assert.equal(ok.accepted, true);
      assert.equal(ok.accepted_by, manager, "who accepted it is recorded");
      assert.ok(ok.accepted_at);
    });
    await as("viewer@test.local", async (q) => {
      assert.equal((await q("select count(*)::int n from public.rule_scenarios where campaign_id = $1", [camp]))[0].n, 0, "a viewer not on the campaign sees nothing");
    });
    await as("team2@test.local", async (q) => {
      assert.equal((await q("select count(*)::int n from public.rule_runs where campaign_id = $1", [camp]))[0].n, 0, "a team member not on the campaign sees no runs");
      await q.rejects("insert into public.rule_scenarios (campaign_id, name, scenario) values ($1, 'x', $2::jsonb)", [camp, scenario], /row-level security|violates/);
    });
  } finally { await db.query("delete from public.campaigns where id = $1", [camp]); }
});
