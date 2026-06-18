import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..", "..");
const sourceRoot = path.join(repoRoot, "sakinaai", "out");
const outputRoot = path.join(appRoot, "public", "data");
const studyOutputPath = path.join(outputRoot, "study-data.json");

const OUTPUTS = [
  { id: "output_a", label: "Output A", statsLabel: "AceGPT-v2-8B-Chat", file: "acegpt_7b_session_output.json", usesTranslatedTranscript: false },
  { id: "output_b", label: "Output B", statsLabel: "ALLAM-7B", file: "allam_7b_session_output.json", usesTranslatedTranscript: false },
  { id: "output_c", label: "Output C", statsLabel: "DeepSeek-V3.2", file: "deepseek_v32_session_output.json", usesTranslatedTranscript: true },
  { id: "output_d", label: "Output D", statsLabel: "Falcon-H1-3B", file: "falcon_h1_3b_session_output.json", usesTranslatedTranscript: false },
  { id: "output_e", label: "Output E", statsLabel: "Fanar-2-27B-Instruct", file: "fanar2_27b_session_output.json", usesTranslatedTranscript: false },
  { id: "output_f", label: "Output F", statsLabel: "Gemma-4-31B-it", file: "gemma4_31b_it_session_output.json", usesTranslatedTranscript: false },
  { id: "output_g", label: "Output G", statsLabel: "GPT-4.1", file: "gpt4_1_session_output.json", usesTranslatedTranscript: true },
  { id: "output_h", label: "Output H", statsLabel: "Llama-3.3-70B-Instruct", file: "llama_33_70b_session_output.json", usesTranslatedTranscript: true },
];

async function readText(fileName) {
  return fs.readFile(path.join(sourceRoot, fileName), "utf8");
}

async function readJson(fileName) {
  return JSON.parse(await readText(fileName));
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function stripPrivateMetadata(value) {
  if (Array.isArray(value)) return value.map(stripPrivateMetadata);
  if (!value || typeof value !== "object") return value;

  const cleaned = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key === "metadata") continue;
    cleaned[key] = stripPrivateMetadata(nested);
  }
  return cleaned;
}

function makeComparisonId(leftId, rightId) {
  return `cmp_${leftId.replace(/^output_/, "")}_${rightId.replace(/^output_/, "")}`;
}

async function main() {
  await fs.mkdir(outputRoot, { recursive: true });

  if (!(await pathExists(sourceRoot))) {
    if (await pathExists(studyOutputPath)) {
      console.log(`Source folder not found at ${sourceRoot}; keeping committed public/data/study-data.json`);
      return;
    }
    throw new Error(`Source folder not found at ${sourceRoot}, and no committed study-data.json exists.`);
  }

  const outputs = [];
  for (const spec of OUTPUTS) {
    const raw = await readJson(spec.file);
    outputs.push({
      id: spec.id,
      label: spec.label,
      statsLabel: raw?.metadata?.model_name || spec.statsLabel,
      usesTranslatedTranscript: spec.usesTranslatedTranscript,
      payload: stripPrivateMetadata(raw),
    });
  }

  const comparisons = [];
  for (let i = 0; i < outputs.length; i += 1) {
    for (let j = i + 1; j < outputs.length; j += 1) {
      comparisons.push({
        id: makeComparisonId(outputs[i].id, outputs[j].id),
        outputIds: [outputs[i].id, outputs[j].id],
      });
    }
  }

  const study = {
    generatedAt: new Date().toISOString(),
    title: "Sakina SOAP Output Preference Review",
    outputCount: outputs.length,
    comparisonCount: comparisons.length,
    transcripts: {
      originalArabic: await readText("simulated_session_arabic.txt"),
      fanarEnglish: await readText("simulated_session_english_fanar.txt"),
    },
    outputs,
    comparisons,
  };

  await fs.writeFile(studyOutputPath, `${JSON.stringify(study, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outputs.length} anonymized outputs and ${comparisons.length} comparisons to public/data/study-data.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
