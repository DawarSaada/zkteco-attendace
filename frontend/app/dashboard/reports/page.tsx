'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  AlertTriangle,
  CalendarDays,
  Clock,
  Download,
  Edit3,
  FileSpreadsheet,
  FileText,
  Info,
  ListChecks,
  RefreshCw,
  Timer,
  Trash2,
} from 'lucide-react';
import { ApprovalsInbox } from '@/components/ApprovalsInbox';
import { ExceptionsInbox } from '@/components/ExceptionsInbox';
import { useLanguage } from '@/components/LanguageContext';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { BarChart } from '@/components/ui/Charts';
import { MetricTile } from '@/components/ui/StatCard';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { SortHeader } from '@/components/SortHeader';
import {
  Table,
  TableCard,
  TableMessageRow,
  TableScroll,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { calculateMinutes, formatPunchTime, formatTotalHours } from '@/lib/utils/formatTime';
import type { TranslationKey } from '@/lib/i18n/translations';
import type { BadgeTone } from '@/components/ui/Badge';
import type { DailyAttendanceSummary, Device, Employee, RawPunch } from '@/types';
import type { CSSProperties } from 'react';

type RangeType = 'monthly' | 'payroll' | 'weekly' | 'daily' | 'custom';
type ReportPackType = 'timecard' | 'exceptions' | 'absence' | 'overtime' | 'rollup' | 'late';

/** The report pack served by /api/reports/run/[type] (Phase 5). */
const REPORT_OPTIONS: { value: ReportPackType; key: TranslationKey }[] = [
  { value: 'timecard', key: 'rpt_timecard' },
  { value: 'exceptions', key: 'rpt_exceptions' },
  { value: 'absence', key: 'rpt_absence' },
  { value: 'overtime', key: 'rpt_overtime' },
  { value: 'rollup', key: 'rpt_rollup' },
  { value: 'late', key: 'rpt_late' },
];

/** Visual tone per engine status (Phase 1). */
const STATUS_TONE: Record<string, BadgeTone> = {
  present: 'success',
  late: 'warning',
  absent: 'danger',
  incomplete: 'accent',
  leave: 'info',
  holiday: 'brand',
  off: 'neutral',
};

const STATUS_LABEL: Record<string, TranslationKey> = {
  present: 'status_present',
  late: 'status_late',
  absent: 'status_absent',
  incomplete: 'status_incomplete',
  leave: 'status_leave',
  holiday: 'status_holiday',
  off: 'status_off',
};

/** `90` → `1h 30m`; zero renders as an em dash so exceptions stand out. */
function formatMinutes(minutes?: number | null): string {
  const value = Math.max(0, Math.round(minutes ?? 0));
  if (value === 0) return '—';
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return hours > 0 ? `${hours}h ${rest}m` : `${rest}m`;
}

function isExceptionRow(row: DailyAttendanceSummary): boolean {
  if ((row.early_leave_minutes ?? 0) > 0) return true;
  return row.status === 'late' || row.status === 'absent' || row.status === 'incomplete';
}

function generateDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (current <= last) {
    dates.push(current.toISOString().substring(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function compareReports(
  a: DailyAttendanceSummary,
  b: DailyAttendanceSummary,
  key: string,
): number {
  switch (key) {
    case 'employee':
      return (a.full_name || `Employee ${a.pin}`).localeCompare(
        b.full_name || `Employee ${b.pin}`,
      );
    case 'date':
      return a.punch_date.localeCompare(b.punch_date);
    case 'shift':
      return (a.shift_start || '').localeCompare(b.shift_start || '');
    case 'check_in':
      return (
        (a.check_in ? new Date(a.check_in).getTime() : 0) -
        (b.check_in ? new Date(b.check_in).getTime() : 0)
      );
    case 'check_out':
      return (
        (a.check_out ? new Date(a.check_out).getTime() : 0) -
        (b.check_out ? new Date(b.check_out).getTime() : 0)
      );
    case 'duration':
      return (
        calculateMinutes(a.check_in, a.check_out) -
        calculateMinutes(b.check_in, b.check_out)
      );
    case 'late':
      return (a.late_minutes ?? 0) - (b.late_minutes ?? 0);
    case 'overtime':
      return (a.overtime_minutes ?? 0) - (b.overtime_minutes ?? 0);
    default:
      return 0;
  }
}

/**
 * The window a cycle preset covers. Payroll is the 26th → 25th window rather than a
 * calendar month; `custom` has no preset, so the user's own dates are kept.
 */
function rangeFor(type: RangeType, today: Date): { start: string; end: string } | null {
  switch (type) {
    case 'daily': {
      const value = format(today, 'yyyy-MM-dd');
      return { start: value, end: value };
    }
    case 'weekly':
      return {
        start: format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
        end: format(endOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
      };
    case 'payroll': {
      const previousMonth = subMonths(today, 1);
      return {
        start: `${previousMonth.getFullYear()}-${String(previousMonth.getMonth() + 1).padStart(2, '0')}-26`,
        end: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-25`,
      };
    }
    case 'monthly':
      return {
        start: format(startOfMonth(today), 'yyyy-MM-dd'),
        end: format(endOfMonth(today), 'yyyy-MM-dd'),
      };
    default:
      return null;
  }
}

export default function ReportsPage() {
  const [rangeType, setRangeType] = useState<RangeType>('monthly');
  const [startDate, setStartDate] = useState(() =>
    format(startOfMonth(new Date()), 'yyyy-MM-dd'),
  );
  const [endDate, setEndDate] = useState(() =>
    format(endOfMonth(new Date()), 'yyyy-MM-dd'),
  );
  const [employeesList, setEmployeesList] = useState<Employee[]>([]);
  const [devicesList, setDevicesList] = useState<Device[]>([]);
  const [filterPin, setFilterPin] = useState('all');
  const [filterBranch, setFilterBranch] = useState('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [reports, setReports] = useState<DailyAttendanceSummary[]>([]);
  /**
   * Rows in the current range the engine has not recomputed yet. They come from
   * the punch log, which has no late/overtime figures — so the page says so
   * rather than letting those cells look like a genuine zero.
   */
  const [derivedRows, setDerivedRows] = useState(0);

  const [sortKey, setSortKey] = useState<string>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [onlyExceptions, setOnlyExceptions] = useState(false);
  /** Bumped after a punch edit so the exception inbox reloads. */
  const [inboxKey, setInboxKey] = useState(0);
  const [reportType, setReportType] = useState<ReportPackType>('timecard');
  const [reportFormat, setReportFormat] = useState('xlsx');

  const [selectedRow, setSelectedRow] = useState<{
    pin: string;
    date: string;
    name: string;
  } | null>(null);
  const [rawPunches, setRawPunches] = useState<RawPunch[]>([]);
  const [newPunchTime, setNewPunchTime] = useState('09:00');
  const [newPunchStatus, setNewPunchStatus] = useState('0');
  const [isSavingPunch, setIsSavingPunch] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RawPunch | null>(null);
  const [isDeletingPunch, setIsDeletingPunch] = useState(false);

  const [editingPunch, setEditingPunch] = useState<{
    id?: string;
    oldTimestamp: string;
    time: string;
    status: string;
  } | null>(null);

  const { t } = useLanguage();
  const toast = useToast();

  useEffect(() => {
    void (async () => {
      try {
        const [employeesRes, devicesRes] = await Promise.all([
          fetch('/api/employees'),
          fetch('/api/devices'),
        ]);
        if (employeesRes.ok) {
          const data = await employeesRes.json();
          setEmployeesList(Array.isArray(data) ? data : []);
        }
        if (devicesRes.ok) {
          const data = await devicesRes.json();
          setDevicesList(Array.isArray(data) ? data : []);
        }
      } catch {
        // Filter options are non-critical; the table still renders without them.
      }
    })();
  }, []);

  // The loader only clears `loading`; callers that re-run it (filters, refresh,
  // mutations) raise the flag from their own handler so the mount pass does not
  // schedule a redundant render.
  const fetchReports = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/reports/daily?start=${startDate}&end=${endDate}&pin=${filterPin}&branch=${filterBranch}`,
      );
      const data = await res.json();
      if (res.ok) {
        setReports(Array.isArray(data) ? data : []);
        setDerivedRows(Number(res.headers.get('X-Report-Derived-Rows') ?? 0) || 0);
      } else {
        setReports([]);
        setDerivedRows(0);
        setErrorMsg(data.error || t('report_error_fetch'));
      }
    } catch {
      setReports([]);
      setDerivedRows(0);
      setErrorMsg(t('report_error_fetch'));
    } finally {
      setIsLoading(false);
    }
  }, [startDate, endDate, filterPin, filterBranch, t]);

  useEffect(() => {
    // Deferred off the effect path: the loader sets state, and calling it
    // synchronously here is what react-hooks/set-state-in-effect flags.
    void Promise.resolve().then(fetchReports);
  }, [fetchReports]);

  /** Raises the loading flag from the caller, not from the effect. */
  const beginReload = () => {
    setIsLoading(true);
    setErrorMsg('');
  };

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortOrder('asc');
    }
  };

  const visibleReports = useMemo(
    () => (onlyExceptions ? reports.filter(isExceptionRow) : reports),
    [reports, onlyExceptions],
  );

  const sortedReports = useMemo(
    () =>
      [...visibleReports].sort((a, b) =>
        sortOrder === 'asc'
          ? compareReports(a, b, sortKey)
          : -compareReports(a, b, sortKey),
      ),
    [visibleReports, sortKey, sortOrder],
  );

  const exceptionCount = useMemo(
    () => reports.filter(isExceptionRow).length,
    [reports],
  );

  const fetchRawPunches = useCallback(
    async (pin: string, date: string) => {
      try {
        const res = await fetch(`/api/attendance/manual?pin=${pin}&date=${date}`);
        const data = await res.json();
        if (res.ok) {
          setRawPunches(Array.isArray(data) ? data : []);
        } else {
          toast.error(data.error || t('punch_load_failed'));
        }
      } catch {
        toast.error(t('punch_load_failed'));
      }
    },
    [t, toast],
  );

  const openPunchesModal = (pin: string, date: string, name: string) => {
    setSelectedRow({ pin, date, name });
    setEditingPunch(null);
    setRawPunches([]);
    void fetchRawPunches(pin, date);
  };

  const deletePunch = async () => {
    if (!pendingDelete || !selectedRow) return;
    setIsDeletingPunch(true);

    try {
      const res = await fetch('/api/attendance/manual', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: pendingDelete.id,
          pin: selectedRow.pin,
          timestamp: pendingDelete.timestamp,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.pending) toast.warning(t('punch_pending_approval'));
        else toast.success(t('punch_deleted_success'));
        setPendingDelete(null);
        await fetchRawPunches(selectedRow.pin, selectedRow.date);
        await fetchReports();
        setInboxKey((prev) => prev + 1);
      } else {
        toast.error(data.error || t('punch_delete_failed'));
      }
    } catch {
      toast.error(t('punch_delete_failed'));
    } finally {
      setIsDeletingPunch(false);
    }
  };

  const addManualPunch = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedRow) return;
    setIsSavingPunch(true);

    try {
      const timestamp = new Date(
        `${selectedRow.date}T${newPunchTime}:00Z`,
      ).toISOString();

      const res = await fetch('/api/attendance/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pin: selectedRow.pin,
          timestamp,
          status: newPunchStatus,
          verify_mode: '0',
          work_code: 0,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.pending) toast.warning(t('punch_pending_approval'));
        else toast.success(t('punch_added_success'));
        await fetchRawPunches(selectedRow.pin, selectedRow.date);
        await fetchReports();
        setInboxKey((prev) => prev + 1);
      } else {
        toast.error(data.error || t('punch_add_failed'));
      }
    } catch {
      toast.error(t('punch_add_failed'));
    } finally {
      setIsSavingPunch(false);
    }
  };

  const handleSavePunchEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedRow || !editingPunch) return;
    setIsSavingPunch(true);

    try {
      const newIso = new Date(
        `${selectedRow.date}T${editingPunch.time}:00Z`,
      ).toISOString();

      const res = await fetch('/api/attendance/manual', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingPunch.id,
          pin: selectedRow.pin,
          old_timestamp: editingPunch.oldTimestamp,
          timestamp: newIso,
          status: editingPunch.status,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.pending) toast.warning(t('punch_pending_approval'));
        else toast.success(t('punch_updated_success'));
        setEditingPunch(null);
        await fetchRawPunches(selectedRow.pin, selectedRow.date);
        await fetchReports();
        setInboxKey((prev) => prev + 1);
      } else {
        toast.error(data.error || t('punch_update_failed'));
      }
    } catch {
      toast.error(t('punch_update_failed'));
    } finally {
      setIsSavingPunch(false);
    }
  };

  /** Triggers the export download without navigating the SPA away. */
  const handleExportExcel = () => {
    const url = `/api/reports/export?start=${startDate}&end=${endDate}&pin=${filterPin}&branch=${filterBranch}`;
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  /** Downloads the Phase 5 report pack for the current range and filters. */
  const handleExportReportPack = () => {
    const url =
      `/api/reports/run/${reportType}/export?format=${reportFormat}` +
      `&from=${startDate}&to=${endDate}&pin=${filterPin}&branch=${filterBranch}`;
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const handleExportPDF = async () => {
    setIsExportingPdf(true);
    // Yield a frame so the button can show its loading state before jsPDF
    // blocks the main thread generating every timecard.
    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      const allDates = generateDateRange(startDate, endDate);

      const employeeMap = new Map<
        string,
        { pin: string; name: string; department: string; branch: string }
      >();

      employeesList.forEach((employee) => {
        if (filterPin !== 'all' && employee.pin !== filterPin) return;
        if (filterBranch !== 'all' && employee.branch !== filterBranch) return;
        employeeMap.set(employee.pin, {
          pin: employee.pin,
          name: employee.full_name || `PIN ${employee.pin}`,
          department: employee.department || '',
          branch: employee.branch || '',
        });
      });

      reports.forEach((row) => {
        if (filterPin !== 'all' && row.pin !== filterPin) return;
        if (filterBranch !== 'all' && row.branch !== filterBranch) return;
        if (!employeeMap.has(row.pin)) {
          employeeMap.set(row.pin, {
            pin: row.pin,
            name: row.full_name || `PIN ${row.pin}`,
            department: row.department || '',
            branch: row.branch || '',
          });
        }
      });

      const employees = Array.from(employeeMap.values());
      if (employees.length === 0) {
        toast.warning(t('pdf_no_employees'));
        return;
      }

      const attendanceMap = new Map<string, DailyAttendanceSummary>();
      reports.forEach((row) => {
        attendanceMap.set(`${row.pin}_${row.punch_date}`, row);
      });

      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

      employees.forEach((employee, index) => {
        if (index > 0) doc.addPage('a4', 'landscape');

        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('Monthly Employee Time Card Report', 10, 8.5);

        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.text(`Period: ${startDate} to ${endDate}`, 10, 13);

        const deptText = employee.department ? ` | Dept: ${employee.department}` : '';
        const branchText = employee.branch ? ` | Branch: ${employee.branch}` : '';
        doc.setFont('helvetica', 'bold');
        doc.text(
          `Employee ID: ${employee.pin} | Name: ${employee.name}${deptText}${branchText}`,
          10,
          17,
        );

        const tableColumn = [
          'Date',
          'Day',
          'Schedule In',
          'Schedule Out',
          'Clock In',
          'Clock Out',
          'Total Hours',
          'Device',
          'Branch',
        ];

        let totalMinutes = 0;
        let daysPresent = 0;

        const tableRows = allDates.map((dateStr) => {
          const weekday = format(new Date(`${dateStr}T00:00:00Z`), 'EEE');
          const log = attendanceMap.get(`${employee.pin}_${dateStr}`);

          if (log && (log.check_in || log.check_out)) {
            daysPresent += 1;
            totalMinutes += calculateMinutes(log.check_in, log.check_out);

            const hasBothPunches =
              log.check_in && log.check_out && log.check_in !== log.check_out;

            return [
              dateStr,
              weekday,
              log.shift_start ? log.shift_start.substring(0, 5) : '--:--',
              log.shift_end ? log.shift_end.substring(0, 5) : '--:--',
              formatPunchTime(log.check_in),
              hasBothPunches ? formatPunchTime(log.check_out) : '',
              hasBothPunches ? formatTotalHours(log.check_in, log.check_out) : '0h 0m',
              log.device_name || '-',
              log.branch || employee.branch || '-',
            ];
          }

          return [dateStr, weekday, '--:--', '--:--', '', '', '', '', employee.branch || '-'];
        });

        tableRows.push([
          'Summary:',
          `Days: ${daysPresent}`,
          '',
          '',
          'Total Hours:',
          '',
          `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`,
          '',
          '',
        ]);

        autoTable(doc, {
          head: [tableColumn],
          body: tableRows,
          startY: 19,
          margin: { top: 19, bottom: 5, left: 8, right: 8 },
          theme: 'grid',
          pageBreak: 'avoid',
          styles: {
            fontSize: 6.3,
            cellPadding: 0.65,
            minCellHeight: 3.4,
            overflow: 'ellipsize',
            lineColor: [210, 210, 210],
            lineWidth: 0.1,
            textColor: [30, 30, 30],
          },
          headStyles: {
            fillColor: [240, 244, 248],
            textColor: [20, 20, 20],
            fontStyle: 'bold',
            fontSize: 6.8,
            cellPadding: 0.8,
          },
          columnStyles: {
            0: { cellWidth: 24 },
            1: { cellWidth: 14 },
            2: { cellWidth: 22 },
            3: { cellWidth: 22 },
            4: { cellWidth: 22 },
            5: { cellWidth: 22 },
            6: { cellWidth: 24 },
            7: { cellWidth: 'auto' },
            8: { cellWidth: 'auto' },
          },
        });
      });

      doc.save(`TimeCards_${startDate}_to_${endDate}.pdf`);
      toast.success(t('pdf_export_success'));
    } catch {
      toast.error(t('request_failed'));
    } finally {
      setIsExportingPdf(false);
    }
  };

  const uniqueBranches = useMemo(() => {
    const set = new Set(
      [
        ...employeesList.map((employee) => employee.branch),
        ...devicesList.map((device) => device.branch),
      ].filter(Boolean) as string[],
    );
    return Array.from(set);
  }, [employeesList, devicesList]);

  const combinedEmployees = useMemo(() => {
    const map = new Map<string, { pin: string; full_name: string; branch?: string }>();
    employeesList.forEach((employee) => {
      map.set(employee.pin, {
        pin: employee.pin,
        full_name: employee.full_name || '',
        branch: employee.branch || '',
      });
    });
    reports.forEach((row) => {
      if (!map.has(row.pin)) {
        map.set(row.pin, {
          pin: row.pin,
          full_name: row.full_name || '',
          branch: row.branch || '',
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => {
      if (a.full_name && b.full_name) return a.full_name.localeCompare(b.full_name);
      return a.pin.localeCompare(b.pin, undefined, { numeric: true });
    });
  }, [employeesList, reports]);

  const isUnpairedDelete = rawPunches.length === 2;

  /** Minutes worked per calendar day across the filtered range. */
  const dailyHours = useMemo(() => {
    const buckets = new Map<string, number>();
    reports.forEach((row) => {
      const minutes = calculateMinutes(row.check_in, row.check_out);
      if (minutes <= 0) return;
      buckets.set(row.punch_date, (buckets.get(row.punch_date) || 0) + minutes);
    });
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, minutes]) => ({
        label: date.slice(8, 10),
        value: Math.round((minutes / 60) * 10) / 10,
        hint: date,
      }));
  }, [reports]);

  const totalMinutes = useMemo(
    () =>
      reports.reduce(
        (sum, row) => sum + Math.max(0, calculateMinutes(row.check_in, row.check_out)),
        0,
      ),
    [reports],
  );
  const totalHours = totalMinutes / 60;
  // Averaged over employee-days that actually recorded time, so empty rows in
  // the range do not drag the figure down.
  const workedRecords = reports.filter(
    (row) => calculateMinutes(row.check_in, row.check_out) > 0,
  ).length;
  const avgHours = workedRecords > 0 ? totalHours / workedRecords : 0;
  const missingCheckouts = reports.filter(
    (row) => row.check_in && (!row.check_out || row.check_out === row.check_in),
  ).length;

  return (
    <div className="animate-in fade-in space-y-6 duration-200">
      <PageHeader
        title={t('reports_title')}
        description={t('reports_subtitle')}
        actions={
          <>
            <Button
              variant="success"
              icon={FileSpreadsheet}
              onClick={handleExportExcel}
            >
              {t('btn_export_excel')}
            </Button>
            <Button
              variant="danger"
              icon={FileText}
              onClick={() => void handleExportPDF()}
              loading={isExportingPdf}
              loadingLabel={t('saving')}
            >
              {t('btn_export_pdf')}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                beginReload();
                void fetchReports();
              }}
              aria-label={t('refresh')}
              title={t('refresh')}
            >
              <RefreshCw size={16} />
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label={t('report_records_label')}
          value={sortedReports.length}
          icon={ListChecks}
          tone="aurora"
        />
        <MetricTile
          label={t('report_total_hours_label')}
          value={totalHours}
          decimals={1}
          suffix={t('report_hours_suffix')}
          icon={Clock}
          tone="success"
        />
        <MetricTile
          label={t('report_avg_hours_label')}
          value={avgHours}
          decimals={1}
          suffix={t('report_hours_suffix')}
          icon={Timer}
          tone="info"
        />
        <MetricTile
          label={t('report_missing_checkout_label')}
          value={missingCheckouts}
          icon={AlertTriangle}
          tone={missingCheckouts > 0 ? 'warning' : 'success'}
        />
      </div>

      {derivedRows > 0 && (
        <p className="flex items-start gap-2.5 rounded-xl border border-warning-line bg-warning-soft px-4 py-3 text-xs font-medium text-warning">
          <Info size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          {t('report_source_note')}
        </p>
      )}

      {dailyHours.length > 1 && (
        <Card className="sheen-top space-y-4 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold text-ink">
                {t('report_daily_hours_title')}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                {t('report_daily_hours_desc')}
              </p>
            </div>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-brand-line bg-brand-soft text-brand">
              <CalendarDays size={18} aria-hidden="true" />
            </span>
          </div>
          <BarChart
            data={dailyHours}
            height={150}
            suffix={t('report_hours_suffix')}
          />
        </Card>
      )}

      {/* Filters */}
      <Card className="sheen-top flex flex-wrap items-end gap-4 p-5">
        <p className="w-full text-[10px] font-bold tracking-[0.12em] text-ink-subtle uppercase">
          {t('report_filter_label')}
        </p>
        <Field label={t('filter_branch')} className="min-w-[11rem] flex-1">
          <Select
            value={filterBranch}
            onChange={(event) => {
              beginReload();
              setFilterBranch(event.target.value);
            }}
          >
            <option value="all">{t('filter_all_branches')}</option>
            {uniqueBranches.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('filter_employee')} className="min-w-[13rem] flex-1">
          <Select
            value={filterPin}
            onChange={(event) => {
              beginReload();
              setFilterPin(event.target.value);
            }}
          >
            <option value="all">
              {t('filter_all_employees')} ({combinedEmployees.length})
            </option>
            {combinedEmployees
              .filter(
                (employee) => filterBranch === 'all' || employee.branch === filterBranch,
              )
              .map((employee) => (
                <option key={employee.pin} value={employee.pin}>
                  {employee.full_name
                    ? `${employee.full_name} (${employee.pin})`
                    : `PIN: ${employee.pin}`}
                </option>
              ))}
          </Select>
        </Field>

        <Field label={t('report_cycle_label')} className="min-w-[10rem]">
          <Select
            value={rangeType}
            onChange={(event) => {
              const next = event.target.value as RangeType;
              beginReload();
              setRangeType(next);
              // Applied here rather than from an effect on `rangeType`, which would
              // set state during the effect pass and add a second render.
              const range = rangeFor(next, new Date());
              if (range) {
                setStartDate(range.start);
                setEndDate(range.end);
              }
            }}
          >
            <option value="monthly">{t('range_monthly')}</option>
            <option value="payroll">{t('range_payroll')}</option>
            <option value="weekly">{t('range_weekly')}</option>
            <option value="daily">{t('range_daily')}</option>
            <option value="custom">{t('range_custom')}</option>
          </Select>
        </Field>

        <Field
          label={t('report_rows_label')}
          hint={t('report_exceptions_hint')}
          className="min-w-[12rem]"
        >
          <Select
            value={onlyExceptions ? 'exceptions' : 'all'}
            onChange={(event) => setOnlyExceptions(event.target.value === 'exceptions')}
          >
            <option value="all">{t('report_all_rows')}</option>
            <option value="exceptions">
              {t('report_only_exceptions')} ({exceptionCount})
            </option>
          </Select>
        </Field>

        {rangeType === 'custom' && (
          <>
            <Field label={t('col_date')} className="min-w-[9rem]">
              <Input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </Field>
            <Field label={t('date_to')} className="min-w-[9rem]">
              <Input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </Field>
          </>
        )}
      </Card>

      {/* Phase 5 report pack — every report reconciles to `attendance_days`. */}
      <Card className="sheen-top flex flex-wrap items-end gap-4 p-5">
        <p className="w-full text-[10px] font-bold tracking-[0.12em] text-ink-subtle uppercase">
          {t('reportpack_title')}
        </p>
        <Field label={t('reportpack_type')} className="min-w-[14rem] flex-1">
          <Select
            value={reportType}
            onChange={(event) => setReportType(event.target.value as ReportPackType)}
          >
            {REPORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.key)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('reportpack_format')} className="min-w-[9rem]">
          <Select value={reportFormat} onChange={(event) => setReportFormat(event.target.value)}>
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="pdf">PDF</option>
            <option value="csv">CSV</option>
          </Select>
        </Field>
        <Button variant="primary" icon={Download} onClick={handleExportReportPack}>
          {t('reportpack_download')}
        </Button>
        <p className="w-full text-[11px] leading-relaxed text-ink-subtle">
          {t('reportpack_hint')}
        </p>
      </Card>

      {errorMsg && (
        <p
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-xs font-medium text-danger"
        >
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          {errorMsg}
        </p>
      )}

      <TableCard>
        <TableScroll>
          <Table caption={t('reports_title')} className="min-w-[74rem]">
            <THead>
              <tr>
                <SortHeader
                  columnKey="employee"
                  label={t('col_employee')}
                  activeKey={sortKey}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
                <SortHeader
                  columnKey="date"
                  label={t('col_date')}
                  activeKey={sortKey}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
                <SortHeader
                  columnKey="shift"
                  label={t('col_shift_schedule')}
                  activeKey={sortKey}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
                <SortHeader
                  columnKey="check_in"
                  label={t('col_check_in')}
                  activeKey={sortKey}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
                <SortHeader
                  columnKey="check_out"
                  label={t('col_check_out')}
                  activeKey={sortKey}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
                <SortHeader
                  columnKey="duration"
                  label={t('col_duration')}
                  activeKey={sortKey}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
                <Th align="center">{t('col_attendance_status')}</Th>
                <SortHeader
                  columnKey="late"
                  label={t('col_late')}
                  activeKey={sortKey}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
                <Th align="end">{t('col_early_leave')}</Th>
                <SortHeader
                  columnKey="overtime"
                  label={t('col_overtime')}
                  activeKey={sortKey}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
                <Th align="end">{t('col_audit_punches')}</Th>
              </tr>
            </THead>

            <TBody>
              {isLoading && (
                <TableMessageRow colSpan={11}>
                  <TableSkeleton rows={7} columns={11} />
                </TableMessageRow>
              )}

              {!isLoading &&
                sortedReports.map((row, index) => {
                  const hasBothPunches =
                    row.check_in && row.check_out && row.check_in !== row.check_out;
                  const totalHours = hasBothPunches
                    ? formatTotalHours(row.check_in, row.check_out)
                    : '0h 0m';

                  const shiftStr =
                    row.shift_start && row.shift_end
                      ? `${row.shift_start.substring(0, 5)} – ${row.shift_end.substring(0, 5)}`
                      : t('unassigned');

                  return (
                    <Tr
                      key={`${row.pin}-${row.punch_date}-${index}`}
                      className="stagger-in"
                      style={{ '--ui-i': Math.min(index, 12) } as CSSProperties}
                    >
                      <Td>
                        <p className="font-semibold text-ink">
                          {row.full_name || `Employee ${row.pin}`}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-subtle" data-numeric>
                          PIN: {row.pin}
                          {row.branch ? ` • ${row.branch}` : ''}
                        </p>
                      </Td>
                      <Td numeric className="font-mono text-ink-muted">
                        {row.punch_date}
                      </Td>
                      <Td numeric className="font-mono text-xs text-ink-subtle">
                        {shiftStr}
                      </Td>
                      <Td numeric className="font-mono font-bold text-success">
                        {formatPunchTime(row.check_in)}
                      </Td>
                      <Td numeric className="font-mono font-bold text-brand">
                        {hasBothPunches ? formatPunchTime(row.check_out) : '--:--'}
                      </Td>
                      <Td numeric className="font-mono font-semibold text-ink">
                        {totalHours}
                      </Td>
                      <Td align="center">
                        {row.status ? (
                          <Badge
                            tone={STATUS_TONE[row.status] ?? 'neutral'}
                            size="sm"
                            dot
                          >
                            {t(STATUS_LABEL[row.status] ?? 'col_attendance_status')}
                          </Badge>
                        ) : (
                          <span className="text-ink-subtle">—</span>
                        )}
                      </Td>
                      <Td numeric className="font-mono font-semibold text-warning">
                        {formatMinutes(row.late_minutes)}
                      </Td>
                      <Td numeric className="font-mono text-ink-muted">
                        {formatMinutes(row.early_leave_minutes)}
                      </Td>
                      <Td numeric className="font-mono font-semibold text-accent">
                        {formatMinutes(row.overtime_minutes)}
                      </Td>
                      <Td align="end">
                        <Button
                          variant="subtle"
                          size="sm"
                          icon={Edit3}
                          onClick={() =>
                            openPunchesModal(
                              row.pin,
                              row.punch_date,
                              row.full_name || row.pin,
                            )
                          }
                        >
                          {t('btn_manage_punches')}
                        </Button>
                      </Td>
                    </Tr>
                  );
                })}

              {!isLoading && sortedReports.length === 0 && !errorMsg && (
                <TableMessageRow colSpan={11}>
                  <EmptyState
                    icon={FileSpreadsheet}
                    title={t('no_reports_found')}
                    description={t('punch_pending')}
                  />
                </TableMessageRow>
              )}
            </TBody>
          </Table>
        </TableScroll>
      </TableCard>

      {/* Punches & audit trail */}
      <Modal
        open={selectedRow !== null}
        onClose={() => setSelectedRow(null)}
        title={t('modal_manual_title')}
        description={
          selectedRow
            ? `${selectedRow.name} • PIN: ${selectedRow.pin} • ${selectedRow.date}`
            : undefined
        }
        closeLabel={t('close')}
        size="xl"
        footer={
          <Button variant="secondary" onClick={() => setSelectedRow(null)}>
            {t('done')}
          </Button>
        }
      >
        <div className="space-y-5">
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold tracking-wider text-ink-subtle uppercase">
                {t('punches_title')}
              </h3>
              <Badge tone="neutral" size="sm">
                {rawPunches.length}
              </Badge>
            </div>

            <div className="overflow-hidden rounded-xl border border-line">
              <TableScroll>
                <Table
                  caption={t('punches_title')}
                  className="text-xs"
                >
                  <THead>
                    <tr>
                      <Th>{t('modal_time_label')}</Th>
                      <Th>{t('col_status')}</Th>
                      <Th>{t('col_source_device')}</Th>
                      <Th align="end">{t('actions')}</Th>
                    </tr>
                  </THead>
                  <TBody className="divide-line">
                    {rawPunches.map((punch, index) => {
                      const isPunchIn = punch.status === '0' || punch.status === 0;
                      return (
                        <Tr key={punch.id || index}>
                          <Td
                            numeric
                            className="font-mono font-bold text-ink"
                          >
                            {formatPunchTime(punch.timestamp)}
                          </Td>
                          <Td>
                            <Badge
                              tone={isPunchIn ? 'success' : 'brand'}
                              size="sm"
                            >
                              {isPunchIn ? t('status_checkin') : t('status_checkout')}
                            </Badge>
                          </Td>
                          <Td className="text-ink-muted">
                            {punch.is_manual || !punch.sn ? (
                              <Badge tone="accent" size="sm">
                                {t('source_manual')}
                              </Badge>
                            ) : (
                              <span className="font-mono text-[11px]">{punch.sn}</span>
                            )}
                          </Td>
                          <Td align="end">
                            <div className="inline-flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="iconSm"
                                aria-label={t('edit')}
                                title={t('edit')}
                                className="text-brand hover:bg-brand-soft"
                                onClick={() => {
                                  setEditingPunch({
                                    id: punch.id,
                                    oldTimestamp: punch.timestamp,
                                    time: formatPunchTime(punch.timestamp),
                                    status: String(punch.status || '0'),
                                  });
                                }}
                              >
                                <Edit3 size={13} />
                              </Button>
                              <Button
                                variant="ghost"
                                size="iconSm"
                                aria-label={t('delete')}
                                title={t('delete')}
                                className="text-ink-subtle hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                                onClick={() => setPendingDelete(punch)}
                              >
                                <Trash2 size={13} />
                              </Button>
                            </div>
                          </Td>
                        </Tr>
                      );
                    })}

                    {rawPunches.length === 0 && (
                      <TableMessageRow colSpan={4}>
                        <p className="text-xs text-ink-subtle">
                          {t('punch_no_records')}
                        </p>
                      </TableMessageRow>
                    )}
                  </TBody>
                </Table>
              </TableScroll>
            </div>
          </div>

          {editingPunch ? (
            <form
              onSubmit={handleSavePunchEdit}
              className="space-y-3 rounded-xl border border-brand-line bg-brand-soft p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-brand">
                  {t('modal_modifying_punch')}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingPunch(null)}
                >
                  {t('btn_cancel_edit')}
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('modal_time_label')}>
                  <Input
                    type="time"
                    required
                    value={editingPunch.time}
                    onChange={(event) =>
                      setEditingPunch({ ...editingPunch, time: event.target.value })
                    }
                    className="bg-surface"
                  />
                </Field>
                <Field label={t('modal_punch_type')}>
                  <Select
                    value={editingPunch.status}
                    onChange={(event) =>
                      setEditingPunch({ ...editingPunch, status: event.target.value })
                    }
                    className="bg-surface"
                  >
                    <option value="0">{t('status_checkin')}</option>
                    <option value="1">{t('status_checkout')}</option>
                  </Select>
                </Field>
              </div>
              <Button
                type="submit"
                loading={isSavingPunch}
                loadingLabel={t('saving')}
                className="w-full"
              >
                {t('btn_save_punch_update')}
              </Button>
            </form>
          ) : (
            <form onSubmit={addManualPunch} className="space-y-3">
              <h3 className="text-xs font-bold text-ink">
                {t('modal_record_new_punch')}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('modal_time_label')}>
                  <Input
                    type="time"
                    required
                    value={newPunchTime}
                    onChange={(event) => setNewPunchTime(event.target.value)}
                  />
                </Field>
                <Field label={t('modal_punch_type')}>
                  <Select
                    value={newPunchStatus}
                    onChange={(event) => setNewPunchStatus(event.target.value)}
                  >
                    <option value="0">{t('status_checkin')}</option>
                    <option value="1">{t('status_checkout')}</option>
                  </Select>
                </Field>
              </div>
              <Button
                type="submit"
                loading={isSavingPunch}
                loadingLabel={t('saving')}
                className="w-full"
              >
                {t('btn_add_manual_punch')}
              </Button>
            </form>
          )}
        </div>
      </Modal>

      <ApprovalsInbox refreshKey={inboxKey} />
      <ExceptionsInbox refreshKey={inboxKey} />

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void deletePunch()}
        title={
          isUnpairedDelete ? t('punch_delete_unpaired_title') : t('punch_delete_title')
        }
        description={
          isUnpairedDelete ? t('punch_delete_unpaired_desc') : t('punch_delete_desc')
        }
        details={
          pendingDelete && (
            <p className="font-mono text-ink-muted" data-numeric>
              {selectedRow?.name} • {formatPunchTime(pendingDelete.timestamp)}
            </p>
          )
        }
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        loading={isDeletingPunch}
      />
    </div>
  );
}
