import type { Metadata } from "next";
import { Archivo, Fraunces } from "next/font/google";
import Financials from "./Financials";

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
  title: "Financials",
  robots: { index: false, follow: false },
};

export default function FinancialsPage() {
  return (
    <div className={`${archivo.variable} ${fraunces.variable}`}>
      <Financials />
    </div>
  );
}
