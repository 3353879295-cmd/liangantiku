import {
  RUNTIME_QUESTION_BANK,
  loadRuntimeQuestionRecords,
} from './questions/runtime-question-records';
import type { RuntimeQuestionBank, RuntimeQuestionRecord } from '../types/runtime-question';

export const QUESTION_BANK: RuntimeQuestionBank = RUNTIME_QUESTION_BANK;

/**
 * Compatibility helper for code that needs every raw record. Do not call this
 * during startup: it expands all compressed question-bank shards.
 */
export const loadQuestionRecords = (): RuntimeQuestionRecord[] => loadRuntimeQuestionRecords();
