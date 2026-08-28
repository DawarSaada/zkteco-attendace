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

export interface ReportAutomation {
    id: string;
    branch: string;
    recipient_emails: string[];
    cycle_start_day: number;
    cycle_end_day: number;
    dispatch_day: number;
    dispatch_time: string;
    report_format: 'excel' | 'pdf' | 'both';
    is_active: boolean;
    last_run_at?: string | null;
    last_run_status?: string | null;
    created_at?: string;
}

export interface ReportAutomationLog {
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
