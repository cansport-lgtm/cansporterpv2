import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RotateCw, ArrowLeft } from "lucide-react";

interface Props {
  children: ReactNode;
  /** When this value changes, the boundary clears any captured error.
   *  Pass the current route so navigating away recovers automatically. */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time errors anywhere below it and shows a recoverable
 * fallback instead of letting the whole app unmount to a blank white screen.
 * Without this, a single thrown error (e.g. on the dispatch screen) blanks
 * the entire page with no message.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prevProps: Props) {
    // Recover when the route changes (e.g. the user navigates elsewhere).
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface the real cause in the console for diagnostics.
    console.error("Unhandled UI error:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md space-y-4 rounded-lg border bg-card p-6 text-center shadow-sm">
          <div className="flex justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Something went wrong</h2>
            <p className="text-sm text-muted-foreground">
              This screen hit an unexpected error. You can reload or go back and try again.
            </p>
          </div>
          {error.message && (
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-left text-xs text-muted-foreground">
              {error.message}
            </pre>
          )}
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={() => window.history.back()}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Go back
            </Button>
            <Button onClick={() => window.location.reload()}>
              <RotateCw className="mr-2 h-4 w-4" />
              Reload
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
