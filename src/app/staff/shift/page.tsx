import type { Metadata } from "next";
import { Suspense } from "react";
import ShiftDetail from "./ShiftDetail";

export const metadata: Metadata = {
  title: "Shift details",
};

export default function ShiftPage() {
  return (
    <Suspense>
      <ShiftDetail />
    </Suspense>
  );
}
