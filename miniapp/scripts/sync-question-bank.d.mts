export const SHARDS: string[];

export function syncQuestionBank(
  sourceDir: string,
  targetDir: string,
  options?: {
    minimumPerShard?: number;
    fileOps?: { renameSync?: (from: string, to: string) => void };
  },
): Record<string, number>;
