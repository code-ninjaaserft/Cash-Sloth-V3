/** Query indexes only; original financial rows and migration history are unchanged. */
export const salesHistoryIndexesMigration = {
  version: 5,
  name: '0005-sales-history-indexes',
  sql: `
CREATE INDEX sales_history_total ON sales(amount_due_rappen, completed_at, id) WHERE sealed = 1;
CREATE INDEX financial_sales_history_total ON financial_sales(actual_paid_rappen, completed_at, id);
`,
} as const;
