import type { Metadata } from "next";
import HomePage from "@/components/HomePage";

export const metadata: Metadata = {
  title: "Amuse Bouchenator — Quick-Win Prototype Generator",
  description:
    "Generate taster-menu prototype ideas for any company, complete with Cursor-ready build steps.",
};

export default function Page() {
  return <HomePage />;
}
