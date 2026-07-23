import inspectorL3 from './questions/inspector_l3.json';
import inspectorL4 from './questions/inspector_l4.json';
import inspectorL5 from './questions/inspector_l5.json';
import warehouseL3 from './questions/warehouse_l3.json';
import warehouseL4 from './questions/warehouse_l4.json';
import warehouseL5 from './questions/warehouse_l5.json';
import type { RuntimeQuestionRecord } from '../types/runtime-question';

const asRecords = (records: unknown): RuntimeQuestionRecord[] =>
  Array.isArray(records) ? (records as RuntimeQuestionRecord[]) : [];

export const QUESTION_RECORDS: RuntimeQuestionRecord[] = [
  ...asRecords(warehouseL5),
  ...asRecords(warehouseL4),
  ...asRecords(warehouseL3),
  ...asRecords(inspectorL5),
  ...asRecords(inspectorL4),
  ...asRecords(inspectorL3),
];
