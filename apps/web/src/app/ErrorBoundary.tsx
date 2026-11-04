import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui";

type State = { error: Error | null };

/** Keeps one broken page from blanking the whole app; resets when the route changes. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode; resetKey?: string }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto mt-16 max-w-md text-center">
        <AlertTriangle className="mx-auto mb-2 size-5 text-st-amber" />
        <p className="font-medium">This page hit an error</p>
        <p className="mt-1 text-sm text-muted">{this.state.error.message}</p>
        <p className="mt-1 text-xs text-muted">Your data is safe. Reload the page; if it keeps happening, note what you clicked and tell the admin.</p>
        <Button className="mt-4" onClick={() => window.location.reload()}>Reload page</Button>
      </div>
    );
  }
}
