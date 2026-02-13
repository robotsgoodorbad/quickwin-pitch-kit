import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    hasProductHuntToken: Boolean(process.env.PRODUCT_HUNT_TOKEN),
  });
}
