import { Suspense } from "react";
import { HoneypotDashboard } from "./components/honeypot-dashboard";

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
      <HoneypotDashboard />
    </Suspense>
  );
}
