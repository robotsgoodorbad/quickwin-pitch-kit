import { NextResponse } from "next/server";
import { generateCustomIdeaPlan } from "@/lib/ai";
import type { CompanyContext } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const text: string = (body.text ?? "").trim();
    const companyContext: CompanyContext | undefined = body.companyContext;

    if (!text) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    const result = await generateCustomIdeaPlan(text, companyContext);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Failed to generate" }, { status: 500 });
  }
}
