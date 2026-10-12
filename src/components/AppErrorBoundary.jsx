import React from "react";

export default class AppErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("LingoClub crashed", error, info?.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: "100vh", background: "#0b0c0f", color: "#e5e7eb", padding: "30vh 24px 0", textAlign: "center", fontFamily: "-apple-system, sans-serif" }}>
        <p style={{ fontSize: 18, marginBottom: 12 }}>页面出错了</p>
        <p style={{ fontSize: 13, color: "#9ca3af", marginBottom: 20 }}>{String(this.state.error?.message || this.state.error).slice(0, 200)}</p>
        <button onClick={() => window.location.reload()} style={{ padding: "10px 20px", borderRadius: 8, background: "#f59e0b", color: "#000", border: 0 }}>刷新重试</button>
      </div>
    );
  }
}
