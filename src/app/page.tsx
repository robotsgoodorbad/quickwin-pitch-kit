import type { Metadata } from "next";
import HomePage from "@/components/HomePage";

export const metadata: Metadata = {
  title: "Amuse Bouchenator — Quick-Win Prototype Generator",
  description:
    "Fresh app ideas, served daily\u2014Cursor-ready build steps included.",
};

export default function Page() {
  return <HomePage />;
}
