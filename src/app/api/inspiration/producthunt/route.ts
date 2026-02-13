import { NextResponse } from "next/server";
import { fetchProductHuntTrending } from "@/lib/producthunt";

export async function GET() {
  try {
    const posts = await fetchProductHuntTrending();
    return NextResponse.json({ posts });
  } catch {
    return NextResponse.json({ posts: [] });
  }
}
