import type { Metadata } from "next";
import Schedule from "./Schedule";

export const metadata: Metadata = {
  title: "Weekly Shift Schedule",
};

export default function SchedulePage() {
  return <Schedule />;
}
