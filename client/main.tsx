import { StrictMode, Component, lazy, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Layout, PageLoading } from "./components/Layout";
import "@fontsource-variable/atkinson-hyperlegible-next/wght.css";
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
      <section className="page narrow">
        <h1>Something went wrong</h1>
        <p>The page didn’t finish loading. Your file is still on your computer, so you can try again.</p>
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
if (teacher) document.title = "Staff · 3D Print Studio · BNTS";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Layout teacher={teacher}>
      <ErrorBoundary>
        <Suspense fallback={<PageLoading />}>{teacher ? <Teacher /> : <Student />}</Suspense>
      </ErrorBoundary>
    </Layout>
  </StrictMode>,
);
