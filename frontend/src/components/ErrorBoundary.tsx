import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Catches render-time errors anywhere in the tree and shows a graceful,
 * on-brand fallback instead of a blank white screen (production hardening).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Inferno UI error:", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="glass-raised flex max-w-md flex-col items-center gap-4 p-8 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-danger/15 text-2xl text-danger">
            ⚠
          </div>
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="text-sm text-ink-muted">
            The console hit an unexpected error. Your data is safe — reload to recover.
          </p>
          <pre className="max-h-32 w-full overflow-auto rounded-lg border border-hairline bg-surface/50 p-3 text-left text-[11px] text-ink-faint">
            {this.state.error.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="focusable rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-base"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
