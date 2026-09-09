import type { Metadata } from "next";
import { Archivo, Fraunces } from "next/font/google";
import AdminPreferences from "./AdminPreferences";

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-archivo",
});
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-fraunces",
});

export const metadata: Metadata = {
  title: "Set up the week",
  robots: { index: false, follow: false },
};

export default function AdminPreferencesPage() {
  return (
    <div className={`${archivo.variable} ${fraunces.variable}`}>
      <AdminPreferences />
    </div>
  );
}
