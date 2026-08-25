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
    created_at?: string;
    employees?: { full_name: string } | null;
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
    } | null;
}

export interface DeviceCommand {
    id?: string;
    sn: string;
    command_str: string;
    status: 'PENDING' | 'EXECUTED' | string;
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
}

export interface GroupedReportEmployee {
    pin: string;
    name: string;
    department: string;
    records: DailyAttendanceSummary[];
    totalMinutes?: number;
}
