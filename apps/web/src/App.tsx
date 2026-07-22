import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
  useRouterState
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import {
  Apple,
  CalendarDays,
  Dumbbell,
  HeartPulse,
  Home,
  Settings,
  ShoppingBasket,
  Sparkles,
  TrendingUp,
  type LucideIcon
} from "lucide-react";

import { Button } from "./components/ui/button.js";
import { OnboardingWizard } from "./onboarding/OnboardingWizard.js";
import { SettingsScreen } from "./settings/SettingsScreen.js";
import { ProgressScreen } from "./training/ProgressScreen.js";
import { WorkoutScreen } from "./training/WorkoutScreen.js";
import { clearFirstPlanHandoff, isFirstPlanHandoff } from "./lib/first-plan.js";
import { intellaClient } from "./lib/api.js";
import { cn } from "./lib/utils.js";

const navItems = [
  { label: "Today", to: "/", icon: Home },
  { label: "Onboarding", to: "/onboarding", icon: HeartPulse },
  { label: "Workout", to: "/workout", icon: Dumbbell },
  { label: "Progress", to: "/progress", icon: TrendingUp },
  { label: "Meal Plan", to: "/meal-plan", icon: Apple },
  { label: "Grocery", to: "/grocery", icon: ShoppingBasket },
  { label: "Settings", to: "/settings", icon: Settings }
] as const satisfies ReadonlyArray<{
  label: string;
  to: string;
  icon: LucideIcon;
}>;

function AppShell() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname
  });
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: () => intellaClient.getHealth(),
    refetchInterval: 30_000,
    retry: 1
  });
  const healthLabel =
    healthQuery.data?.status === "ok"
      ? "Live"
      : healthQuery.isPending
        ? "Checking"
        : "Offline";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen lg:grid-cols-[260px_1fr]">
        <aside className="border-b border-border bg-sidebar px-4 py-4 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between gap-3 lg:block">
            <div>
              <div className="text-lg font-semibold">Intella</div>
              <div className="mt-1 text-sm text-muted-foreground">{healthLabel}</div>
            </div>
            <div
              className={cn(
                "h-2.5 w-2.5 rounded-full",
                healthQuery.data?.status === "ok"
                  ? "bg-emerald-500"
                  : healthQuery.isPending
                    ? "bg-amber-400"
                    : "bg-rose-500"
              )}
              aria-label={`API ${healthLabel}`}
            />
          </div>

          <nav className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.to;

              return (
                <Button
                  key={item.to}
                  asChild
                  variant={isActive ? "secondary" : "ghost"}
                  className="justify-start"
                >
                  <Link to={item.to}>
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </Link>
                </Button>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 px-5 py-6 sm:px-8 lg:px-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function TodayScreen() {
  // Onboarding hands off here with a one-time "generating your first plan" flag.
  const [handoff, setHandoff] = useState(() => isFirstPlanHandoff());

  if (handoff) {
    return (
      <FirstPlanHandoff
        onDismiss={() => {
          clearFirstPlanHandoff();
          setHandoff(false);
        }}
      />
    );
  }

  return (
    <ScreenFrame title="Today" eyebrow="Dashboard">
      <div className="grid gap-4 md:grid-cols-3">
        <MetricPanel icon={Dumbbell} label="Workout" value="Planned" />
        <MetricPanel icon={Apple} label="Meals" value="Open" />
        <MetricPanel icon={ShoppingBasket} label="Grocery" value="Ready" />
      </div>
    </ScreenFrame>
  );
}

function FirstPlanHandoff({ onDismiss }: { onDismiss: () => void }) {
  return (
    <section className="mx-auto grid w-full max-w-2xl gap-6 py-10 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
        <Sparkles className="h-6 w-6 text-primary" />
      </div>
      <div className="grid gap-2">
        <h1 className="text-3xl font-semibold">Generating your first plan</h1>
        <p className="text-sm text-muted-foreground">
          Your profile, goal, training, and nutrition are saved. Your personalized
          program and meal plan generate here once the training and nutrition engines
          come online (Phase 2–3). Until then, everything you entered is captured and
          editable in Settings.
        </p>
      </div>
      <div className="flex justify-center gap-3">
        <Button onClick={onDismiss}>
          <Home className="h-4 w-4" />
          Go to Today
        </Button>
        <Button asChild variant="outline">
          <Link to="/settings">
            <Settings className="h-4 w-4" />
            Review in Settings
          </Link>
        </Button>
      </div>
    </section>
  );
}

function MealPlanScreen() {
  return (
    <ScreenFrame title="Meal Plan" eyebrow="Meals">
      <div className="grid gap-2 md:grid-cols-7">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
          <div key={day} className="rounded-md border border-border bg-panel p-3">
            <div className="text-sm font-medium">{day}</div>
            <div className="mt-4 h-20 rounded bg-muted" />
          </div>
        ))}
      </div>
    </ScreenFrame>
  );
}

function GroceryScreen() {
  return (
    <ScreenFrame title="Grocery" eyebrow="List">
      <div className="grid gap-3 md:grid-cols-2">
        {["Produce", "Protein", "Pantry", "Dairy"].map((category) => (
          <Row key={category} label={category} value="0 checked" />
        ))}
      </div>
    </ScreenFrame>
  );
}

function ScreenFrame({
  children,
  eyebrow,
  title
}: {
  children: ReactNode;
  eyebrow: string;
  title: string;
}) {
  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6">
      <header className="flex items-end justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="text-sm font-medium text-muted-foreground">{eyebrow}</div>
          <h1 className="mt-2 text-3xl font-semibold">{title}</h1>
        </div>
        <CalendarDays className="h-5 w-5 text-muted-foreground" />
      </header>
      {children}
    </section>
  );
}

function MetricPanel({
  icon: Icon,
  label,
  value
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border bg-panel p-4">
      <Icon className="h-5 w-5 text-primary" />
      <div className="mt-5 text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-3 rounded-md border border-border bg-panel px-4">
      <span className="font-medium">{label}</span>
      <span className="text-sm text-muted-foreground">{value}</span>
    </div>
  );
}

const rootRoute = createRootRoute({
  component: AppShell
});

const todayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: TodayScreen
});

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/onboarding",
  component: OnboardingWizard
});

const workoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workout",
  component: WorkoutScreen
});

const progressRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/progress",
  component: ProgressScreen
});

const mealPlanRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/meal-plan",
  component: MealPlanScreen
});

const groceryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/grocery",
  component: GroceryScreen
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsScreen
});

const routeTree = rootRoute.addChildren([
  todayRoute,
  onboardingRoute,
  workoutRoute,
  progressRoute,
  mealPlanRoute,
  groceryRoute,
  settingsRoute
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function App() {
  return <RouterProvider router={router} />;
}
