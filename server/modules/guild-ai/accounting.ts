import type { DatabaseSync } from "node:sqlite";

type DbLike = Pick<DatabaseSync, "prepare">;

type StarterAccount = {
  code: string;
  name: string;
  nameTh: string;
  category: "asset" | "liability" | "equity" | "revenue" | "expense";
  normalBalance: "debit" | "credit";
};

export const THAI_ACCOUNTING_CATEGORIES = [
  { key: "asset", name: "Assets", nameTh: "สินทรัพย์", normalBalance: "debit" },
  { key: "liability", name: "Liabilities", nameTh: "หนี้สิน", normalBalance: "credit" },
  { key: "equity", name: "Owner's Equity", nameTh: "ส่วนของเจ้าของ", normalBalance: "credit" },
  { key: "revenue", name: "Revenue", nameTh: "รายได้", normalBalance: "credit" },
  { key: "expense", name: "Expenses", nameTh: "ค่าใช้จ่าย", normalBalance: "debit" },
] as const;

export const STARTER_CHART_OF_ACCOUNTS: StarterAccount[] = [
  { code: "1000", name: "Cash and Bank", nameTh: "เงินสดและเงินฝาก", category: "asset", normalBalance: "debit" },
  { code: "1100", name: "Prepaid AI Credits", nameTh: "เครดิต AI จ่ายล่วงหน้า", category: "asset", normalBalance: "debit" },
  { code: "1200", name: "Accounts Receivable", nameTh: "ลูกหนี้การค้า", category: "asset", normalBalance: "debit" },
  { code: "2000", name: "Accounts Payable", nameTh: "เจ้าหนี้การค้า", category: "liability", normalBalance: "credit" },
  { code: "3000", name: "Owner Capital", nameTh: "ทุนเจ้าของ", category: "equity", normalBalance: "credit" },
  { code: "4000", name: "Service Revenue", nameTh: "รายได้ค่าบริการ", category: "revenue", normalBalance: "credit" },
  { code: "5000", name: "AI Token Expense", nameTh: "ค่าใช้จ่ายโทเคน AI", category: "expense", normalBalance: "debit" },
  { code: "5100", name: "Server Expense", nameTh: "ค่าเซิร์ฟเวอร์", category: "expense", normalBalance: "debit" },
  {
    code: "5200",
    name: "Tool Subscription Expense",
    nameTh: "ค่าเครื่องมือและซอฟต์แวร์",
    category: "expense",
    normalBalance: "debit",
  },
];

export function seedStarterChartOfAccounts(db: DbLike, guildId: string): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO guild_accounting_accounts (
      guild_id, account_code, account_name, account_name_th, category, normal_balance
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  );

  for (const account of STARTER_CHART_OF_ACCOUNTS) {
    insert.run(guildId, account.code, account.name, account.nameTh, account.category, account.normalBalance);
  }
}
