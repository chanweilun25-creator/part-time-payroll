import React, { useState, useMemo, useEffect } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isWeekend, isSameMonth, isToday, parseISO, addMonths, subMonths, startOfWeek, endOfWeek, isBefore, isAfter, isEqual } from 'date-fns';
import { Calculator, ChevronLeft, ChevronRight, DollarSign, Info, Trash2, X, User, CalendarDays, Plus, Briefcase, Clock, Edit2, Calendar, FileText, Download, Moon, Sun, Copy, ClipboardPaste, TrendingUp, Target, BarChart3 } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

const CPF_RATES = {
  '55_and_below': { label: '55 and below', employer: 0.17, employee: 0.20 },
  '55_to_60': { label: 'Above 55 to 60', employer: 0.16, employee: 0.18 },
  '60_to_65': { label: 'Above 60 to 65', employer: 0.125, employee: 0.125 },
  '65_to_70': { label: 'Above 65 to 70', employer: 0.09, employee: 0.075 },
  'above_70': { label: 'Above 70', employer: 0.075, employee: 0.05 },
};

const SG_PUBLIC_HOLIDAYS: Record<string, string> = {
  // 2025
  '2025-01-01': "New Year's Day",
  '2025-01-29': "Chinese New Year",
  '2025-01-30': "Chinese New Year",
  '2025-03-31': "Hari Raya Puasa",
  '2025-04-18': "Good Friday",
  '2025-05-01': "Labour Day",
  '2025-05-12': "Vesak Day",
  '2025-06-07': "Hari Raya Haji",
  '2025-08-09': "National Day",
  '2025-10-20': "Deepavali",
  '2025-12-25': "Christmas Day",
  // 2026
  '2026-01-01': "New Year's Day",
  '2026-02-17': "Chinese New Year",
  '2026-02-18': "Chinese New Year",
  '2026-03-20': "Hari Raya Puasa",
  '2026-04-03': "Good Friday",
  '2026-05-01': "Labour Day",
  '2026-05-27': "Hari Raya Haji",
  '2026-05-31': "Vesak Day",
  '2026-06-01': "Vesak Day (Observed)",
  '2026-08-09': "National Day",
  '2026-08-10': "National Day (Observed)",
  '2026-11-08': "Deepavali",
  '2026-11-09': "Deepavali (Observed)",
  '2026-12-25': "Christmas Day",
};

type AgeGroup = keyof typeof CPF_RATES;
type PayrollCycleType = 'end_of_month' | 'end_of_event';
type ViewTab = 'calendar' | 'monthly_income' | 'event_income' | 'dashboard';

const JOB_COLORS = [
  { id: 'red', bg: 'bg-red-500', border: 'border-red-200', text: 'text-red-700', lightBg: 'bg-red-50' },
  { id: 'yellow', bg: 'bg-yellow-500', border: 'border-yellow-200', text: 'text-yellow-700', lightBg: 'bg-yellow-50' },
  { id: 'orange', bg: 'bg-orange-500', border: 'border-orange-200', text: 'text-orange-700', lightBg: 'bg-orange-50' },
  { id: 'green', bg: 'bg-green-500', border: 'border-green-200', text: 'text-green-700', lightBg: 'bg-green-50' },
  { id: 'navy', bg: 'bg-blue-800', border: 'border-blue-300', text: 'text-blue-800', lightBg: 'bg-blue-50' },
  { id: 'purple', bg: 'bg-purple-500', border: 'border-purple-200', text: 'text-purple-700', lightBg: 'bg-purple-50' },
  { id: 'pink', bg: 'bg-pink-500', border: 'border-pink-200', text: 'text-pink-700', lightBg: 'bg-pink-50' },
  { id: 'sky', bg: 'bg-sky-400', border: 'border-sky-200', text: 'text-sky-700', lightBg: 'bg-sky-50' },
];

const getHexColor = (colorId: string) => {
  const map: Record<string, string> = {
    'red': '#ef4444', 'yellow': '#eab308', 'orange': '#f97316',
    'green': '#22c55e', 'navy': '#1e40af', 'purple': '#a855f7',
    'pink': '#ec4899', 'sky': '#38bdf8',
  };
  return map[colorId] || '#6366f1';
};

interface Job {
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
    cutoffDay?: number; // 1-31 for end_of_month
    endDate?: string; // YYYY-MM-DD for end_of_event
  };
}

interface Shift {
  id: string;
  jobId: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  unpaidBreakHours: number;
  isPublicHoliday: boolean;
  allowance?: number;
  deduction?: number;
}

export default function App() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [activeTab, setActiveTab] = useState<ViewTab>('calendar');
  
  const [ageGroup, setAgeGroup] = useState<AgeGroup>(() => {
    const saved = localStorage.getItem('payroll_ageGroup');
    return (saved as AgeGroup) || '55_and_below';
  });
  
  const [jobs, setJobs] = useState<Job[]>(() => {
    const saved = localStorage.getItem('payroll_jobs');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return [
      {
        id: '1',
        title: 'Main Job',
        colorId: 'navy',
        rates: { weekday: 12, weekend: 15, publicHoliday: 20 },
        payrollCycle: { type: 'end_of_month', cutoffDay: 31 }
      }
    ];
  });
  
  const [shifts, setShifts] = useState<Shift[]>(() => {
    const saved = localStorage.getItem('payroll_shifts');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return [];
  });

  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('payroll_darkMode');
    return saved === 'true';
  });

  const [copiedShift, setCopiedShift] = useState<Partial<Shift> | null>(null);

  const [monthlyGoal, setMonthlyGoal] = useState<number>(() => {
    const saved = localStorage.getItem('payroll_monthlyGoal');
    return saved ? Number(saved) : 1000;
  });

  useEffect(() => {
    localStorage.setItem('payroll_monthlyGoal', String(monthlyGoal));
  }, [monthlyGoal]);

  useEffect(() => {
    localStorage.setItem('payroll_ageGroup', ageGroup);
  }, [ageGroup]);

  useEffect(() => {
    localStorage.setItem('payroll_jobs', JSON.stringify(jobs));
  }, [jobs]);

  useEffect(() => {
    localStorage.setItem('payroll_shifts', JSON.stringify(shifts));
  }, [shifts]);

  useEffect(() => {
    localStorage.setItem('payroll_darkMode', String(isDarkMode));
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);
  
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const [isJobModalOpen, setIsJobModalOpen] = useState(false);
  
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [tempShift, setTempShift] = useState<Partial<Shift>>({});

  // Calculate shifts that fall into the current selected month's payroll cycle
  const currentMonthPayrollShifts = useMemo(() => {
    return shifts.filter(shift => {
      const job = jobs.find(j => j.id === shift.jobId);
      if (!job || job.payrollCycle.type !== 'end_of_month') return false;

      const shiftDate = parseISO(shift.date);
      const cutoffDay = job.payrollCycle.cutoffDay || 31;
      
      // If cutoff is e.g. 25th, the cycle for March is Feb 26 to Mar 25
      let cycleStart, cycleEnd;
      
      if (cutoffDay >= 28) {
        // Standard calendar month
        cycleStart = startOfMonth(currentDate);
        cycleEnd = endOfMonth(currentDate);
      } else {
        // Custom cutoff
        cycleEnd = new Date(currentDate.getFullYear(), currentDate.getMonth(), cutoffDay);
        cycleStart = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, cutoffDay + 1);
      }

      return (isAfter(shiftDate, cycleStart) || isEqual(shiftDate, cycleStart)) && 
             (isBefore(shiftDate, cycleEnd) || isEqual(shiftDate, cycleEnd));
    });
  }, [shifts, jobs, currentDate]);

  // Calculate shifts for event-based jobs
  const eventPayrollShifts = useMemo(() => {
    return shifts.filter(shift => {
      const job = jobs.find(j => j.id === shift.jobId);
      return job && job.payrollCycle.type === 'end_of_event';
    });
  }, [shifts, jobs]);

  const calculateShiftHours = (startTime?: string, endTime?: string, unpaidBreakHours: number = 0) => {
    if (!startTime || !endTime) return 0;
    
    // Parse times
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    
    let startMinutes = startH * 60 + startM;
    let endMinutes = endH * 60 + endM;
    
    // Handle overnight shifts
    if (endMinutes < startMinutes) {
      endMinutes += 24 * 60;
    }
    
    const totalMinutes = endMinutes - startMinutes;
    const totalHours = totalMinutes / 60;
    
    return Math.max(0, totalHours - unpaidBreakHours);
  };

  const calculateCpf = (grossPay: number) => {
    let employeeCpf = 0;
    let employerCpf = 0;
    const ratesForAge = CPF_RATES[ageGroup];

    if (grossPay > 750) {
      employeeCpf = grossPay * ratesForAge.employee;
      employerCpf = grossPay * ratesForAge.employer;
    } else if (grossPay > 500) {
      employeeCpf = grossPay * ratesForAge.employee;
      employerCpf = grossPay * ratesForAge.employer;
    } else if (grossPay > 50) {
      employeeCpf = 0;
      employerCpf = grossPay * ratesForAge.employer;
    }

    return { employeeCpf, employerCpf };
  };

  const monthlyCalculations = useMemo(() => {
    let grossPay = 0;
    
    currentMonthPayrollShifts.forEach(shift => {
      const job = jobs.find(j => j.id === shift.jobId);
      if (!job) return;

      const date = parseISO(shift.date);
      let rate = job.rates.weekday;
      
      if (shift.isPublicHoliday) {
        rate = job.rates.publicHoliday;
      } else if (isWeekend(date)) {
        rate = job.rates.weekend;
      }
      
      const hours = calculateShiftHours(shift.startTime, shift.endTime, shift.unpaidBreakHours);
      grossPay += (hours * rate) + (shift.allowance || 0) - (shift.deduction || 0);
    });

    let employeeCpf = 0;
    let employerCpf = 0;

    const ratesForAge = CPF_RATES[ageGroup];

    if (grossPay > 750) {
      employeeCpf = grossPay * ratesForAge.employee;
      employerCpf = grossPay * ratesForAge.employer;
    } else if (grossPay > 500) {
      employeeCpf = grossPay * ratesForAge.employee;
      employerCpf = grossPay * ratesForAge.employer;
    } else if (grossPay > 50) {
      employeeCpf = 0;
      employerCpf = grossPay * ratesForAge.employer;
    } else {
      employeeCpf = 0;
      employerCpf = 0;
    }

    const netPay = grossPay - employeeCpf;
    const totalCpf = employeeCpf + employerCpf;

    return { grossPay, employeeCpf, employerCpf, netPay, totalCpf };
  }, [currentMonthPayrollShifts, jobs, ageGroup]);

  const dashboardAnalytics = useMemo(() => {
    // 1. Income month-over-month (last 6 months)
    const last6Months = Array.from({ length: 6 }).map((_, i) => subMonths(new Date(), 5 - i));
    
    const monthlyTrend = last6Months.map(monthDate => {
      const monthStr = format(monthDate, 'MMM yyyy');
      
      // Get shifts for this month
      const monthShifts = shifts.filter(s => isSameMonth(parseISO(s.date), monthDate));
      
      let grossPay = 0;
      monthShifts.forEach(shift => {
        const job = jobs.find(j => j.id === shift.jobId);
        if (!job) return;
        
        const date = parseISO(shift.date);
        let rate = job.rates.weekday;
        if (shift.isPublicHoliday) rate = job.rates.publicHoliday;
        else if (isWeekend(date)) rate = job.rates.weekend;
        
        const hours = calculateShiftHours(shift.startTime, shift.endTime, shift.unpaidBreakHours);
        grossPay += (hours * rate) + (shift.allowance || 0) - (shift.deduction || 0);
      });
      
      const { employeeCpf } = calculateCpf(grossPay);
      const netPay = grossPay - employeeCpf;
      
      return {
        month: monthStr,
        gross: Number(grossPay.toFixed(2)),
        net: Number(netPay.toFixed(2))
      };
    });

    // 2. Earnings by Job (Current Month)
    const jobEarningsMap = new Map<string, { name: string, value: number, color: string }>();
    
    currentMonthPayrollShifts.forEach(shift => {
      const job = jobs.find(j => j.id === shift.jobId);
      if (!job) return;
      
      const date = parseISO(shift.date);
      let rate = job.rates.weekday;
      if (shift.isPublicHoliday) rate = job.rates.publicHoliday;
      else if (isWeekend(date)) rate = job.rates.weekend;
      
      const hours = calculateShiftHours(shift.startTime, shift.endTime, shift.unpaidBreakHours);
      const shiftGross = (hours * rate) + (shift.allowance || 0) - (shift.deduction || 0);
      
      const existing = jobEarningsMap.get(job.id);
      if (existing) {
        existing.value += shiftGross;
      } else {
        const colorObj = JOB_COLORS.find(c => c.id === job.colorId) || JOB_COLORS[0];
        const hexColor = getHexColor(colorObj.id);
        jobEarningsMap.set(job.id, { name: job.title, value: shiftGross, color: hexColor });
      }
    });
    
    const jobEarnings = Array.from(jobEarningsMap.values()).map(item => ({
      ...item,
      value: Number(item.value.toFixed(2))
    })).filter(item => item.value > 0);

    return { monthlyTrend, jobEarnings };
  }, [shifts, jobs, ageGroup, currentMonthPayrollShifts]);

  const daysInMonth = useMemo(() => {
    return eachDayOfInterval({
      start: startOfWeek(startOfMonth(currentDate)),
      end: endOfWeek(endOfMonth(currentDate))
    });
  }, [currentDate]);

  const handleDateClick = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    setSelectedDate(dateStr);
    
    // Find if there's an existing shift for this date
    const existingShifts = shifts.filter(s => s.date === dateStr);
    
    if (existingShifts.length > 0) {
      // Edit the first shift for simplicity, or we could list them
      setTempShift(existingShifts[0]);
    } else {
      setTempShift({
        jobId: jobs[0]?.id || '',
        date: dateStr,
        startTime: '09:00',
        endTime: '17:00',
        unpaidBreakHours: 1,
        isPublicHoliday: !!SG_PUBLIC_HOLIDAYS[dateStr]
      });
    }
    setIsShiftModalOpen(true);
  };

  const handleSaveShift = () => {
    if (!tempShift.jobId || !tempShift.startTime || !tempShift.endTime) return;
    
    if (tempShift.id) {
      // Update existing
      setShifts(prev => prev.map(s => s.id === tempShift.id ? { ...s, ...tempShift } as Shift : s));
    } else {
      // Add new
      const newShift: Shift = {
        id: Math.random().toString(36).substr(2, 9),
        jobId: tempShift.jobId,
        date: tempShift.date!,
        startTime: tempShift.startTime,
        endTime: tempShift.endTime,
        unpaidBreakHours: tempShift.unpaidBreakHours || 0,
        isPublicHoliday: tempShift.isPublicHoliday || false,
        allowance: tempShift.allowance || 0,
        deduction: tempShift.deduction || 0
      };
      setShifts(prev => [...prev, newShift]);
    }
    setIsShiftModalOpen(false);
  };

  const handleDeleteShift = () => {
    if (tempShift.id) {
      setShifts(prev => prev.filter(s => s.id !== tempShift.id));
    }
    setIsShiftModalOpen(false);
  };

  const handleSaveJob = () => {
    if (!editingJob?.title) return;
    
    if (jobs.find(j => j.id === editingJob.id)) {
      setJobs(prev => prev.map(j => j.id === editingJob.id ? editingJob : j));
    } else {
      setJobs(prev => [...prev, { ...editingJob, id: Math.random().toString(36).substr(2, 9) }]);
    }
    setIsJobModalOpen(false);
  };

  const handleDeleteJob = (jobId: string) => {
    setJobs(prev => prev.filter(j => j.id !== jobId));
    setShifts(prev => prev.filter(s => s.jobId !== jobId));
    setIsJobModalOpen(false);
  };

  const generatePDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(20);
    doc.text('Payslip Summary', 14, 22);
    
    doc.setFontSize(12);
    doc.text(`Generated on: ${format(new Date(), 'MMM dd, yyyy')}`, 14, 32);
    doc.text(`Age Group: ${CPF_RATES[ageGroup].label}`, 14, 40);

    // Monthly Income Summary
    doc.setFontSize(16);
    doc.text(`Monthly Income (${format(currentDate, 'MMMM yyyy')})`, 14, 55);
    
    autoTable(doc, {
      startY: 60,
      head: [['Job', 'Gross Pay', 'Employee CPF', 'Employer CPF', 'Net Pay']],
      body: jobs.filter(j => j.payrollCycle.type === 'end_of_month').map(job => {
        const jobShifts = currentMonthPayrollShifts.filter(s => s.jobId === job.id);
        let jobGross = 0;
        jobShifts.forEach(shift => {
          const date = parseISO(shift.date);
          let rate = job.rates.weekday;
          if (shift.isPublicHoliday) rate = job.rates.publicHoliday;
          else if (isWeekend(date)) rate = job.rates.weekend;
          const hours = calculateShiftHours(shift.startTime, shift.endTime, shift.unpaidBreakHours);
          jobGross += (hours * rate) + (shift.allowance || 0) - (shift.deduction || 0);
        });
        const { employeeCpf, employerCpf } = calculateCpf(jobGross);
        return [
          job.title,
          `$${jobGross.toFixed(2)}`,
          `-$${employeeCpf.toFixed(2)}`,
          `+$${employerCpf.toFixed(2)}`,
          `$${(jobGross - employeeCpf).toFixed(2)}`
        ];
      })
    });

    // Event Income Summary
    const finalY = (doc as any).lastAutoTable.finalY || 60;
    doc.setFontSize(16);
    doc.text('Event / Gig Income', 14, finalY + 15);

    autoTable(doc, {
      startY: finalY + 20,
      head: [['Job', 'Gross Pay', 'Employee CPF', 'Employer CPF', 'Net Pay']],
      body: jobs.filter(j => j.payrollCycle.type === 'end_of_event').map(job => {
        const jobShifts = eventPayrollShifts.filter(s => s.jobId === job.id);
        let jobGross = 0;
        jobShifts.forEach(shift => {
          const date = parseISO(shift.date);
          let rate = job.rates.weekday;
          if (shift.isPublicHoliday) rate = job.rates.publicHoliday;
          else if (isWeekend(date)) rate = job.rates.weekend;
          const hours = calculateShiftHours(shift.startTime, shift.endTime, shift.unpaidBreakHours);
          jobGross += (hours * rate) + (shift.allowance || 0) - (shift.deduction || 0);
        });
        const { employeeCpf, employerCpf } = calculateCpf(jobGross);
        return [
          job.title,
          `$${jobGross.toFixed(2)}`,
          `-$${employeeCpf.toFixed(2)}`,
          `+$${employerCpf.toFixed(2)}`,
          `$${(jobGross - employeeCpf).toFixed(2)}`
        ];
      })
    });

    doc.save(`Payslip_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
  };

  const openNewJobModal = () => {
    setEditingJob({
      id: '',
      title: 'New Job',
      colorId: JOB_COLORS[jobs.length % JOB_COLORS.length].id,
      rates: { weekday: 10, weekend: 12, publicHoliday: 15 },
      payrollCycle: { type: 'end_of_month', cutoffDay: 31 }
    });
    setIsJobModalOpen(true);
  };

  const exportToCSV = () => {
    let csvContent = "--- SHIFTS DATA ---\n";
    csvContent += ['Job Title', 'Payroll Cycle', 'Date', 'Start Time', 'End Time', 'Unpaid Break (hrs)', 'Paid Hours', 'Public Holiday', 'Hourly Rate', 'Allowance', 'Deduction', 'Gross Pay'].join(',') + '\n';
    
    const sortedShifts = [...shifts].sort((a, b) => a.date.localeCompare(b.date));
    
    sortedShifts.forEach(shift => {
      const job = jobs.find(j => j.id === shift.jobId);
      if (!job) return;
      
      const date = parseISO(shift.date);
      let rate = job.rates.weekday;
      if (shift.isPublicHoliday) rate = job.rates.publicHoliday;
      else if (isWeekend(date)) rate = job.rates.weekend;
      
      const hours = calculateShiftHours(shift.startTime, shift.endTime, shift.unpaidBreakHours);
      const grossPay = (hours * rate) + (shift.allowance || 0) - (shift.deduction || 0);
      
      csvContent += [
        `"${job.title}"`,
        job.payrollCycle.type === 'end_of_month' ? 'Monthly' : 'Event',
        shift.date,
        shift.startTime,
        shift.endTime,
        shift.unpaidBreakHours,
        hours.toFixed(2),
        shift.isPublicHoliday ? 'Yes' : 'No',
        rate.toFixed(2),
        (shift.allowance || 0).toFixed(2),
        (shift.deduction || 0).toFixed(2),
        grossPay.toFixed(2)
      ].join(',') + '\n';
    });

    csvContent += "\n--- JOBS SUMMARY ---\n";
    csvContent += ['Job Title', 'Payroll Cycle', 'Total Hours', 'Gross Pay', 'Employee CPF', 'Employer CPF', 'Net Pay'].join(',') + '\n';
    
    jobs.forEach(job => {
      const jobShifts = shifts.filter(s => s.jobId === job.id);
      let jobGross = 0;
      let totalHours = 0;
      
      jobShifts.forEach(shift => {
        const date = parseISO(shift.date);
        let rate = job.rates.weekday;
        if (shift.isPublicHoliday) rate = job.rates.publicHoliday;
        else if (isWeekend(date)) rate = job.rates.weekend;
        
        const hours = calculateShiftHours(shift.startTime, shift.endTime, shift.unpaidBreakHours);
        jobGross += (hours * rate) + (shift.allowance || 0) - (shift.deduction || 0);
        totalHours += hours;
      });

      const { employeeCpf, employerCpf } = calculateCpf(jobGross);
      const netPay = jobGross - employeeCpf;

      csvContent += [
        `"${job.title}"`,
        job.payrollCycle.type === 'end_of_month' ? 'Monthly' : 'Event',
        totalHours.toFixed(2),
        jobGross.toFixed(2),
        employeeCpf.toFixed(2),
        employerCpf.toFixed(2),
        netPay.toFixed(2)
      ].join(',') + '\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `payroll_export_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans flex flex-col md:flex-row dark:bg-neutral-900 dark:text-neutral-100 transition-colors duration-200">
      {/* Sidebar */}
      <aside className="w-full md:w-80 bg-white border-r border-neutral-200 p-6 flex flex-col gap-8 shrink-0 overflow-y-auto dark:bg-neutral-800 dark:border-neutral-700 transition-colors duration-200">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Calculator className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              Payroll Calculator
            </h1>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">Singapore Part-Time</p>
          </div>
          <button 
            onClick={() => setIsDarkMode(!isDarkMode)} 
            className="p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
            title="Toggle Dark Mode"
          >
            {isDarkMode ? <Sun className="w-5 h-5 text-amber-500" /> : <Moon className="w-5 h-5 text-slate-600" />}
          </button>
        </div>

        {/* Navigation */}
        <div className="space-y-1">
          <button 
            onClick={() => setActiveTab('calendar')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'calendar' ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300' : 'text-neutral-600 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-700/50'}`}
          >
            <CalendarDays className="w-4 h-4" /> Calendar View
          </button>
          <button 
            onClick={() => setActiveTab('monthly_income')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'monthly_income' ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300' : 'text-neutral-600 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-700/50'}`}
          >
            <Calendar className="w-4 h-4" /> Monthly Income
          </button>
          <button 
            onClick={() => setActiveTab('event_income')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'event_income' ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300' : 'text-neutral-600 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-700/50'}`}
          >
            <FileText className="w-4 h-4" /> Event / Gig Income
          </button>
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'dashboard' ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300' : 'text-neutral-600 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-700/50'}`}
          >
            <BarChart3 className="w-4 h-4" /> Insights & Goals
          </button>
          <div className="pt-2 mt-2 border-t border-neutral-100 dark:border-neutral-700 space-y-2">
            <button 
              onClick={exportToCSV}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-900/30 dark:hover:bg-emerald-900/50 transition-colors"
            >
              <Download className="w-4 h-4" /> Export to CSV
            </button>
            <button 
              onClick={generatePDF}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 dark:text-rose-300 dark:bg-rose-900/30 dark:hover:bg-rose-900/50 transition-colors"
            >
              <FileText className="w-4 h-4" /> Download PDF
            </button>
          </div>
        </div>

        {/* Jobs List */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-500 flex items-center gap-2">
              <Briefcase className="w-4 h-4" /> Jobs
            </h2>
            <button onClick={openNewJobModal} className="p-1 text-indigo-600 hover:bg-indigo-50 rounded transition-colors">
              <Plus className="w-4 h-4" />
            </button>
          </div>
          
          <div className="space-y-2">
            {jobs.map(job => {
              const color = JOB_COLORS.find(c => c.id === job.colorId) || JOB_COLORS[0];
              return (
                <div key={job.id} className={`p-3 rounded-lg border ${color.border} ${color.lightBg} flex items-center justify-between group`}>
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${color.bg}`}></div>
                    <div className="flex flex-col">
                      <span className={`font-medium text-sm ${color.text}`}>{job.title}</span>
                      <span className={`text-[10px] opacity-70 ${color.text}`}>
                        {job.payrollCycle.type === 'end_of_month' ? `Monthly (Cutoff: ${job.payrollCycle.cutoffDay})` : 'Event-based'}
                      </span>
                    </div>
                  </div>
                  <button 
                    onClick={() => { setEditingJob(job); setIsJobModalOpen(true); }}
                    className="opacity-0 group-hover:opacity-100 p-1.5 text-neutral-500 hover:text-neutral-900 hover:bg-white/50 rounded transition-all"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
            {jobs.length === 0 && (
              <div className="text-sm text-neutral-500 italic text-center py-4">No jobs added yet.</div>
            )}
          </div>
        </div>

        {/* CPF Settings */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 flex items-center gap-2">
            <User className="w-4 h-4" /> Employee Details
          </h2>
          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Age Group</label>
            <select value={ageGroup} onChange={e => setAgeGroup(e.target.value as AgeGroup)} className="w-full px-3 py-2 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white">
              {Object.entries(CPF_RATES).map(([key, {label}]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div className="bg-indigo-50 text-indigo-800 p-3 rounded-lg text-xs leading-relaxed">
            <Info className="w-4 h-4 inline mr-1 -mt-0.5" />
            CPF rates are based on 1 Jan 2026 guidelines. For wages ≤ $750, estimated full rates are applied.
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 md:p-10 overflow-y-auto dark:bg-neutral-900 transition-colors duration-200">
        <div className="max-w-5xl mx-auto space-y-8">
          
          {activeTab === 'calendar' && (
            <>
              {/* Summary Cards for Current Month */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-neutral-800 p-6 rounded-2xl shadow-sm border border-neutral-100 dark:border-neutral-700 transition-colors">
                  <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-1">Monthly Gross Pay</p>
                  <p className="text-3xl font-light text-neutral-900 dark:text-white">${monthlyCalculations.grossPay.toFixed(2)}</p>
                </div>
                <div className="bg-white dark:bg-neutral-800 p-6 rounded-2xl shadow-sm border border-neutral-100 dark:border-neutral-700 transition-colors">
                  <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-1">Monthly Net Pay</p>
                  <p className="text-3xl font-light text-emerald-600 dark:text-emerald-400">${monthlyCalculations.netPay.toFixed(2)}</p>
                </div>
                <div className="bg-white dark:bg-neutral-800 p-6 rounded-2xl shadow-sm border border-neutral-100 dark:border-neutral-700 transition-colors">
                  <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-1">Employee CPF (-)</p>
                  <p className="text-3xl font-light text-rose-600 dark:text-rose-400">${monthlyCalculations.employeeCpf.toFixed(2)}</p>
                </div>
                <div className="bg-white dark:bg-neutral-800 p-6 rounded-2xl shadow-sm border border-neutral-100 dark:border-neutral-700 transition-colors">
                  <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-1">Employer CPF (+)</p>
                  <p className="text-3xl font-light text-indigo-600 dark:text-indigo-400">${monthlyCalculations.employerCpf.toFixed(2)}</p>
                </div>
              </div>

              {/* Calendar Section */}
              <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-100 dark:border-neutral-700 overflow-hidden transition-colors">
                <div className="p-4 sm:p-6 border-b border-neutral-100 dark:border-neutral-700 flex items-center justify-between">
                  <h2 className="text-lg font-semibold flex items-center gap-2 dark:text-white">
                    <CalendarDays className="w-5 h-5 text-neutral-500 dark:text-neutral-400" />
                    {format(currentDate, 'MMMM yyyy')}
                  </h2>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setCurrentDate(subMonths(currentDate, 1))} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-full transition-colors dark:text-white">
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button onClick={() => setCurrentDate(new Date())} className="px-3 py-1 text-sm font-medium hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-full transition-colors dark:text-white">
                      Today
                    </button>
                    <button onClick={() => setCurrentDate(addMonths(currentDate, 1))} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-full transition-colors dark:text-white">
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </div>
                </div>
                
                <div className="p-4 sm:p-6">
                  <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-2">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                      <div key={day} className="text-center text-xs font-semibold text-neutral-400 uppercase tracking-wider py-2">
                        <span className="hidden sm:inline">{day}</span>
                        <span className="sm:hidden">{day.charAt(0)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1 sm:gap-2">
                    {daysInMonth.map(date => {
                      const dateStr = format(date, 'yyyy-MM-dd');
                      const dayShifts = shifts.filter(s => s.date === dateStr);
                      const isCurrentMonth = isSameMonth(date, currentDate);
                      const isTodayDate = isToday(date);
                      const holidayName = SG_PUBLIC_HOLIDAYS[dateStr];
                      
                      return (
                        <div
                          key={dateStr}
                          onClick={() => handleDateClick(date)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleDateClick(date);
                            }
                          }}
                          className={`
                            group min-h-[80px] sm:min-h-[100px] p-1 sm:p-2 rounded-xl border flex flex-col items-start justify-start transition-all text-left relative cursor-pointer
                            ${!isCurrentMonth ? 'opacity-40 bg-neutral-50 dark:bg-neutral-800/50 border-transparent' : 'bg-white dark:bg-neutral-800 border-neutral-100 dark:border-neutral-700 hover:border-indigo-300 dark:hover:border-indigo-500 hover:shadow-sm'}
                            ${isTodayDate ? 'ring-2 ring-indigo-500 ring-offset-1 sm:ring-offset-2 dark:ring-offset-neutral-900' : ''}
                            ${holidayName && dayShifts.length === 0 ? 'bg-amber-50/30 dark:bg-amber-900/10 border-amber-100 dark:border-amber-900/30' : ''}
                          `}
                        >
                          <div className="flex items-center justify-between w-full">
                            <span className={`text-xs sm:text-sm font-medium ${isTodayDate ? 'text-indigo-600 dark:text-indigo-400' : holidayName ? 'text-amber-600 dark:text-amber-500' : 'text-neutral-700 dark:text-neutral-300'}`}>
                              {format(date, 'd')}
                            </span>
                            {copiedShift && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const newShift: Shift = {
                                    ...(copiedShift as Shift),
                                    id: Math.random().toString(36).substr(2, 9),
                                    date: dateStr,
                                    isPublicHoliday: !!SG_PUBLIC_HOLIDAYS[dateStr]
                                  };
                                  setShifts(prev => [...prev, newShift]);
                                }}
                                className="opacity-0 group-hover:opacity-100 p-0.5 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/50 rounded transition-all"
                                title="Paste Shift"
                              >
                                <ClipboardPaste className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          
                          <div className="mt-1 w-full space-y-1 overflow-hidden">
                            {dayShifts.map(shift => {
                              const job = jobs.find(j => j.id === shift.jobId);
                              const color = job ? JOB_COLORS.find(c => c.id === job.colorId) || JOB_COLORS[0] : JOB_COLORS[0];
                              const hours = calculateShiftHours(shift.startTime, shift.endTime, shift.unpaidBreakHours);
                              
                              return (
                                <div key={shift.id} className={`text-[10px] sm:text-xs px-1.5 py-0.5 rounded ${color.lightBg} ${color.text} font-medium truncate flex items-center justify-between gap-1 group/shift`}>
                                  <div className="flex items-center gap-1 truncate">
                                    <div className={`w-1.5 h-1.5 rounded-full ${color.bg} shrink-0`}></div>
                                    <span className="truncate">{hours.toFixed(1)}h</span>
                                  </div>
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); setCopiedShift(shift); }}
                                    className="opacity-0 group-hover/shift:opacity-100 p-0.5 hover:bg-black/10 dark:hover:bg-white/20 rounded transition-opacity"
                                    title="Copy Shift"
                                  >
                                    <Copy className="w-3 h-3" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>

                          {holidayName && dayShifts.length === 0 && (
                            <div className="mt-auto w-full text-[10px] text-amber-600 font-medium leading-tight truncate hidden sm:block" title={holidayName}>
                              {holidayName}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          )}

          {activeTab === 'monthly_income' && (
            <div className="bg-white rounded-2xl shadow-sm border border-neutral-100 overflow-hidden">
              <div className="p-6 border-b border-neutral-100 flex items-center justify-between">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-indigo-600" />
                  Monthly Income Breakdown
                </h2>
                <div className="flex items-center gap-2">
                  <button onClick={() => setCurrentDate(subMonths(currentDate, 1))} className="p-2 hover:bg-neutral-100 rounded-full transition-colors">
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <span className="text-sm font-medium px-2">{format(currentDate, 'MMMM yyyy')}</span>
                  <button onClick={() => setCurrentDate(addMonths(currentDate, 1))} className="p-2 hover:bg-neutral-100 rounded-full transition-colors">
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="p-6">
                {jobs.filter(j => j.payrollCycle.type === 'end_of_month').length === 0 ? (
                  <div className="text-center py-8 text-neutral-500">No monthly jobs found.</div>
                ) : (
                  <div className="space-y-6">
                    {jobs.filter(j => j.payrollCycle.type === 'end_of_month').map(job => {
                      const color = JOB_COLORS.find(c => c.id === job.colorId) || JOB_COLORS[0];
                      const jobShifts = currentMonthPayrollShifts.filter(s => s.jobId === job.id);
                      
                      let jobGross = 0;
                      let totalHours = 0;
                      
                      jobShifts.forEach(shift => {
                        const date = parseISO(shift.date);
                        let rate = job.rates.weekday;
                        if (shift.isPublicHoliday) rate = job.rates.publicHoliday;
                        else if (isWeekend(date)) rate = job.rates.weekend;
                        
                        const hours = calculateShiftHours(shift.startTime, shift.endTime, shift.unpaidBreakHours);
                        jobGross += (hours * rate) + (shift.allowance || 0) - (shift.deduction || 0);
                        totalHours += hours;
                      });

                      const { employeeCpf, employerCpf } = calculateCpf(jobGross);

                      return (
                        <div key={job.id} className="border border-neutral-200 rounded-xl overflow-hidden">
                          <div className={`p-4 ${color.lightBg} border-b ${color.border} flex items-center justify-between`}>
                            <div className="flex items-center gap-2">
                              <div className={`w-3 h-3 rounded-full ${color.bg}`}></div>
                              <h3 className={`font-semibold ${color.text}`}>{job.title}</h3>
                            </div>
                            <span className={`text-sm font-medium ${color.text}`}>Cutoff: {job.payrollCycle.cutoffDay}</span>
                          </div>
                          <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div>
                              <p className="text-xs text-neutral-500 mb-1">Total Hours</p>
                              <p className="font-medium">{totalHours.toFixed(1)}h</p>
                            </div>
                            <div>
                              <p className="text-xs text-neutral-500 mb-1">Gross Pay</p>
                              <p className="font-medium">${jobGross.toFixed(2)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-neutral-500 mb-1">Employee CPF</p>
                              <p className="font-medium text-rose-600">-${employeeCpf.toFixed(2)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-neutral-500 mb-1">Net Pay</p>
                              <p className="font-semibold text-emerald-600">${(jobGross - employeeCpf).toFixed(2)}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'event_income' && (
            <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-100 dark:border-neutral-700 overflow-hidden transition-colors">
              <div className="p-6 border-b border-neutral-100 dark:border-neutral-700">
                <h2 className="text-lg font-semibold flex items-center gap-2 dark:text-white">
                  <FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                  Event / Gig Income Breakdown
                </h2>
              </div>
              <div className="p-6">
                {jobs.filter(j => j.payrollCycle.type === 'end_of_event').length === 0 ? (
                  <div className="text-center py-8 text-neutral-500 dark:text-neutral-400">No event-based jobs found.</div>
                ) : (
                  <div className="space-y-6">
                    {jobs.filter(j => j.payrollCycle.type === 'end_of_event').map(job => {
                      const color = JOB_COLORS.find(c => c.id === job.colorId) || JOB_COLORS[0];
                      const jobShifts = eventPayrollShifts.filter(s => s.jobId === job.id);
                      
                      let jobGross = 0;
                      let totalHours = 0;
                      
                      jobShifts.forEach(shift => {
                        const date = parseISO(shift.date);
                        let rate = job.rates.weekday;
                        if (shift.isPublicHoliday) rate = job.rates.publicHoliday;
                        else if (isWeekend(date)) rate = job.rates.weekend;
                        
                        const hours = calculateShiftHours(shift.startTime, shift.endTime, shift.unpaidBreakHours);
                        jobGross += (hours * rate) + (shift.allowance || 0) - (shift.deduction || 0);
                        totalHours += hours;
                      });

                      const { employeeCpf, employerCpf } = calculateCpf(jobGross);

                      return (
                        <div key={job.id} className="border border-neutral-200 dark:border-neutral-700 rounded-xl overflow-hidden">
                          <div className={`p-4 ${color.lightBg} dark:bg-neutral-800/50 border-b ${color.border} dark:border-neutral-700 flex items-center justify-between`}>
                            <div className="flex items-center gap-2">
                              <div className={`w-3 h-3 rounded-full ${color.bg}`}></div>
                              <h3 className={`font-semibold ${color.text} dark:text-white`}>{job.title}</h3>
                            </div>
                            <span className={`text-sm font-medium ${color.text} dark:text-neutral-400`}>
                              Event Ends: {job.payrollCycle.endDate ? format(parseISO(job.payrollCycle.endDate), 'MMM d, yyyy') : 'Not set'}
                            </span>
                          </div>
                          <div className="p-4 grid grid-cols-2 md:grid-cols-5 gap-4 dark:text-white">
                            <div>
                              <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">Total Hours</p>
                              <p className="font-medium">{totalHours.toFixed(1)}h</p>
                            </div>
                            <div>
                              <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">Gross Pay</p>
                              <p className="font-medium">${jobGross.toFixed(2)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">Employee CPF</p>
                              <p className="font-medium text-rose-600 dark:text-rose-400">-${employeeCpf.toFixed(2)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">Employer CPF</p>
                              <p className="font-medium text-indigo-600 dark:text-indigo-400">+${employerCpf.toFixed(2)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">Net Pay</p>
                              <p className="font-semibold text-emerald-600 dark:text-emerald-400">${(jobGross - employeeCpf).toFixed(2)}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'dashboard' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* Goal Tracking */}
              <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-100 dark:border-neutral-700 p-6 transition-colors">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold flex items-center gap-2 dark:text-white">
                    <Target className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    Monthly Income Goal
                  </h2>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-neutral-500 dark:text-neutral-400">Target: $</span>
                    <input 
                      type="number" 
                      value={monthlyGoal}
                      onChange={(e) => setMonthlyGoal(Number(e.target.value))}
                      className="w-24 px-2 py-1 text-sm bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-600 dark:text-neutral-300">Current Net Pay: <span className="font-semibold text-emerald-600 dark:text-emerald-400">${monthlyCalculations.netPay.toFixed(2)}</span></span>
                    <span className="text-neutral-600 dark:text-neutral-300">{Math.min(100, (monthlyCalculations.netPay / monthlyGoal) * 100).toFixed(1)}%</span>
                  </div>
                  <div className="w-full h-4 bg-neutral-100 dark:bg-neutral-700 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-indigo-500 transition-all duration-500 ease-out"
                      style={{ width: `${Math.min(100, (monthlyCalculations.netPay / monthlyGoal) * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 text-right">
                    {monthlyCalculations.netPay >= monthlyGoal ? 'Goal reached! 🎉' : `$${(monthlyGoal - monthlyCalculations.netPay).toFixed(2)} to go`}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Month over Month Bar Chart */}
                <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-100 dark:border-neutral-700 p-6 transition-colors">
                  <h2 className="text-lg font-semibold flex items-center gap-2 mb-6 dark:text-white">
                    <TrendingUp className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    Income Trend (Last 6 Months)
                  </h2>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dashboardAnalytics.monthlyTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDarkMode ? '#404040' : '#e5e5e5'} />
                        <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: isDarkMode ? '#a3a3a3' : '#737373' }} dy={10} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: isDarkMode ? '#a3a3a3' : '#737373' }} tickFormatter={(value) => `$${value}`} />
                        <Tooltip 
                          cursor={{ fill: isDarkMode ? '#262626' : '#f5f5f5' }}
                          contentStyle={{ backgroundColor: isDarkMode ? '#171717' : '#ffffff', borderColor: isDarkMode ? '#404040' : '#e5e5e5', borderRadius: '8px', color: isDarkMode ? '#ffffff' : '#000000' }}
                          formatter={(value: number) => [`$${value.toFixed(2)}`, 'Net Pay']}
                        />
                        <Bar dataKey="net" fill="#6366f1" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Earnings by Job Pie Chart */}
                <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-100 dark:border-neutral-700 p-6 transition-colors">
                  <h2 className="text-lg font-semibold flex items-center gap-2 mb-6 dark:text-white">
                    <Briefcase className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    Earnings by Job (This Month)
                  </h2>
                  <div className="h-64 w-full">
                    {dashboardAnalytics.jobEarnings.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={dashboardAnalytics.jobEarnings}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            paddingAngle={5}
                            dataKey="value"
                          >
                            {dashboardAnalytics.jobEarnings.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip 
                            contentStyle={{ backgroundColor: isDarkMode ? '#171717' : '#ffffff', borderColor: isDarkMode ? '#404040' : '#e5e5e5', borderRadius: '8px', color: isDarkMode ? '#ffffff' : '#000000' }}
                            formatter={(value: number) => [`$${value.toFixed(2)}`, 'Earnings']}
                          />
                          <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px', color: isDarkMode ? '#a3a3a3' : '#737373' }} />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex items-center justify-center text-neutral-500 dark:text-neutral-400 text-sm">
                        No earnings recorded for this month yet.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </main>

      {/* Shift Modal */}
      {isShiftModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-neutral-100 dark:border-neutral-800 flex items-start justify-between">
              <h3 className="text-lg font-semibold flex flex-col dark:text-white">
                <span>{selectedDate ? format(parseISO(selectedDate), 'EEEE, MMM d, yyyy') : ''}</span>
                {selectedDate && SG_PUBLIC_HOLIDAYS[selectedDate] && (
                  <span className="text-sm text-amber-600 dark:text-amber-500 font-medium mt-0.5">{SG_PUBLIC_HOLIDAYS[selectedDate]}</span>
                )}
              </h3>
              <button onClick={() => setIsShiftModalOpen(false)} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 mt-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {jobs.length === 0 ? (
                <div className="text-center py-4">
                  <p className="text-neutral-500 dark:text-neutral-400 mb-4">Please add a job first before adding shifts.</p>
                  <button onClick={() => { setIsShiftModalOpen(false); openNewJobModal(); }} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
                    Add Job
                  </button>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Job</label>
                    <select 
                      value={tempShift.jobId || ''} 
                      onChange={e => setTempShift({...tempShift, jobId: e.target.value})}
                      className="w-full px-3 py-2 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white"
                    >
                      {jobs.map(job => (
                        <option key={job.id} value={job.id}>{job.title}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Start Time</label>
                      <input 
                        type="time" 
                        value={tempShift.startTime || ''} 
                        onChange={e => setTempShift({...tempShift, startTime: e.target.value})} 
                        className="w-full px-3 py-2 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white" 
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">End Time</label>
                      <input 
                        type="time" 
                        value={tempShift.endTime || ''} 
                        onChange={e => setTempShift({...tempShift, endTime: e.target.value})} 
                        className="w-full px-3 py-2 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white" 
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Unpaid Break (Hours)</label>
                    <input 
                      type="number" 
                      min="0" 
                      step="0.5"
                      value={tempShift.unpaidBreakHours || 0} 
                      onChange={e => setTempShift({...tempShift, unpaidBreakHours: Number(e.target.value)})} 
                      className="w-full px-3 py-2 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white" 
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Allowance ($)</label>
                      <input 
                        type="number" 
                        min="0" 
                        step="0.01"
                        value={tempShift.allowance || ''} 
                        onChange={e => setTempShift({...tempShift, allowance: Number(e.target.value)})} 
                        className="w-full px-3 py-2 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white" 
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Deduction ($)</label>
                      <input 
                        type="number" 
                        min="0" 
                        step="0.01"
                        value={tempShift.deduction || ''} 
                        onChange={e => setTempShift({...tempShift, deduction: Number(e.target.value)})} 
                        className="w-full px-3 py-2 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white" 
                        placeholder="0.00"
                      />
                    </div>
                  </div>

                  <div className="bg-neutral-50 dark:bg-neutral-800/50 p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 flex items-center justify-between">
                    <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Total Paid Hours</span>
                    <span className="text-lg font-semibold text-indigo-600 dark:text-indigo-400">
                      {calculateShiftHours(tempShift.startTime, tempShift.endTime, tempShift.unpaidBreakHours).toFixed(2)}h
                    </span>
                  </div>

                  <label className="flex items-center gap-3 p-3 border border-neutral-200 dark:border-neutral-700 rounded-lg cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors">
                    <input 
                      type="checkbox" 
                      checked={tempShift.isPublicHoliday || false} 
                      onChange={e => setTempShift({...tempShift, isPublicHoliday: e.target.checked})}
                      className="w-4 h-4 text-indigo-600 rounded border-neutral-300 dark:border-neutral-600 dark:bg-neutral-700 focus:ring-indigo-500"
                    />
                    <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Mark as Public Holiday</span>
                  </label>
                </>
              )}
            </div>
            {jobs.length > 0 && (
              <div className="p-6 bg-neutral-50 dark:bg-neutral-800/50 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-between gap-3">
                {tempShift.id ? (
                  <button onClick={handleDeleteShift} className="px-4 py-2 text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded-lg transition-colors flex items-center gap-2">
                    <Trash2 className="w-4 h-4" /> Remove
                  </button>
                ) : <div></div>}
                <div className="flex gap-2">
                  <button onClick={() => setIsShiftModalOpen(false)} className="px-4 py-2 text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors">
                    Cancel
                  </button>
                  <button onClick={handleSaveShift} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-sm">
                    Save Shift
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Job Modal */}
      {isJobModalOpen && editingJob && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between">
              <h3 className="text-lg font-semibold dark:text-white">{editingJob.id ? 'Edit Job' : 'Add New Job'}</h3>
              <button onClick={() => setIsJobModalOpen(false)} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Job Title</label>
                <input 
                  type="text" 
                  value={editingJob.title} 
                  onChange={e => setEditingJob({...editingJob, title: e.target.value})} 
                  className="w-full px-3 py-2 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white" 
                  placeholder="e.g. Barista, Tutor"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">Color Label</label>
                <div className="flex flex-wrap gap-2">
                  {JOB_COLORS.map(color => (
                    <button
                      key={color.id}
                      onClick={() => setEditingJob({...editingJob, colorId: color.id})}
                      className={`w-8 h-8 rounded-full ${color.bg} flex items-center justify-center transition-transform ${editingJob.colorId === color.id ? 'ring-2 ring-offset-2 ring-neutral-800 dark:ring-neutral-200 scale-110' : 'hover:scale-110'}`}
                      title={color.id}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-medium text-neutral-700 dark:text-neutral-300 border-b border-neutral-100 dark:border-neutral-800 pb-2">Hourly Rates</h4>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1">Weekday</label>
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500 dark:text-neutral-400 text-sm">$</span>
                      <input type="number" value={editingJob.rates.weekday} onChange={e => setEditingJob({...editingJob, rates: {...editingJob.rates, weekday: Number(e.target.value)}})} className="w-full pl-6 pr-2 py-1.5 text-sm bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none dark:text-white" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1">Weekend</label>
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500 dark:text-neutral-400 text-sm">$</span>
                      <input type="number" value={editingJob.rates.weekend} onChange={e => setEditingJob({...editingJob, rates: {...editingJob.rates, weekend: Number(e.target.value)}})} className="w-full pl-6 pr-2 py-1.5 text-sm bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none dark:text-white" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1">Holiday</label>
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500 dark:text-neutral-400 text-sm">$</span>
                      <input type="number" value={editingJob.rates.publicHoliday} onChange={e => setEditingJob({...editingJob, rates: {...editingJob.rates, publicHoliday: Number(e.target.value)}})} className="w-full pl-6 pr-2 py-1.5 text-sm bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none dark:text-white" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-medium text-neutral-700 dark:text-neutral-300 border-b border-neutral-100 dark:border-neutral-800 pb-2">Payroll Cycle</h4>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setEditingJob({...editingJob, payrollCycle: { type: 'end_of_month', cutoffDay: 31 }})}
                    className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${editingJob.payrollCycle.type === 'end_of_month' ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300' : 'bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700'}`}
                  >
                    End of Month
                  </button>
                  <button
                    onClick={() => setEditingJob({...editingJob, payrollCycle: { type: 'end_of_event', endDate: format(new Date(), 'yyyy-MM-dd') }})}
                    className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${editingJob.payrollCycle.type === 'end_of_event' ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300' : 'bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700'}`}
                  >
                    End of Event
                  </button>
                </div>

                {editingJob.payrollCycle.type === 'end_of_month' ? (
                  <div>
                    <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1">Cutoff Day (1-31)</label>
                    <input 
                      type="number" 
                      min="1" 
                      max="31"
                      value={editingJob.payrollCycle.cutoffDay || 31} 
                      onChange={e => setEditingJob({...editingJob, payrollCycle: { ...editingJob.payrollCycle, cutoffDay: Number(e.target.value) }})} 
                      className="w-full px-3 py-2 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white" 
                    />
                    <p className="text-[10px] text-neutral-500 dark:text-neutral-400 mt-1">Leave as 31 for the last day of the month.</p>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1">Event End Date</label>
                    <input 
                      type="date" 
                      value={editingJob.payrollCycle.endDate || ''} 
                      onChange={e => setEditingJob({...editingJob, payrollCycle: { ...editingJob.payrollCycle, endDate: e.target.value }})} 
                      className="w-full px-3 py-2 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-white" 
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="p-6 bg-neutral-50 dark:bg-neutral-800/50 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-between gap-3">
              {editingJob.id ? (
                <button onClick={() => handleDeleteJob(editingJob.id)} className="px-4 py-2 text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded-lg transition-colors flex items-center gap-2">
                  <Trash2 className="w-4 h-4" /> Delete Job
                </button>
              ) : <div></div>}
              <div className="flex gap-2">
                <button onClick={() => setIsJobModalOpen(false)} className="px-4 py-2 text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors">
                  Cancel
                </button>
                <button onClick={handleSaveJob} disabled={!editingJob.title} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors shadow-sm">
                  Save Job
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

