import { Component, type ReactNode, type ErrorInfo } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidMount(): void {
    window.addEventListener('error', this.handleWindowError);
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection);
  }

  componentWillUnmount(): void {
    window.removeEventListener('error', this.handleWindowError);
    window.removeEventListener('unhandledrejection', this.handleUnhandledRejection);
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[AgentForge:Error]', error, errorInfo);
  }

  private handleWindowError = (event: ErrorEvent): void => {
    console.error('[AgentForge:Error]', event.message, event.error);
    // Only crash the UI for ReactFlow errors — polling/network errors are non-critical
    if (event.message?.includes('ReactFlow') || event.message?.includes('react-flow')) {
      this.setState({ hasError: true, error: event.error });
    }
  };

  private handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
    console.error('[AgentForge:UnhandledRejection]', event.reason);
    // WebSocket disconnects are expected during deployment — don't crash the UI
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="h-screen flex items-center justify-center bg-background text-foreground">
          <Alert variant="destructive" className="max-w-md shadow-md">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Something went wrong</AlertTitle>
            <AlertDescription>{this.state.error?.message || 'An unexpected error occurred'}</AlertDescription>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}>Reload AgentForge</Button>
          </Alert>
        </div>
      );
    }
    return this.props.children;
  }
}
