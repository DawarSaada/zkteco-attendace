/**
 * Formats an ISO date string directly from UTC components
 * to prevent unwanted browser local timezone shifts (e.g. +3h drift).
 */
export function formatPunchTime(dateStr: string | null | undefined): string {
    if (!dateStr) return '--:--';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '--:--';
    
    const hours = String(d.getUTCHours()).padStart(2, '0');
    const minutes = String(d.getUTCMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

/**
 * Calculates and formats total working hours and minutes between check-in and check-out.
 */
export function formatTotalHours(checkIn: string | null | undefined, checkOut: string | null | undefined): string {
    if (!checkIn || !checkOut || checkIn === checkOut) return '0h 0m';
    const start = new Date(checkIn).getTime();
    const end = new Date(checkOut).getTime();
    if (isNaN(start) || isNaN(end)) return '0h 0m';
    
    const diffMinutes = Math.max(0, Math.floor((end - start) / (1000 * 60)));
    const h = Math.floor(diffMinutes / 60);
    const m = diffMinutes % 60;
    return `${h}h ${m}m`;
}

/**
 * Calculates duration in minutes between check-in and check-out.
 */
export function calculateMinutes(checkIn: string | null | undefined, checkOut: string | null | undefined): number {
    if (!checkIn || !checkOut || checkIn === checkOut) return 0;
    const start = new Date(checkIn).getTime();
    const end = new Date(checkOut).getTime();
    if (isNaN(start) || isNaN(end)) return 0;
    return Math.max(0, Math.floor((end - start) / (1000 * 60)));
}
