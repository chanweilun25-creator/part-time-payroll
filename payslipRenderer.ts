import { format, parseISO, startOfMonth, endOfMonth, isAfter, isBefore, isEqual, isWeekend } from 'date-fns';
import { type Job, type Shift, getHexColor, SG_PUBLIC_HOLIDAYS } from './types';
import { type AgeGroup, CPF_RATES, CPF_RATES_EFFECTIVE_DATE, calculateCpf } from './cpfRates';
import { calculateShiftHours, calcShiftGross } from './utils';

type CycleScope = 'payroll_cycle' | 'calendar_month';

interface RenderOptions {
  jobs: Job[];
  shifts: Shift[];
  ageGroup: AgeGroup;
  selectedMonth: string; // 'yyyy-MM'
  scope: CycleScope;
}

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

function hex(colorId: string) { return getHexColor(colorId); }
function fmtMoney(n: number)  { return `$${n.toFixed(2)}`; }
function fmtHours(n: number)  { return `${n.toFixed(2)}h`; }

export function renderPayslipHTML(opts: RenderOptions): string {
  const { jobs, shifts, ageGroup, selectedMonth, scope } = opts;
  const [year, month] = selectedMonth.split('-').map(Number);
  const monthLabel    = format(new Date(year, month - 1, 1), 'MMMM yyyy');
  const generatedAt   = format(new Date(), "d MMM yyyy, h:mm a");
  const cpfRates      = CPF_RATES[ageGroup];
  const scopeLabel    = scope === 'payroll_cycle' ? 'Payroll Cycle' : 'Calendar Month';

  // Per-job data
  const jobBlocks = jobs.map(job => {
    const jobShifts  = getJobShifts(shifts, job, selectedMonth, scope).sort((a, b) => a.date.localeCompare(b.date));
    let totalHours   = 0;
    let totalGross   = 0;
    let weekdayHours = 0, weekendHours = 0, phHours = 0;
    let weekdayGross = 0, weekendGross = 0, phGross = 0;
    let totalAllowance = 0, totalDeduction = 0;

    const shiftRows = jobShifts.map(shift => {
      const date  = parseISO(shift.date);
      const isPH  = shift.isPublicHoliday;
      const isWkd = !isPH && isWeekend(date);
      const rate  = isPH ? job.rates.publicHoliday : isWkd ? job.rates.weekend : job.rates.weekday;
      const hours = calculateShiftHours(shift.startTime, shift.endTime, shift.unpaidBreakHours);
      const gross = calcShiftGross(shift, job);
      const holidayName = SG_PUBLIC_HOLIDAYS[shift.date];

      totalHours   += hours;
      totalGross   += gross;
      totalAllowance += shift.allowance || 0;
      totalDeduction += shift.deduction || 0;

      if (isPH)        { phHours += hours; phGross += hours * rate; }
      else if (isWkd)  { weekendHours += hours; weekendGross += hours * rate; }
      else             { weekdayHours += hours; weekdayGross += hours * rate; }

      const typeTag = isPH
        ? `<span class="badge badge-ph">PH${holidayName ? ` · ${holidayName}` : ''}</span>`
        : isWkd ? `<span class="badge badge-wkd">Weekend</span>`
        : `<span class="badge badge-wd">Weekday</span>`;

      return `
        <tr>
          <td>${format(date, 'EEE, d MMM')}</td>
          <td>${shift.startTime} – ${shift.endTime}</td>
          <td class="num">${fmtHours(hours)}</td>
          <td class="num">$${rate.toFixed(2)}</td>
          <td>${typeTag}</td>
          <td class="num">${shift.allowance ? `+${fmtMoney(shift.allowance)}` : '—'}</td>
          <td class="num">${shift.deduction ? `-${fmtMoney(shift.deduction)}` : '—'}</td>
          <td class="num bold">${fmtMoney(gross)}</td>
        </tr>
        ${shift.notes ? `<tr class="notes-row"><td colspan="8"><span class="note-label">Note:</span> ${shift.notes}</td></tr>` : ''}
      `;
    }).join('');

    const { employeeCpf, employerCpf } = calculateCpf(totalGross, ageGroup);
    const netPay = totalGross - employeeCpf;
    const jobColor = hex(job.colorId);

    // Rate breakdown rows — only show rows with hours
    const rateBreakdown = [
      weekdayHours  > 0 ? `<tr><td>Weekday hours</td><td class="num">${fmtHours(weekdayHours)}</td><td class="num">$${job.rates.weekday.toFixed(2)}/h</td><td class="num">${fmtMoney(weekdayGross)}</td></tr>` : '',
      weekendHours  > 0 ? `<tr><td>Weekend hours</td><td class="num">${fmtHours(weekendHours)}</td><td class="num">$${job.rates.weekend.toFixed(2)}/h</td><td class="num">${fmtMoney(weekendGross)}</td></tr>` : '',
      phHours       > 0 ? `<tr><td>Public holiday hours</td><td class="num">${fmtHours(phHours)}</td><td class="num">$${job.rates.publicHoliday.toFixed(2)}/h</td><td class="num">${fmtMoney(phGross)}</td></tr>` : '',
      totalAllowance > 0 ? `<tr><td>Allowances</td><td class="num">—</td><td class="num">—</td><td class="num">+${fmtMoney(totalAllowance)}</td></tr>` : '',
      totalDeduction > 0 ? `<tr><td>Deductions</td><td class="num">—</td><td class="num">—</td><td class="num">-${fmtMoney(totalDeduction)}</td></tr>` : '',
    ].filter(Boolean).join('');

    const cycleNote = job.payrollCycle.type === 'end_of_month' && scope === 'payroll_cycle'
      ? `Payroll cycle cutoff: Day ${job.payrollCycle.cutoffDay}`
      : job.payrollCycle.type === 'end_of_event'
      ? `Event-based job${job.payrollCycle.endDate ? ` · ends ${format(parseISO(job.payrollCycle.endDate), 'd MMM yyyy')}` : ''}`
      : `Calendar month scope`;

    return { job, jobShifts, shiftRows, rateBreakdown, totalHours, totalGross, totalAllowance, totalDeduction, employeeCpf, employerCpf, netPay, jobColor, cycleNote };
  });

  // Grand total
  const grandGross      = jobBlocks.reduce((s, b) => s + b.totalGross, 0);
  const grandEmpCpf     = jobBlocks.reduce((s, b) => s + b.employeeCpf, 0);
  const grandEmprCpf    = jobBlocks.reduce((s, b) => s + b.employerCpf, 0);
  const grandNet        = jobBlocks.reduce((s, b) => s + b.netPay, 0);
  const grandHours      = jobBlocks.reduce((s, b) => s + b.totalHours, 0);

  const jobDotList = jobs.map(j =>
    `<span class="job-dot-item"><span class="dot" style="background:${hex(j.colorId)}"></span>${j.title}</span>`
  ).join('');

  const jobSections = jobBlocks.map(b => `
    <div class="job-section" style="--job-color: ${b.jobColor}">
      <div class="job-header">
        <div class="job-title-row">
          <span class="job-dot" style="background:${b.jobColor}"></span>
          <h2 class="job-title">${b.job.title}</h2>
          <span class="job-cycle-note">${b.cycleNote}</span>
        </div>
        <div class="job-summary-pills">
          <span class="pill">${b.jobShifts.length} shift${b.jobShifts.length !== 1 ? 's' : ''}</span>
          <span class="pill">${fmtHours(b.totalHours)} total</span>
          <span class="pill gross-pill">${fmtMoney(b.totalGross)} gross</span>
        </div>
      </div>

      ${b.jobShifts.length === 0 ? '<p class="no-shifts">No shifts recorded for this period.</p>' : `
        <table class="shift-table">
          <thead>
            <tr>
              <th>Date</th><th>Hours</th><th>Paid Hrs</th><th>Rate</th><th>Type</th><th>Allowance</th><th>Deduction</th><th>Gross</th>
            </tr>
          </thead>
          <tbody>${b.shiftRows}</tbody>
        </table>
      `}

      <div class="calc-section">
        <div class="calc-left">
          <p class="calc-heading">Earnings Breakdown</p>
          <table class="calc-table">
            <thead><tr><th>Component</th><th>Hours</th><th>Rate</th><th>Amount</th></tr></thead>
            <tbody>${b.rateBreakdown}</tbody>
            <tfoot>
              <tr class="total-row"><td colspan="3">Gross Pay</td><td class="num bold">${fmtMoney(b.totalGross)}</td></tr>
            </tfoot>
          </table>
        </div>
        <div class="calc-right">
          <p class="calc-heading">CPF Contributions</p>
          <div class="cpf-box">
            <div class="cpf-row">
              <span>Gross Pay</span>
              <span class="cpf-val">${fmtMoney(b.totalGross)}</span>
            </div>
            <div class="cpf-row employee">
              <span>Employee CPF (${(cpfRates.employee * 100).toFixed(1)}%)</span>
              <span class="cpf-val negative">− ${fmtMoney(b.employeeCpf)}</span>
            </div>
            <div class="cpf-divider"></div>
            <div class="cpf-row net">
              <span>Take-Home (Net)</span>
              <span class="cpf-val net-val">${fmtMoney(b.netPay)}</span>
            </div>
            <div class="cpf-row employer">
              <span>Employer CPF (${(cpfRates.employer * 100).toFixed(1)}%)</span>
              <span class="cpf-val positive">+ ${fmtMoney(b.employerCpf)}</span>
            </div>
            <p class="cpf-note">Employer CPF goes into your CPF account and is not part of take-home pay.</p>
          </div>
        </div>
      </div>
    </div>
  `).join('');

  const hasMultipleJobs = jobBlocks.length > 1;

  const grandTotalSection = hasMultipleJobs ? `
    <div class="grand-total-section">
      <h2 class="grand-title">Combined Summary</h2>
      <div class="grand-grid">
        <div class="grand-card">
          <p class="grand-label">Total Hours</p>
          <p class="grand-value">${fmtHours(grandHours)}</p>
        </div>
        <div class="grand-card">
          <p class="grand-label">Total Gross</p>
          <p class="grand-value">${fmtMoney(grandGross)}</p>
        </div>
        <div class="grand-card negative-card">
          <p class="grand-label">Total Employee CPF</p>
          <p class="grand-value negative">${fmtMoney(grandEmpCpf)}</p>
        </div>
        <div class="grand-card positive-card">
          <p class="grand-label">Total Employer CPF</p>
          <p class="grand-value positive">${fmtMoney(grandEmprCpf)}</p>
        </div>
        <div class="grand-card net-card">
          <p class="grand-label">Total Take-Home</p>
          <p class="grand-value net">${fmtMoney(grandNet)}</p>
        </div>
      </div>
    </div>
  ` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Payslip — ${monthLabel}</title>
  <style>
    /* ── Reset & base ── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 11px;
      line-height: 1.5;
      color: #1a1a2e;
      background: #ffffff;
      padding: 0;
    }

    /* ── Page layout ── */
    .page {
      max-width: 900px;
      margin: 0 auto;
      padding: 48px 48px 64px;
    }

    /* ── Header ── */
    .header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      padding-bottom: 28px;
      border-bottom: 2px solid #e8e8f0;
      margin-bottom: 32px;
    }
    .header-left {}
    .header-badge {
      display: inline-block;
      background: #6366f1;
      color: white;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      padding: 3px 10px;
      border-radius: 100px;
      margin-bottom: 10px;
    }
    .header-title {
      font-size: 28px;
      font-weight: 700;
      color: #0f0f23;
      letter-spacing: -0.02em;
      line-height: 1.15;
    }
    .header-subtitle {
      font-size: 13px;
      color: #6b7280;
      margin-top: 4px;
    }
    .header-right {
      text-align: right;
    }
    .header-meta {
      font-size: 10px;
      color: #9ca3af;
      line-height: 1.8;
    }
    .header-meta strong {
      color: #4b5563;
      font-weight: 600;
    }

    /* ── Job dot list ── */
    .jobs-row {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 36px;
      padding: 14px 18px;
      background: #f8f8fc;
      border-radius: 12px;
      border: 1px solid #e8e8f0;
    }
    .jobs-row-label {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #9ca3af;
      width: 100%;
      margin-bottom: 4px;
    }
    .job-dot-item {
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 11px;
      font-weight: 600;
      color: #374151;
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      display: inline-block;
      flex-shrink: 0;
    }

    /* ── Scope + CPF info strip ── */
    .meta-strip {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 32px;
    }
    .meta-chip {
      font-size: 10px;
      font-weight: 500;
      color: #4b5563;
      background: #f3f4f6;
      border: 1px solid #e5e7eb;
      border-radius: 100px;
      padding: 4px 12px;
    }
    .meta-chip.indigo {
      background: #eef2ff;
      border-color: #c7d2fe;
      color: #4338ca;
    }

    /* ── Job section ── */
    .job-section {
      margin-bottom: 44px;
      padding: 24px;
      border: 1.5px solid #e8e8f0;
      border-radius: 16px;
      page-break-inside: avoid;
    }
    .job-section::before {
      content: '';
      display: block;
      height: 3px;
      background: var(--job-color);
      border-radius: 2px;
      margin-bottom: 20px;
      margin-left: -24px;
      margin-right: -24px;
      margin-top: -24px;
      border-radius: 14px 14px 0 0;
    }

    .job-header {
      margin-bottom: 18px;
    }
    .job-title-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
    }
    .job-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .job-title {
      font-size: 16px;
      font-weight: 700;
      color: #0f0f23;
    }
    .job-cycle-note {
      font-size: 9px;
      color: #9ca3af;
      font-weight: 500;
      margin-left: auto;
    }
    .job-summary-pills {
      display: flex;
      gap: 8px;
    }
    .pill {
      font-size: 10px;
      font-weight: 600;
      background: #f3f4f6;
      color: #4b5563;
      border-radius: 100px;
      padding: 3px 10px;
      border: 1px solid #e5e7eb;
    }
    .gross-pill {
      background: #f0fdf4;
      color: #15803d;
      border-color: #bbf7d0;
    }

    /* ── No shifts ── */
    .no-shifts {
      color: #9ca3af;
      font-style: italic;
      font-size: 11px;
      margin: 12px 0;
    }

    /* ── Shift table ── */
    .shift-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
      font-size: 10.5px;
    }
    .shift-table thead tr {
      background: #f8f8fc;
    }
    .shift-table th {
      text-align: left;
      padding: 8px 10px;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #9ca3af;
      border-bottom: 1px solid #e8e8f0;
    }
    .shift-table td {
      padding: 8px 10px;
      border-bottom: 1px solid #f3f4f6;
      color: #374151;
    }
    .shift-table tbody tr:last-child td { border-bottom: none; }
    .shift-table tbody tr:hover { background: #fafafa; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .bold { font-weight: 700; }

    /* ── Notes row ── */
    .notes-row td {
      padding: 3px 10px 8px;
      font-size: 9.5px;
      color: #9ca3af;
      border-bottom: 1px solid #f3f4f6;
      font-style: italic;
    }
    .note-label { font-weight: 600; color: #d1d5db; }

    /* ── Badges ── */
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 100px;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.04em;
    }
    .badge-wd  { background: #f3f4f6; color: #6b7280; }
    .badge-wkd { background: #fff7ed; color: #c2410c; }
    .badge-ph  { background: #fef3c7; color: #b45309; }

    /* ── Calc section ── */
    .calc-section {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-top: 4px;
    }
    .calc-heading {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #9ca3af;
      margin-bottom: 10px;
    }
    .calc-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10.5px;
    }
    .calc-table th {
      text-align: left;
      font-size: 9px;
      font-weight: 600;
      color: #9ca3af;
      padding: 5px 8px;
      border-bottom: 1px solid #e8e8f0;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .calc-table td {
      padding: 6px 8px;
      color: #374151;
      border-bottom: 1px solid #f3f4f6;
    }
    .calc-table tfoot td {
      border-top: 1.5px solid #e8e8f0;
      border-bottom: none;
      padding-top: 8px;
      font-weight: 700;
      color: #111827;
    }

    /* ── CPF box ── */
    .cpf-box {
      background: #f8f8fc;
      border: 1px solid #e8e8f0;
      border-radius: 10px;
      padding: 14px 16px;
    }
    .cpf-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 10.5px;
      padding: 4px 0;
      color: #374151;
    }
    .cpf-val { font-weight: 600; font-variant-numeric: tabular-nums; }
    .cpf-row.employee .cpf-val { color: #dc2626; }
    .cpf-row.employer .cpf-val { color: #6366f1; font-size: 10px; }
    .cpf-row.employer { opacity: 0.75; }
    .cpf-row.net { margin-top: 2px; }
    .cpf-row.net span:first-child { font-weight: 700; color: #111827; }
    .cpf-val.net-val { font-size: 13px; color: #15803d; font-weight: 800; }
    .negative { color: #dc2626; }
    .positive { color: #6366f1; }
    .cpf-divider { border-top: 1.5px solid #e8e8f0; margin: 8px 0; }
    .cpf-note {
      font-size: 9px;
      color: #9ca3af;
      margin-top: 10px;
      padding-top: 8px;
      border-top: 1px dashed #e5e7eb;
      line-height: 1.5;
    }

    /* ── Grand total ── */
    .grand-total-section {
      margin-top: 8px;
      padding: 24px;
      background: #0f0f23;
      border-radius: 16px;
      color: white;
      page-break-inside: avoid;
    }
    .grand-title {
      font-size: 13px;
      font-weight: 700;
      color: #e5e7eb;
      letter-spacing: 0.04em;
      margin-bottom: 18px;
    }
    .grand-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 12px;
    }
    .grand-card {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 10px;
      padding: 12px 14px;
    }
    .grand-label {
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #9ca3af;
      margin-bottom: 6px;
    }
    .grand-value {
      font-size: 14px;
      font-weight: 800;
      color: #f9fafb;
      font-variant-numeric: tabular-nums;
    }
    .grand-value.negative { color: #fca5a5; }
    .grand-value.positive { color: #a5b4fc; }
    .grand-value.net      { color: #6ee7b7; }
    .net-card { background: rgba(16, 185, 129, 0.12); border-color: rgba(16,185,129,0.3); }

    /* ── Footer ── */
    .footer {
      margin-top: 48px;
      padding-top: 20px;
      border-top: 1px solid #e8e8f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .footer-left {
      font-size: 9px;
      color: #d1d5db;
    }
    .footer-right {
      font-size: 9px;
      color: #d1d5db;
      text-align: right;
    }

    /* ── Print ── */
    @media print {
      body { background: white; }
      .page { padding: 32px; }
      .job-section { page-break-inside: avoid; }
      .grand-total-section { page-break-inside: avoid; }
      @page { margin: 0.5in; size: A4; }
    }
  </style>
</head>
<body>
  <div class="page">

    <!-- Header -->
    <div class="header">
      <div class="header-left">
        <div class="header-badge">Payslip</div>
        <h1 class="header-title">${monthLabel}</h1>
        <p class="header-subtitle">Singapore Part-Time Payroll</p>
      </div>
      <div class="header-right">
        <div class="header-meta">
          <div><strong>Generated</strong></div>
          <div>${generatedAt}</div>
          <div style="margin-top:8px"><strong>CPF Age Group</strong></div>
          <div>${cpfRates.label}</div>
          <div style="margin-top:8px"><strong>Rates effective</strong></div>
          <div>${CPF_RATES_EFFECTIVE_DATE}</div>
        </div>
      </div>
    </div>

    <!-- Jobs included -->
    <div class="jobs-row">
      <div class="jobs-row-label">Jobs included</div>
      ${jobDotList}
    </div>

    <!-- Meta chips -->
    <div class="meta-strip">
      <span class="meta-chip indigo">Scope: ${scopeLabel}</span>
      <span class="meta-chip">Employee CPF: ${(cpfRates.employee * 100).toFixed(1)}%</span>
      <span class="meta-chip">Employer CPF: ${(cpfRates.employer * 100).toFixed(1)}%</span>
    </div>

    <!-- Job sections -->
    ${jobSections}

    <!-- Grand total (only if multiple jobs) -->
    ${grandTotalSection}

    <!-- Footer -->
    <div class="footer">
      <div class="footer-left">Generated by SG Part-Time Payroll Calculator · ${generatedAt}</div>
      <div class="footer-right">This is a self-generated record, not an official payslip.</div>
    </div>

  </div>
</body>
</html>`;
}
