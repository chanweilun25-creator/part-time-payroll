import {
  format, parseISO, startOfMonth, endOfMonth,
  isAfter, isBefore, isEqual, isWeekend,
} from 'date-fns';
import { type Job, type Shift, getHexColor, SG_PUBLIC_HOLIDAYS } from './types';
import { type AgeGroup, CPF_RATES, CPF_RATES_EFFECTIVE_DATE, calculateCpf } from './cpfRates';
import { calculateShiftHours, calcShiftGross } from './utils';

export type CycleScope = 'payroll_cycle' | 'calendar_month';

export interface RenderOptions {
  jobs: Job[];
  shifts: Shift[];
  ageGroup: AgeGroup;
  selectedMonth: string; // 'yyyy-MM'
  scope: CycleScope;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getJobShifts(shifts: Shift[], job: Job, selectedMonth: string, scope: CycleScope): Shift[] {
  const [year, month] = selectedMonth.split('-').map(Number);
  const refDate = new Date(year, month - 1, 1);

  if (scope === 'calendar_month') {
    const start = startOfMonth(refDate);
    const end   = endOfMonth(refDate);
    return shifts.filter(s => {
      const d = parseISO(s.date);
      return s.jobId === job.id
        && (isAfter(d, start) || isEqual(d, start))
        && (isBefore(d, end)  || isEqual(d, end));
    });
  }

  if (job.payrollCycle.type === 'end_of_event') {
    return shifts.filter(s => s.jobId === job.id);
  }

  const cutoffDay = job.payrollCycle.cutoffDay || 31;
  let cycleStart: Date, cycleEnd: Date;
  if (cutoffDay >= 28) {
    cycleStart = startOfMonth(refDate);
    cycleEnd   = endOfMonth(refDate);
  } else {
    cycleEnd   = new Date(year, month - 1, cutoffDay);
    cycleStart = new Date(year, month - 2, cutoffDay + 1);
  }
  return shifts.filter(s => {
    const d = parseISO(s.date);
    return s.jobId === job.id
      && (isAfter(d, cycleStart) || isEqual(d, cycleStart))
      && (isBefore(d, cycleEnd)  || isEqual(d, cycleEnd));
  });
}

function getPayPeriodLabel(job: Job, selectedMonth: string, scope: CycleScope): string {
  const [year, month] = selectedMonth.split('-').map(Number);
  const refDate = new Date(year, month - 1, 1);

  if (scope === 'calendar_month') {
    return `${format(startOfMonth(refDate), 'd MMM yyyy')} – ${format(endOfMonth(refDate), 'd MMM yyyy')}`;
  }
  if (job.payrollCycle.type === 'end_of_event') {
    const end = job.payrollCycle.endDate
      ? format(parseISO(job.payrollCycle.endDate), 'd MMM yyyy')
      : 'ongoing';
    return `Event-based · ends ${end}`;
  }
  const cutoffDay = job.payrollCycle.cutoffDay || 31;
  if (cutoffDay >= 28) {
    return `${format(startOfMonth(refDate), 'd MMM yyyy')} – ${format(endOfMonth(refDate), 'd MMM yyyy')}`;
  }
  const cycleEnd   = new Date(year, month - 1, cutoffDay);
  const cycleStart = new Date(year, month - 2, cutoffDay + 1);
  return `${format(cycleStart, 'd MMM yyyy')} – ${format(cycleEnd, 'd MMM yyyy')}`;
}

function $ (n: number) { return `$${n.toFixed(2)}`; }
function h (n: number) { return `${n.toFixed(2)}h`; }

// ── Main renderer ─────────────────────────────────────────────────────────────

export function renderPayslipHTML(opts: RenderOptions): string {
  const { jobs, shifts, ageGroup, selectedMonth, scope } = opts;
  const [year, month] = selectedMonth.split('-').map(Number);
  const monthLabel    = format(new Date(year, month - 1, 1), 'MMMM yyyy');
  const generatedAt   = format(new Date(), "d MMM yyyy 'at' h:mm a");
  const cpfRates      = CPF_RATES[ageGroup];

  // ── Per-job computation ──
  const jobData = jobs.map(job => {
    const jobShifts = getJobShifts(shifts, job, selectedMonth, scope)
      .sort((a, b) => a.date.localeCompare(b.date));

    let totalLogged  = 0;
    let totalPaid    = 0;
    let totalGross   = 0;
    let weekdayHours = 0, weekendHours = 0, phHours = 0;
    let weekdayEarnings = 0, weekendEarnings = 0, phEarnings = 0;
    let totalAllowance = 0, totalDeduction = 0;

    jobShifts.forEach(shift => {
      const date    = parseISO(shift.date);
      const isPH    = shift.isPublicHoliday;
      const isWkd   = !isPH && isWeekend(date);
      const rate    = isPH ? job.rates.publicHoliday : isWkd ? job.rates.weekend : job.rates.weekday;
      const logged  = calculateShiftHours(shift.startTime, shift.endTime, 0);
      const paid    = calculateShiftHours(shift.startTime, shift.endTime, shift.unpaidBreakHours);
      const gross   = calcShiftGross(shift, job);

      totalLogged    += logged;
      totalPaid      += paid;
      totalGross     += gross;
      totalAllowance += shift.allowance || 0;
      totalDeduction += shift.deduction || 0;

      if (isPH)       { phHours += paid; phEarnings += paid * rate; }
      else if (isWkd) { weekendHours += paid; weekendEarnings += paid * rate; }
      else            { weekdayHours += paid; weekdayEarnings += paid * rate; }
    });

    const { employeeCpf, employerCpf } = calculateCpf(totalGross, ageGroup);
    const netPay = totalGross - employeeCpf;
    const effectiveHourly = totalPaid > 0 ? netPay / totalPaid : 0;
    const payPeriod = getPayPeriodLabel(job, selectedMonth, scope);
    const jobColor  = getHexColor(job.colorId);

    return {
      job, jobShifts, jobColor, payPeriod,
      totalLogged, totalPaid, totalGross,
      weekdayHours, weekendHours, phHours,
      weekdayEarnings, weekendEarnings, phEarnings,
      totalAllowance, totalDeduction,
      employeeCpf, employerCpf, netPay, effectiveHourly,
    };
  });

  // ── Grand totals ──
  const grandGross   = jobData.reduce((s, d) => s + d.totalGross, 0);
  const grandEmpCpf  = jobData.reduce((s, d) => s + d.employeeCpf, 0);
  const grandEmprCpf = jobData.reduce((s, d) => s + d.employerCpf, 0);
  const grandNet     = jobData.reduce((s, d) => s + d.netPay, 0);
  const grandHours   = jobData.reduce((s, d) => s + d.totalPaid, 0);

  // ── Job sections HTML ──
  const jobSections = jobData.map(d => {
    const { job, jobShifts, jobColor } = d;

    // Shift rows
    const shiftRows = jobShifts.map(shift => {
      const date      = parseISO(shift.date);
      const isPH      = shift.isPublicHoliday;
      const isWkd     = !isPH && isWeekend(date);
      const rate      = isPH ? job.rates.publicHoliday : isWkd ? job.rates.weekend : job.rates.weekday;
      const paid      = calculateShiftHours(shift.startTime, shift.endTime, shift.unpaidBreakHours);
      const gross     = calcShiftGross(shift, job);
      const holiday   = SG_PUBLIC_HOLIDAYS[shift.date];
      const typeLabel = isPH ? `PH${holiday ? ` · ${holiday}` : ''}` : isWkd ? 'Weekend' : 'Weekday';
      const typeCls   = isPH ? 'badge-ph' : isWkd ? 'badge-wkd' : 'badge-wd';
      const breakNote = shift.unpaidBreakHours > 0 ? `<span class="break-note">${shift.unpaidBreakHours}h break</span>` : '';
      const noteLine  = shift.notes ? `<tr class="note-row"><td colspan="6"><span class="note-icon">↳</span>${shift.notes}</td></tr>` : '';

      return `
        <tr class="shift-row">
          <td class="date-cell">
            <span class="date-day">${format(date, 'EEE')}</span>
            <span class="date-full">${format(date, 'd MMM')}</span>
          </td>
          <td class="time-cell">${shift.startTime}<span class="time-sep">–</span>${shift.endTime}${breakNote}</td>
          <td class="num">${h(paid)}</td>
          <td class="num rate-cell">$${rate.toFixed(2)}<span class="rate-unit">/h</span></td>
          <td><span class="badge ${typeCls}">${typeLabel}</span></td>
          <td class="num gross-cell">${$(gross)}</td>
        </tr>${noteLine}`;
    }).join('');

    // Earnings breakdown lines
    const breakdownLines = [
      d.weekdayHours  > 0 ? `<div class="calc-line"><span class="calc-label">Weekday</span><span class="calc-equation">${h(d.weekdayHours)} × $${job.rates.weekday.toFixed(2)}</span><span class="calc-val">${$(d.weekdayEarnings)}</span></div>` : '',
      d.weekendHours  > 0 ? `<div class="calc-line"><span class="calc-label">Weekend</span><span class="calc-equation">${h(d.weekendHours)} × $${job.rates.weekend.toFixed(2)}</span><span class="calc-val">${$(d.weekendEarnings)}</span></div>` : '',
      d.phHours       > 0 ? `<div class="calc-line"><span class="calc-label">Public Holiday</span><span class="calc-equation">${h(d.phHours)} × $${job.rates.publicHoliday.toFixed(2)}</span><span class="calc-val">${$(d.phEarnings)}</span></div>` : '',
      d.totalAllowance > 0 ? `<div class="calc-line"><span class="calc-label">Allowances</span><span class="calc-equation">—</span><span class="calc-val positive">+${$(d.totalAllowance)}</span></div>` : '',
      d.totalDeduction > 0 ? `<div class="calc-line"><span class="calc-label">Deductions</span><span class="calc-equation">—</span><span class="calc-val negative">−${$(d.totalDeduction)}</span></div>` : '',
    ].filter(Boolean).join('');

    const hoursLine = d.totalLogged !== d.totalPaid
      ? `<span class="hours-detail">${h(d.totalLogged)} logged · ${h(d.totalPaid)} paid · ${h(d.totalLogged - d.totalPaid)} unpaid breaks</span>`
      : `<span class="hours-detail">${h(d.totalPaid)} paid</span>`;

    return `
    <div class="job-card" style="--accent: ${jobColor}">
      <!-- Job header -->
      <div class="job-card-header">
        <div class="job-name-row">
          <span class="job-dot" style="background:${jobColor}"></span>
          <h2 class="job-name">${job.title}</h2>
        </div>
        <div class="job-meta-row">
          <span class="meta-tag period-tag">
            <span class="meta-tag-label">Pay Period</span>
            ${d.payPeriod}
          </span>
          <span class="meta-tag">
            <span class="meta-tag-label">Cycle</span>
            ${job.payrollCycle.type === 'end_of_month' ? `Monthly · cutoff day ${job.payrollCycle.cutoffDay}` : 'Event-based'}
          </span>
        </div>
      </div>

      <!-- Summary strip -->
      <div class="summary-strip">
        <div class="summary-item">
          <span class="summary-label">Shifts</span>
          <span class="summary-value">${jobShifts.length}</span>
        </div>
        <div class="summary-divider"></div>
        <div class="summary-item">
          <span class="summary-label">Hours</span>
          <span class="summary-value">${h(d.totalPaid)}</span>
        </div>
        <div class="summary-divider"></div>
        <div class="summary-item">
          <span class="summary-label">Gross</span>
          <span class="summary-value">${$(d.totalGross)}</span>
        </div>
        <div class="summary-divider"></div>
        <div class="summary-item">
          <span class="summary-label">Effective $/h (net)</span>
          <span class="summary-value eff-rate">$${d.effectiveHourly.toFixed(2)}</span>
        </div>
      </div>

      <!-- Hours note if breaks exist -->
      ${d.totalLogged !== d.totalPaid ? `<div class="hours-note">${hoursLine}</div>` : ''}

      <!-- Shift table -->
      ${jobShifts.length === 0
        ? `<div class="no-shifts">No shifts recorded for this period.</div>`
        : `<div class="shift-table-wrap">
            <table class="shift-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Time</th>
                  <th class="num">Paid hrs</th>
                  <th class="num">Rate</th>
                  <th>Type</th>
                  <th class="num">Gross</th>
                </tr>
              </thead>
              <tbody>${shiftRows}</tbody>
            </table>
          </div>`
      }

      <!-- Earnings + CPF -->
      <div class="bottom-grid">
        <!-- Earnings breakdown -->
        <div class="breakdown-col">
          <p class="col-heading">Earnings Breakdown</p>
          <div class="calc-lines">
            ${breakdownLines}
          </div>
          <div class="calc-total-line">
            <span>Gross Pay</span>
            <span>${$(d.totalGross)}</span>
          </div>
        </div>

        <!-- CPF -->
        <div class="cpf-col">
          <p class="col-heading">CPF Contributions</p>
          <div class="cpf-stack">
            <div class="cpf-line cpf-gross">
              <span>Gross Pay</span>
              <span>${$(d.totalGross)}</span>
            </div>
            <div class="cpf-line cpf-emp">
              <span>Employee CPF <span class="cpf-rate-badge">${(cpfRates.employee * 100).toFixed(1)}%</span></span>
              <span class="neg">− ${$(d.employeeCpf)}</span>
            </div>
            <div class="cpf-line cpf-net">
              <span>Take-Home</span>
              <span class="take-home">${$(d.netPay)}</span>
            </div>
            <div class="cpf-employer-note">
              <span class="empr-label">Employer CPF (${(cpfRates.employer * 100).toFixed(1)}%) →</span>
              <span class="empr-val">+ ${$(d.employerCpf)} to your CPF account</span>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  // ── Grand total section ──
  const grandSection = jobs.length > 1 ? `
    <div class="grand-card">
      <div class="grand-header">
        <span class="grand-label">Combined Summary</span>
        <span class="grand-month">${monthLabel}</span>
      </div>
      <div class="grand-grid">
        <div class="grand-item">
          <span class="grand-item-label">Total Hours</span>
          <span class="grand-item-val">${h(grandHours)}</span>
        </div>
        <div class="grand-item">
          <span class="grand-item-label">Total Gross</span>
          <span class="grand-item-val">${$(grandGross)}</span>
        </div>
        <div class="grand-item">
          <span class="grand-item-label">Employee CPF</span>
          <span class="grand-item-val neg-light">− ${$(grandEmpCpf)}</span>
        </div>
        <div class="grand-item">
          <span class="grand-item-label">Employer CPF</span>
          <span class="grand-item-val indigo-light">+ ${$(grandEmprCpf)}</span>
        </div>
        <div class="grand-item grand-net-item">
          <span class="grand-item-label">Total Take-Home</span>
          <span class="grand-item-val grand-net">${$(grandNet)}</span>
        </div>
      </div>
    </div>` : '';

  // ── Job pills for header ──
  const jobPills = jobs.map(j =>
    `<span class="job-pill"><span class="pill-dot" style="background:${getHexColor(j.colorId)}"></span>${j.title}</span>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Payslip — ${monthLabel}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    :root {
      --green:  #16a34a;
      --red:    #dc2626;
      --indigo: #6366f1;
      --ink:    #0d0d14;
      --ink2:   #374151;
      --ink3:   #6b7280;
      --ink4:   #9ca3af;
      --line:   #e5e7eb;
      --line2:  #f3f4f6;
      --bg:     #f9fafb;
      --white:  #ffffff;
      --mono:   'DM Mono', monospace;
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'DM Sans', -apple-system, sans-serif;
      font-size: 11px;
      line-height: 1.55;
      color: var(--ink2);
      background: var(--bg);
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .page {
      max-width: 820px;
      margin: 0 auto;
      padding: 52px 48px 72px;
    }

    /* ── TOP HEADER ─────────────────────────────────────── */
    .top-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 36px;
      padding-bottom: 28px;
      border-bottom: 1.5px solid var(--line);
    }

    .header-left {}

    .payslip-label {
      font-size: 9.5px;
      font-weight: 600;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--indigo);
      margin-bottom: 8px;
    }

    .month-title {
      font-size: 34px;
      font-weight: 700;
      color: var(--ink);
      letter-spacing: -0.03em;
      line-height: 1;
      margin-bottom: 4px;
    }

    .header-sub {
      font-size: 12px;
      color: var(--ink4);
      font-weight: 400;
    }

    .header-right {
      text-align: right;
      padding-top: 4px;
    }

    .header-meta-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
      text-align: right;
    }

    .meta-line {
      font-size: 10px;
      color: var(--ink3);
      line-height: 1.4;
    }
    .meta-line strong {
      color: var(--ink2);
      font-weight: 600;
    }

    /* ── JOB PILLS ──────────────────────────────────────── */
    .jobs-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-bottom: 32px;
    }

    .jobs-row-label {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--ink4);
      margin-right: 4px;
    }

    .job-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px 4px 8px;
      background: var(--white);
      border: 1px solid var(--line);
      border-radius: 100px;
      font-size: 10.5px;
      font-weight: 500;
      color: var(--ink2);
    }

    .pill-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    /* ── JOB CARD ───────────────────────────────────────── */
    .job-card {
      background: var(--white);
      border: 1px solid var(--line);
      border-radius: 16px;
      overflow: hidden;
      margin-bottom: 24px;
      page-break-inside: avoid;
      border-left: 3.5px solid var(--accent);
    }

    .job-card-header {
      padding: 20px 24px 16px;
      border-bottom: 1px solid var(--line2);
    }

    .job-name-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
    }

    .job-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .job-name {
      font-size: 17px;
      font-weight: 700;
      color: var(--ink);
      letter-spacing: -0.02em;
    }

    .job-meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .meta-tag {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 10px;
      background: var(--line2);
      border-radius: 6px;
      font-size: 10px;
      color: var(--ink2);
      font-weight: 500;
    }

    .meta-tag-label {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--ink4);
    }

    /* ── SUMMARY STRIP ──────────────────────────────────── */
    .summary-strip {
      display: flex;
      align-items: center;
      padding: 14px 24px;
      border-bottom: 1px solid var(--line2);
      gap: 0;
    }

    .summary-item {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .summary-label {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--ink4);
    }

    .summary-value {
      font-size: 15px;
      font-weight: 700;
      color: var(--ink);
      font-variant-numeric: tabular-nums;
      font-family: var(--mono);
    }

    .eff-rate { color: var(--indigo); }

    .summary-divider {
      width: 1px;
      height: 36px;
      background: var(--line);
      margin: 0 20px;
      flex-shrink: 0;
    }

    /* ── HOURS NOTE ─────────────────────────────────────── */
    .hours-note {
      padding: 8px 24px;
      background: #fffbeb;
      border-bottom: 1px solid #fde68a;
    }

    .hours-detail {
      font-size: 10px;
      color: #92400e;
      font-weight: 500;
    }

    /* ── SHIFT TABLE ────────────────────────────────────── */
    .shift-table-wrap {
      padding: 0 24px;
      border-bottom: 1px solid var(--line2);
    }

    .shift-table {
      width: 100%;
      border-collapse: collapse;
    }

    .shift-table thead tr {
      border-bottom: 1px solid var(--line);
    }

    .shift-table th {
      padding: 10px 8px 8px;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--ink4);
      text-align: left;
    }

    .shift-table th.num { text-align: right; }

    .shift-row td {
      padding: 9px 8px;
      border-bottom: 1px solid var(--line2);
      vertical-align: middle;
    }

    .shift-row:last-of-type td { border-bottom: none; }
    .shift-row:hover td { background: #fafbff; }

    .num { text-align: right; font-variant-numeric: tabular-nums; }

    .date-cell {
      white-space: nowrap;
    }

    .date-day {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      color: var(--ink4);
      margin-right: 5px;
      letter-spacing: 0.06em;
    }

    .date-full {
      font-size: 11px;
      font-weight: 600;
      color: var(--ink2);
    }

    .time-cell {
      font-family: var(--mono);
      font-size: 10.5px;
      color: var(--ink2);
    }

    .time-sep { color: var(--ink4); margin: 0 2px; }

    .break-note {
      display: inline-block;
      margin-left: 6px;
      font-size: 9px;
      color: var(--ink4);
      background: var(--line2);
      padding: 1px 6px;
      border-radius: 4px;
      font-family: 'DM Sans', sans-serif;
    }

    .rate-cell {
      font-family: var(--mono);
      font-size: 10.5px;
      color: var(--ink3);
    }

    .rate-unit {
      font-size: 9px;
      color: var(--ink4);
    }

    .gross-cell {
      font-family: var(--mono);
      font-weight: 600;
      color: var(--ink);
    }

    /* ── BADGES ─────────────────────────────────────────── */
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 5px;
      font-size: 9.5px;
      font-weight: 600;
      letter-spacing: 0.03em;
    }

    .badge-wd  { background: #f3f4f6; color: #6b7280; }
    .badge-wkd { background: #fff3e0; color: #c2410c; }
    .badge-ph  { background: #fef9c3; color: #a16207; }

    /* ── NOTE ROW ───────────────────────────────────────── */
    .note-row td {
      padding: 0 8px 8px 8px;
      font-size: 10px;
      color: var(--ink4);
      font-style: italic;
      border-bottom: 1px solid var(--line2);
    }

    .note-icon {
      margin-right: 5px;
      font-style: normal;
      color: var(--ink4);
    }

    .no-shifts {
      padding: 20px 24px;
      font-size: 11px;
      color: var(--ink4);
      font-style: italic;
      border-bottom: 1px solid var(--line2);
    }

    /* ── BOTTOM GRID ────────────────────────────────────── */
    .bottom-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
    }

    .breakdown-col {
      padding: 20px 24px;
      border-right: 1px solid var(--line2);
    }

    .cpf-col {
      padding: 20px 24px;
    }

    .col-heading {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--ink4);
      margin-bottom: 14px;
    }

    /* Calc lines */
    .calc-lines {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 12px;
    }

    .calc-line {
      display: flex;
      align-items: center;
      gap: 0;
      font-size: 10.5px;
    }

    .calc-label {
      color: var(--ink3);
      flex: 0 0 100px;
    }

    .calc-equation {
      color: var(--ink4);
      font-family: var(--mono);
      font-size: 10px;
      flex: 1;
    }

    .calc-val {
      font-family: var(--mono);
      font-weight: 600;
      color: var(--ink2);
      text-align: right;
      min-width: 72px;
    }

    .calc-val.positive { color: var(--green); }
    .calc-val.negative { color: var(--red); }

    .calc-total-line {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 10px;
      border-top: 1.5px solid var(--line);
      font-weight: 700;
      font-size: 11px;
      color: var(--ink);
      font-family: var(--mono);
    }

    /* CPF stack */
    .cpf-stack {
      display: flex;
      flex-direction: column;
      gap: 0;
    }

    .cpf-line {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 7px 0;
      font-size: 10.5px;
      border-bottom: 1px solid var(--line2);
    }

    .cpf-line:last-of-type { border-bottom: none; }

    .cpf-gross { color: var(--ink2); }
    .cpf-emp   { color: var(--ink3); }

    .cpf-net {
      padding: 10px 0 8px;
      border-bottom: none;
    }

    .cpf-net span:first-child {
      font-size: 12px;
      font-weight: 700;
      color: var(--ink);
    }

    .take-home {
      font-size: 20px;
      font-weight: 800;
      color: var(--green);
      font-family: var(--mono);
      letter-spacing: -0.02em;
    }

    .neg { color: var(--red); font-family: var(--mono); font-weight: 600; }

    .cpf-rate-badge {
      display: inline-block;
      background: #fee2e2;
      color: #991b1b;
      font-size: 9px;
      font-weight: 700;
      padding: 1px 5px;
      border-radius: 4px;
      margin-left: 4px;
    }

    .cpf-employer-note {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 10px;
      padding: 8px 10px;
      background: #eef2ff;
      border-radius: 8px;
      border: 1px solid #c7d2fe;
    }

    .empr-label {
      font-size: 9.5px;
      font-weight: 600;
      color: #4338ca;
    }

    .empr-val {
      font-size: 10px;
      font-weight: 700;
      color: #4338ca;
      font-family: var(--mono);
    }

    /* ── GRAND TOTAL ────────────────────────────────────── */
    .grand-card {
      background: var(--ink);
      border-radius: 16px;
      padding: 28px 32px;
      margin-bottom: 24px;
      page-break-inside: avoid;
    }

    .grand-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 22px;
    }

    .grand-label {
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #6b7280;
    }

    .grand-month {
      font-size: 11px;
      font-weight: 600;
      color: #9ca3af;
    }

    .grand-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 16px;
    }

    .grand-item {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .grand-item-label {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #6b7280;
    }

    .grand-item-val {
      font-size: 16px;
      font-weight: 800;
      color: #f9fafb;
      font-family: var(--mono);
      letter-spacing: -0.01em;
    }

    .neg-light   { color: #fca5a5; }
    .indigo-light { color: #a5b4fc; }
    .grand-net   { color: #6ee7b7; font-size: 20px; }

    .grand-net-item {
      padding-left: 16px;
      border-left: 1px solid #374151;
    }

    /* ── FOOTER ─────────────────────────────────────────── */
    .footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 20px;
      border-top: 1px solid var(--line);
      margin-top: 8px;
    }

    .footer-left, .footer-right {
      font-size: 9px;
      color: #d1d5db;
      line-height: 1.5;
    }

    .footer-right { text-align: right; }

    /* ── PRINT ──────────────────────────────────────────── */
    @media print {
      body { background: white; }
      .page { padding: 32px 36px 48px; }
      .job-card, .grand-card { page-break-inside: avoid; }

      @page {
        size: A4;
        margin: 0.4in 0.5in;

        @bottom-right {
          content: "Page " counter(page) " of " counter(pages);
          font-size: 8px;
          color: #9ca3af;
          font-family: 'DM Sans', sans-serif;
        }
      }
    }
  </style>
</head>
<body>
  <div class="page">

    <!-- Header -->
    <div class="top-header">
      <div class="header-left">
        <div class="payslip-label">Payslip</div>
        <h1 class="month-title">${monthLabel}</h1>
        <p class="header-sub">Singapore Part-Time Payroll</p>
      </div>
      <div class="header-right">
        <div class="header-meta-row">
          <div class="meta-line"><strong>Generated</strong> ${generatedAt}</div>
          <div class="meta-line"><strong>CPF Age Group</strong> ${cpfRates.label}</div>
          <div class="meta-line"><strong>Rates</strong> effective ${CPF_RATES_EFFECTIVE_DATE}</div>
          <div class="meta-line"><strong>Scope</strong> ${scope === 'payroll_cycle' ? 'Payroll Cycle' : 'Calendar Month'}</div>
        </div>
      </div>
    </div>

    <!-- Job pills -->
    <div class="jobs-row">
      <span class="jobs-row-label">Jobs</span>
      ${jobPills}
    </div>

    <!-- Job cards -->
    ${jobSections}

    <!-- Grand total -->
    ${grandSection}

    <!-- Footer -->
    <div class="footer">
      <div class="footer-left">
        Generated by SG Part-Time Payroll Calculator · ${generatedAt}
      </div>
      <div class="footer-right">
        This is a self-generated record and not an official payslip issued by an employer.
      </div>
    </div>

  </div>
</body>
</html>`;
}
