import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button, Dialog, DialogContent, Field, Input, Select, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { useAuth } from "@/lib/auth";
import {
  STAGES, STAGE_LABEL, CAMPAIGN_STATUS_LABEL, PRIORITY_LABEL, HEALTH_LABEL, TRACK_LABEL, options,
} from "@/lib/labels";
import { campaignsService, clientsService, journeysService, type CampaignWithRelations } from "@/services/campaigns";
import { qk } from "@/hooks/queries";

const url = z.string().trim().url("Enter a full URL starting with https://").or(z.literal(""));
const track = z.enum(["not_started", "in_progress", "in_review", "awaiting_client", "changes_requested", "approved"]);
const schema = z.object({
  name: z.string().trim().min(2, "Give the campaign a name"),
  client: z.string().trim().optional(),
  description: z.string().optional(),
  stage: z.enum(["brief_planning", "design", "development", "internal_qa", "client_uat", "live_deployment", "completed"]),
  status: z.enum(["active", "on_hold", "completed", "archived"]),
  priority: z.enum(["low", "medium", "high", "critical"]),
  health: z.enum(["on_track", "at_risk", "blocked"]),
  design_status: track, development_status: track, qa_status: track, uat_status: track,
  start_date: z.string().optional(),
  target_launch_date: z.string().optional(),
  staging_url: url,
  production_url: url,
  notes: z.string().optional(),
  journeys: z.string().optional(),
}).refine((v) => !v.start_date || !v.target_launch_date || v.start_date <= v.target_launch_date, {
  message: "Launch date must be after the start date", path: ["target_launch_date"],
});
type Values = z.infer<typeof schema>;

export function CampaignFormDialog({ open, onOpenChange, campaign }: { open: boolean; onOpenChange: (o: boolean) => void; campaign?: CampaignWithRelations }) {
  const { me } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: clients } = useQuery({ queryKey: qk.clients, queryFn: clientsService.list, enabled: open });
  const defaults: Values = React.useMemo(() => ({
    name: campaign?.name ?? "", client: campaign?.clients?.name ?? "", description: campaign?.description ?? "",
    stage: campaign?.stage ?? "brief_planning", status: campaign?.status ?? "active", priority: campaign?.priority ?? "medium",
    health: campaign?.health ?? "on_track", design_status: campaign?.design_status ?? "not_started",
    development_status: campaign?.development_status ?? "not_started", qa_status: campaign?.qa_status ?? "not_started",
    uat_status: campaign?.uat_status ?? "not_started", start_date: campaign?.start_date ?? "",
    target_launch_date: campaign?.target_launch_date ?? "", staging_url: campaign?.staging_url ?? "",
    production_url: campaign?.production_url ?? "", notes: campaign?.notes ?? "", journeys: "",
  }), [campaign]);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults });
  React.useEffect(() => { if (open) form.reset(defaults); }, [open, defaults, form]);

  const save = useMutation({
    mutationFn: async (v: Values) => {
      const clientId = v.client ? (await clientsService.findOrCreate(v.client, me!.workspaceId!)).id : null;
      const payload = {
        name: v.name, client_id: clientId, description: v.description || null, stage: v.stage, status: v.status,
        priority: v.priority, health: v.health, design_status: v.design_status, development_status: v.development_status,
        qa_status: v.qa_status, uat_status: v.uat_status, start_date: v.start_date || null,
        target_launch_date: v.target_launch_date || null, staging_url: v.staging_url || null,
        production_url: v.production_url || null, notes: v.notes || null,
      };
      if (campaign) return campaignsService.update(campaign.id, payload);
      const c = await campaignsService.create(payload, me!.workspaceId!, me!.id);
      const names = (v.journeys ?? "").split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
      for (const [i, name] of names.entries()) await journeysService.create({ campaign_id: c.id, name, sort_order: i });
      return c;
    },
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: qk.campaigns });
      void qc.invalidateQueries({ queryKey: qk.campaign(c.id) });
      void qc.invalidateQueries({ queryKey: qk.summary });
      toast.success(campaign ? "Campaign updated" : "Campaign created");
      onOpenChange(false);
      if (!campaign) navigate(`/campaigns/${c.id}`);
    },
    onError: (e) => toast.error(e, campaign ? "Could not save the campaign" : "Could not create the campaign"),
  });

  const err = form.formState.errors;
  const trackOpts = options(TRACK_LABEL);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={campaign ? "Edit campaign" : "New campaign"} className="max-w-2xl"
        description="Track statuses are set by a manager; AI reviews never change them."
        footer={<>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={form.handleSubmit((v) => save.mutate(v))}>
            {campaign ? "Save changes" : "Create campaign"}
          </Button>
        </>}>
        <form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(e) => e.preventDefault()}>
          <Field label="Campaign name" error={err.name?.message} className="sm:col-span-2"><Input autoFocus {...form.register("name")} placeholder="e.g. Gold Drop" /></Field>
          <Field label="Client">
            <Input list="client-list" {...form.register("client")} placeholder="e.g. BigCity" />
            <datalist id="client-list">{(clients ?? []).map((c) => <option key={c.id} value={c.name} />)}</datalist>
          </Field>
          <Field label="Priority"><Select options={options(PRIORITY_LABEL)} {...form.register("priority")} /></Field>
          <Field label="Description" className="sm:col-span-2"><Textarea rows={2} {...form.register("description")} /></Field>
          <Field label="Stage"><Select options={STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s] }))} {...form.register("stage")} /></Field>
          <Field label="Status"><Select options={options(CAMPAIGN_STATUS_LABEL)} {...form.register("status")} /></Field>
          <Field label="Health"><Select options={options(HEALTH_LABEL)} {...form.register("health")} /></Field>
          <div />
          <Field label="Design status"><Select options={trackOpts} {...form.register("design_status")} /></Field>
          <Field label="Development status"><Select options={trackOpts} {...form.register("development_status")} /></Field>
          <Field label="QA status"><Select options={trackOpts} {...form.register("qa_status")} /></Field>
          <Field label="UAT status"><Select options={trackOpts} {...form.register("uat_status")} /></Field>
          <Field label="Start date"><Input type="date" {...form.register("start_date")} /></Field>
          <Field label="Target launch date" error={err.target_launch_date?.message}><Input type="date" {...form.register("target_launch_date")} /></Field>
          <Field label="Staging URL" error={err.staging_url?.message}><Input {...form.register("staging_url")} placeholder="https://" /></Field>
          <Field label="Production URL" error={err.production_url?.message}><Input {...form.register("production_url")} placeholder="https://" /></Field>
          {!campaign && (
            <Field label="Journeys" hint="One per line or separated by semicolons. You can add more later." className="sm:col-span-2">
              <Textarea rows={3} {...form.register("journeys")} placeholder={"Consumer promotion\nAndhra Pradesh retailer scheme\nTelangana retailer contest"} />
            </Field>
          )}
          <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} {...form.register("notes")} /></Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}
