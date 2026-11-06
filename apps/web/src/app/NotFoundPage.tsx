import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { EmptyState } from "@/components/common";
import { Button } from "@/components/ui";

export function NotFoundPage() {
  return (
    <EmptyState icon={Compass} title="This page doesn’t exist" body="The link may be out of date, or the campaign was deleted."
      action={<Button asChild variant="primary"><Link to="/projects">Go to projects</Link></Button>} />
  );
}
