import { StrictMode, Component, lazy, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Layout, Loading } from "./components/Layout";
import "./styles.css";
import { isTeacherPage } from "./platform";
const Student = lazy(() => import("./Student"));
const Teacher = lazy(() => import("./Teacher"));
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <section className="panel narrow connection-error">
        <h1>Page unavailable</h1>
        <p>The page couldn’t finish loading. Your original file is still on your computer.</p>
        <button className="button primary" onClick={() => location.reload()}>
          Reload page
        </button>
      </section>
    ) : (
      this.props.children
    );
  }
}
const teacher = isTeacherPage;
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Layout teacher={teacher}>
      <ErrorBoundary>
        <Suspense fallback={<Loading />}>{teacher ? <Teacher /> : <Student />}</Suspense>
      </ErrorBoundary>
    </Layout>
  </StrictMode>,
);
