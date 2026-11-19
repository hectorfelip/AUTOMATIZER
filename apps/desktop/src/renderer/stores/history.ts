import { create } from "zustand";
import type { ExecutionDetail, ExecutionSummary, HistoryStats, StoredStatus } from "@automation-studio/shared-types";
import { errorMessage, unwrap } from "../lib/api";

export type Period = "all" | "1" | "7" | "30";
export interface HistoryFilter {
  automationId: string;
  status: StoredStatus | "all";
  period: Period;
}
interface State {
  items: ExecutionSummary[];
  total: number;
  stats: HistoryStats | null;
  filter: HistoryFilter;
  loading: boolean;
  error: string | null;
  detail: ExecutionDetail | null;
  detailError: string | null;
  setFilter(patch: Partial<HistoryFilter>): Promise<void>;
  load(limit?: number): Promise<void>;
  open(executionId: string): Promise<void>;
  closeDetail(): void;
  clear(olderThanDays?: number): Promise<number>;
}

export const useHistory = create<State>((set, get) => ({
  items: [],
  total: 0,
  stats: null,
  filter: { automationId: "", status: "all", period: "all" },
  loading: false,
  error: null,
  detail: null,
  detailError: null,
  async setFilter(patch) {
    set({ filter: { ...get().filter, ...patch } });
    await get().load();
  },
  async load(limit = 50) {
    const { filter } = get();
    set({ loading: true });
    try {
      const from = filter.period === "all" ? undefined : new Date(Date.now() - Number(filter.period) * 86_400_000).toISOString();
      const [page, stats] = await Promise.all([
        unwrap((a) =>
          a.history.list({
            limit,
            ...(filter.automationId ? { automationId: filter.automationId } : {}),
            ...(filter.status !== "all" ? { statuses: [filter.status] } : {}),
            ...(from ? { from } : {}),
          }),
        ),
        unwrap((a) => a.history.stats(filter.period === "all" ? {} : { sinceDays: Number(filter.period) })),
      ]);
      set({ items: page.items, total: page.total, stats, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: errorMessage(e) });
    }
  },
  async open(executionId) {
    try {
      set({ detail: await unwrap((a) => a.history.get({ executionId })), detailError: null });
    } catch (e) {
      set({ detail: null, detailError: errorMessage(e) });
    }
  },
  closeDetail: () => set({ detail: null, detailError: null }),
  async clear(olderThanDays) {
    const { deleted } = await unwrap((a) => a.history.clear(olderThanDays === undefined ? {} : { olderThanDays }));
    set({ detail: null });
    await get().load();
    return deleted;
  },
}));
