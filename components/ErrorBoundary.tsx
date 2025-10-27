import React, { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

class ErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(_: Error): State {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  private handleReset = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-4 font-sans bg-gray-200 dark:bg-gray-800 text-gray-800 dark:text-gray-200">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-4">Oops! Something went wrong.</h1>
            <p className="mb-6">The application encountered an unexpected error.</p>
            <button
              onClick={this.handleReset}
              className="bg-red-600 text-white font-bold py-2 px-4 rounded hover:bg-red-700 transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    // Fix: In a React class component, props are accessed via `this.props`. This returns the nested components (children).
    return this.props.children;
  }
}

export default ErrorBoundary;
