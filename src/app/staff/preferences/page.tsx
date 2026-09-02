import type { Metadata } from "next";
import { Archivo, Fraunces } from "next/font/google";
import Preferences from "./Preferences";

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
  title: "Open shifts, 7–12 Sept",
};

export default function PreferencesPage() {
  return (
    <div className={`${archivo.variable} ${fraunces.variable}`}>
      <Preferences />
    </div>
  );
}
