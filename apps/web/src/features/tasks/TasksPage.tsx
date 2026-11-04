import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { must } from "@/services/db";
import { Card, Tabs } from "@/components/ui";
import { EmptyState, PageHeader, StatusDot, Table, Td, Th, Tr } from "@/components/common";
import { FEEDBACK_STATUS_LABEL } from "@/lib/labels";
import { formatDate } from "@/lib/utils";
import { TaskList } from "./TaskList";

export function TasksPage() {
  const [tab, setTab] = React.useState<"tasks" | "feedback">("tasks");
  return (
    <>
      <PageHeader title="Tasks & Feedback" description="Corrections and work items across campaigns, and client feedback waiting to be actioned." />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ value: "tasks", label: "Tasks" }, { value: "feedback", label: "Client feedback" }]} />
      {tab === "tasks" ? <TaskList /> : <AllFeedback />}
    </>
  );
}

function AllFeedback() {
  const { data } = useQuery({
    queryKey: ["delivery", "feedback", "all"],
    queryFn: async () => must(await supabase.from("client_feedback").select("*, campaigns(name)").order("received_on", { ascending: false }).limit(200)),
  });
  if (!data?.length) return <Card><EmptyState title="No client feedback recorded" body="Record feedback on a campaign’s Approvals tab." /></Card>;
  return (
    <Table>
      <thead><tr><Th>Received</Th><Th>Feedback</Th><Th>Campaign</Th><Th>Status</Th></tr></thead>
      <tbody>
        {data.map((f) => (
          <Tr key={f.id}>
            <Td className="text-xs text-muted num whitespace-nowrap">{formatDate(f.received_on)}</Td>
            <Td className="max-w-[420px] truncate">{f.summary}</Td>
            <Td><Link to={`/campaigns/${f.campaign_id}/approvals`} className="text-text-2 hover:text-text">{(f.campaigns as { name: string } | null)?.name}</Link></Td>
            <Td><StatusDot tone={f.status === "open" ? "violet" : f.status === "converted" ? "blue" : "gray"} label={FEEDBACK_STATUS_LABEL[f.status]} /></Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
