import React, { useState, useMemo } from 'react';
import { format, parseISO, startOfMonth, endOfMonth, isAfter, isBefore, isEqual } from 'date-fns';
import { X, FileText, ChevronDown } from 'lucide-react';
import { type Job, type Shift, JOB_COLORS, getHexColor } from './types';
import { type AgeGroup } from './cpfRates';
import { calcShiftGross } from './utils';
import { renderPayslipHTML, type CycleScope } from './payslipRenderer';

interface Props {
  jobs: Job[];
  shifts: Shift[];
  ageGroup: AgeGroup;
  onClose: () => void;
}

function buildMonthOptions() {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return { label: format(d, 'MMMM yyyy'), value: format(d, 'yyyy-MM') };
  });
}

function countShiftsForJob(shifts: Shift[], job: Job, selectedMonth: string, scope: CycleScope) {
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

export default function PDFExportModal({ jobs, shifts, ageGroup, onClose }: Props) {
  const monthOptions = useMemo(() => buildMonthOptions(), []);

  const [selectedMonth, setSelectedMonth]   = useState(monthOptions[0].value);
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set(jobs.map(j => j.id)));
  const [scope, setScope]                   = useState<CycleScope>('payroll_cycle');

  const toggleJob = (id: string) =>
    setSelectedJobIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const selectedJobs = jobs.filter(j => selectedJobIds.has(j.id));

  const handleGenerate = () => {
    const html = renderPayslipHTML({ jobs: selectedJobs, shifts, ageGroup, selectedMonth, scope });
    const win  = window.open('', '_blank');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 700);
  };

  const ic = 'w-full px-3 py-2 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white text-sm';

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="p-5 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="text-base font-semibold dark:text-white">Export Payslip PDF</h3>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5 overflow-y-auto flex-1">

          {/* Month */}
          <div>
            <label className="block text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-2">
              Payslip Month
            </label>
            <div className="relative">
              <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className={ic}>
                {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 pointer-events-none" />
            </div>
          </div>

          {/* Scope */}
          <div>
            <label className="block text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-2">
              Date Scope
            </label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: 'payroll_cycle',  label: 'Payroll Cycle',  desc: "Respects each job's cutoff day" },
                { value: 'calendar_month', label: 'Calendar Month', desc: 'All shifts within the month' },
              ] as { value: CycleScope; label: string; desc: string }[]).map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setScope(opt.value)}
                  className={`px-3 py-2.5 rounded-xl border text-left transition-colors ${
                    scope === opt.value
                      ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-700'
                      : 'border-neutral-200 dark:border-neutral-700 hover:border-neutral-300'
                  }`}
                >
                  <p className={`text-xs font-semibold ${scope === opt.value ? 'text-indigo-700 dark:text-indigo-300' : 'text-neutral-700 dark:text-neutral-200'}`}>{opt.label}</p>
                  <p className="text-[10px] text-neutral-400 mt-0.5">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Jobs */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                Include Jobs
              </label>
              <button
                onClick={() => setSelectedJobIds(
                  selectedJobIds.size === jobs.length ? new Set() : new Set(jobs.map(j => j.id))
                )}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                {selectedJobIds.size === jobs.length ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="space-y-2">
              {jobs.map(job => {
                const color    = JOB_COLORS.find(c => c.id === job.colorId) || JOB_COLORS[0];
                const checked  = selectedJobIds.has(job.id);
                const jobShifts = countShiftsForJob(shifts, job, selectedMonth, scope);
                const gross    = jobShifts.reduce((s, sh) => s + calcShiftGross(sh, job), 0);

                return (
                  <label
                    key={job.id}
                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                      checked
                        ? `${color.lightBg} ${color.border} dark:bg-neutral-700/30`
                        : 'border-neutral-200 dark:border-neutral-700 opacity-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleJob(job.id)}
                      className="w-4 h-4 rounded text-indigo-600 border-neutral-300 focus:ring-indigo-500"
                    />
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: getHexColor(job.colorId) }} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${checked ? color.text : 'text-neutral-600 dark:text-neutral-300'}`}>
                        {job.title}
                      </p>
                      <p className="text-xs text-neutral-400">
                        {jobShifts.length} shift{jobShifts.length !== 1 ? 's' : ''} · ${gross.toFixed(2)} gross
                      </p>
                    </div>
                  </label>
                );
              })}
              {jobs.length === 0 && (
                <p className="text-xs text-neutral-400 italic text-center py-3">No jobs configured.</p>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 bg-neutral-50 dark:bg-neutral-800/50 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-between gap-3 shrink-0">
          <p className="text-xs text-neutral-400">{selectedJobs.length} job{selectedJobs.length !== 1 ? 's' : ''} selected</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-lg transition-colors">
              Cancel
            </button>
            <button
              onClick={handleGenerate}
              disabled={selectedJobs.length === 0}
              className="px-4 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg shadow-sm transition-colors flex items-center gap-2"
            >
              <FileText className="w-4 h-4" /> Generate PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
