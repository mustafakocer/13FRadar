import { Component } from 'react';

// A render error inside one page must not take the whole app down: the shell
// (top bar, footer, palette) stays, the page area shows what went wrong and
// a way to try again. Reset when the route changes, so navigating away from
// a broken page is enough to recover — the parent passes the pathname as
// `resetKey` for that.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // the console is where a support request starts; keep it on one line
    console.error('page render failed', error?.message || error, info?.componentStack || '');
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const { title = 'Something went wrong', retry = 'Try again', message = null } = this.props;
    return (
      <div className="error-box" role="alert">
        <div>{title}</div>
        {message && <div className="small muted" style={{ marginTop: 6 }}>{message}</div>}
        <div className="small muted" style={{ marginTop: 6 }}>{String(this.state.error?.message || this.state.error)}</div>
        <button className="btn ghost sm" style={{ marginTop: 12 }} onClick={() => this.setState({ error: null })}>
          {retry}
        </button>
      </div>
    );
  }
}
