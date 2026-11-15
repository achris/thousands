import { MODULE_ID, initMessage } from "./constants.js";

export const DAILY_TOGGLE_PREFIXES = ["make-your-own-luck:", "magical-paragon:"] as const;

export interface DailyFeatItemLike {
  type?: string;
  system?: {
    frequency?: { value?: number; max: number; per: string } | null;
    rules?: Record<string, unknown>[];
  };
  update(data: Record<string, unknown>): Promise<unknown> | unknown;
}

export interface ChatMessageLike {
  isAuthor?: boolean;
  actor?: { items?: Iterable<DailyFeatItemLike> } | null;
  flags?: { pf2e?: { context?: { options?: Iterable<string> } } };
}

/**
 * Consumes 1 daily use and untoggles the matching RollOption when a roll or
 * spell cast uses a daily toggled academia benefit (Make Your Own Luck or
 * Cascade Bearers' Magical Paragon).
 */
export async function consumeDailyFeatUse(message: ChatMessageLike): Promise<number> {
  if (message.isAuthor === false) return 0;
  const rawOptions = message.flags?.pf2e?.context?.options;
  const items = message.actor?.items;
  if (!rawOptions || !items) return 0;

  const activeToggles = new Set<string>();
  for (const opt of rawOptions) {
    if (DAILY_TOGGLE_PREFIXES.some((prefix) => opt.startsWith(prefix))) {
      activeToggles.add(opt);
    }
  }
  if (activeToggles.size === 0) return 0;

  let updated = 0;
  for (const item of items) {
    const freq = item.system?.frequency;
    const rules = item.system?.rules;
    if (item.type !== "feat" || !freq || !rules) continue;
    const current = freq.value ?? freq.max;
    if (current <= 0) continue;

    let matched = false;
    const nextRules = rules.map((r) => {
      if (
        r.key === "RollOption" &&
        r.toggleable === true &&
        r.value !== false &&
        typeof r.option === "string" &&
        activeToggles.has(r.option)
      ) {
        matched = true;
        return { ...r, value: false };
      }
      return r;
    });

    if (matched) {
      await item.update({
        "system.frequency.value": current - 1,
        "system.rules": nextRules,
      });
      updated++;
    }
  }
  return updated;
}

declare const Hooks:
  | {
      once(hook: string, callback: () => void): number;
      on(hook: string, callback: (doc: ChatMessageLike) => void): number;
    }
  | undefined;

if (typeof Hooks !== "undefined") {
  Hooks.once("init", () => {
    console.log(initMessage(MODULE_ID));
  });
  Hooks.on("createChatMessage", (message) => {
    void consumeDailyFeatUse(message);
  });
}
