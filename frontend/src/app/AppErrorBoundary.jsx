import { Component } from "react";
import ErrorFallback from "./AppErrorFallback.jsx";

// Catches render crashes anywhere below it. Shows a fixed message only: no error
// details, no data, and no client error reporting.
export default class AppErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <ErrorFallback /> : this.props.children;
  }
}
