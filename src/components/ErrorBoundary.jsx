import { Component } from 'react';
import { useLocation } from 'react-router-dom';
import ServerError from '../pages/errors/ServerError';
import { isChunkLoadError, reloadOnceForChunkError } from '../lib/chunkReload';

/**
 * Wraps <Routes> in App.jsx. React error boundaries must be class
 * components (no hook equivalent). Any uncaught render error anywhere in
 * the tree surfaces the same designed 500 page the rest of the app
 * uses for a backend 500, instead of an unstyled crash / blank screen.
 *
 * Two things keep it from being a dead end:
 *  - a failed lazy chunk (stale tab after a deploy) triggers one automatic reload;
 *  - the error state clears when the user navigates to another route, so one
 *    broken page no longer sticks until a manual refresh.
 * "Try again" still does a hard reload since React can't safely resume the subtree that threw.
 */
class Boundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('Unhandled render error:', error, info);
    if (isChunkLoadError(error)) reloadOnceForChunkError();
  }

  componentDidUpdate(prevProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return <ServerError onRetry={() => window.location.reload()} />;
    }
    return this.props.children;
  }
}

export default function ErrorBoundary({ children }) {
  const { pathname } = useLocation();
  return <Boundary resetKey={pathname}>{children}</Boundary>;
}
