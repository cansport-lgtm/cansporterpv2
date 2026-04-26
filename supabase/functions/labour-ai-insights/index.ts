import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const { departmentName, dateRange, stats, workers } = await req.json();

    if (!departmentName) {
      return new Response(
        JSON.stringify({ error: "departmentName is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const avgEfficiency = stats?.totalTarget > 0 ? ((stats.totalActual / stats.totalTarget) * 100) : 0;
    const lowEfficiencyRate = avgEfficiency < 80;

    const systemPrompt = `You are an expert Labour Productivity analyst in a manufacturing environment. You analyze worker productivity data by department and provide actionable insights.

CRITICAL FORMAT RULES:
- All section headings (##) MUST be in English only.
- All content, bullet points, explanations, and details under each heading MUST be written in Urdu.
- IMPORTANT: Worker names, employee codes, process names, and department names must ALWAYS be written in English exactly as provided in the data. Do NOT transliterate names into Urdu.
- Never write headings in Urdu. Never write content/details in English (except names as noted above).
- The FIRST section must always be "Productivity Conclusion" — a brief 2-3 line overall verdict.

Use these exact English headings IN THIS ORDER:

## Productivity Conclusion
(2-3 lines conclusion in Urdu — is the department performing well or needs attention?)

## Department Summary
(write details in Urdu)

## Worker Performance Analysis
(write details in Urdu — highlight top and bottom performers)

## Efficiency Trends
(write details in Urdu)

## Root Cause Analysis
(write details in Urdu — why are some workers underperforming?)

## Recommendations
(write details in Urdu — actionable steps for improvement)

Use bullet points and bold text. Be direct and practical — this is for production floor managers.`;

    const workerDetails = workers && workers.length > 0
      ? workers.map((w: any) => `- ${w.empName} (${w.empCode}) | Category: ${w.category} | Process: ${w.process} | MPH: ${w.mph} | Target: ${w.target} | Actual: ${w.actual} | Efficiency: ${w.efficiency.toFixed(1)}% | Work Type: ${w.workType}`).join("\n")
      : "No worker data available";

    const userPrompt = `Analyze the following Labour Productivity data for department "${departmentName}":

**Date Range**: ${dateRange || "Current period"}

**Department Summary**:
- Total Workers: ${stats?.totalEmployees || 0}
- Total MPH (Man Power Hours): ${stats?.totalMph || 0}
- Total Target: ${stats?.totalTarget || 0}
- Total Actual: ${stats?.totalActual || 0}
- Average Efficiency: ${avgEfficiency.toFixed(1)}%

**Worker-wise Details**:
${workerDetails}

Provide comprehensive productivity analysis. Start with a brief productivity conclusion first. REMEMBER: Headings in English, all details in Urdu.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add funds in Settings > Workspace > Usage." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: "AI analysis failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const insights = data.choices?.[0]?.message?.content || "No insights generated.";

    return new Response(
      JSON.stringify({ insights, avgEfficiency }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("labour-ai-insights error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
