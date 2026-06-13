export type ReminderRepeat =
  | { type: "weekly"; spec: string }
  | { type: "monthly"; spec: string }
  | { type: "daily"; spec: string };

export type Reminder = {
  id: string;
  openid: string;
  text: string;
  occursAt: string;
  repeat?: ReminderRepeat;
  createdAt: string;
  pushedDates: string[];
};

export type UserSettings = {
  pushAt: string;
  tz: string;
};

export type Weather = {
  text: string;
  tempMax: number;
  tempMin: number;
  precipProb: number;
  willRain: boolean;
  isClearLike: boolean;
  needUmbrella: boolean;
};

export type CalendarInfo = {
  date: string;
  weekday: string;
  lunarDate: string;
  festival?: string;
};

export type ListRange = "today" | "tomorrow" | "week" | "all" | "recent" | "date";

export type AmbiguityReason = "missing-time" | "past-time" | "empty-text" | "short-text";

export type ParsedReminder = {
  text: string;
  occursAt: string;
  repeat?: ReminderRepeat;
  ambiguity?: AmbiguityReason[];
};

export type PendingAction =
  | {
      kind: "add";
      originalText: string;
      reminder: ParsedReminder;
      ambiguity: AmbiguityReason[];
      createdAt: string;
    }
  | {
      kind: "update";
      originalText: string;
      index: number;
      reminderId: string;
      previous: Reminder;
      nextReminder: ParsedReminder;
      createdAt: string;
    }
  | {
      kind: "delete";
      originalText: string;
      index: number;
      reminderId: string;
      snapshot: Reminder;
      createdAt: string;
    };

export type Command =
  | { kind: "add"; payload: ParsedReminder }
  | { kind: "batch_add"; payload: { items: ParsedReminder[] } }
  | { kind: "list"; payload: { range: ListRange; date?: string } }
  | { kind: "update"; payload: { index: number; next: ParsedReminder } }
  | { kind: "delete"; payload: { index: number } }
  | { kind: "settings"; payload: Partial<UserSettings> }
  | { kind: "help" };

export type GreetingSlot = "reply" | "morning" | "sign";

export type GreetingContext = {
  isRainy: boolean;
  isWeekend: boolean;
  isClearLike: boolean;
};
