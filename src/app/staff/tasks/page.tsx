import type { Metadata } from "next";
import { Suspense } from "react";
import Tasks from "./Tasks";

export const metadata: Metadata = {
  title: "Tasks",
};

export default function TasksPage() {
  return (
    <Suspense>
      <Tasks />
    </Suspense>
  );
}
