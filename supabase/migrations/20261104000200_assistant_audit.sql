-- Audit trail for the Claude assistant. Every change it proposes and a user confirms is already recorded by the normal
-- triggers (with the user as actor). This adds one extra row saying it came through the assistant, so reviewers can tell.
-- Users cannot write activity_logs directly, so this goes through a SECURITY DEFINER function that checks access.

create or replace function public.record_assistant_action(p_campaign uuid, p_tool text, p_summary text, p_detail jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_human_member() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_campaign is not null and not public.can_read_campaign(p_campaign) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  insert into public.activity_logs (workspace_id, campaign_id, entity_type, entity_id, action, summary, before, after, actor_id, created_by)
  values ((select workspace_id from public.campaigns where id = p_campaign), p_campaign, 'assistant', null,
          'assistant_confirmed', left(coalesce(p_summary, p_tool), 300), null,
          jsonb_build_object('tool', p_tool, 'detail', coalesce(p_detail, '{}')), auth.uid(), auth.uid());
end $$;

revoke all on function public.record_assistant_action(uuid, text, text, jsonb) from public, anon;
grant execute on function public.record_assistant_action(uuid, text, text, jsonb) to authenticated;
