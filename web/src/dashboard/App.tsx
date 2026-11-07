import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Box,
  CalendarDays,
  Check,
  CheckCircle2,
  FileText,
  Home,
  LogOut,
  Menu,
  Plus,
  Settings,
  Upload,
  Users,
  X,
} from "lucide-react";
import PlanForm from "./PlanForm";
import { Badge, Brand, Button, Card, Heading, Notice } from "./ui";
import {
  exportJSON,
  fmt,
  newDraft,
  planShape,
  steps,
  titles,
  updated,
  validate,
  type Draft,
  type Plan,
  type Step,
} from "./model";
const SimulationPage = lazy(() => import("./SimulationPage"));
const STORAGE = "opsidio:plans:v1",
  SESSION = "opsidio:demo-session";
function loadDrafts(): Draft[] {
  try {
    const items = JSON.parse(localStorage.getItem(STORAGE) ?? "[]");
    return Array.isArray(items)
      ? items.filter(
          (d) =>
            d &&
            typeof d.id === "string" &&
            Number.isSafeInteger(d.revision) &&
            planShape(d.plan),
        )
      : [];
  } catch {
    return [];
  }
}
function authenticated() {
  try {
    return sessionStorage.getItem(SESSION) === "organizer";
  } catch {
    return false;
  }
}
export class AppBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main className="op-recovery">
        <Brand />
        <h1>This view could not load</h1>
        <p>Your saved drafts are still in this browser.</p>
        <Button primary onClick={() => location.assign("/")}>
          Return home
        </Button>
      </main>
    ) : (
      this.props.children
    );
  }
}
export default function App() {
  const [session, setSession] = useState(authenticated),
    [drafts, setDrafts] = useState(loadDrafts),
    [route, setRoute] = useState(location.pathname + location.search),
    [saved, setSaved] = useState("Drafts saved in this browser"),
    [storageError, setStorageError] = useState(""),
    [profile, setProfile] = useState(false),
    [mobileMenu, setMobileMenu] = useState(false),
    [toast, setToast] = useState("");
  const importRef = useRef<HTMLInputElement>(null),
    first = useRef(true);
  useEffect(() => {
    const pop = () => {
      setRoute(location.pathname + location.search);
      setMobileMenu(false);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSaved("Saving…");
    try {
      localStorage.setItem(STORAGE, JSON.stringify(drafts));
      setSaved("All changes saved");
      setStorageError("");
    } catch {
      setSaved("Not saved");
      setStorageError(
        "Browser storage is full or unavailable. Export your plan to keep your changes.",
      );
    }
  }, [drafts]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(id);
  }, [toast]);
  const url = new URL(route, location.origin),
    parts = url.pathname.split("/"),
    isSimulation = url.pathname === "/simulation",
    isSettings = url.pathname === "/settings",
    isReports = url.pathname === "/reports",
    isEvents = url.pathname === "/events",
    draftId = isSimulation
      ? (url.searchParams.get("event") ?? drafts[0]?.id)
      : parts[1] === "events"
        ? parts[2]
        : null,
    draft = drafts.find((d) => d.id === draftId),
    step: Step = steps.includes(parts[3] as Step)
      ? (parts[3] as Step)
      : "brief";
  function navigate(path: string) {
    history.pushState({}, "", path);
    setRoute(path);
    setMobileMenu(false);
    setProfile(false);
    window.scrollTo(0, 0);
  }
  function open(d: Draft, s: Step = "brief") {
    navigate(`/events/${d.id}/${s}`);
  }
  function create(example = false) {
    const d = newDraft(example);
    setDrafts((items) => [d, ...items]);
    open(d);
  }
  function change(plan: Plan) {
    if (!draft) return;
    setDrafts((items) =>
      items.map((d) => (d.id === draft.id ? updated(d, plan) : d)),
    );
  }
  function logout() {
    try {
      sessionStorage.removeItem(SESSION);
    } catch {}
    setSession(false);
    setProfile(false);
    navigate("/");
  }
  function signIn() {
    try {
      sessionStorage.setItem(SESSION, "organizer");
    } catch {}
    setSession(true);
  }
  async function importPlan(file?: File) {
    if (!file) return;
    try {
      if (file.size > 1_000_000)
        throw Error("Choose a plan smaller than 1 MB.");
      const plan = JSON.parse(await file.text());
      if (!planShape(plan))
        throw Error("This file is not a complete Opsidio v0.1 plan.");
      validate(plan);
      const d = { ...newDraft(), plan };
      setDrafts((items) => [d, ...items]);
      open(d);
      setToast("Plan imported. Review its inputs before running.");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Could not import this plan.");
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  }
  if (!session) return <Login onLogin={signIn} />;
  if (isSimulation && draft)
    return (
      <AppBoundary key={draft.id}>
        <Suspense
          fallback={
            <main className="op-recovery">
              <Brand />
              <p>Loading the GBK workspace…</p>
            </main>
          }
        >
          <SimulationPage
            draft={draft}
            onBack={() => open(draft, "review")}
            onChange={change}
          />
        </Suspense>
      </AppBoundary>
    );
  const currentGroup = step === "brief" ? 0 : step === "review" ? 2 : 1,
    issues = draft ? validate(draft.plan) : [],
    complete = draft
      ? steps.slice(0, 5).filter((s) => !issues.some((i) => i.step === s))
          .length
      : 0;
  const icons = [
    { id: "home", icon: Home, label: "Home", path: "/" },
    { id: "events", icon: CalendarDays, label: "Events", path: "/events" },
    {
      id: "simulation",
      icon: Box,
      label: "Simulation",
      path: drafts.length ? `/simulation?event=${drafts[0].id}` : "/events",
    },
    { id: "reports", icon: FileText, label: "Reports", path: "/reports" },
  ];
  const active =
    draft || isEvents
      ? "events"
      : isReports
        ? "reports"
        : isSettings
          ? "settings"
          : "home";
  return (
    <div className={`op-app ${draft ? "has-planner" : ""}`}>
      <a className="op-skip" href="#main">
        Skip to main content
      </a>
      <aside className="op-rail" aria-label="Main navigation">
        <button
          className="op-logo-button"
          title="Opsidio home"
          aria-label="Opsidio home"
          onClick={() => navigate("/")}
        >
          <span className="op-mark" />
        </button>
        <nav>
          {icons.map(({ id, icon: Icon, label, path }) => (
            <button
              key={id}
              title={label}
              aria-label={label}
              aria-current={active === id ? "page" : undefined}
              onClick={() => navigate(path)}
            >
              <Icon size={21} />
            </button>
          ))}
        </nav>
        <div className="op-rail-bottom">
          <button
            title="Settings"
            aria-label="Settings"
            aria-current={active === "settings" ? "page" : undefined}
            onClick={() => navigate("/settings")}
          >
            <Settings size={20} />
          </button>
          <button
            className="op-avatar"
            title="Your profile"
            aria-label="Your profile"
            aria-expanded={profile}
            onClick={() => setProfile(!profile)}
          >
            EO
          </button>
        </div>
      </aside>
      {profile && (
        <div className="op-profile-menu">
          <strong>Event organizer</strong>
          <small>organizer@opsidio.demo</small>
          <Button onClick={() => navigate("/settings")}>
            <Settings size={15} />
            Profile
          </Button>
          <Button onClick={logout}>
            <LogOut size={15} />
            Log out
          </Button>
        </div>
      )}
      {draft && (
        <aside className={`op-planner ${mobileMenu ? "open" : ""}`}>
          <button className="op-back" onClick={() => navigate("/")}>
            <ArrowLeft size={15} />
            Back to home
          </button>
          <Badge tone="coral">
            {draft.demo ? "GBK DEMO" : "ENTRY PLAN"} · V1
          </Badge>
          <h2>{draft.plan.event.name || "Untitled event"}</h2>
          <p className="op-muted">
            {draft.plan.event.date || "Date to be decided"}
            <br />
            {draft.plan.venue.name || "Choose your venue"}
          </p>
          <Badge tone="amber">Draft{draft.demo ? " · Demo inputs" : ""}</Badge>
          <nav aria-label="Event creation progress">
            {[
              "Event brief",
              "Entry operations",
              "Review entry plan",
              "Simulation & insights",
            ].map((label, i) => (
              <button
                key={label}
                className={currentGroup === i ? "current" : ""}
                aria-current={currentGroup === i ? "step" : undefined}
                onClick={() =>
                  i === 3
                    ? navigate(`/simulation?event=${draft.id}`)
                    : open(
                        draft,
                        i === 0 ? "brief" : i === 1 ? "attendance" : "review",
                      )
                }
              >
                <span>
                  {i < 3 &&
                  ((i === 0 && !issues.some((x) => x.step === "brief")) ||
                    (i === 1 &&
                      !issues.some((x) =>
                        [
                          "attendance",
                          "checks",
                          "resources",
                          "targets",
                        ].includes(x.step),
                      ))) ? (
                    <Check size={15} />
                  ) : (
                    String(i + 1).padStart(2, "0")
                  )}
                </span>
                <div>
                  <strong>{label}</strong>
                  {currentGroup === i && (
                    <small>
                      {i === 1
                        ? `${steps.indexOf(step)} of 4 · ${titles[step]}`
                        : "Current section"}
                    </small>
                  )}
                </div>
              </button>
            ))}
          </nav>
          <div className="op-progress">
            <div>
              <span style={{ width: `${(complete / 5) * 100}%` }} />
            </div>
            <small>{complete} of 5 input sections ready</small>
          </div>
          <p className="op-muted">
            Move freely between sections. Readiness is checked before
            optimization.
          </p>
        </aside>
      )}
      <header className="op-topbar">
        {draft && (
          <button
            className="op-mobile-menu"
            onClick={() => setMobileMenu(!mobileMenu)}
            aria-label="Toggle event navigation"
          >
            {mobileMenu ? <X /> : <Menu />}
          </button>
        )}
        <Brand />
        <span>
          {draft
            ? "Planning workspace"
            : isReports
              ? "Reports"
              : isSettings
                ? "Settings"
                : isEvents
                  ? "Events"
                  : "Home"}
        </span>
        <Badge tone={storageError ? "amber" : "green"}>{saved}</Badge>
      </header>
      <main id="main" className="op-main">
        {storageError && (
          <Notice title="Keep a copy of your draft" tone="amber">
            {storageError}{" "}
            {draft && (
              <Button
                onClick={() => exportJSON(draft.plan, "opsidio-plan.json")}
              >
                Export plan
              </Button>
            )}
          </Notice>
        )}
        {draft ? (
          <PlanForm
            key={`${draft.id}:${step}`}
            draft={draft}
            step={step}
            onChange={change}
            onType={(venueType) =>
              setDrafts((items) =>
                items.map((d) =>
                  d.id === draft.id
                    ? {
                        ...d,
                        venueType,
                        revision: d.revision + 1,
                        updatedAt: new Date().toISOString(),
                      }
                    : d,
                ),
              )
            }
            onStep={(s) => open(draft, s)}
            onHome={() => navigate("/")}
            onSimulation={() => navigate(`/simulation?event=${draft.id}`)}
          />
        ) : isSettings ? (
          <>
            <Heading title="Your workspace">
              Account details for the hackathon MVP.
            </Heading>
            <Card title="Event organizer">
              <div className="op-account">
                <span className="op-avatar">EO</span>
                <div>
                  <strong>Event organizer</strong>
                  <p>organizer@opsidio.demo</p>
                </div>
              </div>
              <p className="op-muted">
                Plans are saved on this device. Export JSON to share a plan with
                your team.
              </p>
              <Button onClick={logout}>
                <LogOut size={16} />
                Log out
              </Button>
            </Card>
          </>
        ) : isReports ? (
          <>
            <Heading title="Simulation reports">
              Review the results alongside the event they belong to.
            </Heading>
            <Card title="Compare your entry scenarios">
              <p>
                Open an event’s simulation and choose Optimize to compare V1
                with a returned V2 candidate.
              </p>
              <Button primary onClick={() => navigate("/events")}>
                View events
                <ArrowRight size={16} />
              </Button>
            </Card>
          </>
        ) : (
          <>
            <Heading
              title={isEvents ? "Your events" : "Welcome to Opsidio"}
              action={
                drafts.length ? (
                  <Button primary onClick={() => create()}>
                    <Plus size={16} />
                    Create event
                  </Button>
                ) : undefined
              }
            >
              {isEvents
                ? "Continue an entry plan or start a new scenario."
                : "Bring your next event into focus, one step at a time."}
            </Heading>
            {!drafts.length ? (
              <section className="op-empty">
                <div className="op-empty-icon">
                  <CalendarDays size={40} strokeWidth={1.3} />
                </div>
                <h2>Your first event starts here</h2>
                <p>
                  No event plans yet. Create your first event to explore
                  <br className="op-desktop" /> arrivals, entry checks,
                  staffing, and crowd flow.
                </p>
                <Button primary onClick={() => create()}>
                  Create your first event
                  <ArrowRight size={17} />
                </Button>
                <small>
                  You don’t need every detail yet. Start with what you know.
                </small>
              </section>
            ) : (
              <div className="op-draft-grid">
                {drafts.map((d) => (
                  <Card key={d.id}>
                    <div className="op-draft-art">
                      <CalendarDays size={32} />
                      <Badge>{d.demo ? "GBK demo" : "Draft"}</Badge>
                    </div>
                    <h2>{d.plan.event.name || "Untitled event"}</h2>
                    <p className="op-muted">
                      {d.plan.event.date || "Date to be decided"} ·{" "}
                      {fmt(d.plan.event.expected_attendees_estimate)} expected
                    </p>
                    <p className="op-muted">
                      Updated {new Date(d.updatedAt).toLocaleString()}
                    </p>
                    <Button primary onClick={() => open(d)}>
                      Continue planning
                      <ArrowRight size={16} />
                    </Button>
                    <Button
                      onClick={() => navigate(`/simulation?event=${d.id}`)}
                    >
                      <Box size={16} />
                      3D view
                    </Button>
                  </Card>
                ))}
              </div>
            )}
            <h3 className="op-home-subtitle">A clearer plan in three steps</h3>
            <div className="op-grid three op-help-cards">
              {[
                {
                  Icon: FileText,
                  title: "Define your event",
                  text: "Add the basics and choose a public or private venue.",
                },
                {
                  Icon: Users,
                  title: "Build your entry plan",
                  text: "Plan arrivals, entry checks, staffing, and any missing details.",
                },
                {
                  Icon: Box,
                  title: "Test the possibilities",
                  text: "Explore the 3D view, then optimize and compare changes.",
                },
              ].map(({ Icon, title, text }, i) => (
                <Card key={title}>
                  <div className="op-help-number">
                    <Icon size={21} />
                    <span>0{i + 1}</span>
                  </div>
                  <h3>{title}</h3>
                  <p className="op-muted">{text}</p>
                </Card>
              ))}
            </div>
            <div className="op-demo-actions">
              <span>Have a plan ready?</span>
              <Button onClick={() => importRef.current?.click()}>
                <Upload size={15} />
                Import plan JSON
              </Button>
              <Button onClick={() => create(true)}>
                Explore the GBK demo
                <ArrowRight size={15} />
              </Button>
            </div>
            <input
              ref={importRef}
              type="file"
              accept=".json,application/json"
              hidden
              aria-label="Import plan JSON"
              onChange={(e) => void importPlan(e.target.files?.[0])}
            />
          </>
        )}
      </main>
      {toast && (
        <div className="op-toast" role="status">
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [show, setShow] = useState(false);
  return (
    <main className="op-login">
      <section className="op-login-story">
        <Brand mark />
        <div>
          <Badge tone="coral">PLAN WITH CONFIDENCE</Badge>
          <h1>
            See the crowd.
            <br />
            Shape the experience.
          </h1>
          <p>
            Turn event assumptions into a clearer entry plan.
            <br />
            Explore arrivals, test your resources, and prepare
            <br />
            for the moments that matter.
          </p>
          <div className="op-stadium-art" aria-hidden="true">
            <div />
            <div />
            <div />
            <span>GBK · JAKARTA</span>
          </div>
        </div>
        <small>Better planning. Smoother entrances.</small>
      </section>
      <section className="op-login-form">
        <div>
          <span className="op-eyebrow">YOUR PLANNING WORKSPACE</span>
          <h1>Welcome to Opsidio</h1>
          <p>Log in to plan your next event.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (
                email.trim().toLowerCase() === "organizer@opsidio.demo" &&
                password === "Opsidio2026!"
              )
                onLogin();
              else setError("Use the demo account shown below to log in.");
            }}
          >
            <label className="op-field">
              <span>Email address</span>
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </label>
            <label className="op-field">
              <span>Password</span>
              <input
                type={show ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
              />
            </label>
            <label className="op-check">
              <input
                type="checkbox"
                checked={show}
                onChange={(e) => setShow(e.target.checked)}
              />
              Show password
            </label>
            {error && (
              <p role="alert" className="op-error">
                {error}
              </p>
            )}
            <Button primary type="submit">
              Log in
              <ArrowRight size={16} />
            </Button>
          </form>
          <div className="op-demo-login">
            <strong>Hackathon demo account</strong>
            <span>organizer@opsidio.demo</span>
            <span>Opsidio2026!</span>
            <button
              onClick={() => {
                setEmail("organizer@opsidio.demo");
                setPassword("Opsidio2026!");
                setError("");
              }}
            >
              Use demo details
            </button>
          </div>
          <small className="op-muted">
            An event organizer workspace by Opsidio.
          </small>
        </div>
      </section>
    </main>
  );
}
