import { createRoot } from "react-dom/client";

const root = createRoot(document.getElementById("root")!);
const pathname = window.location.pathname.replace(/\/$/, "");

if (pathname === "/simulation/workspace") {
  void Promise.all([
    import("./simulation/StandaloneSimulation"),
    import("./scene-page.css"),
  ]).then(([{ default: StandaloneSimulation }]) => {
    root.render(<StandaloneSimulation />);
  });
} else {
  void Promise.all([
    import("./dashboard/App"),
    import("@fontsource/jost/latin-400.css"),
    import("@fontsource/jost/latin-500.css"),
    import("@fontsource/jost/latin-600.css"),
    import("@fontsource/roboto/latin-400.css"),
    import("@fontsource/roboto/latin-500.css"),
    import("@fontsource/roboto/latin-700.css"),
    import("./dashboard/dashboard.css"),
  ]).then(([{ default: App, AppBoundary }]) => {
    root.render(<AppBoundary><App /></AppBoundary>);
  });
}
