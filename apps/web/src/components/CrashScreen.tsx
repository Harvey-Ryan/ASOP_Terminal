// When a page crashes while rendering, this shows a way out instead of a blank
// screen, and reports the crash with a ref the person can quote (v1.13.0).

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { reportError } from '@/lib/reportError';

interface State { error: Error | null; ref: string | null }

export class CrashScreen extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = { error: null, ref: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const withComponents = Object.assign(new Error(error.message), { name: error.name, stack: `${error.stack ?? ''}\nComponent stack:${info.componentStack ?? ''}` });
    this.setState({ ref: reportError(withComponents, 'render crash') });
  }

  componentDidUpdate(prev: { resetKey?: string }): void {
    // Moving to another page clears the crash.
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null, ref: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center p-6" role="alert">
        <div className="max-w-md space-y-4 rounded-lg border border-destructive/40 bg-card p-6 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-destructive" aria-hidden />
          <h2 className="text-lg font-semibold">This page ran into a problem</h2>
          <p className="text-sm text-muted-foreground">It's been reported. Reloading usually fixes it; if it keeps happening, mention this code when you ask for help.</p>
          {this.state.ref && <p className="font-mono text-sm tracking-widest">Ref {this.state.ref}</p>}
          <div className="flex justify-center gap-2">
            <Button onClick={() => window.location.reload()}>Reload</Button>
            <Button variant="outline" onClick={() => { window.location.href = '/dashboard'; }}>Dashboard</Button>
          </div>
        </div>
      </div>
    );
  }
}
