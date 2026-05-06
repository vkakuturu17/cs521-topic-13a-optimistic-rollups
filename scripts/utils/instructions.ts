export function parseInstructionsCsv(raw: string): bigint[] {
  const items = raw
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
    .map((x) => BigInt(x));

  if (items.length === 0) {
    throw new Error("Instruction CSV must include at least one integer.");
  }

  return items;
}

export function readChallengerInstructionsFromEnv(): bigint[] {
  const raw =
    process.env.CHALLENGER_DELTAS_CSV ??
    process.env.CHALLENGER_INSTRUCTIONS_CSV ??
    process.env.DELTAS_CSV ??
    process.env.INSTRUCTIONS_CSV;

  if (!raw) {
    throw new Error(
      "Set CHALLENGER_DELTAS_CSV (preferred), CHALLENGER_INSTRUCTIONS_CSV, DELTAS_CSV, or INSTRUCTIONS_CSV.",
    );
  }

  return parseInstructionsCsv(raw);
}

export function readInstructionsFromEnv(): bigint[] {
  const raw = process.env.DELTAS_CSV ?? process.env.INSTRUCTIONS_CSV;
  if (!raw) {
    throw new Error("Set DELTAS_CSV or INSTRUCTIONS_CSV.");
  }
  return parseInstructionsCsv(raw);
}
