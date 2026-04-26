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

    const { processName, processCode, dateRange, stats, readings, standards, instructions } = await req.json();

    if (!processName) {
      return new Response(
        JSON.stringify({ error: "processName is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const failRate = stats?.total ? ((stats.fail / stats.total) * 100) : 0;

    // Calculate compliance score from readings
    let complianceScore: number | null = null;
    if (readings && readings.length > 0) {
      const totalReadings = readings.length;
      const inSpecCount = readings.filter((r: any) => r.withinSpec === true).length;
      complianceScore = Math.round((inSpecCount / totalReadings) * 100);
    }

    const systemPrompt = `You are an expert Quality Assurance analyst in a manufacturing environment. You analyze process inspection data, process standards, and process instructions to provide actionable insights.

CRITICAL FORMAT RULES:
- All section headings (##) MUST be in English only.
- All content, bullet points, explanations, and details under each heading MUST be written in Urdu.
- Never write headings in Urdu. Never write content/details in English.
- The FIRST section must always be "Inspection Conclusion" — a brief 2-3 line overall verdict.

Use these exact English headings IN THIS ORDER:

## Inspection Conclusion
(2-3 lines conclusion in Urdu — is the process healthy or needs attention?)

## Quality Summary
(write details in Urdu)

## Standards Compliance
(Compare actual inspection readings against the documented process standards/specifications. Highlight which standards are being met and which are violated. Write details in Urdu.)

## Process Instructions Review
(Review whether the documented process instructions/SOPs are being followed based on inspection results. Identify any gaps between what instructions require and what actual data shows. Highlight safety-related instructions if any violations are detected. Write details in Urdu.)

## Trend Analysis
(write details in Urdu)

## Out-of-Spec Identification
(write details in Urdu)

## Root Cause Analysis
(write details in Urdu)

## Recommendations
(write details in Urdu)

Use bullet points and bold text. Be direct and practical — this is for production floor managers.`;

    const userPrompt = `Analyze the following QA inspection data for process "${processName}" (${processCode}):

**Date Range**: ${dateRange || "Current period"}

**Summary Stats**:
- Total Inspections: ${stats?.total || 0}
- Pass: ${stats?.pass || 0} (${stats?.total ? ((stats.pass / stats.total) * 100).toFixed(1) : 0}%)
- Fail: ${stats?.fail || 0} (${stats?.total ? ((stats.fail / stats.total) * 100).toFixed(1) : 0}%)
- Hold: ${stats?.hold || 0} (${stats?.total ? ((stats.hold / stats.total) * 100).toFixed(1) : 0}%)

**Parameter Readings** (sample from recent inspections):
${readings && readings.length > 0
  ? readings.map((r: any) => `- ${r.parameter}: ${r.value} | Spec Status: ${r.withinSpec ? "OK" : "Out of Spec"}`).join("\n")
  : "No parameter data available"}

**Process Standards/Specifications** (documented benchmarks):
${standards && standards.length > 0
  ? standards.map((s: any) => `- **${s.standard_title}** [${s.standard_type || "specification"}]: Target=${s.target_value || "N/A"}, Tolerance=${s.tolerance_range || "N/A"}${s.standard_description ? " | " + s.standard_description : ""}`).join("\n")
  : "No standards documented for this process"}

**Process Instructions/SOPs** (documented steps operators must follow):
${instructions && instructions.length > 0
  ? instructions.map((i: any) => `- **Step ${i.step_number}: ${i.title}** [${i.instruction_type || "step"}]${i.description ? " — " + i.description : ""}`).join("\n")
  : "No process instructions documented for this process"}

Provide comprehensive quality analysis. Compare actual readings against documented standards where applicable. Review whether process instructions are being followed based on inspection outcomes. Start with a brief inspection conclusion first. REMEMBER: Headings in English, all details in Urdu.`;

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
      JSON.stringify({ insights, failRate, complianceScore }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("qa-ai-insights error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
