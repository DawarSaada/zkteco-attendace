export interface Device {
    id?: string;
    sn: string;
    name?: string | null;
    branch?: string | null;
    ip_address?: string | null;
    last_active: string;
    created_at?: string;
}

export interface Employee {
    id?: string;
    pin: string;
    full_name: string;
    department?: string | null;
    branch?: string | null;
    designation?: string | null;
    created_at?: string;
}

export interface AttendanceLog {
    id?: string;
    sn?: string | null;
    pin: string;
    timestamp: string;
    status?: string | number | null;
    verify_mode?: string | number | null;
    work_code?: number | null;
    is_manual?: boolean;
    edited_by?: string | null;
    created_at?: string;
    employees?: { 
        full_name: string;
        branch?: string | null;
        department?: string | null;
    } | null;
}

export interface Shift {
    id: string;
    name: string;
    start_time: string;
    end_time: string;
    created_at?: string;
}

export interface EmployeeShift {
    id?: string;
    pin: string;
    shift_id: string;
    shifts?: {
        name?: string;
        start_time?: string;
        end_time?: string;
    } | null;
    employees?: {
        full_name?: string;
        branch?: string | null;
        department?: string | null;
    } | null;
}

export interface DeviceCommand {
    id?: string;
    sn: string;
    command_str: string;
    status: 'PENDING' | 'SENT' | 'ACKNOWLEDGED' | 'EXECUTED' | 'FAILED' | string;
    created_at?: string;
    executed_at?: string | null;
}

export type AttendanceDayStatus =
    | 'present'
    | 'late'
    | 'absent'
    | 'leave'
    | 'holiday'
    | 'off'
    | 'incomplete';

export interface DailyAttendanceSummary {
    pin: string;
    full_name?: string | null;
    department?: string | null;
    device_name?: string | null;
    branch?: string | null;
    punch_date: string;
    check_in?: string | null;
    check_out?: string | null;
    total_punches: number;
    shift_start?: string | null;
    shift_end?: string | null;
    // --- Phase 1 attendance engine (present once recompute has run) ---
    status?: AttendanceDayStatus | null;
    expected_minutes?: number | null;
    worked_minutes?: number | null;
    late_minutes?: number | null;
    early_leave_minutes?: number | null;
    overtime_minutes?: number | null;
    shift_id?: string | null;
}

/** One row of the computed summary table (attendance_days). */
export interface AttendanceDay {
    id?: string;
    pin: string;
    work_date: string;
    shift_id?: string | null;
    policy_id?: string | null;
    expected_minutes: number;
    worked_minutes: number;
    late_minutes: number;
    early_leave_minutes: number;
    overtime_minutes: number;
    status: AttendanceDayStatus;
    first_in?: string | null;
    last_out?: string | null;
    punch_count: number;
    computed_at?: string;
}

export interface AttendancePolicy {
    id?: string;
    name: string;
    grace_in_minutes: number;
    grace_out_minutes: number;
    min_minutes_for_full_day: number;
    weekend_days: number[];
    overtime_after_minutes: number;
    requires_overtime_approval: boolean;
    is_default: boolean;
}

export interface ShiftPeriod {
    id?: string;
    shift_id: string;
    seq: number;
    start_time: string;
    end_time: string;
    day_offset: number;
    crosses_midnight?: boolean;
}

export interface EmployeeShiftAssignment {
    id?: string;
    pin: string;
    shift_id: string;
    effective_from: string;
    effective_to?: string | null;
}

export interface Holiday {
    id?: string;
    date: string;
    name: string;
    scope: string;
    is_working_day: boolean;
}

export interface RawPunch {
    id?: string;
    sn?: string | null;
    pin: string;
    timestamp: string;
    status?: string | number | null;
    verify_mode?: string | number | null;
    work_code?: number | null;
    is_manual?: boolean;
    edited_by?: string | null;
}

export interface GroupedReportEmployee {
    pin: string;
    name: string;
    department: string;
    branch?: string;
    records: DailyAttendanceSummary[];
    totalMinutes?: number;
    daysPresent?: number;
}

export type ReportType = 'timecard' | 'exceptions' | 'absence' | 'overtime' | 'rollup' | 'late';
export type ReportCadence = 'monthly' | 'weekly' | 'daily';

export interface ReportAutomation {
    id: string;
    branch: string;
    recipient_emails: string[];
    cycle_start_day: number;
    cycle_end_day: number;
    dispatch_day: number;
    dispatch_time: string;
    report_format: 'excel' | 'pdf' | 'both';
    /** Phase 5 — which report to send; defaults to the monthly timecard. */
    report_type?: ReportType | null;
    /** Phase 5 — how often to send it. */
    cadence?: ReportCadence | null;
    is_active: boolean;
    last_run_at?: string | null;
    last_run_status?: string | null;
    created_at?: string;
}

export interface ReportAutomationLog {
    report_type?: ReportType | null;
    id: string;
    automation_id?: string | null;
    branch: string;
    period_start: string;
    period_end: string;
    recipients: string[];
    status: 'SUCCESS' | 'FAILED';
    error_message?: string | null;
    created_at: string;
}

/* ------------------------------------------------------------------ *
 * Phase 7 — self-service ("my attendance")
 * ------------------------------------------------------------------ */

export interface SelfServiceSummary {
    days: number;
    scheduledDays: number;
    presentDays: number;
    lateDays: number;
    absentDays: number;
    incompleteDays: number;
    leaveDays: number;
    holidayDays: number;
    offDays: number;
    workedMinutes: number;
    expectedMinutes: number;
    lateMinutes: number;
    earlyLeaveMinutes: number;
    overtimeMinutes: number;
    punchCount: number;
    attendanceRate: number;
}

export interface SelfServiceRequest {
    id: string;
    pin: string;
    work_date: string | null;
    action: 'add' | 'edit' | 'delete';
    status: 'pending' | 'approved' | 'rejected';
    note?: string | null;
    source?: string | null;
    payload?: { timestamp?: string; old_timestamp?: string } | null;
    created_at: string;
}

export interface SelfServicePayload {
    linked: boolean;
    profile: { display_name: string | null; role: string; employee_pin: string | null };
    employee?: {
        pin: string;
        full_name: string | null;
        branch: string | null;
        department: string | null;
    };
    shift?: { name?: string; start_time?: string; end_time?: string } | null;
    range: { from: string; to: string };
    engineApplied?: boolean;
    summary?: SelfServiceSummary;
    /** Rows of `attendance_days` (no `pin`/`id`: they are the caller's own). */
    days?: Omit<AttendanceDay, 'id' | 'pin'>[];
    requests?: SelfServiceRequest[];
    openExceptions?: { id: string; work_date: string; kind: string; state: string }[];
}
