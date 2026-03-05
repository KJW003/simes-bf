import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  error: Error | null;
}

/**
 * Global error boundary – catches unhandled render errors
 * and displays a user-friendly recovery screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  handleDismiss = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
          <div className="max-w-md w-full space-y-6 text-center">
            <AlertCircle className="w-12 h-12 text-destructive mx-auto" />
            <div className="space-y-2">
              <h1 className="text-xl font-bold text-foreground">
                {this.props.fallbackTitle ?? "Une erreur est survenue"}
              </h1>
              <p className="text-sm text-muted-foreground">
                L'application a rencontré une erreur inattendue.
              </p>
              {import.meta.env.DEV && (
                <pre className="mt-4 p-3 bg-muted rounded text-xs text-left overflow-auto max-h-40">
                  {this.state.error.message}
                </pre>
              )}
            </div>
            <div className="flex gap-3 justify-center">
              <Button variant="outline" onClick={this.handleDismiss}>
                Réessayer
              </Button>
              <Button onClick={this.handleReload}>
                <RefreshCw className="w-4 h-4 mr-2" /> Recharger
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
