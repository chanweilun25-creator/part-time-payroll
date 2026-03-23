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

const fmt$ = (n: number) => `$${n.toFixed(2)}`;
const fmtH = (n: number) => `${n.toFixed(2)}h`;

// ── Main renderer ─────────────────────────────────────────────────────────────

export function renderPayslipHTML(opts: RenderOptions): string {
  const { jobs, shifts, ageGroup, selectedMonth, scope } = opts;
  const [year, month] = selectedMonth.split('-').map(Number);
  const monthLabel  = format(new Date(year, month - 1, 1), 'MMMM yyyy');
  const generatedAt = format(new Date(), "d MMM yyyy 'at' h:mm a");
  const cpfRates    = CPF_RATES[ageGroup];

  // ── Per-job computation ──────────────────────────────────────────────────────
  const jobData = jobs.map(job => {
    const jobShifts = getJobShifts(shifts, job, selectedMonth, scope)
      .sort((a, b) => a.date.localeCompare(b.date));

    let totalLogged = 0, totalPaid = 0, totalGross = 0;
    let weekdayHours = 0, weekendHours = 0, phHours = 0;
    let weekdayEarnings = 0, weekendEarnings = 0, phEarnings = 0;
    let totalAllowance = 0, totalDeduction = 0;

    jobShifts.forEach(shift => {
      const date   = parseISO(shift.date);
      const isPH   = shift.isPublicHoliday;
      const isWkd  = !isPH && isWeekend(date);
      const rate   = isPH ? job.rates.publicHoliday : isWkd ? job.rates.weekend : job.rates.weekday;
      const logged = calculateShiftHours(shift.startTime, shift.endTime, 0);
      const paid   = calculateShiftHours(shift.startTime, shift.endTime, shift.unpaidBreakHours);
      const gross  = calcShiftGross(shift, job);

      totalLogged    += logged;
      totalPaid      += paid;
      totalGross     += gross;
      totalAllowance += shift.allowance || 0;
      totalDeduction += shift.deduction || 0;

      if (isPH)       { phHours += paid;      phEarnings      += paid * rate; }
      else if (isWkd) { weekendHours += paid;  weekendEarnings += paid * rate; }
      else            { weekdayHours += paid;  weekdayEarnings += paid * rate; }
    });

    const { employeeCpf, employerCpf } = calculateCpf(totalGross, ageGroup);
    const netPay          = totalGross - employeeCpf;
    const effectiveHourly = totalPaid > 0 ? netPay / totalPaid : 0;
    const payPeriod       = getPayPeriodLabel(job, selectedMonth, scope);
    const jobColor        = getHexColor(job.colorId);

    return {
      job, jobShifts, jobColor, payPeriod,
      totalLogged, totalPaid, totalGross,
      weekdayHours, weekendHours, phHours,
      weekdayEarnings, weekendEarnings, phEarnings,
      totalAllowance, totalDeduction,
      employeeCpf, employerCpf, netPay, effectiveHourly,
    };
  });

  // ── Grand totals ──────────────────────────────────────────────────────────────
  const grandGross   = jobData.reduce((s, d) => s + d.totalGross,   0);
  const grandEmpCpf  = jobData.reduce((s, d) => s + d.employeeCpf,  0);
  const grandEmprCpf = jobData.reduce((s, d) => s + d.employerCpf,  0);
  const grandNet     = jobData.reduce((s, d) => s + d.netPay,        0);
  const grandHours   = jobData.reduce((s, d) => s + d.totalPaid,     0);

  // ── Job pills ─────────────────────────────────────────────────────────────────
  const jobPills = jobs.map(j =>
    `<span class="job-pill">
      <span class="pill-dot" style="background:${getHexColor(j.colorId)}"></span>
      ${j.title}
    </span>`
  ).join('');

  // ── Per-job card HTML ─────────────────────────────────────────────────────────
  const jobSections = jobData.map(d => {
    const { job, jobShifts, jobColor } = d;

    // Shift rows
    const shiftRows = jobShifts.map((shift, i) => {
      const date      = parseISO(shift.date);
      const isPH      = shift.isPublicHoliday;
      const isWkd     = !isPH && isWeekend(date);
      const rate      = isPH ? job.rates.publicHoliday : isWkd ? job.rates.weekend : job.rates.weekday;
      const paid      = calculateShiftHours(shift.startTime, shift.endTime, shift.unpaidBreakHours);
      const gross     = calcShiftGross(shift, job);
      const holiday   = SG_PUBLIC_HOLIDAYS[shift.date];
      const typeLabel = isPH ? `PH${holiday ? ` · ${holiday}` : ''}` : isWkd ? 'Weekend' : 'Weekday';
      const typeCls   = isPH ? 'badge-ph' : isWkd ? 'badge-wkd' : 'badge-wd';
      const rowBg     = i % 2 === 1 ? 'style="background:#fafafa"' : '';
      const breakNote = shift.unpaidBreakHours > 0
        ? `<span class="break-tag">${shift.unpaidBreakHours}h break</span>` : '';
      const noteLine  = shift.notes
        ? `<tr><td colspan="6" class="note-cell">↳ ${shift.notes}</td></tr>` : '';

      return `
        <tr ${rowBg}>
          <td class="td-date">
            <span class="dow">${format(date, 'EEE')}</span>
            <span class="ddate">${format(date, 'd MMM')}</span>
          </td>
          <td class="td-time">${shift.startTime}<span class="tsep">–</span>${shift.endTime}${breakNote}</td>
          <td class="td-num">${fmtH(paid)}</td>
          <td class="td-num td-rate">$${rate.toFixed(2)}<span class="per-h">/h</span></td>
          <td><span class="badge ${typeCls}">${typeLabel}</span></td>
          <td class="td-num td-gross">${fmt$(gross)}</td>
        </tr>${noteLine}`;
    }).join('');

    // Receipt-style earnings breakdown
    const earningsLines = [
      d.weekdayHours  > 0 ? `<div class="receipt-line">
        <span class="r-label">Weekday</span>
        <span class="r-eq">${fmtH(d.weekdayHours)} × $${job.rates.weekday.toFixed(2)}</span>
        <span class="r-val">${fmt$(d.weekdayEarnings)}</span>
      </div>` : '',
      d.weekendHours  > 0 ? `<div class="receipt-line">
        <span class="r-label">Weekend</span>
        <span class="r-eq">${fmtH(d.weekendHours)} × $${job.rates.weekend.toFixed(2)}</span>
        <span class="r-val">${fmt$(d.weekendEarnings)}</span>
      </div>` : '',
      d.phHours       > 0 ? `<div class="receipt-line">
        <span class="r-label">Public Holiday</span>
        <span class="r-eq">${fmtH(d.phHours)} × $${job.rates.publicHoliday.toFixed(2)}</span>
        <span class="r-val">${fmt$(d.phEarnings)}</span>
      </div>` : '',
      d.totalAllowance > 0 ? `<div class="receipt-line">
        <span class="r-label">Allowances</span>
        <span class="r-eq">—</span>
        <span class="r-val r-pos">+${fmt$(d.totalAllowance)}</span>
      </div>` : '',
      d.totalDeduction > 0 ? `<div class="receipt-line">
        <span class="r-label">Deductions</span>
        <span class="r-eq">—</span>
        <span class="r-val r-neg">−${fmt$(d.totalDeduction)}</span>
      </div>` : '',
    ].filter(Boolean).join('');

    const hasBreaks = d.totalLogged !== d.totalPaid;

    return `
    <div class="job-card" style="border-left-color: ${jobColor}">

      <!-- Card header -->
      <div class="card-header">
        <div class="card-title-row">
          <span class="card-dot" style="background:${jobColor}"></span>
          <h2 class="card-title">${job.title}</h2>
        </div>
        <div class="card-meta-row">
          <span class="meta-chip">
            <span class="chip-label">Pay Period</span>
            ${d.payPeriod}
          </span>
          <span class="meta-chip">
            <span class="chip-label">Cycle</span>
            ${job.payrollCycle.type === 'end_of_month'
              ? `Monthly · cutoff day ${job.payrollCycle.cutoffDay}`
              : 'Event-based'}
          </span>
        </div>
      </div>

      <!-- Summary strip -->
      <div class="summary-strip">
        <div class="s-item">
          <span class="s-label">Shifts Worked</span>
          <span class="s-val">${jobShifts.length}</span>
        </div>
        <div class="s-divider"></div>
        <div class="s-item">
          <span class="s-label">Hours Paid</span>
          <span class="s-val">${fmtH(d.totalPaid)}</span>
        </div>
        ${hasBreaks ? `
        <div class="s-divider"></div>
        <div class="s-item">
          <span class="s-label">Hours Logged</span>
          <span class="s-val s-muted">${fmtH(d.totalLogged)}</span>
        </div>
        <div class="s-divider"></div>
        <div class="s-item">
          <span class="s-label">Unpaid Breaks</span>
          <span class="s-val s-muted">${fmtH(d.totalLogged - d.totalPaid)}</span>
        </div>` : ''}
        <div class="s-divider"></div>
        <div class="s-item">
          <span class="s-label">Gross Pay</span>
          <span class="s-val">${fmt$(d.totalGross)}</span>
        </div>
        <div class="s-divider"></div>
        <div class="s-item">
          <span class="s-label">Effective $/h (net)</span>
          <span class="s-val s-indigo">$${d.effectiveHourly.toFixed(2)}</span>
        </div>
      </div>

      <!-- Shift table -->
      ${jobShifts.length === 0
        ? `<div class="no-shifts">No shifts recorded for this period.</div>`
        : `<div class="table-wrap">
            <table class="shift-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Time</th>
                  <th class="th-num">Paid hrs</th>
                  <th class="th-num">Rate</th>
                  <th>Type</th>
                  <th class="th-num">Gross</th>
                </tr>
              </thead>
              <tbody>${shiftRows}</tbody>
            </table>
          </div>`
      }

      <!-- Earnings + CPF stacked -->
      <div class="lower-section">

        <!-- Earnings breakdown (receipt style) -->
        <div class="earnings-block">
          <p class="block-label">Earnings Breakdown</p>
          <div class="receipt-lines">${earningsLines}</div>
          <div class="receipt-total">
            <span>Gross Pay</span>
            <span>${fmt$(d.totalGross)}</span>
          </div>
        </div>

        <div class="lower-divider"></div>

        <!-- CPF block -->
        <div class="cpf-block">
          <p class="block-label">CPF Contributions</p>
          <div class="cpf-row">
            <span class="cpf-label">Gross Pay</span>
            <span class="cpf-num">${fmt$(d.totalGross)}</span>
          </div>
          <div class="cpf-row cpf-deduct">
            <span class="cpf-label">
              Employee CPF
              <span class="cpf-rate-tag">${(cpfRates.employee * 100).toFixed(1)}%</span>
            </span>
            <span class="cpf-num cpf-red">− ${fmt$(d.employeeCpf)}</span>
          </div>
          <div class="cpf-separator"></div>
          <div class="cpf-row cpf-net-row">
            <span class="cpf-net-label">Take-Home</span>
            <span class="cpf-take-home">${fmt$(d.netPay)}</span>
          </div>
          <div class="cpf-employer-row">
            <span class="empr-text">
              Employer also contributes ${fmt$(d.employerCpf)}
              (${(cpfRates.employer * 100).toFixed(1)}%) to your CPF account
            </span>
          </div>
        </div>

      </div>
    </div>`;
  }).join('');

  // ── Grand total card ──────────────────────────────────────────────────────────
  const grandSection = jobs.length > 1 ? `
    <div class="grand-card">
      <div class="grand-header-row">
        <span class="grand-eyebrow">Combined Summary</span>
        <span class="grand-month">${monthLabel}</span>
      </div>
      <div class="grand-grid">
        <div class="grand-item">
          <span class="gi-label">Total Hours</span>
          <span class="gi-val">${fmtH(grandHours)}</span>
        </div>
        <div class="grand-item">
          <span class="gi-label">Total Gross</span>
          <span class="gi-val">${fmt$(grandGross)}</span>
        </div>
        <div class="grand-item">
          <span class="gi-label">Employee CPF</span>
          <span class="gi-val gi-red">− ${fmt$(grandEmpCpf)}</span>
        </div>
        <div class="grand-item">
          <span class="gi-label">Employer CPF</span>
          <span class="gi-val gi-indigo">+ ${fmt$(grandEmprCpf)}</span>
        </div>
        <div class="grand-item grand-item-net">
          <span class="gi-label">Total Take-Home</span>
          <span class="gi-val gi-green">${fmt$(grandNet)}</span>
        </div>
      </div>
    </div>` : '';

  // ── Full HTML document ────────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Payslip — ${monthLabel}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
  <style>
    /* ── Reset ── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 11px;
      line-height: 1.55;
      color: #1a1a1a;
      background: #fafafa;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* ── Page ── */
    .page {
      max-width: 780px;
      margin: 0 auto;
      padding: 56px 48px 80px;
    }

    /* ── Header ──────────────────────────────────────────── */
    .doc-header {
      margin-bottom: 40px;
      padding-bottom: 32px;
      border-bottom: 1px solid #ebebeb;
    }

    .doc-eyebrow {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #6366f1;
      margin-bottom: 10px;
    }

    .doc-month {
      font-size: 32px;
      font-weight: 700;
      color: #0a0a0a;
      letter-spacing: -0.025em;
      line-height: 1.1;
      margin-bottom: 20px;
    }

    .doc-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 20px;
    }

    .doc-meta-item {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .doc-meta-label {
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #9ca3af;
    }

    .doc-meta-value {
      font-size: 11px;
      font-weight: 500;
      color: #374151;
    }

    /* ── Job pills ───────────────────────────────────────── */
    .pills-section {
      margin-bottom: 32px;
    }

    .pills-label {
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #9ca3af;
      margin-bottom: 10px;
    }

    .pills-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .job-pill {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 5px 12px 5px 9px;
      background: #ffffff;
      border: 1px solid #ebebeb;
      border-radius: 100px;
      font-size: 11px;
      font-weight: 500;
      color: #374151;
    }

    .pill-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    /* ── Job card ────────────────────────────────────────── */
    .job-card {
      background: #ffffff;
      border: 1px solid #ebebeb;
      border-radius: 12px;
      border-left-width: 3px;
      overflow: hidden;
      margin-bottom: 20px;
      page-break-inside: avoid;
    }

    /* Card header */
    .card-header {
      padding: 20px 24px 16px;
      border-bottom: 1px solid #f3f4f6;
    }

    .card-title-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
    }

    .card-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .card-title {
      font-size: 16px;
      font-weight: 700;
      color: #0a0a0a;
      letter-spacing: -0.015em;
    }

    .card-meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .meta-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      background: #f9fafb;
      border: 1px solid #ebebeb;
      border-radius: 6px;
      font-size: 10px;
      color: #374151;
      font-weight: 400;
    }

    .chip-label {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #9ca3af;
    }

    /* Summary strip */
    .summary-strip {
      display: flex;
      align-items: center;
      padding: 14px 24px;
      border-bottom: 1px solid #f3f4f6;
      background: #fafafa;
      gap: 0;
    }

    .s-item {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .s-label {
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #9ca3af;
    }

    .s-val {
      font-size: 14px;
      font-weight: 700;
      color: #0a0a0a;
      font-variant-numeric: tabular-nums;
    }

    .s-muted { color: #6b7280; font-weight: 500; }
    .s-indigo { color: #6366f1; }

    .s-divider {
      width: 1px;
      height: 32px;
      background: #ebebeb;
      margin: 0 16px;
      flex-shrink: 0;
    }

    /* Shift table */
    .table-wrap {
      border-bottom: 1px solid #f3f4f6;
    }

    .shift-table {
      width: 100%;
      border-collapse: collapse;
    }

    .shift-table thead tr {
      border-bottom: 1px solid #ebebeb;
    }

    .shift-table th {
      padding: 10px 12px 8px;
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #9ca3af;
      text-align: left;
    }

    .th-num { text-align: right; }

    .shift-table tbody tr td {
      padding: 9px 12px;
      border-bottom: 1px solid #f3f4f6;
      color: #374151;
    }

    .shift-table tbody tr:last-child td { border-bottom: none; }

    .td-num { text-align: right; font-variant-numeric: tabular-nums; }

    .td-date { white-space: nowrap; }
    .dow {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #9ca3af;
      margin-right: 5px;
    }
    .ddate {
      font-size: 11px;
      font-weight: 500;
      color: #374151;
    }

    .td-time {
      font-size: 10.5px;
      color: #4b5563;
      font-variant-numeric: tabular-nums;
    }
    .tsep { color: #d1d5db; margin: 0 2px; }

    .break-tag {
      display: inline-block;
      margin-left: 6px;
      padding: 1px 6px;
      background: #fef9c3;
      color: #92400e;
      border-radius: 4px;
      font-size: 9px;
      font-weight: 500;
    }

    .td-rate {
      font-size: 10.5px;
      color: #6b7280;
    }
    .per-h { font-size: 9px; color: #9ca3af; }

    .td-gross {
      font-weight: 600;
      color: #111827;
    }

    /* Badges */
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 5px;
      font-size: 9.5px;
      font-weight: 600;
    }
    .badge-wd  { background: #f3f4f6; color: #6b7280; }
    .badge-wkd { background: #fff3e0; color: #c2410c; }
    .badge-ph  { background: #fef9c3; color: #a16207; }

    /* Note row */
    .note-cell {
      padding: 2px 12px 8px 12px !important;
      font-size: 9.5px;
      color: #9ca3af;
      font-style: italic;
      border-bottom: 1px solid #f3f4f6 !important;
    }

    .no-shifts {
      padding: 20px 24px;
      font-size: 11px;
      color: #9ca3af;
      font-style: italic;
      border-bottom: 1px solid #f3f4f6;
    }

    /* Lower section */
    .lower-section {
      display: flex;
      flex-direction: column;
    }

    .earnings-block {
      padding: 20px 24px;
      border-bottom: 1px solid #f3f4f6;
    }

    .lower-divider { display: none; }

    .cpf-block {
      padding: 20px 24px;
    }

    .block-label {
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: #9ca3af;
      margin-bottom: 14px;
    }

    /* Receipt lines */
    .receipt-lines {
      display: flex;
      flex-direction: column;
      gap: 7px;
      margin-bottom: 12px;
    }

    .receipt-line {
      display: flex;
      align-items: baseline;
      gap: 0;
      font-size: 11px;
    }

    .r-label {
      flex: 0 0 110px;
      color: #4b5563;
      font-weight: 500;
    }

    .r-eq {
      flex: 1;
      color: #9ca3af;
      font-size: 10px;
      font-variant-numeric: tabular-nums;
    }

    .r-val {
      font-weight: 600;
      color: #111827;
      font-variant-numeric: tabular-nums;
      min-width: 70px;
      text-align: right;
    }

    .r-pos { color: #16a34a; }
    .r-neg { color: #dc2626; }

    .receipt-total {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 10px;
      border-top: 1.5px solid #ebebeb;
      font-size: 12px;
      font-weight: 700;
      color: #0a0a0a;
      font-variant-numeric: tabular-nums;
    }

    /* CPF block */
    .cpf-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 7px 0;
      border-bottom: 1px solid #f3f4f6;
      font-size: 11px;
    }

    .cpf-row:last-of-type { border-bottom: none; }

    .cpf-label { color: #4b5563; }
    .cpf-num { font-weight: 600; font-variant-numeric: tabular-nums; color: #111827; }
    .cpf-red { color: #dc2626; }

    .cpf-rate-tag {
      display: inline-block;
      margin-left: 5px;
      padding: 1px 5px;
      background: #fee2e2;
      color: #991b1b;
      border-radius: 4px;
      font-size: 9px;
      font-weight: 700;
    }

    .cpf-separator {
      border-top: 1.5px solid #ebebeb;
      margin: 4px 0;
    }

    .cpf-net-row {
      border-bottom: none !important;
      padding-top: 10px;
    }

    .cpf-net-label {
      font-size: 13px;
      font-weight: 700;
      color: #0a0a0a;
    }

    .cpf-take-home {
      font-size: 26px;
      font-weight: 800;
      color: #16a34a;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.02em;
    }

    .cpf-employer-row {
      margin-top: 12px;
      padding: 10px 14px;
      background: #eef2ff;
      border-radius: 8px;
      border: 1px solid #c7d2fe;
    }

    .empr-text {
      font-size: 10px;
      color: #4338ca;
      font-weight: 500;
    }

    /* ── Grand total card ────────────────────────────────── */
    .grand-card {
      background: #0a0a0a;
      border-radius: 12px;
      padding: 28px 32px;
      margin-bottom: 24px;
      page-break-inside: avoid;
    }

    .grand-header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }

    .grand-eyebrow {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: #6b7280;
    }

    .grand-month {
      font-size: 11px;
      font-weight: 500;
      color: #6b7280;
    }

    .grand-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 20px;
    }

    .grand-item {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .gi-label {
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #6b7280;
    }

    .gi-val {
      font-size: 15px;
      font-weight: 700;
      color: #f9fafb;
      font-variant-numeric: tabular-nums;
    }

    .gi-red    { color: #fca5a5; }
    .gi-indigo { color: #a5b4fc; }
    .gi-green  { color: #6ee7b7; font-size: 20px; font-weight: 800; }

    .grand-item-net {
      padding-left: 20px;
      border-left: 1px solid #374151;
    }

    /* ── Footer ──────────────────────────────────────────── */
    .doc-footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #ebebeb;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 20px;
    }

    .footer-l, .footer-r {
      font-size: 9px;
      color: #d1d5db;
      line-height: 1.6;
    }

    .footer-r { text-align: right; }

    /* ── Print rules ─────────────────────────────────────── */
    @media print {
      body { background: #fafafa; }
      .page { padding: 32px 36px 52px; }
      .job-card, .grand-card { page-break-inside: avoid; }

      @page {
        size: A4;
        margin: 0.4in 0.5in;

        @bottom-center {
          content: "Page " counter(page) " of " counter(pages);
          font-family: 'Inter', sans-serif;
          font-size: 8px;
          color: #9ca3af;
        }
      }
    }
  </style>
</head>
<body>
  <div class="page">

    <!-- Header -->
    <div class="doc-header">
      <div class="doc-eyebrow">Payslip</div>
      <h1 class="doc-month">${monthLabel}</h1>
      <div class="doc-meta">
        <div class="doc-meta-item">
          <span class="doc-meta-label">Generated</span>
          <span class="doc-meta-value">${generatedAt}</span>
        </div>
        <div class="doc-meta-item">
          <span class="doc-meta-label">CPF Age Group</span>
          <span class="doc-meta-value">${cpfRates.label}</span>
        </div>
        <div class="doc-meta-item">
          <span class="doc-meta-label">Rates Effective</span>
          <span class="doc-meta-value">${CPF_RATES_EFFECTIVE_DATE}</span>
        </div>
        <div class="doc-meta-item">
          <span class="doc-meta-label">Scope</span>
          <span class="doc-meta-value">${scope === 'payroll_cycle' ? 'Payroll Cycle' : 'Calendar Month'}</span>
        </div>
      </div>
    </div>

    <!-- Job pills -->
    <div class="pills-section">
      <div class="pills-label">Jobs Included</div>
      <div class="pills-row">${jobPills}</div>
    </div>

    <!-- Job cards -->
    ${jobSections}

    <!-- Grand total -->
    ${grandSection}

    <!-- Footer -->
    <div class="doc-footer">
      <div class="footer-l">Generated by SG Part-Time Payroll Calculator · ${generatedAt}</div>
      <div class="footer-r">Self-generated record only. Not an official payslip issued by an employer.</div>
    </div>

  </div>
</body>
</html>`;
}
