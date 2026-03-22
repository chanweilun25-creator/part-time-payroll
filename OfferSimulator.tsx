import React, { useState, useMemo } from 'react';
import { Zap, Plus, Trash2, Info, TrendingDown, CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { CPF_RATES, calculateCpf, type AgeGroup } from './cpfRates';
import { JOB_COLORS, getHexColor } from './types';
import { calculateShiftHours } from './utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type ScheduleType = 'weekly' | 'custom';
type WeekDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;

interface SimJob {
  id: string;
  label: string;
  colorId: string;
  hourlyRate: number;
  scheduleType: ScheduleType;
  // weekly mode
  daysPerWeek: number;
  hoursPerDay: number;
  // custom mode — list of {hours, isWeekend, isPH}
  customShifts: { hours: number; isWeekend: boolean; isPH: boolean }[];
  // weekend / PH rates (optional overrides)
  weekendRate: number;
  phRate: number;
  // monthly allowance
  monthlyAllowance: number;
}

interface FixedExpense {
  id: string;
  label: string;
  amount: number;
}

const WEEKS_PER_MONTH = 52 / 12; // 4.333…

function makeJob(index: number): SimJob {
  return {
    id: Math.random().toString(36).substr(2, 9),
    label: `Job ${index + 1}`,
    colorId: JOB_COLORS[index % JOB_COLORS.length].id,
    hourlyRate: 12,
    scheduleType: 'weekly',
    daysPerWeek: 5,
    hoursPerDay: 8,
    customShifts: [],
    weekendRate: 0,
    phRate: 0,
    monthlyAllowance: 0,
  };
}

function calcJobGross(job: SimJob): number {
  if (job.scheduleType === 'weekly') {
    const monthlyHours = job.daysPerWeek * job.hoursPerDay * WEEKS_PER_MONTH;
    return monthlyHours * job.hourlyRate + job.monthlyAllowance;
  }
  // custom shifts
  return job.customShifts.reduce((sum, s) => {
    const rate = s.isPH && job.phRate > 0 ? job.phRate
               : s.isWeekend && job.weekendRate > 0 ? job.weekendRate
               : job.hourlyRate;
    return sum + s.hours * rate;
  }, 0) + job.monthlyAllowance;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const ic = 'w-full px-3 py-2 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-white text-sm';

function JobCard({
  job, index, onChange, onRemove, canRemove,
}: {
  job: SimJob;
  index: number;
  onChange: (updated: SimJob) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const color = JOB_COLORS.find(c => c.id === job.colorId) || JOB_COLORS[0];
  const gross = calcJobGross(job);
  const monthlyHours = job.scheduleType === 'weekly'
    ? job.daysPerWeek * job.hoursPerDay * WEEKS_PER_MONTH
    : job.customShifts.reduce((s, x) => s + x.hours, 0);

  const set = (patch: Partial<SimJob>) => onChange({ ...job, ...patch });

  return (
    <div className={`rounded-2xl border ${color.border} overflow-hidden`}>
      {/* Card header */}
      <div className={`px-4 py-3 ${color.lightBg} dark:bg-neutral-700/40 flex items-center justify-between`}>
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div className={`w-3 h-3 rounded-full ${color.bg} shrink-0`} />
          <input
            type="text"
            value={job.label}
            onChange={e => set({ label: e.target.value })}
            className={`font-semibold text-sm bg-transparent border-none outline-none ${color.text} w-full min-w-0`}
            placeholder="Job name"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Colour picker */}
          <div className="flex gap-1">
            {JOB_COLORS.map(c => (
              <button
                key={c.id}
                onClick={() => set({ colorId: c.id })}
                className={`w-4 h-4 rounded-full ${c.bg} transition-transform ${job.colorId === c.id ? 'ring-2 ring-offset-1 ring-neutral-600 dark:ring-neutral-200 scale-110' : 'hover:scale-110'}`}
              />
            ))}
          </div>
          {canRemove && (
            <button onClick={onRemove} className="p-1 text-neutral-400 hover:text-rose-500 transition-colors ml-1">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={() => setExpanded(!expanded)} className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="p-4 space-y-4 bg-white dark:bg-neutral-800">
          {/* Weekday rate */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">Weekday $/h</label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 text-xs">$</span>
                <input type="number" min="0" step="0.50" value={job.hourlyRate} onChange={e => set({ hourlyRate: Number(e.target.value) })} className="w-full pl-6 pr-2 py-2 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">Weekend $/h</label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 text-xs">$</span>
                <input type="number" min="0" step="0.50" value={job.weekendRate || ''} onChange={e => set({ weekendRate: Number(e.target.value) })} className="w-full pl-6 pr-2 py-2 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white" placeholder="same" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">Holiday $/h</label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 text-xs">$</span>
                <input type="number" min="0" step="0.50" value={job.phRate || ''} onChange={e => set({ phRate: Number(e.target.value) })} className="w-full pl-6 pr-2 py-2 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white" placeholder="same" />
              </div>
            </div>
          </div>

          {/* Schedule type toggle */}
          <div className="flex gap-2">
            {(['weekly', 'custom'] as ScheduleType[]).map(t => (
              <button
                key={t}
                onClick={() => set({ scheduleType: t })}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${job.scheduleType === t ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300' : 'border-neutral-200 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400 hover:border-neutral-300 dark:hover:border-neutral-600'}`}
              >
                {t === 'weekly' ? 'Regular schedule' : 'Custom shifts'}
              </button>
            ))}
          </div>

          {job.scheduleType === 'weekly' ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">Days per week</label>
                <input type="number" min="1" max="7" step="0.5" value={job.daysPerWeek} onChange={e => set({ daysPerWeek: Number(e.target.value) })} className={ic} />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">Hours per day</label>
                <input type="number" min="0.5" max="24" step="0.5" value={job.hoursPerDay} onChange={e => set({ hoursPerDay: Number(e.target.value) })} className={ic} />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Shifts this month</label>
                <button
                  onClick={() => set({ customShifts: [...job.customShifts, { hours: 8, isWeekend: false, isPH: false }] })}
                  className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Add shift
                </button>
              </div>
              {job.customShifts.length === 0 && (
                <p className="text-xs text-neutral-400 italic">No shifts added yet.</p>
              )}
              {job.customShifts.map((s, i) => (
                <div key={i} className="flex items-center gap-2 p-2 bg-neutral-50 dark:bg-neutral-800/60 rounded-lg border border-neutral-200 dark:border-neutral-700">
                  <div className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400 shrink-0">
                    <span>Shift {i + 1}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <input type="number" min="0.5" max="24" step="0.5" value={s.hours}
                      onChange={e => { const cs = [...job.customShifts]; cs[i] = { ...cs[i], hours: Number(e.target.value) }; set({ customShifts: cs }); }}
                      className="w-16 px-2 py-1 text-xs bg-white dark:bg-neutral-700 border border-neutral-200 dark:border-neutral-600 rounded outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white" />
                    <span className="text-xs text-neutral-400">h</span>
                  </div>
                  <label className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400 cursor-pointer">
                    <input type="checkbox" checked={s.isWeekend} onChange={e => { const cs = [...job.customShifts]; cs[i] = { ...cs[i], isWeekend: e.target.checked }; set({ customShifts: cs }); }} className="rounded" />
                    Wknd
                  </label>
                  <label className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400 cursor-pointer">
                    <input type="checkbox" checked={s.isPH} onChange={e => { const cs = [...job.customShifts]; cs[i] = { ...cs[i], isPH: e.target.checked }; set({ customShifts: cs }); }} className="rounded" />
                    PH
                  </label>
                  <button onClick={() => { const cs = job.customShifts.filter((_, j) => j !== i); set({ customShifts: cs }); }} className="ml-auto p-0.5 text-neutral-400 hover:text-rose-500 transition-colors"><Trash2 className="w-3 h-3" /></button>
                </div>
              ))}
            </div>
          )}

          {/* Allowance */}
          <div>
            <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">Monthly allowance / bonus ($)</label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 text-xs">$</span>
              <input type="number" min="0" step="1" value={job.monthlyAllowance || ''} onChange={e => set({ monthlyAllowance: Number(e.target.value) })} className="w-full pl-6 pr-2 py-2 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white" placeholder="0" />
            </div>
          </div>

          {/* Per-job summary strip */}
          <div className={`flex items-center justify-between px-3 py-2 rounded-xl ${color.lightBg} dark:bg-neutral-700/30`}>
            <span className={`text-xs font-medium ${color.text} dark:text-neutral-300`}>
              ~{monthlyHours.toFixed(1)}h / month
            </span>
            <span className={`text-sm font-bold ${color.text} dark:text-white`}>
              ${gross.toFixed(2)} gross
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function OfferSimulator({ ageGroup }: { ageGroup: AgeGroup }) {
  const [jobs, setJobs] = useState<SimJob[]>([makeJob(0)]);
  const [expenses, setExpenses] = useState<FixedExpense[]>([
    { id: '1', label: 'Rent / Housing', amount: 800 },
    { id: '2', label: 'Transport',      amount: 120 },
    { id: '3', label: 'Food',           amount: 400 },
  ]);
  const [showExpenses, setShowExpenses] = useState(true);

  const updateJob = (id: string, updated: SimJob) =>
    setJobs(prev => prev.map(j => j.id === id ? updated : j));

  const addExpense = () =>
    setExpenses(prev => [...prev, { id: Math.random().toString(36).substr(2, 9), label: '', amount: 0 }]);

  const updateExpense = (id: string, patch: Partial<FixedExpense>) =>
    setExpenses(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));

  const totalGross = useMemo(() => jobs.reduce((s, j) => s + calcJobGross(j), 0), [jobs]);
  const { employeeCpf, employerCpf } = useMemo(() => calculateCpf(totalGross, ageGroup), [totalGross, ageGroup]);
  const netPay = totalGross - employeeCpf;
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const disposable = netPay - totalExpenses;
  const savingsRate = netPay > 0 ? (disposable / netPay) * 100 : 0;

  const totalHours = useMemo(() =>
    jobs.reduce((s, j) =>
      s + (j.scheduleType === 'weekly'
        ? j.daysPerWeek * j.hoursPerDay * WEEKS_PER_MONTH
        : j.customShifts.reduce((x, sh) => x + sh.hours, 0)
      ), 0), [jobs]);

  const effectiveHourlyNet = totalHours > 0 ? netPay / totalHours : 0;

  // CPF age label
  const cpfLabel = CPF_RATES[ageGroup].label;

  // Verdict
  const verdict = useMemo(() => {
    if (disposable >= 500) return { icon: CheckCircle2, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800', label: 'Comfortable', desc: `You have $${disposable.toFixed(0)} left after expenses. You're in the clear.` };
    if (disposable >= 0)   return { icon: AlertTriangle, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800', label: 'Tight but workable', desc: `Only $${disposable.toFixed(0)} left after expenses. One unexpected bill and you're short.` };
    return { icon: XCircle, color: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800', label: "Doesn't cover expenses", desc: `You're $${Math.abs(disposable).toFixed(0)} short every month. Either cut expenses or increase hours.` };
  }, [disposable]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold dark:text-white flex items-center gap-2">
          <Zap className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          Offer Simulator
        </h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">
          Test any job offer before you commit. Nothing here touches your real shifts.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* LEFT — Inputs */}
        <div className="xl:col-span-3 space-y-4">

          {/* Job cards */}
          {jobs.map((job, i) => (
            <JobCard
              key={job.id}
              job={job}
              index={i}
              onChange={updated => updateJob(job.id, updated)}
              onRemove={() => setJobs(prev => prev.filter(j => j.id !== job.id))}
              canRemove={jobs.length > 1}
            />
          ))}

          <button
            onClick={() => setJobs(prev => [...prev, makeJob(prev.length)])}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-neutral-300 dark:border-neutral-700 text-sm font-medium text-neutral-500 dark:text-neutral-400 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all"
          >
            <Plus className="w-4 h-4" /> Add another job to the mix
          </button>

          {/* Expenses */}
          <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
            <button
              onClick={() => setShowExpenses(!showExpenses)}
              className="w-full px-4 py-3 flex items-center justify-between text-sm font-semibold text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-700/50 transition-colors"
            >
              <span>Fixed Monthly Expenses</span>
              <div className="flex items-center gap-2">
                <span className="text-neutral-500 dark:text-neutral-400 font-normal">${totalExpenses.toFixed(0)}/mo</span>
                {showExpenses ? <ChevronUp className="w-4 h-4 text-neutral-400" /> : <ChevronDown className="w-4 h-4 text-neutral-400" />}
              </div>
            </button>
            {showExpenses && (
              <div className="px-4 pb-4 space-y-2 border-t border-neutral-100 dark:border-neutral-700 pt-3">
                {expenses.map(exp => (
                  <div key={exp.id} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={exp.label}
                      onChange={e => updateExpense(exp.id, { label: e.target.value })}
                      className="flex-1 px-3 py-1.5 text-sm bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                      placeholder="Expense name"
                    />
                    <div className="relative shrink-0">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 text-xs">$</span>
                      <input
                        type="number"
                        min="0"
                        value={exp.amount || ''}
                        onChange={e => updateExpense(exp.id, { amount: Number(e.target.value) })}
                        className="w-24 pl-6 pr-2 py-1.5 text-sm bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                        placeholder="0"
                      />
                    </div>
                    <button onClick={() => setExpenses(prev => prev.filter(e => e.id !== exp.id))} className="p-1 text-neutral-400 hover:text-rose-500 transition-colors shrink-0">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <button onClick={addExpense} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 mt-1">
                  <Plus className="w-3 h-3" /> Add expense
                </button>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — Results */}
        <div className="xl:col-span-2 space-y-4">

          {/* Verdict banner */}
          <div className={`p-4 rounded-2xl border ${verdict.bg} flex items-start gap-3`}>
            <verdict.icon className={`w-5 h-5 mt-0.5 shrink-0 ${verdict.color}`} />
            <div>
              <p className={`font-semibold text-sm ${verdict.color}`}>{verdict.label}</p>
              <p className="text-xs text-neutral-600 dark:text-neutral-300 mt-0.5">{verdict.desc}</p>
            </div>
          </div>

          {/* Numbers breakdown */}
          <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
            <div className="p-4 border-b border-neutral-100 dark:border-neutral-700">
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Monthly Breakdown</p>
              <p className="text-[11px] text-neutral-400 mt-0.5">CPF age group: {cpfLabel}</p>
            </div>
            <div className="divide-y divide-neutral-50 dark:divide-neutral-700/50">
              {[
                { label: 'Total Gross',       value: `$${totalGross.toFixed(2)}`,     sub: `~${totalHours.toFixed(0)}h worked`,              color: 'text-neutral-800 dark:text-white' },
                { label: 'Employee CPF (−)',   value: `-$${employeeCpf.toFixed(2)}`,   sub: `${((employeeCpf/totalGross)*100||0).toFixed(1)}% of gross`, color: 'text-rose-600 dark:text-rose-400' },
                { label: 'Take-Home (Net)',    value: `$${netPay.toFixed(2)}`,         sub: `$${effectiveHourlyNet.toFixed(2)}/h effective`,   color: 'text-emerald-600 dark:text-emerald-400 font-bold' },
                { label: 'Fixed Expenses (−)', value: `-$${totalExpenses.toFixed(2)}`, sub: `${expenses.length} items`,                        color: 'text-neutral-600 dark:text-neutral-400' },
                { label: 'Disposable Income', value: `$${disposable.toFixed(2)}`,     sub: `${savingsRate.toFixed(1)}% of take-home`,         color: disposable >= 0 ? 'text-indigo-600 dark:text-indigo-400 font-bold' : 'text-rose-600 dark:text-rose-400 font-bold' },
              ].map(({ label, value, sub, color }) => (
                <div key={label} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{label}</p>
                    <p className="text-[11px] text-neutral-400">{sub}</p>
                  </div>
                  <p className={`text-sm ${color}`}>{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Employer CPF note */}
          <div className="bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900 rounded-xl p-3 flex gap-2 text-xs text-indigo-700 dark:text-indigo-300">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>Employer also contributes <strong>${employerCpf.toFixed(2)}</strong>/month to your CPF — that's money in your account, just locked for now.</span>
          </div>

          {/* Per-job contribution bars */}
          {jobs.length > 1 && (
            <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Contribution by Job</p>
              {jobs.map(job => {
                const gross = calcJobGross(job);
                const pct   = totalGross > 0 ? (gross / totalGross) * 100 : 0;
                const col   = JOB_COLORS.find(c => c.id === job.colorId) || JOB_COLORS[0];
                return (
                  <div key={job.id}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className={`font-medium ${col.text} dark:text-neutral-200`}>{job.label}</span>
                      <span className="text-neutral-500 dark:text-neutral-400">${gross.toFixed(0)} · {pct.toFixed(0)}%</span>
                    </div>
                    <div className="w-full h-2 bg-neutral-100 dark:bg-neutral-700 rounded-full overflow-hidden">
                      <div className={`h-full ${col.bg} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Hourly reality check */}
          <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Reality Check</p>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-neutral-50 dark:bg-neutral-700/40 rounded-xl p-3">
                <p className="text-neutral-500 dark:text-neutral-400">Effective hourly (net)</p>
                <p className="text-base font-bold text-neutral-800 dark:text-white mt-0.5">${effectiveHourlyNet.toFixed(2)}/h</p>
              </div>
              <div className="bg-neutral-50 dark:bg-neutral-700/40 rounded-xl p-3">
                <p className="text-neutral-500 dark:text-neutral-400">Hours to cover expenses</p>
                <p className="text-base font-bold text-neutral-800 dark:text-white mt-0.5">
                  {effectiveHourlyNet > 0 ? `${(totalExpenses / effectiveHourlyNet).toFixed(0)}h` : '—'}
                </p>
              </div>
              <div className="bg-neutral-50 dark:bg-neutral-700/40 rounded-xl p-3">
                <p className="text-neutral-500 dark:text-neutral-400">Daily take-home (÷22)</p>
                <p className="text-base font-bold text-neutral-800 dark:text-white mt-0.5">${(netPay / 22).toFixed(2)}</p>
              </div>
              <div className="bg-neutral-50 dark:bg-neutral-700/40 rounded-xl p-3">
                <p className="text-neutral-500 dark:text-neutral-400">Savings rate</p>
                <p className={`text-base font-bold mt-0.5 ${savingsRate >= 20 ? 'text-emerald-600 dark:text-emerald-400' : savingsRate >= 0 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`}>
                  {savingsRate.toFixed(1)}%
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
