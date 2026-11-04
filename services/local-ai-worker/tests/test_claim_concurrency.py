"""Atomic claiming against a real migrated database (plain Postgres or local Supabase).

    DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pytest -m db
"""

import json
import os
import uuid

import pytest

psycopg = pytest.importorskip("psycopg")
DB = os.environ.get("DATABASE_URL")
pytestmark = [pytest.mark.db, pytest.mark.skipif(not DB, reason="DATABASE_URL not set")]


def as_user(conn, uid):
    conn.execute("select set_config('request.jwt.claims', %s, true), set_config('request.jwt.claim.sub', %s, true)",
                 (json.dumps({"sub": str(uid), "role": "authenticated"}), str(uid)))
    conn.execute("set local role authenticated")


@pytest.fixture
def setup():
    admin = psycopg.connect(DB, autocommit=True)
    tag = uuid.uuid4().hex[:8]
    worker_id = admin.execute("insert into auth.users (email) values (%s) returning id", (f"w-{tag}@test.local",)).fetchone()[0]
    admin.execute("update public.workspace_members set role = 'worker' where user_id = %s", (worker_id,))
    ws = admin.execute("select id from public.workspaces order by created_at limit 1").fetchone()[0]
    camp = admin.execute("insert into public.campaigns (workspace_id, name) values (%s, %s) returning id", (ws, f"conc-{tag}")).fetchone()[0]
    # nothing else may be queued during the test
    admin.execute("update public.review_jobs set status = 'cancelled' where status = 'queued'")
    jobs = [admin.execute(
        "insert into public.review_jobs (campaign_id, review_type, source, source_hash, input) values (%s, 'sow_analysis', '{}', %s, '{}') returning id",
        (camp, f"{tag}-{i}")).fetchone()[0] for i in range(2)]
    yield worker_id, jobs
    admin.execute("delete from public.campaigns where id = %s", (camp,))
    admin.execute("delete from auth.users where id = %s", (worker_id,))
    admin.close()


def claim(conn, uid, name):
    as_user(conn, uid)
    return conn.execute("select public.claim_review_job(%s)", (name,)).fetchone()[0]


def test_two_concurrent_claimers_never_get_the_same_job(setup):
    worker_id, jobs = setup
    a, b = psycopg.connect(DB), psycopg.connect(DB)
    try:
        ja = claim(a, worker_id, "pc-a")          # A holds its row lock (transaction still open)
        jb = claim(b, worker_id, "pc-b")          # B must skip A's row, not wait and not duplicate
        assert ja and jb and ja["id"] != jb["id"]
        assert {ja["id"], jb["id"]} == {str(j) for j in jobs}
        c = psycopg.connect(DB)
        assert claim(c, worker_id, "pc-c") is None  # both rows locked or claimed → nothing to hand out
        c.rollback()
        c.close()
        a.commit()
        b.commit()
    finally:
        a.close()
        b.close()
