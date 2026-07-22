export const SHARDS: string[];

export function syncQuestionBank(
  sourceDir: string,
  targetDir: string,
  options?: { minimumPerShard?: number },
): Record<string, number>;
