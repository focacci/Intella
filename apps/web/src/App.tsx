import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
  useRouterState
} from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  Apple,
  CalendarDays,
  Dumbbell,
  HeartPulse,
  Home,
  Save,
  Settings,
  ShoppingBasket,
  type LucideIcon
} from "lucide-react";

import { Button } from "./components/ui/button.js";
import { intellaClient } from "./lib/api.js";
import { cn } from "./lib/utils.js";

const navItems = [
  { label: "Today", to: "/", icon: Home },
  { label: "Onboarding", to: "/onboarding", icon: HeartPulse },
  { label: "Workout", to: "/workout", icon: Dumbbell },
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

function OnboardingScreen() {
  return (
    <ScreenFrame title="Onboarding" eyebrow="Profile">
      <div className="grid gap-3 md:grid-cols-5">
        {["Physiology", "Goals", "Training", "Nutrition", "Review"].map(
          (step, index) => (
            <div key={step} className="rounded-md border border-border bg-panel p-4">
              <div className="text-sm text-muted-foreground">Step {index + 1}</div>
              <div className="mt-2 font-medium">{step}</div>
            </div>
          )
        )}
      </div>
    </ScreenFrame>
  );
}

function TodayScreen() {
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

function WorkoutScreen() {
  return (
    <ScreenFrame title="Workout" eyebrow="Training">
      <div className="grid gap-3">
        {["Warm-up", "Main lifts", "Accessories", "Feedback"].map((item) => (
          <Row key={item} label={item} value="Queued" />
        ))}
      </div>
    </ScreenFrame>
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

function SettingsScreen() {
  const queryClient = useQueryClient();
  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: () => intellaClient.getProfile(),
    retry: 1
  });
  const systemStatusQuery = useQuery({
    queryKey: ["system-status"],
    queryFn: () => intellaClient.getSystemStatus(),
    retry: 1
  });
  const saveProfile = useMutation({
    mutationFn: () =>
      intellaClient.putProfile({
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        unitSystem: "metric",
        activityLevel: "moderate"
      }),
    onSuccess: (profile) => {
      queryClient.setQueryData(["profile"], profile);
    }
  });

  return (
    <ScreenFrame title="Settings" eyebrow="System">
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="rounded-md border border-border bg-panel p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">Profile</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {profileQuery.data
                  ? profileQuery.data.timezone
                  : profileQuery.isPending
                    ? "Loading"
                    : "Unavailable"}
              </div>
            </div>
            <Button
              onClick={() => saveProfile.mutate()}
              disabled={saveProfile.isPending}
            >
              <Save className="h-4 w-4" />
              Save
            </Button>
          </div>
        </div>
        <div className="rounded-md border border-border bg-panel p-4">
          <div className="font-medium">Mode</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {systemStatusQuery.data?.mode ?? "Unavailable"}
          </div>
        </div>
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
  component: OnboardingScreen
});

const workoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workout",
  component: WorkoutScreen
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
