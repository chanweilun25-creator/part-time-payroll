import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval, isWeekend,
  isSameMonth, isToday, parseISO, addMonths, subMonths,
  startOfWeek, endOfWeek, isBefore, isAfter, isEqual,
} from 'date-fns';
import {
  Calculator, ChevronLeft, ChevronRight, Info, Trash2, X,
  User, CalendarDays, Plus, Briefcase, Edit2, Calendar,
  FileText, Download, Moon, Sun, Copy, ClipboardPaste,
  TrendingUp, Target, BarChart3, Repeat, Lightbulb, MessageSquare,
  Zap, Clock, Sparkles,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';

import { CPF_RATES, CPF_RATES_EFFECTIVE_DATE, calculateCpf, type AgeGroup } from './cpfRates';
import {
  type Job, type Shift, type ShiftTemplate, type RecurringRule,
  type ViewTab, JOB_COLORS, getHexColor, SG_PUBLIC_HOLIDAYS,
} from './types';
import { calculateShiftHours, calcShiftGross, calcPayrollSummary, expandRecurringRule, hoursToGoal } from './utils';
import OfferSimulator from './OfferSimulator';
import PDFExportModal from './PDFExportModal';

// ── Storage helper ──────────────────────────────────────────────────────────
function loadLS<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; }
  catch { return fallback; }
}

const DEFAULT_JOB: Job = {
  id: '1', title: 'Main Job', colorId: 'navy',
  rates: { weekday: 12, weekend: 15, publicHoliday: 20 },
  payrollCycle: { type: 'end_of_month', cutoffDay: 31 },
};

export default function App() {
  const [currentDate, setCurrentDate]   = useState(new Date());
  const [activeTab, setActiveTab]       = useState<ViewTab>('calendar');
  const [isDarkMode, setIsDarkMode]     = useState(() => loadLS('payroll_darkMode', false));
  const [ageGroup, setAgeGroup]         = useState<AgeGroup>(() => loadLS('payroll_ageGroup', '55_and_below'));
  const [jobs, setJobs]                 = useState<Job[]>(() => loadLS('payroll_jobs', [DEFAULT_JOB]));
  const [shifts, setShifts]             = useState<Shift[]>(() => loadLS('payroll_shifts', []));
  const [monthlyGoal, setMonthlyGoal]   = useState(() => loadLS('payroll_monthlyGoal', 1000));
  const [templates, setTemplates]       = useState<ShiftTemplate[]>(() => loadLS('payroll_templates', []));
  const [recurringRules, setRecurringRules] = useState<RecurringRule[]>(() => loadLS('payroll_recurring', []));

  const [selectedDate, setSelectedDate]               = useState<string | null>(null);
  const [isShiftModalOpen, setIsShiftModalOpen]       = useState(false);
  const [isJobModalOpen, setIsJobModalOpen]           = useState(false);
  const [isDayPickerOpen, setIsDayPickerOpen]         = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [isRecurringModalOpen, setIsRecurringModalOpen] = useState(false);
  const [isPDFModalOpen, setIsPDFModalOpen]           = useState(false);
  const [copiedShift, setCopiedShift]                 = useState<Partial<Shift> | null>(null);
  const [editingJob, setEditingJob]                   = useState<Job | null>(null);
  const [tempShift, setTempShift]                     = useState<Partial<Shift>>({});
  const [editingTemplate, setEditingTemplate]         = useState<Partial<ShiftTemplate>>({});
  const [editingRecurring, setEditingRecurring]       = useState<Partial<RecurringRule>>({});

  useEffect(() => { localStorage.setItem('payroll_darkMode', String(isDarkMode)); document.documentElement.classList.toggle('dark', isDarkMode); }, [isDarkMode]);
  useEffect(() => { localStorage.setItem('payroll_ageGroup', ageGroup); }, [ageGroup]);
  useEffect(() => { localStorage.setItem('payroll_jobs', JSON.stringify(jobs)); }, [jobs]);
  useEffect(() => { localStorage.setItem('payroll_shifts', JSON.stringify(shifts)); }, [shifts]);
  useEffect(() => { localStorage.setItem('payroll_monthlyGoal', String(monthlyGoal)); }, [monthlyGoal]);
  useEffect(() => { localStorage.setItem('payroll_templates', JSON.stringify(templates)); }, [templates]);
  useEffect(() => { localStorage.setItem('payroll_recurring', JSON.stringify(recurringRules)); }, [recurringRules]);

  const currentMonthPayrollShifts = useMemo(() => shifts.filter(shift => {
    const job = jobs.find(j => j.id === shift.jobId);
    if (!job || job.payrollCycle.type !== 'end_of_month') return false;
    const shiftDate = parseISO(shift.date);
    const cutoffDay = job.payrollCycle.cutoffDay || 31;
    let cycleStart: Date, cycleEnd: Date;
    if (cutoffDay >= 28) { cycleStart = startOfMonth(currentDate); cycleEnd = endOfMonth(currentDate); }
    else { cycleEnd = new Date(currentDate.getFullYear(), currentDate.getMonth(), cutoffDay); cycleStart = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, cutoffDay + 1); }
    return (isAfter(shiftDate, cycleStart) || isEqual(shiftDate, cycleStart)) && (isBefore(shiftDate, cycleEnd) || isEqual(shiftDate, cycleEnd));
  }), [shifts, jobs, currentDate]);

  const eventPayrollShifts = useMemo(() => shifts.filter(s => jobs.find(j => j.id === s.jobId)?.payrollCycle.type === 'end_of_event'), [shifts, jobs]);
  const monthlyCalc = useMemo(() => calcPayrollSummary(currentMonthPayrollShifts, jobs, ageGroup), [currentMonthPayrollShifts, jobs, ageGroup]);

  const dashboardAnalytics = useMemo(() => {
    const last6 = Array.from({ length: 6 }, (_, i) => subMonths(new Date(), 5 - i));
    const monthlyTrend = last6.map(d => {
      const ms = shifts.filter(s => isSameMonth(parseISO(s.date), d));
      const { grossPay, netPay } = calcPayrollSummary(ms, jobs, ageGroup);
      return { month: format(d, 'MMM yy'), gross: +grossPay.toFixed(2), net: +netPay.toFixed(2) };
    });
    const earningsMap = new Map<string, { name: string; value: number; color: string }>();
    currentMonthPayrollShifts.forEach(shift => {
      const job = jobs.find(j => j.id === shift.jobId); if (!job) return;
      const gross = calcShiftGross(shift, job);
      const ex = earningsMap.get(job.id);
      if (ex) ex.value += gross;
      else earningsMap.set(job.id, { name: job.title, value: gross, color: getHexColor(job.colorId) });
    });
    const jobEarnings = [...earningsMap.values()].map(e => ({ ...e, value: +e.value.toFixed(2) })).filter(e => e.value > 0);
    return { monthlyTrend, jobEarnings };
  }, [shifts, jobs, ageGroup, currentMonthPayrollShifts]);

  const incomeProjection = useMemo(() => {
    const gap = Math.max(0, monthlyGoal - monthlyCalc.netPay);
    const recommendations = hoursToGoal(gap, jobs, ageGroup);
    const today = new Date();
    const daysLeft = Math.max(0, Math.ceil((endOfMonth(today).getTime() - today.getTime()) / 86400000));
    return { gap, recommendations, daysLeft };
  }, [monthlyGoal, monthlyCalc.netPay, jobs, ageGroup]);

  const daysInMonth = useMemo(() => eachDayOfInterval({ start: startOfWeek(startOfMonth(currentDate)), end: endOfWeek(endOfMonth(currentDate)) }), [currentDate]);

  const handleDateClick = useCallback((date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    setSelectedDate(dateStr);
    const dayShifts = shifts.filter(s => s.date === dateStr);
    if (dayShifts.length > 1) { setIsDayPickerOpen(true); }
    else if (dayShifts.length === 1) { setTempShift(dayShifts[0]); setIsShiftModalOpen(true); }
    else { setTempShift({ jobId: jobs[0]?.id || '', date: dateStr, startTime: '09:00', endTime: '17:00', unpaidBreakHours: 1, isPublicHoliday: !!SG_PUBLIC_HOLIDAYS[dateStr] }); setIsShiftModalOpen(true); }
  }, [shifts, jobs]);

  const handleSaveShift = useCallback(() => {
    if (!tempShift.jobId || !tempShift.startTime || !tempShift.endTime) return;
    if (tempShift.id) {
      setShifts(prev => prev.map(s => s.id === tempShift.id ? { ...s, ...tempShift } as Shift : s));
    } else {
      setShifts(prev => [...prev, { id: Math.random().toString(36).substr(2, 9), jobId: tempShift.jobId!, date: tempShift.date!, startTime: tempShift.startTime!, endTime: tempShift.endTime!, unpaidBreakHours: tempShift.unpaidBreakHours || 0, isPublicHoliday: tempShift.isPublicHoliday || false, allowance: tempShift.allowance || 0, deduction: tempShift.deduction || 0, notes: tempShift.notes || '' }]);
    }
    setIsShiftModalOpen(false);
  }, [tempShift]);

  const handleDeleteShift = useCallback(() => {
    if (tempShift.id) setShifts(prev => prev.filter(s => s.id !== tempShift.id));
    setIsShiftModalOpen(false);
  }, [tempShift]);

  const handleSaveJob = useCallback(() => {
    if (!editingJob?.title) return;
    if (jobs.find(j => j.id === editingJob.id)) setJobs(prev => prev.map(j => j.id === editingJob.id ? editingJob : j));
    else setJobs(prev => [...prev, { ...editingJob, id: Math.random().toString(36).substr(2, 9) }]);
    setIsJobModalOpen(false);
  }, [editingJob, jobs]);

  const handleDeleteJob = useCallback((jobId: string) => {
    setJobs(prev => prev.filter(j => j.id !== jobId));
    setShifts(prev => prev.filter(s => s.jobId !== jobId));
    setTemplates(prev => prev.filter(t => t.jobId !== jobId));
    setIsJobModalOpen(false);
  }, []);

  const handleSaveTemplate = useCallback(() => {
    if (!editingTemplate.name || !editingTemplate.jobId) return;
    const t = editingTemplate as ShiftTemplate;
    if (templates.find(x => x.id === t.id)) setTemplates(prev => prev.map(x => x.id === t.id ? t : x));
    else setTemplates(prev => [...prev, { ...t, id: Math.random().toString(36).substr(2, 9) }]);
    setIsTemplateModalOpen(false);
  }, [editingTemplate, templates]);

  const handleApplyRecurring = useCallback(() => {
    const rule = editingRecurring as RecurringRule;
    if (!rule.templateId || !rule.startDate || !rule.endDate || !rule.daysOfWeek?.length) return;
    const tmpl = templates.find(t => t.id === rule.templateId); if (!tmpl) return;
    const ruleWithId = { ...rule, id: Math.random().toString(36).substr(2, 9) };
    setShifts(prev => [...prev, ...expandRecurringRule(ruleWithId, tmpl, prev)]);
    setRecurringRules(prev => [...prev, ruleWithId]);
    setIsRecurringModalOpen(false); setEditingRecurring({});
  }, [editingRecurring, templates]);

  const openNewJobModal = () => { setEditingJob({ id: '', title: 'New Job', colorId: JOB_COLORS[jobs.length % JOB_COLORS.length].id, rates: { weekday: 10, weekend: 12, publicHoliday: 15 }, payrollCycle: { type: 'end_of_month', cutoffDay: 31 } }); setIsJobModalOpen(true); };

  const generatePDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(20); doc.text('Payslip Summary', 14, 22);
    doc.setFontSize(12); doc.text(`Generated: ${format(new Date(), 'MMM dd, yyyy')}`, 14, 32); doc.text(`Age Group: ${CPF_RATES[ageGroup].label}`, 14, 40);
    doc.setFontSize(16); doc.text(`Monthly — ${format(currentDate, 'MMMM yyyy')}`, 14, 55);
    autoTable(doc, { startY: 60, head: [['Job','Gross','Emp CPF','Empr CPF','Net']], body: jobs.filter(j => j.payrollCycle.type === 'end_of_month').map(job => { let g = 0; currentMonthPayrollShifts.filter(s => s.jobId === job.id).forEach(s => { g += calcShiftGross(s, job); }); const { employeeCpf, employerCpf } = calculateCpf(g, ageGroup); return [job.title, `$${g.toFixed(2)}`, `-$${employeeCpf.toFixed(2)}`, `+$${employerCpf.toFixed(2)}`, `$${(g - employeeCpf).toFixed(2)}`]; }) });
    const fy = (doc as any).lastAutoTable.finalY || 80;
    doc.setFontSize(16); doc.text('Event / Gig', 14, fy + 15);
    autoTable(doc, { startY: fy + 20, head: [['Job','Gross','Emp CPF','Empr CPF','Net']], body: jobs.filter(j => j.payrollCycle.type === 'end_of_event').map(job => { let g = 0; eventPayrollShifts.filter(s => s.jobId === job.id).forEach(s => { g += calcShiftGross(s, job); }); const { employeeCpf, employerCpf } = calculateCpf(g, ageGroup); return [job.title, `$${g.toFixed(2)}`, `-$${employeeCpf.toFixed(2)}`, `+$${employerCpf.toFixed(2)}`, `$${(g - employeeCpf).toFixed(2)}`]; }) });
    doc.save(`Payslip_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
  };

  const exportToCSV = () => {
    let csv = 'Job,Cycle,Date,Start,End,Break,Hours,PH,Rate,Allowance,Deduction,Gross,Notes\n';
    [...shifts].sort((a, b) => a.date.localeCompare(b.date)).forEach(shift => {
      const job = jobs.find(j => j.id === shift.jobId); if (!job) return;
      const date = parseISO(shift.date);
      const rate = shift.isPublicHoliday ? job.rates.publicHoliday : isWeekend(date) ? job.rates.weekend : job.rates.weekday;
      const hours = calculateShiftHours(shift.startTime, shift.endTime, shift.unpaidBreakHours);
      csv += [`"${job.title}"`, job.payrollCycle.type === 'end_of_month' ? 'Monthly' : 'Event', shift.date, shift.startTime, shift.endTime, shift.unpaidBreakHours, hours.toFixed(2), shift.isPublicHoliday ? 'Yes' : 'No', rate.toFixed(2), (shift.allowance||0).toFixed(2), (shift.deduction||0).toFixed(2), calcShiftGross(shift, job).toFixed(2), `"${shift.notes||''}"`].join(',') + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `payroll_${format(new Date(), 'yyyy-MM-dd')}.csv`; document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const ic = 'w-full px-3 py-2 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white text-sm';
  const nb = (active: boolean) => `w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${active ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300' : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700/50'}`;

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans flex flex-col md:flex-row dark:bg-neutral-900 dark:text-neutral-100 transition-colors duration-200">

      {/* SIDEBAR */}
      <aside className="w-full md:w-64 bg-white border-r border-neutral-200 p-5 flex flex-col gap-6 shrink-0 md:min-h-screen overflow-y-auto dark:bg-neutral-800 dark:border-neutral-700 transition-colors">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold flex items-center gap-2">
              <Calculator className="w-4 h-4 text-indigo-600 dark:text-indigo-400" /> Payroll Calculator
            </h1>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Singapore Part-Time</p>
          </div>
          <button onClick={() => setIsDarkMode(!isDarkMode)} className="p-1.5 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors" title="Toggle dark mode">
            {isDarkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-500" />}
          </button>
        </div>

        <nav className="space-y-0.5">
          <button className={nb(activeTab==='calendar')} onClick={() => setActiveTab('calendar')}><CalendarDays className="w-4 h-4" /> Calendar</button>
          <button className={nb(activeTab==='monthly_income')} onClick={() => setActiveTab('monthly_income')}><Calendar className="w-4 h-4" /> Monthly Income</button>
          <button className={nb(activeTab==='event_income')} onClick={() => setActiveTab('event_income')}><FileText className="w-4 h-4" /> Event / Gig</button>
          <button className={nb(activeTab==='dashboard')} onClick={() => setActiveTab('dashboard')}><BarChart3 className="w-4 h-4" /> Insights & Goals</button>
          <button className={nb(activeTab==='offer_simulator')} onClick={() => setActiveTab('offer_simulator')}><Sparkles className="w-4 h-4" /> Offer Simulator</button>
          <div className="pt-2 mt-1 border-t border-neutral-100 dark:border-neutral-700 space-y-0.5">
            <button className={nb(false)} onClick={() => { setEditingTemplate({ jobId: jobs[0]?.id||'', startTime:'09:00', endTime:'17:00', unpaidBreakHours:1 }); setIsTemplateModalOpen(true); }}><Repeat className="w-4 h-4" /> Templates</button>
            <button className={nb(false)} onClick={() => { setEditingRecurring({ daysOfWeek:[] }); setIsRecurringModalOpen(true); }}><Clock className="w-4 h-4" /> Recurring Shifts</button>
          </div>
          <div className="pt-2 mt-1 border-t border-neutral-100 dark:border-neutral-700 space-y-0.5">
            <button onClick={exportToCSV} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-900/30 transition-colors"><Download className="w-4 h-4" /> Export CSV</button>
            <button onClick={() => setIsPDFModalOpen(true)} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-900/30 transition-colors"><FileText className="w-4 h-4" /> Download PDF</button>          </div>
        </nav>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-1.5"><Briefcase className="w-3.5 h-3.5" /> Jobs</span>
            <button onClick={openNewJobModal} className="p-1 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded transition-colors"><Plus className="w-3.5 h-3.5" /></button>
          </div>
          <div className="space-y-1.5">
            {jobs.map(job => {
              const c = JOB_COLORS.find(x => x.id === job.colorId) || JOB_COLORS[0];
              return (
                <div key={job.id} className={`px-2.5 py-2 rounded-lg border ${c.border} ${c.lightBg} flex items-center justify-between group`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`w-2.5 h-2.5 rounded-full ${c.bg} shrink-0`} />
                    <div className="min-w-0">
                      <p className={`font-medium text-xs truncate ${c.text}`}>{job.title}</p>
                      <p className={`text-[10px] opacity-60 ${c.text}`}>{job.payrollCycle.type === 'end_of_month' ? `Monthly · D${job.payrollCycle.cutoffDay}` : 'Event'}</p>
                    </div>
                  </div>
                  <button onClick={() => { setEditingJob(job); setIsJobModalOpen(true); }} className="opacity-0 group-hover:opacity-100 p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 rounded transition-all shrink-0"><Edit2 className="w-3 h-3" /></button>
                </div>
              );
            })}
            {jobs.length === 0 && <p className="text-xs text-neutral-400 italic text-center py-3">No jobs yet.</p>}
          </div>
        </div>

        <div className="space-y-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> Employee</span>
          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">CPF Age Group</label>
            <select value={ageGroup} onChange={e => setAgeGroup(e.target.value as AgeGroup)} className="w-full px-2.5 py-1.5 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white">
              {Object.entries(CPF_RATES).map(([k, { label }]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </div>
          <div className="bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 p-2.5 rounded-lg text-[11px] leading-relaxed">
            <Info className="w-3.5 h-3.5 inline mr-1 -mt-0.5" /> Rates effective {CPF_RATES_EFFECTIVE_DATE}.
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main className="flex-1 p-4 sm:p-6 md:p-8 overflow-y-auto dark:bg-neutral-900 transition-colors">
        <div className="max-w-5xl mx-auto space-y-6">

          {activeTab === 'calendar' && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { l: 'Gross Pay',    v: `$${monthlyCalc.grossPay.toFixed(2)}`,     cl: 'text-neutral-900 dark:text-white' },
                  { l: 'Net Pay',      v: `$${monthlyCalc.netPay.toFixed(2)}`,        cl: 'text-emerald-600 dark:text-emerald-400' },
                  { l: 'Employee CPF', v: `-$${monthlyCalc.employeeCpf.toFixed(2)}`,  cl: 'text-rose-600 dark:text-rose-400' },
                  { l: 'Employer CPF', v: `+$${monthlyCalc.employerCpf.toFixed(2)}`,  cl: 'text-indigo-600 dark:text-indigo-400' },
                ].map(({ l, v, cl }) => (
                  <div key={l} className="bg-white dark:bg-neutral-800 p-4 rounded-2xl shadow-sm border border-neutral-100 dark:border-neutral-700">
                    <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">{l}</p>
                    <p className={`text-2xl font-light ${cl}`}>{v}</p>
                  </div>
                ))}
              </div>

              <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-100 dark:border-neutral-700 overflow-hidden">
                <div className="p-4 border-b border-neutral-100 dark:border-neutral-700 flex items-center justify-between">
                  <h2 className="text-base font-semibold flex items-center gap-2 dark:text-white">
                    <CalendarDays className="w-4 h-4 text-neutral-400" /> {format(currentDate, 'MMMM yyyy')}
                  </h2>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setCurrentDate(subMonths(currentDate, 1))} className="p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-full transition-colors dark:text-white"><ChevronLeft className="w-4 h-4" /></button>
                    <button onClick={() => setCurrentDate(new Date())} className="px-2.5 py-1 text-xs font-medium hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-full transition-colors dark:text-white">Today</button>
                    <button onClick={() => setCurrentDate(addMonths(currentDate, 1))} className="p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-full transition-colors dark:text-white"><ChevronRight className="w-4 h-4" /></button>
                  </div>
                </div>
                <div className="p-3 sm:p-4">
                  <div className="grid grid-cols-7 gap-1 mb-1">
                    {['S','M','T','W','T','F','S'].map((d, i) => (
                      <div key={i} className="text-center text-[10px] font-semibold text-neutral-400 uppercase py-1">{d}</div>
                    ))}
                  </div>
                  {shifts.length === 0 && <p className="text-center text-xs text-neutral-400 py-1 mb-1">Tap any day to log a shift</p>}
                  <div className="grid grid-cols-7 gap-1">
                    {daysInMonth.map(date => {
                      const dateStr   = format(date, 'yyyy-MM-dd');
                      const dayShifts = shifts.filter(s => s.date === dateStr);
                      const inMonth   = isSameMonth(date, currentDate);
                      const today     = isToday(date);
                      const holiday   = SG_PUBLIC_HOLIDAYS[dateStr];
                      return (
                        <div key={dateStr} onClick={() => handleDateClick(date)} role="button" tabIndex={0}
                          onKeyDown={e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); handleDateClick(date); } }}
                          className={['group min-h-[60px] sm:min-h-[78px] p-1 rounded-xl border flex flex-col items-start transition-all cursor-pointer',
                            !inMonth ? 'opacity-30 bg-neutral-50 dark:bg-neutral-800/30 border-transparent' : 'bg-white dark:bg-neutral-800 border-neutral-100 dark:border-neutral-700 hover:border-indigo-300 dark:hover:border-indigo-500 hover:shadow-sm',
                            today ? 'ring-2 ring-indigo-500 ring-offset-1 dark:ring-offset-neutral-900' : '',
                            holiday && dayShifts.length===0 ? 'bg-amber-50/40 dark:bg-amber-900/10 border-amber-100 dark:border-amber-900/30' : '',
                          ].join(' ')}>
                          <div className="flex items-center justify-between w-full">
                            <span className={`text-xs font-medium ${today ? 'text-indigo-600 dark:text-indigo-400' : holiday ? 'text-amber-500' : 'text-neutral-600 dark:text-neutral-400'}`}>{format(date, 'd')}</span>
                            {copiedShift && (
                              <button onClick={e => { e.stopPropagation(); if (shifts.some(s => s.date===dateStr && s.jobId===(copiedShift as Shift).jobId)) return; setShifts(prev => [...prev, { ...(copiedShift as Shift), id: Math.random().toString(36).substr(2,9), date: dateStr, isPublicHoliday: !!SG_PUBLIC_HOLIDAYS[dateStr] }]); }}
                                className="opacity-0 group-hover:opacity-100 p-0.5 text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/40 rounded transition-all" title="Paste"><ClipboardPaste className="w-3 h-3" /></button>
                            )}
                          </div>
                          <div className="mt-0.5 w-full space-y-0.5 overflow-hidden">
                            {dayShifts.map(shift => {
                              const job = jobs.find(j => j.id===shift.jobId);
                              const col = job ? JOB_COLORS.find(c => c.id===job.colorId)||JOB_COLORS[0] : JOB_COLORS[0];
                              const h = calculateShiftHours(shift.startTime, shift.endTime, shift.unpaidBreakHours);
                              return (
                                <div key={shift.id} className="flex items-center gap-0.5 group/shift">
                                  <div className={`w-1.5 h-1.5 rounded-full ${col.bg} shrink-0 sm:hidden`} />
                                  <div className={`hidden sm:flex items-center justify-between gap-1 w-full text-[10px] px-1.5 py-0.5 rounded ${col.lightBg} ${col.text} font-medium`}>
                                    <div className="flex items-center gap-1 truncate"><div className={`w-1.5 h-1.5 rounded-full ${col.bg} shrink-0`} /><span className="truncate">{h.toFixed(1)}h</span></div>
                                    <button onClick={e => { e.stopPropagation(); setCopiedShift(shift); }} className="opacity-0 group-hover/shift:opacity-100 p-0.5 hover:bg-black/10 dark:hover:bg-white/20 rounded transition-opacity" title="Copy"><Copy className="w-2.5 h-2.5" /></button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          {holiday && dayShifts.length===0 && <p className="hidden sm:block mt-auto w-full text-[9px] text-amber-500 font-medium leading-tight truncate" title={holiday}>{holiday}</p>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          )}

          {activeTab === 'monthly_income' && (
            <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-100 dark:border-neutral-700 overflow-hidden transition-colors">
              <div className="p-5 border-b border-neutral-100 dark:border-neutral-700 flex items-center justify-between">
                <h2 className="text-base font-semibold flex items-center gap-2 dark:text-white"><Calendar className="w-4 h-4 text-indigo-600 dark:text-indigo-400" /> Monthly Income — {format(currentDate, 'MMMM yyyy')}</h2>
                <div className="flex items-center gap-1">
                  <button onClick={() => setCurrentDate(subMonths(currentDate,1))} className="p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-full transition-colors dark:text-white"><ChevronLeft className="w-4 h-4" /></button>
                  <button onClick={() => setCurrentDate(addMonths(currentDate,1))} className="p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-full transition-colors dark:text-white"><ChevronRight className="w-4 h-4" /></button>
                </div>
              </div>
              <div className="p-5">
                {jobs.filter(j => j.payrollCycle.type==='end_of_month').length === 0
                  ? <p className="text-center py-8 text-neutral-400 text-sm">No monthly jobs configured.</p>
                  : <div className="space-y-4">
                    {jobs.filter(j => j.payrollCycle.type==='end_of_month').map(job => {
                      const col = JOB_COLORS.find(c => c.id===job.colorId)||JOB_COLORS[0];
                      const js  = currentMonthPayrollShifts.filter(s => s.jobId===job.id);
                      const { grossPay, totalHours, employeeCpf, employerCpf, netPay } = calcPayrollSummary(js, jobs, ageGroup);
                      return (
                        <div key={job.id} className="border border-neutral-200 dark:border-neutral-700 rounded-xl overflow-hidden">
                          <div className={`p-3.5 ${col.lightBg} dark:bg-neutral-700/40 border-b ${col.border} dark:border-neutral-700 flex items-center justify-between`}>
                            <div className="flex items-center gap-2"><div className={`w-2.5 h-2.5 rounded-full ${col.bg}`} /><span className={`font-semibold text-sm ${col.text} dark:text-white`}>{job.title}</span></div>
                            <span className="text-xs text-neutral-500 dark:text-neutral-400">Cutoff: {job.payrollCycle.cutoffDay}</span>
                          </div>
                          <div className="p-4 grid grid-cols-2 md:grid-cols-5 gap-4 dark:text-white">
                            {[{ l:'Hours', v:`${totalHours.toFixed(1)}h`, c:'' }, { l:'Gross', v:`$${grossPay.toFixed(2)}`, c:'' }, { l:'Emp CPF', v:`-$${employeeCpf.toFixed(2)}`, c:'text-rose-600 dark:text-rose-400' }, { l:'Empr CPF', v:`+$${employerCpf.toFixed(2)}`, c:'text-indigo-600 dark:text-indigo-400' }, { l:'Net Pay', v:`$${netPay.toFixed(2)}`, c:'text-emerald-600 dark:text-emerald-400 font-semibold' }].map(({ l, v, c }) => (
                              <div key={l}><p className="text-xs text-neutral-500 dark:text-neutral-400 mb-0.5">{l}</p><p className={`text-sm font-medium ${c}`}>{v}</p></div>
                            ))}
                          </div>
                          {js.length > 0 && (
                            <div className="border-t border-neutral-100 dark:border-neutral-700 divide-y divide-neutral-50 dark:divide-neutral-700/50">
                              {js.map(shift => {
                                const d = parseISO(shift.date);
                                const rate = shift.isPublicHoliday ? job.rates.publicHoliday : isWeekend(d) ? job.rates.weekend : job.rates.weekday;
                                const h = calculateShiftHours(shift.startTime, shift.endTime, shift.unpaidBreakHours);
                                return (
                                  <div key={shift.id} className="px-4 py-2 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
                                    <div className="flex items-center gap-3 flex-wrap">
                                      <span className="font-medium text-neutral-700 dark:text-neutral-200 w-24">{format(d,'EEE, d MMM')}</span>
                                      <span>{shift.startTime}–{shift.endTime}</span>
                                      <span>{h.toFixed(1)}h @ ${rate}/h</span>
                                      {shift.isPublicHoliday && <span className="text-amber-500 font-medium">PH</span>}
                                      {shift.notes && <span className="flex items-center gap-1 text-neutral-400 italic truncate max-w-[120px]"><MessageSquare className="w-3 h-3 shrink-0" />{shift.notes}</span>}
                                    </div>
                                    <span className="font-medium text-neutral-700 dark:text-neutral-200 shrink-0">${calcShiftGross(shift, job).toFixed(2)}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                }
              </div>
            </div>
          )}

          {activeTab === 'event_income' && (
            <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-100 dark:border-neutral-700 overflow-hidden transition-colors">
              <div className="p-5 border-b border-neutral-100 dark:border-neutral-700">
                <h2 className="text-base font-semibold flex items-center gap-2 dark:text-white"><FileText className="w-4 h-4 text-indigo-600 dark:text-indigo-400" /> Event / Gig Income</h2>
              </div>
              <div className="p-5">
                {jobs.filter(j => j.payrollCycle.type==='end_of_event').length === 0
                  ? <p className="text-center py-8 text-neutral-400 text-sm">No event-based jobs configured.</p>
                  : <div className="space-y-4">
                    {jobs.filter(j => j.payrollCycle.type==='end_of_event').map(job => {
                      const col = JOB_COLORS.find(c => c.id===job.colorId)||JOB_COLORS[0];
                      const js  = eventPayrollShifts.filter(s => s.jobId===job.id);
                      const { grossPay, totalHours, employeeCpf, employerCpf, netPay } = calcPayrollSummary(js, jobs, ageGroup);
                      return (
                        <div key={job.id} className="border border-neutral-200 dark:border-neutral-700 rounded-xl overflow-hidden">
                          <div className={`p-3.5 ${col.lightBg} dark:bg-neutral-700/40 border-b ${col.border} dark:border-neutral-700 flex items-center justify-between`}>
                            <div className="flex items-center gap-2"><div className={`w-2.5 h-2.5 rounded-full ${col.bg}`} /><span className={`font-semibold text-sm ${col.text} dark:text-white`}>{job.title}</span></div>
                            <span className="text-xs text-neutral-500 dark:text-neutral-400">Ends: {job.payrollCycle.endDate ? format(parseISO(job.payrollCycle.endDate),'MMM d, yyyy') : 'Not set'}</span>
                          </div>
                          <div className="p-4 grid grid-cols-2 md:grid-cols-5 gap-4 dark:text-white">
                            {[{ l:'Hours', v:`${totalHours.toFixed(1)}h`, c:'' }, { l:'Gross', v:`$${grossPay.toFixed(2)}`, c:'' }, { l:'Emp CPF', v:`-$${employeeCpf.toFixed(2)}`, c:'text-rose-600 dark:text-rose-400' }, { l:'Empr CPF', v:`+$${employerCpf.toFixed(2)}`, c:'text-indigo-600 dark:text-indigo-400' }, { l:'Net Pay', v:`$${netPay.toFixed(2)}`, c:'text-emerald-600 dark:text-emerald-400 font-semibold' }].map(({ l, v, c }) => (
                              <div key={l}><p className="text-xs text-neutral-500 dark:text-neutral-400 mb-0.5">{l}</p><p className={`text-sm font-medium ${c}`}>{v}</p></div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                }
              </div>
            </div>
          )}

          {activeTab === 'dashboard' && (
            <div className="space-y-5">
              <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-100 dark:border-neutral-700 p-5 transition-colors">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-semibold flex items-center gap-2 dark:text-white"><Target className="w-4 h-4 text-indigo-600 dark:text-indigo-400" /> Monthly Goal</h2>
                  <div className="flex items-center gap-1.5 text-sm text-neutral-500 dark:text-neutral-400">
                    <span>$</span>
                    <input type="number" value={monthlyGoal} onChange={e => setMonthlyGoal(Number(e.target.value))} className="w-24 px-2 py-1 text-sm bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white" />
                  </div>
                </div>
                <div className="space-y-1.5 mb-5">
                  <div className="flex justify-between text-xs text-neutral-500 dark:text-neutral-400">
                    <span>Net Pay: <span className="font-semibold text-emerald-600 dark:text-emerald-400">${monthlyCalc.netPay.toFixed(2)}</span></span>
                    <span>{Math.min(100,(monthlyCalc.netPay/monthlyGoal)*100).toFixed(1)}%</span>
                  </div>
                  <div className="w-full h-3 bg-neutral-100 dark:bg-neutral-700 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-500 ${monthlyCalc.netPay>=monthlyGoal ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width:`${Math.min(100,(monthlyCalc.netPay/monthlyGoal)*100)}%` }} />
                  </div>
                  <p className="text-xs text-right text-neutral-400">{monthlyCalc.netPay>=monthlyGoal ? '🎉 Goal reached!' : `$${incomeProjection.gap.toFixed(2)} remaining`}</p>
                </div>

                {incomeProjection.gap > 0 && jobs.length > 0 && (
                  <div className="border-t border-neutral-100 dark:border-neutral-700 pt-4">
                    <h3 className="text-sm font-semibold flex items-center gap-2 dark:text-white mb-3"><Lightbulb className="w-4 h-4 text-amber-500" /> How to close the gap</h3>
                    <div className="space-y-2">
                      {incomeProjection.recommendations.map(({ job, hoursNeeded, grossNeeded }) => {
                        const col = JOB_COLORS.find(c => c.id===job.colorId)||JOB_COLORS[0];
                        const dailyHours = incomeProjection.daysLeft > 0 ? (hoursNeeded/incomeProjection.daysLeft).toFixed(1) : '—';
                        return (
                          <div key={job.id} className={`p-3 rounded-xl border ${col.border} ${col.lightBg} dark:bg-neutral-700/30 dark:border-neutral-700`}>
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-1.5"><div className={`w-2 h-2 rounded-full ${col.bg}`} /><span className={`text-sm font-semibold ${col.text} dark:text-white`}>{job.title}</span></div>
                              <span className="text-xs text-neutral-500 dark:text-neutral-400">${job.rates.weekday}/h</span>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-xs">
                              <div><p className="text-neutral-400 dark:text-neutral-500">Hours needed</p><p className="font-semibold text-neutral-700 dark:text-neutral-200">{hoursNeeded.toFixed(1)}h</p></div>
                              <div><p className="text-neutral-400 dark:text-neutral-500">~8h shifts</p><p className="font-semibold text-neutral-700 dark:text-neutral-200">{Math.ceil(hoursNeeded/8)}</p></div>
                              <div><p className="text-neutral-400 dark:text-neutral-500">Daily avg</p><p className="font-semibold text-neutral-700 dark:text-neutral-200">{dailyHours}h/day</p></div>
                            </div>
                            {incomeProjection.daysLeft <= 5 && <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1"><Zap className="w-3 h-3" /> Only {incomeProjection.daysLeft} days left this month</p>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {incomeProjection.gap <= 0 && <div className="border-t border-neutral-100 dark:border-neutral-700 pt-4 text-center text-sm text-emerald-600 dark:text-emerald-400">You've hit your goal — nice work 🎯</div>}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-100 dark:border-neutral-700 p-5 transition-colors">
                  <h2 className="text-sm font-semibold flex items-center gap-2 mb-4 dark:text-white"><TrendingUp className="w-4 h-4 text-indigo-600 dark:text-indigo-400" /> Income Trend (6 Months)</h2>
                  <div className="h-52 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dashboardAnalytics.monthlyTrend} margin={{ top:8, right:8, left:-20, bottom:0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDarkMode ? '#3a3a3a' : '#e5e5e5'} />
                        <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize:11, fill: isDarkMode ? '#a3a3a3' : '#737373' }} dy={8} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize:11, fill: isDarkMode ? '#a3a3a3' : '#737373' }} tickFormatter={v => `$${v}`} />
                        <Tooltip cursor={{ fill: isDarkMode ? '#262626' : '#f5f5f5' }} contentStyle={{ backgroundColor: isDarkMode ? '#1a1a1a' : '#fff', borderColor: isDarkMode ? '#3a3a3a' : '#e5e5e5', borderRadius:8, fontSize:12, color: isDarkMode ? '#fff' : '#000' }} formatter={(v: number) => [`$${v.toFixed(2)}`, 'Net Pay']} />
                        <Bar dataKey="net" fill="#6366f1" radius={[4,4,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-100 dark:border-neutral-700 p-5 transition-colors">
                  <h2 className="text-sm font-semibold flex items-center gap-2 mb-4 dark:text-white"><Briefcase className="w-4 h-4 text-indigo-600 dark:text-indigo-400" /> Earnings by Job</h2>
                  <div className="h-52 w-full">
                    {dashboardAnalytics.jobEarnings.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={dashboardAnalytics.jobEarnings} cx="50%" cy="50%" innerRadius={55} outerRadius={75} paddingAngle={4} dataKey="value">
                            {dashboardAnalytics.jobEarnings.map((e, i) => <Cell key={i} fill={e.color} />)}
                          </Pie>
                          <Tooltip contentStyle={{ backgroundColor: isDarkMode ? '#1a1a1a' : '#fff', borderColor: isDarkMode ? '#3a3a3a' : '#e5e5e5', borderRadius:8, fontSize:12, color: isDarkMode ? '#fff' : '#000' }} formatter={(v: number) => [`$${v.toFixed(2)}`, 'Earnings']} />
                          <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize:11, color: isDarkMode ? '#a3a3a3' : '#737373' }} />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : <div className="h-full flex items-center justify-center text-neutral-400 text-sm">No earnings this month yet.</div>}
                  </div>
                </div>
              </div>
            </div>
          )}
          {activeTab === 'offer_simulator' && (
            <OfferSimulator ageGroup={ageGroup} />
          )}

        </div>
      </main>

      {/* MODALS */}

      {/* Day Picker */}
      {isDayPickerOpen && selectedDate && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="p-5 border-b border-neutral-100 dark:border-neutral-800 flex items-start justify-between">
              <div><h3 className="text-base font-semibold dark:text-white">{format(parseISO(selectedDate),'EEEE, MMM d')}</h3><p className="text-xs text-neutral-500 mt-0.5">Multiple shifts — select one</p></div>
              <button onClick={() => setIsDayPickerOpen(false)} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 space-y-2">
              {shifts.filter(s => s.date===selectedDate).map(shift => {
                const job = jobs.find(j => j.id===shift.jobId);
                const col = job ? JOB_COLORS.find(c => c.id===job.colorId)||JOB_COLORS[0] : JOB_COLORS[0];
                const h = calculateShiftHours(shift.startTime, shift.endTime, shift.unpaidBreakHours);
                return (
                  <button key={shift.id} onClick={() => { setTempShift(shift); setIsDayPickerOpen(false); setIsShiftModalOpen(true); }} className={`w-full flex items-center gap-3 p-3 rounded-xl border ${col.border} ${col.lightBg} hover:brightness-95 transition-all text-left`}>
                    <div className={`w-2.5 h-2.5 rounded-full ${col.bg} shrink-0`} />
                    <div className="flex-1 min-w-0"><p className={`font-medium text-sm ${col.text}`}>{job?.title??'Unknown'}</p><p className="text-xs text-neutral-500">{shift.startTime}–{shift.endTime} · {h.toFixed(1)}h</p>{shift.notes && <p className="text-xs text-neutral-400 italic truncate">{shift.notes}</p>}</div>
                    <Edit2 className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                  </button>
                );
              })}
              <button onClick={() => { setTempShift({ jobId:jobs[0]?.id||'', date:selectedDate, startTime:'09:00', endTime:'17:00', unpaidBreakHours:1, isPublicHoliday:!!SG_PUBLIC_HOLIDAYS[selectedDate] }); setIsDayPickerOpen(false); setIsShiftModalOpen(true); }} className="w-full flex items-center gap-2 p-3 rounded-xl border border-dashed border-neutral-300 dark:border-neutral-600 text-neutral-500 dark:text-neutral-400 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all text-sm font-medium">
                <Plus className="w-4 h-4" /> Add another shift
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shift Modal */}
      {isShiftModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-5 border-b border-neutral-100 dark:border-neutral-800 flex items-start justify-between shrink-0">
              <h3 className="text-base font-semibold dark:text-white flex flex-col">
                <span>{selectedDate ? format(parseISO(selectedDate),'EEEE, MMM d, yyyy') : ''}</span>
                {selectedDate && SG_PUBLIC_HOLIDAYS[selectedDate] && <span className="text-xs text-amber-500 font-medium mt-0.5">{SG_PUBLIC_HOLIDAYS[selectedDate]}</span>}
              </h3>
              <button onClick={() => setIsShiftModalOpen(false)} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 mt-0.5"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              {jobs.length === 0
                ? <div className="text-center py-4"><p className="text-neutral-500 text-sm mb-3">Add a job first.</p><button onClick={() => { setIsShiftModalOpen(false); openNewJobModal(); }} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">Add Job</button></div>
                : <>
                  <div>
                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Job</label>
                    <select value={tempShift.jobId||''} onChange={e => setTempShift({ ...tempShift, jobId:e.target.value })} className={ic}>{jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}</select>
                  </div>
                  {templates.filter(t => t.jobId===tempShift.jobId).length > 0 && (
                    <div>
                      <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Fill from template</label>
                      <div className="flex flex-wrap gap-1.5">
                        {templates.filter(t => t.jobId===tempShift.jobId).map(t => (
                          <button key={t.id} onClick={() => setTempShift(p => ({ ...p, startTime:t.startTime, endTime:t.endTime, unpaidBreakHours:t.unpaidBreakHours }))} className="px-2.5 py-1 text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors font-medium">{t.name}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Start</label><input type="time" value={tempShift.startTime||''} onChange={e => setTempShift({ ...tempShift, startTime:e.target.value })} className={ic} /></div>
                    <div><label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">End</label><input type="time" value={tempShift.endTime||''} onChange={e => setTempShift({ ...tempShift, endTime:e.target.value })} className={ic} /></div>
                  </div>
                  <div><label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Unpaid Break (hrs)</label><input type="number" min="0" step="0.5" value={tempShift.unpaidBreakHours||0} onChange={e => setTempShift({ ...tempShift, unpaidBreakHours:Number(e.target.value) })} className={ic} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Allowance ($)</label><input type="number" min="0" step="0.01" value={tempShift.allowance||''} onChange={e => setTempShift({ ...tempShift, allowance:Number(e.target.value) })} className={ic} placeholder="0.00" /></div>
                    <div><label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Deduction ($)</label><input type="number" min="0" step="0.01" value={tempShift.deduction||''} onChange={e => setTempShift({ ...tempShift, deduction:Number(e.target.value) })} className={ic} placeholder="0.00" /></div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1 flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" /> Notes</label>
                    <input type="text" value={tempShift.notes||''} onChange={e => setTempShift({ ...tempShift, notes:e.target.value })} className={ic} placeholder="e.g. Covered for colleague, training day…" />
                  </div>
                  <div className="bg-neutral-50 dark:bg-neutral-800/60 p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 flex items-center justify-between">
                    <span className="text-xs font-medium text-neutral-600 dark:text-neutral-300">Paid Hours</span>
                    <span className="text-lg font-semibold text-indigo-600 dark:text-indigo-400">{calculateShiftHours(tempShift.startTime, tempShift.endTime, tempShift.unpaidBreakHours).toFixed(2)}h</span>
                  </div>
                  <label className="flex items-center gap-2.5 p-3 border border-neutral-200 dark:border-neutral-700 rounded-lg cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors">
                    <input type="checkbox" checked={tempShift.isPublicHoliday||false} onChange={e => setTempShift({ ...tempShift, isPublicHoliday:e.target.checked })} className="w-4 h-4 text-indigo-600 rounded border-neutral-300 focus:ring-indigo-500" />
                    <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Public Holiday rate</span>
                  </label>
                </>
              }
            </div>
            {jobs.length > 0 && (
              <div className="p-5 bg-neutral-50 dark:bg-neutral-800/50 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-between gap-3 shrink-0">
                {tempShift.id ? <button onClick={handleDeleteShift} className="px-3 py-1.5 text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded-lg flex items-center gap-1.5 transition-colors"><Trash2 className="w-4 h-4" /> Remove</button> : <div />}
                <div className="flex gap-2">
                  <button onClick={() => setIsShiftModalOpen(false)} className="px-3 py-1.5 text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-lg transition-colors">Cancel</button>
                  <button onClick={handleSaveShift} className="px-4 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors">Save Shift</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Template Modal */}
      {isTemplateModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-5 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between">
              <h3 className="text-base font-semibold dark:text-white">Shift Templates</h3>
              <button onClick={() => setIsTemplateModalOpen(false)} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              {templates.length > 0 && (
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {templates.map(t => {
                    const job = jobs.find(j => j.id===t.jobId);
                    const col = job ? JOB_COLORS.find(c => c.id===job.colorId)||JOB_COLORS[0] : JOB_COLORS[0];
                    return (
                      <div key={t.id} className={`flex items-center justify-between p-2.5 rounded-xl border ${col.border} ${col.lightBg}`}>
                        <div><p className={`text-sm font-medium ${col.text}`}>{t.name}</p><p className="text-xs text-neutral-500">{job?.title} · {t.startTime}–{t.endTime} · {t.unpaidBreakHours}h break</p></div>
                        <button onClick={() => setTemplates(prev => prev.filter(x => x.id!==t.id))} className="p-1 text-neutral-400 hover:text-rose-500 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="border-t border-neutral-100 dark:border-neutral-700 pt-4 space-y-3">
                <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">New Template</p>
                <div><label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Name</label><input type="text" value={editingTemplate.name||''} onChange={e => setEditingTemplate(p => ({ ...p, name:e.target.value }))} className={ic} placeholder="e.g. Morning Shift" /></div>
                <div><label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Job</label><select value={editingTemplate.jobId||''} onChange={e => setEditingTemplate(p => ({ ...p, jobId:e.target.value }))} className={ic}>{jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}</select></div>
                <div className="grid grid-cols-3 gap-2">
                  <div><label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Start</label><input type="time" value={editingTemplate.startTime||'09:00'} onChange={e => setEditingTemplate(p => ({ ...p, startTime:e.target.value }))} className={ic} /></div>
                  <div><label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">End</label><input type="time" value={editingTemplate.endTime||'17:00'} onChange={e => setEditingTemplate(p => ({ ...p, endTime:e.target.value }))} className={ic} /></div>
                  <div><label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Break hrs</label><input type="number" min="0" step="0.5" value={editingTemplate.unpaidBreakHours??1} onChange={e => setEditingTemplate(p => ({ ...p, unpaidBreakHours:Number(e.target.value) }))} className={ic} /></div>
                </div>
              </div>
            </div>
            <div className="p-5 bg-neutral-50 dark:bg-neutral-800/50 border-t border-neutral-100 dark:border-neutral-800 flex justify-end gap-2">
              <button onClick={() => setIsTemplateModalOpen(false)} className="px-3 py-1.5 text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-lg transition-colors">Close</button>
              <button onClick={handleSaveTemplate} disabled={!editingTemplate.name||!editingTemplate.jobId} className="px-4 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg shadow-sm transition-colors">Save Template</button>
            </div>
          </div>
        </div>
      )}

      {/* Recurring Modal */}
      {isRecurringModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-5 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between">
              <h3 className="text-base font-semibold dark:text-white">Recurring Shifts</h3>
              <button onClick={() => setIsRecurringModalOpen(false)} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              {templates.length === 0
                ? <div className="text-center py-4"><p className="text-neutral-500 text-sm mb-3">Create a template first.</p><button onClick={() => { setIsRecurringModalOpen(false); setEditingTemplate({ jobId:jobs[0]?.id||'', startTime:'09:00', endTime:'17:00', unpaidBreakHours:1 }); setIsTemplateModalOpen(true); }} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">Create Template</button></div>
                : <>
                  <div><label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Template</label><select value={editingRecurring.templateId||''} onChange={e => setEditingRecurring(p => ({ ...p, templateId:e.target.value }))} className={ic}><option value="">— select —</option>{templates.map(t => { const job = jobs.find(j => j.id===t.jobId); return <option key={t.id} value={t.id}>{t.name} ({job?.title})</option>; })}</select></div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-2">Days of week</label>
                    <div className="flex gap-1.5">
                      {['S','M','T','W','T','F','S'].map((d, i) => {
                        const active = (editingRecurring.daysOfWeek||[]).includes(i);
                        return <button key={i} onClick={() => setEditingRecurring(p => { const days = p.daysOfWeek||[]; return { ...p, daysOfWeek: active ? days.filter(x => x!==i) : [...days,i] }; })} className={`w-9 h-9 rounded-full text-xs font-semibold transition-colors ${active ? 'bg-indigo-600 text-white' : 'bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-600'}`}>{d}</button>;
                      })}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Start date</label><input type="date" value={editingRecurring.startDate||''} onChange={e => setEditingRecurring(p => ({ ...p, startDate:e.target.value }))} className={ic} /></div>
                    <div><label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">End date</label><input type="date" value={editingRecurring.endDate||''} onChange={e => setEditingRecurring(p => ({ ...p, endDate:e.target.value }))} className={ic} /></div>
                  </div>
                  {editingRecurring.templateId && editingRecurring.startDate && editingRecurring.endDate && (editingRecurring.daysOfWeek?.length??0) > 0 && (() => {
                    const tmpl = templates.find(t => t.id===editingRecurring.templateId);
                    if (!tmpl) return null;
                    const preview = expandRecurringRule(editingRecurring as RecurringRule, tmpl, shifts);
                    return <div className="bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 p-3 rounded-lg text-xs">Will add <strong>{preview.length}</strong> shift{preview.length!==1?'s':''}. {preview.length===0 && '(All days already have a shift.)'}</div>;
                  })()}
                </>
              }
            </div>
            <div className="p-5 bg-neutral-50 dark:bg-neutral-800/50 border-t border-neutral-100 dark:border-neutral-800 flex justify-end gap-2">
              <button onClick={() => setIsRecurringModalOpen(false)} className="px-3 py-1.5 text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-lg transition-colors">Cancel</button>
              <button onClick={handleApplyRecurring} disabled={!editingRecurring.templateId||!editingRecurring.startDate||!editingRecurring.endDate||!(editingRecurring.daysOfWeek?.length)} className="px-4 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg shadow-sm transition-colors">Apply Shifts</button>
            </div>
          </div>
        </div>
      )}

      {/* Job Modal */}
      {isJobModalOpen && editingJob && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-5 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between shrink-0">
              <h3 className="text-base font-semibold dark:text-white">{editingJob.id ? 'Edit Job' : 'Add Job'}</h3>
              <button onClick={() => setIsJobModalOpen(false)} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-5 overflow-y-auto flex-1">
              <div><label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Job Title</label><input type="text" value={editingJob.title} onChange={e => setEditingJob({ ...editingJob, title:e.target.value })} className={ic} placeholder="e.g. Barista, Tutor" /></div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-2">Colour</label>
                <div className="flex flex-wrap gap-2">{JOB_COLORS.map(col => <button key={col.id} onClick={() => setEditingJob({ ...editingJob, colorId:col.id })} className={`w-8 h-8 rounded-full ${col.bg} transition-transform ${editingJob.colorId===col.id ? 'ring-2 ring-offset-2 ring-neutral-800 dark:ring-neutral-200 scale-110' : 'hover:scale-110'}`} />)}</div>
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-2 border-b border-neutral-100 dark:border-neutral-800 pb-1.5">Hourly Rates</label>
                <div className="grid grid-cols-3 gap-2">
                  {[{ label:'Weekday', key:'weekday' as const }, { label:'Weekend', key:'weekend' as const }, { label:'Holiday', key:'publicHoliday' as const }].map(({ label, key }) => (
                    <div key={key}><label className="block text-[11px] text-neutral-500 dark:text-neutral-400 mb-1">{label}</label><div className="relative"><span className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400 text-xs">$</span><input type="number" value={editingJob.rates[key]} onChange={e => setEditingJob({ ...editingJob, rates:{ ...editingJob.rates, [key]:Number(e.target.value) } })} className="w-full pl-5 pr-2 py-1.5 text-sm bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white" /></div></div>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-2 border-b border-neutral-100 dark:border-neutral-800 pb-1.5">Payroll Cycle</label>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {(['end_of_month','end_of_event'] as const).map(type => (
                    <button key={type} onClick={() => setEditingJob({ ...editingJob, payrollCycle: type==='end_of_month' ? { type, cutoffDay:31 } : { type, endDate:format(new Date(),'yyyy-MM-dd') } })} className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${editingJob.payrollCycle.type===type ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300' : 'bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50'}`}>{type==='end_of_month' ? 'End of Month' : 'End of Event'}</button>
                  ))}
                </div>
                {editingJob.payrollCycle.type==='end_of_month'
                  ? <div><label className="block text-[11px] text-neutral-500 mb-1">Cutoff day (1–31)</label><input type="number" min="1" max="31" value={editingJob.payrollCycle.cutoffDay||31} onChange={e => setEditingJob({ ...editingJob, payrollCycle:{ ...editingJob.payrollCycle, cutoffDay:Number(e.target.value) } })} className={ic} /><p className="text-[10px] text-neutral-400 mt-1">31 = last day of month.</p></div>
                  : <div><label className="block text-[11px] text-neutral-500 mb-1">Event end date</label><input type="date" value={editingJob.payrollCycle.endDate||''} onChange={e => setEditingJob({ ...editingJob, payrollCycle:{ ...editingJob.payrollCycle, endDate:e.target.value } })} className={ic} /></div>
                }
              </div>
            </div>
            <div className="p-5 bg-neutral-50 dark:bg-neutral-800/50 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-between gap-3 shrink-0">
              {editingJob.id ? <button onClick={() => handleDeleteJob(editingJob.id)} className="px-3 py-1.5 text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded-lg flex items-center gap-1.5 transition-colors"><Trash2 className="w-4 h-4" /> Delete</button> : <div />}
              <div className="flex gap-2">
                <button onClick={() => setIsJobModalOpen(false)} className="px-3 py-1.5 text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-lg transition-colors">Cancel</button>
                <button onClick={handleSaveJob} disabled={!editingJob.title} className="px-4 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg shadow-sm transition-colors">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {isPDFModalOpen && (
        <PDFExportModal
          jobs={jobs}
          shifts={shifts}
          ageGroup={ageGroup}
          onClose={() => setIsPDFModalOpen(false)}
        />
      )}
    </div>
  );
}
