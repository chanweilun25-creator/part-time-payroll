import { isWeekend, parseISO, format, eachDayOfInterval } from 'date-fns';
import { Shift, Job, ShiftTemplate, RecurringRule, SG_PUBLIC_HOLIDAYS } from './types';
import { calculateCpf, CPF_RATES, AgeGroup } from './cpfRates';

export function calculateShiftHours(startTime?: string, endTime?: string, unpaidBreakHours = 0): number {
  if (!startTime || !endTime) return 0;
  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);
  let startMins = startH * 60 + startM;
  let endMins = endH * 60 + endM;
  if (endMins < startMins) endMins += 24 * 60;
  return Math.max(0, (endMins - startMins) / 60 - unpaidBreakHours);
}

export function calcShiftGross(shift: Shift, job: Job): number {
  const date = parseISO(shift.date);
  let rate = job.rates.weekday;
  if (shift.isPublicHoliday) rate = job.rates.publicHoliday;
  else if (isWeekend(date)) rate = job.rates.weekend;
  const hours = calculateShiftHours(shift.startTime, shift.endTime, shift.unpaidBreakHours);
  return hours * rate + (shift.allowance ?? 0) - (shift.deduction ?? 0);
}

export function calcPayrollSummary(relevantShifts: Shift[], jobs: Job[], ageGroup: AgeGroup) {
  let grossPay = 0;
  let totalHours = 0;
  relevantShifts.forEach(shift => {
    const job = jobs.find(j => j.id === shift.jobId);
    if (!job) return;
    grossPay += calcShiftGross(shift, job);
    totalHours += calculateShiftHours(shift.startTime, shift.endTime, shift.unpaidBreakHours);
  });
  const { employeeCpf, employerCpf } = calculateCpf(grossPay, ageGroup);
  return { grossPay, totalHours, employeeCpf, employerCpf, netPay: grossPay - employeeCpf, totalCpf: employeeCpf + employerCpf };
}

export function expandRecurringRule(rule: RecurringRule, template: ShiftTemplate, existingShifts: Shift[]): Shift[] {
  const days = eachDayOfInterval({ start: parseISO(rule.startDate), end: parseISO(rule.endDate) });
  const generated: Shift[] = [];
  days.forEach(day => {
    if (!rule.daysOfWeek.includes(day.getDay())) return;
    const dateStr = format(day, 'yyyy-MM-dd');
    if (existingShifts.some(s => s.date === dateStr && s.jobId === template.jobId)) return;
    generated.push({
      id: `rec_${rule.id}_${dateStr}_${Math.random().toString(36).substr(2, 5)}`,
      jobId: template.jobId,
      date: dateStr,
      startTime: template.startTime,
      endTime: template.endTime,
      unpaidBreakHours: template.unpaidBreakHours,
      isPublicHoliday: !!SG_PUBLIC_HOLIDAYS[dateStr],
    });
  });
  return generated;
}

export function hoursToGoal(remainingNet: number, jobs: Job[], ageGroup: AgeGroup): { job: Job; hoursNeeded: number; grossNeeded: number }[] {
  if (remainingNet <= 0 || jobs.length === 0) return [];
  const r = CPF_RATES[ageGroup];

  function grossForNet(targetNet: number): number {
    const g1 = targetNet / (1 - r.employee);
    if (g1 > 750) return g1;
    const g2 = (targetNet - 500 * r.employee) / (1 - r.employee);
    if (g2 > 500 && g2 <= 750) return g2;
    return targetNet;
  }

  return jobs
    .filter(j => j.rates.weekday > 0)
    .map(job => {
      const grossNeeded = grossForNet(remainingNet);
      const hoursNeeded = grossNeeded / job.rates.weekday;
      return { job, hoursNeeded, grossNeeded };
    })
    .sort((a, b) => a.hoursNeeded - b.hoursNeeded);
}
