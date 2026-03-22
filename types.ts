export type PayrollCycleType = 'end_of_month' | 'end_of_event';
export type ViewTab = 'calendar' | 'monthly_income' | 'event_income' | 'dashboard' | 'offer_simulator';

export interface Job {
  id: string;
  title: string;
  colorId: string;
  rates: {
    weekday: number;
    weekend: number;
    publicHoliday: number;
  };
  payrollCycle: {
    type: PayrollCycleType;
    cutoffDay?: number;   // 1–31, used when type === 'end_of_month'
    endDate?: string;     // YYYY-MM-DD, used when type === 'end_of_event'
  };
}

export interface Shift {
  id: string;
  jobId: string;
  date: string;           // YYYY-MM-DD
  startTime: string;      // HH:mm
  endTime: string;        // HH:mm
  unpaidBreakHours: number;
  isPublicHoliday: boolean;
  allowance?: number;
  deduction?: number;
  notes?: string;
}

export interface ShiftTemplate {
  id: string;
  name: string;
  jobId: string;
  startTime: string;      // HH:mm
  endTime: string;        // HH:mm
  unpaidBreakHours: number;
}

export interface RecurringRule {
  id: string;
  templateId: string;     // references ShiftTemplate.id
  daysOfWeek: number[];   // 0 = Sun … 6 = Sat
  startDate: string;      // YYYY-MM-DD
  endDate: string;        // YYYY-MM-DD
}

export const JOB_COLORS = [
  { id: 'red',    bg: 'bg-red-500',    border: 'border-red-200',    text: 'text-red-700',    lightBg: 'bg-red-50'    },
  { id: 'yellow', bg: 'bg-yellow-500', border: 'border-yellow-200', text: 'text-yellow-700', lightBg: 'bg-yellow-50' },
  { id: 'orange', bg: 'bg-orange-500', border: 'border-orange-200', text: 'text-orange-700', lightBg: 'bg-orange-50' },
  { id: 'green',  bg: 'bg-green-500',  border: 'border-green-200',  text: 'text-green-700',  lightBg: 'bg-green-50'  },
  { id: 'navy',   bg: 'bg-blue-800',   border: 'border-blue-300',   text: 'text-blue-800',   lightBg: 'bg-blue-50'   },
  { id: 'purple', bg: 'bg-purple-500', border: 'border-purple-200', text: 'text-purple-700', lightBg: 'bg-purple-50' },
  { id: 'pink',   bg: 'bg-pink-500',   border: 'border-pink-200',   text: 'text-pink-700',   lightBg: 'bg-pink-50'   },
  { id: 'sky',    bg: 'bg-sky-400',    border: 'border-sky-200',    text: 'text-sky-700',    lightBg: 'bg-sky-50'    },
] as const;

export const getHexColor = (colorId: string): string => {
  const map: Record<string, string> = {
    red: '#ef4444', yellow: '#eab308', orange: '#f97316',
    green: '#22c55e', navy: '#1e40af', purple: '#a855f7',
    pink: '#ec4899', sky: '#38bdf8',
  };
  return map[colorId] || '#6366f1';
};

export const SG_PUBLIC_HOLIDAYS: Record<string, string> = {
  // 2025
  '2025-01-01': "New Year's Day",
  '2025-01-29': 'Chinese New Year',
  '2025-01-30': 'Chinese New Year',
  '2025-03-31': 'Hari Raya Puasa',
  '2025-04-18': 'Good Friday',
  '2025-05-01': 'Labour Day',
  '2025-05-12': 'Vesak Day',
  '2025-06-07': 'Hari Raya Haji',
  '2025-08-09': 'National Day',
  '2025-10-20': 'Deepavali',
  '2025-12-25': 'Christmas Day',
  // 2026
  '2026-01-01': "New Year's Day",
  '2026-02-17': 'Chinese New Year',
  '2026-02-18': 'Chinese New Year',
  '2026-03-20': 'Hari Raya Puasa',
  '2026-04-03': 'Good Friday',
  '2026-05-01': 'Labour Day',
  '2026-05-27': 'Hari Raya Haji',
  '2026-05-31': 'Vesak Day',
  '2026-06-01': 'Vesak Day (Observed)',
  '2026-08-09': 'National Day',
  '2026-08-10': 'National Day (Observed)',
  '2026-11-08': 'Deepavali',
  '2026-11-09': 'Deepavali (Observed)',
  '2026-12-25': 'Christmas Day',
};
