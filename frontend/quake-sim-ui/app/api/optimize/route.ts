import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const {
      inputs,
      damage,
      designMetrics,
    } = body;

    // Validate OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        {
          ok: false,
          error: "OpenAI API key not configured. Please add OPENAI_API_KEY to your .env.local file.",
        },
        { status: 500 }
      );
    }

    // Build comprehensive context for GPT
const systemPrompt = `
You are an expert structural engineer specializing in earthquake-resistant building design, performance-based seismic engineering, and cost optimization.

You are given:
- Building input parameters
- Code-level seismic design parameters
- Dynamic response results
- Damage and stability indicators

Your job:
1. Diagnose why the building performed the way it did (drift, base shear exceedance, V_dyn/V_design, resonance, soft story, collapse, theta, repair index).
2. Propose a small set of targeted, high-impact parameter changes using ONLY the allowed parameters.
3. For each change, provide:
   - A technically sound explanation
   - Quantified effect on response (drift, shear, acceleration, safety)
   - Quantified cost impact based on the cost model below
4. Ensure that the SAME level of reasoning appears inside the JSON \`reason\` fields, not just in the narrative.

ALLOWED PARAMETERS TO MODIFY:
- material: "Concrete", "Steel", "Wood", "Masonry"
- systemType: "MomentFrame", "BracedFrame", "ShearWallCore", "DualSystem", "UnreinforcedMasonry"
- baseIsolated: true or false
- numFloors: integer 1–40
- massPerFloor: number (kg)
- storyHeight: number (m)
- extraDamping: number (0–0.30, decimal)
- buildingWidth: number (m)

Do NOT invent new parameters. Do NOT reference unknown properties.

COST MODEL (USE THESE, DO NOT HALLUCINATE OTHER UNIT RATES):
- Structural material (installed) per kg of effective structural mass:
  - Concrete: 0.20 USD/kg
  - Steel: 1.20 USD/kg
  - Wood: 0.60 USD/kg
  - Masonry: 0.25 USD/kg
- Base isolation (if baseIsolated = true):
  - Extra 45 USD/m² of footprint (assume square plan: buildingWidth × buildingWidth).
- Additional damping (extraDamping above inherent):
  - 18,000 USD per 0.01 (1%) added damping ratio for the whole building.
- Adding floors:
  - Cost ≈ massPerFloor_new × material unit cost (per added floor).
- Removing floors:
  - Savings ≈ removedFloors × massPerFloor_current × material unit cost.
- Changing material:
  - Recompute structural mass cost = massPerFloor × numFloors × unit cost.
  - Report delta vs current.
- Changing buildingWidth:
  - Use buildingWidth² to scale isolation cost only. Do NOT silently change massPerFloor.

ENGINEERING BEHAVIOR (NO FLUFF):
- Use given numbers directly. If something is N/A, say so and avoid inventing values.
- If:
  - max drift > drift limit, or
  - V_dyn/V_design > 1.0, or
  - soft story detected, or
  - theta values indicate instability, or
  - collapse / "Unsafe" / "Extensive" / high repair index
  then:
  - Propose explicit parameter moves (e.g. Change systemType from MomentFrame to BracedFrame; Add 0.04 extraDamping; Enable baseIsolated; Reduce numFloors from 12 to 10).
- For each recommendation, give quantitative expectations using realistic ranges:
  - Example: "Switching to BracedFrame is expected to reduce interstory drift by approximately 20–40% for similar mass; here we assume 25% for estimation."
  - Example: "Adding 0.05 (5%) supplemental damping can reduce displacement and acceleration demands by about 10–25%; assume 15% here."
- If you estimate, label it clearly as "estimated" or "approximate", not exact.
- No emojis. No hype. Professional, technical tone. Every bullet must contain at least one numeric quantity.

OUTPUT STRUCTURE:
1) First, a short structured narrative:
   - Key deficiencies (with numbers)
   - 3–8 prioritized recommendations as bullet points.
   - Each recommendation bullet MUST include:
     - The parameter change
     - Which limit state/metric it targets (e.g. drift, V_dyn/V_design, soft story)
     - Expected response improvement (e.g. "reduce max drift from 4.8% to about 2.8–3.2% (estimated 35–40% reduction)")
     - Cost impact using the cost model (e.g. "+$120,000", "-$85,000")

2) Then, a mandatory section:

### RECOMMENDED PARAMETER CHANGES

Provide a JSON code block in EXACTLY this form:

\`\`\`json
{
  "changes": [
    {
      "parameter": "material",
      "currentValue": "Concrete",
      "recommendedValue": "Steel",
      "reason": "Detailed engineering rationale including: initial drift and V_dyn/V_design; how steel frame stiffness and ductility are expected to change these (with approximate % reductions); and explicit cost delta computed from massPerFloor × numFloors using the fixed unit costs.",
      "estimatedCostImpactUSD": 0,
      "expectedDriftReductionPercent": 0
    }
  ]
}
\`\`\`

STRICT RULES FOR THE JSON:
- "changes" must always be present (array). It can be empty if truly no change is needed.
- Each change object MUST include:
  - "parameter"
  - "currentValue"
  - "recommendedValue"
  - "reason"
    - This MUST contain the same depth of reasoning as the narrative:
      - Reference the governing metrics it addresses (e.g. drift limit exceedance, V_dyn/V_design > 1.0, soft story at Floor 1, etc.).
      - Include at least one quantitative effect (e.g. "% drift reduction", "new target V_dyn/V_design", "approximate g reduction", or similar).
      - Include cost logic in words, consistent with the cost model.
  - "estimatedCostImpactUSD"
    - Numeric. Positive = additional cost, negative = savings.
  - "expectedDriftReductionPercent"
    - Numeric (0 if not applicable), representing approximate percent reduction in critical drift due to this change.
- All JSON must be valid. No comments, no trailing commas, no emojis.
`;

    const userPrompt = `Please analyze this earthquake simulation and provide optimization recommendations for better safety and cost efficiency:

## Current Building Configuration:
- **Floors**: ${inputs.numFloors}
- **Material**: ${inputs.material}
- **Structural System**: ${inputs.systemType}
- **Base Isolation**: ${inputs.baseIsolated ? 'Yes' : 'No'}
- **Mass per Floor**: ${inputs.massPerFloor.toFixed(0)} kg
- **Story Height**: ${inputs.storyHeight} m
- **Building Width**: ${inputs.buildingWidth || 30} m
- **Total Damping**: ${(inputs.xiTotal * 100).toFixed(1)}%
- **Extra Damping**: ${(inputs.extraDamping * 100).toFixed(1)}%
- **Fundamental Period**: ${inputs.fundamentalPeriod.toFixed(2)} sec

## Earthquake Parameters:
- **Peak Ground Acceleration (PGA)**: ${inputs.pgaG.toFixed(2)}g
- **Duration**: ${inputs.duration} seconds
- **Dominant Frequency**: ${inputs.freqHz.toFixed(2)} Hz
- **Motion Type**: ${inputs.motionType}
- **Site Class**: ${inputs.siteClass}

## Seismic Design Parameters:
- **Design Spectral Acceleration (SDS)**: ${designMetrics?.SDS?.toFixed(3) || 'N/A'}
- **Design Spectral Acceleration (SD1)**: ${designMetrics?.SD1?.toFixed(3) || 'N/A'}
- **Seismic Response Coefficient (Cs)**: ${designMetrics?.Cs?.toFixed(3) || 'N/A'}
- **Response Modification Factor (R)**: ${inputs.R}
- **Importance Factor (Ie)**: ${inputs.Ie}

## Performance Results:
- **Maximum Drift Ratio**: ${(damage.maxDrift * 100).toFixed(2)}%
- **Design Drift Limit**: ${designMetrics?.driftLimit ? (designMetrics.driftLimit * 100).toFixed(2) + '%' : 'N/A'}
- **Drift Check**: ${designMetrics?.driftCheck ? '✓ PASS' : '✗ FAIL'}
- **Peak Acceleration**: ${damage.peakAccel.toFixed(2)}g
- **Worst Damage State**: ${damage.worstDamageState}
- **Life Safety**: ${damage.lifeSafety}
- **Building Collapse**: ${damage.buildingCollapsed ? `Yes (${damage.buildingCollapseType})` : 'No'}
- **Repair Cost Index**: ${damage.totalRepairCost.toFixed(0)}%
- **Soft Story Detected**: ${damage.softStoryIndex >= 0 ? `Yes (Floor ${damage.softStoryIndex + 1})` : 'No'}

## Dynamic Analysis:
- **Base Shear (Design)**: ${designMetrics?.baseShear_kN?.toFixed(0) || 'N/A'} kN
- **Base Shear (Dynamic Max)**: ${designMetrics?.dynamic?.baseShearMax_kN?.toFixed(0) || 'N/A'} kN
- **Dynamic/Design Ratio**: ${designMetrics?.dynamic?.baseShearRatioToDesign?.toFixed(2) || 'N/A'}

## Resonance Analysis:
- **Building Natural Frequency**: ${(1 / inputs.fundamentalPeriod).toFixed(2)} Hz
- **Earthquake Frequency**: ${inputs.freqHz.toFixed(2)} Hz
- **Frequency Ratio**: ${(inputs.freqHz / (1 / inputs.fundamentalPeriod)).toFixed(2)} (${Math.abs(inputs.freqHz / (1 / inputs.fundamentalPeriod) - 1) < 0.2 ? '⚠️ NEAR RESONANCE' : 'OK'})

## Floor-by-Floor Damage:
${damage.floorDamage.map((floor: any) => 
  `- Floor ${floor.floor}: ${floor.damageState} | Drift ${(floor.maxDrift * 100).toFixed(2)}% | ${floor.collapsed ? '⚠️ COLLAPSED' : 'Standing'}`
).join('\n')}

---


Focus on practical, implementable solutions. Be specific with numbers when possible.`;

    // Call OpenAI API
    const completion = await openai.chat.completions.create({
      model: "gpt-4o", // Using GPT-4 for best analysis
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 2500,
    });

    const recommendations = completion.choices[0]?.message?.content || "No recommendations generated.";

    // Parse parameter changes from the response
    let parameterChanges = [];
    const jsonMatch = recommendations.match(/```json\s*([\s\S]*?)\s*```/);
    
    if (jsonMatch && jsonMatch[1]) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.changes && Array.isArray(parsed.changes)) {
          parameterChanges = parsed.changes;
        }
      } catch (e) {
        console.warn("Failed to parse parameter changes JSON:", e);
      }
    }

    return NextResponse.json({
      ok: true,
      recommendations,
      parameterChanges,
      usage: {
        promptTokens: completion.usage?.prompt_tokens || 0,
        completionTokens: completion.usage?.completion_tokens || 0,
        totalTokens: completion.usage?.total_tokens || 0,
      },
    });

  } catch (err: any) {
    console.error("OpenAI optimization error:", err);
    
    // Handle specific OpenAI errors
    if (err.status === 401) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid OpenAI API key. Please check your OPENAI_API_KEY in .env.local",
        },
        { status: 401 }
      );
    }
    
    if (err.status === 429) {
      return NextResponse.json(
        {
          ok: false,
          error: "OpenAI API rate limit exceeded. Please try again in a moment.",
        },
        { status: 429 }
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: err.message || "Failed to generate optimization recommendations",
      },
      { status: 500 }
    );
  }
}
