/**
 * Compiles the sample study's plain-English rules with the real Gemini rule compiler and saves the result,
 * so "Open the sample study" starts from rules Gemini actually produced. Run: npm run sample:rules
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

async function main(): Promise<void> {
  const { compileRules, COMPILE_PROMPT_VERSION } = await import("../src/ai/compile-rules");
  const { aiModel } = await import("../src/ai/gemini");
  const { readBack } = await import("../src/engine/readback");
  const study = JSON.parse(readFileSync(join(process.cwd(), "data", "sample", "study.json"), "utf8")) as { rulesText: string };

  const result = await compileRules(study.rulesText);
  if (!result.ok) {
    console.error(`Compile failed (${result.kind}): ${result.message}`);
    process.exitCode = 1;
    return;
  }
  const output = {
    compiledBy: `gemini:${aiModel()}`,
    promptVersion: COMPILE_PROMPT_VERSION,
    compiledAt: new Date().toISOString(),
    ruleSet: result.data.ruleSet,
    couldNotCompile: result.data.couldNotCompile,
  };
  writeFileSync(join(process.cwd(), "data", "sample", "rules.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Compiled ${result.data.ruleSet.rules.length} rules with ${aiModel()} (${result.cached ? "cached" : `${result.calls} call(s)`}).`);
  for (const rule of result.data.ruleSet.rules) {
    console.log(`  ${rule.id} ${rule.type} → ${rule.outcome_on_fail}: ${readBack(rule)}`);
  }
  for (const item of result.data.couldNotCompile) {
    console.log(`  could not compile: "${item.phrase}" (${item.reason})`);
  }
  process.exit(0);
}

void main();
