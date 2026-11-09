import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../db';
import { beans, orders } from '../db/schema';

export class ReportServiceError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function requireDb() {
  if (!db) throw new ReportServiceError(503, 'Database not configured');
  return db;
}

export function parseDateParam(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

export async function listOrderHistory(input: {
  from?: Date | null;
  to?: Date | null;
  status?: string;
  limit?: number;
}) {
  const database = requireDb();
  const conditions: any[] = [];
  if (input.from) conditions.push(gte(orders.createdAt, input.from));
  if (input.to) conditions.push(lte(orders.createdAt, input.to));
  if (input.status) conditions.push(eq(orders.status, input.status));
  const where = conditions.length ? and(...conditions) : undefined;
  const limit = input.limit && input.limit > 0 ? Math.min(input.limit, 500) : 500;
  const query = database.select().from(orders);
  const rows = where
    ? await query.where(where as any).orderBy(desc(orders.createdAt)).limit(limit)
    : await query.orderBy(desc(orders.createdAt)).limit(limit);
  return rows;
}

export async function getBalance(input: { from?: Date | null; to?: Date | null }) {
  const database = requireDb();
  const fromDate = input.from ?? null;
  const toDate = input.to ?? null;
  const hasRange = !!(fromDate || toDate);
  const orderRange = sql`${fromDate ? sql`AND created_at >= ${fromDate.toISOString()}` : sql``}${toDate ? sql` AND created_at <= ${toDate.toISOString()}` : sql``}`;
  const orderRangeAliased = sql`${fromDate ? sql`AND o.created_at >= ${fromDate.toISOString()}` : sql``}${toDate ? sql` AND o.created_at <= ${toDate.toISOString()}` : sql``}`;
  const disbRange = sql`${fromDate ? sql`AND processed_at >= ${fromDate.toISOString()}` : sql``}${toDate ? sql` AND processed_at <= ${toDate.toISOString()}` : sql``}`;

  const incomeResult = await database.execute(
    sql`SELECT SUM(amount) as total FROM orders WHERE status IN ('settlement', 'capture') ${orderRange}`,
  );
  const totalIncome = incomeResult[0]?.total ? parseInt(incomeResult[0].total as string, 10) : 0;

  const mdrResult = await database.execute(
    sql`SELECT SUM(ROUND(amount * 0.007)) as total FROM orders WHERE status IN ('settlement', 'capture') ${orderRange}`,
  );
  const totalMdrFees = mdrResult[0]?.total ? parseInt(mdrResult[0].total as string, 10) : 0;

  const disbursedResult = await database.execute(
    sql`SELECT SUM(amount) as total FROM disbursements WHERE status = 'approved' ${disbRange}`,
  );
  const totalDisbursed = disbursedResult[0]?.total
    ? parseInt(disbursedResult[0].total as string, 10)
    : 0;

  const withdrawalFeeResult = await database.execute(
    sql`SELECT SUM(withdrawal_fee) as total FROM disbursements WHERE status = 'approved' ${disbRange}`,
  );
  const totalWithdrawalFees = withdrawalFeeResult[0]?.total
    ? parseInt(withdrawalFeeResult[0].total as string, 10)
    : 0;

  const netIncome = totalIncome - totalMdrFees;
  let availableBalance = netIncome - totalDisbursed;
  if (hasRange) {
    const allIncome = await database.execute(
      sql`SELECT SUM(amount) as total FROM orders WHERE status IN ('settlement', 'capture')`,
    );
    const allMdr = await database.execute(
      sql`SELECT SUM(ROUND(amount * 0.007)) as total FROM orders WHERE status IN ('settlement', 'capture')`,
    );
    const allDisbursed = await database.execute(
      sql`SELECT SUM(amount) as total FROM disbursements WHERE status = 'approved'`,
    );
    availableBalance =
      (allIncome[0]?.total ? parseInt(allIncome[0].total as string, 10) : 0) -
      (allMdr[0]?.total ? parseInt(allMdr[0].total as string, 10) : 0) -
      (allDisbursed[0]?.total ? parseInt(allDisbursed[0].total as string, 10) : 0);
  }

  const settledOrders = await database.execute(sql`
    SELECT o.amount, o.grams, o.bean_slug, o.bean_name, o.is_blend, o.blend_data
    FROM orders o
    WHERE o.status IN ('settlement', 'capture') ${orderRangeAliased}
  `);

  const catalogUnitTypes = new Map<string, string>();
  try {
    const catalog = await database.select().from(beans);
    for (const b of catalog) catalogUnitTypes.set(b.slug, b.unitType || 'gram');
  } catch {
    /* unitType falls back below */
  }

  type BeanAggregate = {
    name: string;
    income: number;
    count: number;
    qty: number;
    unitType: string;
    minUnitPrice: number | null;
    maxUnitPrice: number | null;
  };
  const beanIncomeMap = new Map<string, BeanAggregate>();

  const recordIncome = (
    key: string,
    name: string,
    amount: number,
    qty: number,
    unitType: string,
  ) => {
    const safeQty = isNaN(qty) || qty < 0 ? 0 : qty;
    const unitPrice =
      safeQty > 0 ? (unitType === 'piece' ? amount / safeQty : (amount * 250) / safeQty) : null;
    const existing = beanIncomeMap.get(key);
    if (existing) {
      existing.income += amount;
      existing.count += 1;
      existing.qty += safeQty;
      if (unitPrice !== null) {
        existing.minUnitPrice =
          existing.minUnitPrice === null ? unitPrice : Math.min(existing.minUnitPrice, unitPrice);
        existing.maxUnitPrice =
          existing.maxUnitPrice === null ? unitPrice : Math.max(existing.maxUnitPrice, unitPrice);
      }
    } else {
      beanIncomeMap.set(key, {
        name,
        income: amount,
        count: 1,
        qty: safeQty,
        unitType,
        minUnitPrice: unitPrice,
        maxUnitPrice: unitPrice,
      });
    }
  };

  for (const row of (settledOrders || []) as any[]) {
    if (row.is_blend && row.blend_data) {
      let blendBeans: {
        slug: string;
        name: string;
        pricePer250g: number;
        unitType: string;
        grams: number;
      }[];
      try {
        blendBeans = JSON.parse(row.blend_data);
      } catch {
        blendBeans = [];
      }
      const totalAmount = parseInt(row.amount, 10);
      let totalContribution = 0;
      const contributions: number[] = [];
      for (const b of blendBeans) {
        const isPiece = b.unitType === 'piece';
        const contribution = isPiece
          ? Math.round(b.grams * b.pricePer250g)
          : Math.round((b.grams * b.pricePer250g) / 250);
        contributions.push(contribution);
        totalContribution += contribution;
      }
      let remainingAmount = totalAmount;
      for (let i = 0; i < blendBeans.length; i++) {
        const b = blendBeans[i];
        let splitIncome: number;
        if (i === blendBeans.length - 1) {
          splitIncome = remainingAmount;
        } else {
          splitIncome =
            totalContribution > 0
              ? Math.round(totalAmount * (contributions[i] / totalContribution))
              : 0;
          remainingAmount -= splitIncome;
        }
        recordIncome(b.slug || 'unknown', b.name, splitIncome, Number(b.grams), b.unitType || 'gram');
      }
    } else {
      let unitType: string | undefined;
      try {
        const snapshot = row.blend_data ? JSON.parse(row.blend_data) : null;
        if (Array.isArray(snapshot) && snapshot.length > 0 && snapshot[0].unitType) {
          unitType = snapshot[0].unitType;
        }
      } catch {
        /* fall through to catalog lookup */
      }
      unitType = unitType || catalogUnitTypes.get(row.bean_slug) || 'gram';
      recordIncome(
        row.bean_slug || 'unknown',
        row.bean_name || 'Unknown',
        parseInt(row.amount, 10),
        parseFloat(row.grams),
        unitType,
      );
    }
  }

  const perBeanIncome = Array.from(beanIncomeMap.entries())
    .map(([slug, data]) => {
      const meanUnitPrice =
        data.qty > 0
          ? data.unitType === 'piece'
            ? data.income / data.qty
            : (data.income * 250) / data.qty
          : 0;
      const spread =
        data.minUnitPrice !== null && data.maxUnitPrice !== null
          ? data.maxUnitPrice - data.minUnitPrice
          : 0;
      return {
        beanName: data.name,
        beanSlug: slug,
        totalIncome: data.income,
        orderCount: data.count,
        totalQuantity: Math.round(data.qty * 100) / 100,
        unitType: data.unitType,
        unitPrice: Math.round(meanUnitPrice),
        isAveragePrice: spread > Math.max(1, meanUnitPrice * 0.002),
      };
    })
    .sort((a, b) => b.totalIncome - a.totalIncome);

  return {
    balance: Math.max(0, availableBalance),
    totalIncome,
    totalMdrFees,
    netIncome,
    totalDisbursed,
    totalWithdrawalFees,
    totalFees: totalMdrFees + totalWithdrawalFees,
    perBeanIncome,
  };
}
