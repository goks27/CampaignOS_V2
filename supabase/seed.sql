-- DEVELOPMENT ONLY. Loaded by `supabase db reset` on a local stack. Never run against production.
-- Creates demo users (password: campaignos-demo) and one clearly fake "Sample campaign".
-- Everything here is labelled "Demo / unverified".

do $$
declare
  u record;
  v_ws uuid;
  v_client uuid;
  v_campaign uuid;
  v_journey uuid;
begin
  for u in select * from (values
      ('11111111-0000-4000-8000-000000000001'::uuid, 'admin@campaignos.local', 'Demo Admin'),
      ('11111111-0000-4000-8000-000000000002'::uuid, 'manager@campaignos.local', 'Demo Manager'),
      ('11111111-0000-4000-8000-000000000003'::uuid, 'designer@campaignos.local', 'Demo Designer'),
      ('11111111-0000-4000-8000-000000000004'::uuid, 'developer@campaignos.local', 'Demo Developer'),
      ('11111111-0000-4000-8000-000000000005'::uuid, 'viewer@campaignos.local', 'Demo Viewer'),
      ('11111111-0000-4000-8000-000000000006'::uuid, 'worker@campaignos.local', 'Local AI worker')) as t(id, email, name)
  loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
            extensions.crypt('campaignos-demo', extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', u.name), now(), now(), '', '', '', '')
    on conflict (id) do nothing;
    insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (u.id, u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', now(), now(), now())
    on conflict do nothing;
  end loop;

  update public.workspace_members set role = 'manager' where user_id = '11111111-0000-4000-8000-000000000002';
  update public.workspace_members set role = 'team_member' where user_id in ('11111111-0000-4000-8000-000000000003', '11111111-0000-4000-8000-000000000004');
  update public.workspace_members set role = 'worker' where user_id = '11111111-0000-4000-8000-000000000006';

  select id into v_ws from public.workspaces order by created_at limit 1;
  update public.workspaces set name = 'Octech (local dev)' where id = v_ws;
  update public.workspace_settings set allowed_domains = array['example.com'] where workspace_id = v_ws;

  insert into public.clients (workspace_id, name, notes, created_by)
  values (v_ws, 'Sample client', 'Demo / unverified', '11111111-0000-4000-8000-000000000002') returning id into v_client;

  insert into public.campaigns (workspace_id, client_id, name, description, stage, status, priority, health, design_status,
                                start_date, target_launch_date, staging_url, notes, is_demo, created_by)
  values (v_ws, v_client, 'Sample campaign', 'Placeholder campaign for local development. Demo / unverified.',
          'design', 'active', 'medium', 'on_track', 'in_progress', current_date - 10, current_date + 30,
          'https://example.com', 'Demo / unverified', true, '11111111-0000-4000-8000-000000000002')
  returning id into v_campaign;

  insert into public.journeys (campaign_id, name, description, sort_order, stage, design_status)
  values (v_campaign, 'Sample journey', 'Demo / unverified', 0, 'design', 'in_progress') returning id into v_journey;

  insert into public.campaign_members (campaign_id, user_id, campaign_role) values
    (v_campaign, '11111111-0000-4000-8000-000000000002', 'primary_manager'),
    (v_campaign, '11111111-0000-4000-8000-000000000003', 'designer'),
    (v_campaign, '11111111-0000-4000-8000-000000000004', 'developer'),
    (v_campaign, '11111111-0000-4000-8000-000000000005', 'member');

  insert into public.requirements (campaign_id, journey_id, ref, title, description, category, priority, status, origin, source_text) values
    (v_campaign, v_journey, '', 'Registration form collects name and mobile number', 'Demo / unverified. Name and 10-digit mobile number are mandatory.', 'validation', 'high', 'accepted', 'manual', 'Demo / unverified'),
    (v_campaign, v_journey, '', 'OTP is verified before entry', 'Demo / unverified. A 6-digit OTP must be verified; resend after 30 seconds.', 'functional', 'high', 'accepted', 'manual', 'Demo / unverified'),
    (v_campaign, v_journey, '', 'Terms and privacy consent checkbox', 'Demo / unverified. User must accept T&C and Privacy Policy.', 'legal', 'medium', 'draft', 'manual', 'Demo / unverified');

  insert into public.tasks (campaign_id, journey_id, title, assignee_id, status, priority, due_date) values
    (v_campaign, v_journey, 'Design the registration screen', '11111111-0000-4000-8000-000000000003', 'in_progress', 'high', current_date + 3),
    (v_campaign, v_journey, 'Prepare staging environment', '11111111-0000-4000-8000-000000000004', 'todo', 'medium', current_date + 10),
    (v_campaign, v_journey, 'Confirm OTP provider with client', '11111111-0000-4000-8000-000000000002', 'todo', 'medium', current_date - 1);

  insert into public.milestones (campaign_id, title, stage, due_date) values
    (v_campaign, 'Design sign-off', 'design', current_date + 7),
    (v_campaign, 'Staging ready', 'development', current_date + 18),
    (v_campaign, 'Go live', 'live_deployment', current_date + 30);
end $$;
