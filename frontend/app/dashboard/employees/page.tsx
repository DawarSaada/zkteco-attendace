'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Edit, Layers, Plus, Search, Trash2, Users } from 'lucide-react';
import { useLanguage } from '@/components/LanguageContext';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Field, Input, Select } from '@/components/ui/Field';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { MetricTile } from '@/components/ui/StatCard';
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
import type { Employee } from '@/types';
import type { CSSProperties } from 'react';

interface EmployeeForm {
  pin: string;
  full_name: string;
  department: string;
  branch: string;
  designation: string;
}

const EMPTY_FORM: EmployeeForm = {
  pin: '',
  full_name: '',
  department: '',
  branch: '',
  designation: '',
};

function compareEmployees(a: Employee, b: Employee, key: string): number {
  switch (key) {
    case 'pin':
      return (Number(a.pin) || 0) - (Number(b.pin) || 0);
    case 'full_name':
      return (a.full_name || '').localeCompare(b.full_name || '');
    case 'department':
      return (a.department || '').localeCompare(b.department || '');
    case 'branch':
      return (a.branch || '').localeCompare(b.branch || '');
    case 'designation':
      return (a.designation || '').localeCompare(b.designation || '');
    default:
      return 0;
  }
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [sortKey, setSortKey] = useState<string>('pin');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [form, setForm] = useState<EmployeeForm>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);

  const [deletingEmployee, setDeletingEmployee] = useState<Employee | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const { t } = useLanguage();
  const toast = useToast();

  const fetchEmployees = useCallback(async () => {
    try {
      const res = await fetch('/api/employees');
      if (res.ok) {
        const data = await res.json();
        setEmployees(Array.isArray(data) ? data : []);
      } else {
        toast.error(t('emp_fetch_failed'));
        setEmployees([]);
      }
    } catch {
      toast.error(t('emp_fetch_failed'));
      setEmployees([]);
    } finally {
      setIsLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    void fetchEmployees();
  }, [fetchEmployees]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortOrder('asc');
    }
  };

  const openAddModal = () => {
    setEditingEmployee(null);
    setForm(EMPTY_FORM);
    setIsModalOpen(true);
  };

  const openEditModal = (employee: Employee) => {
    setEditingEmployee(employee);
    setForm({
      pin: employee.pin,
      full_name: employee.full_name,
      department: employee.department || '',
      branch: employee.branch || '',
      designation: employee.designation || '',
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);

    try {
      const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pin: form.pin,
          full_name: form.full_name,
          department: form.department,
          branch: form.branch,
          designation: form.designation,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || t('emp_save_failed'));
        return;
      }

      toast.success(
        editingEmployee ? t('emp_updated_success') : t('emp_created_success'),
      );
      setIsModalOpen(false);
      await fetchEmployees();
    } catch {
      toast.error(t('emp_save_failed'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteEmployee = async () => {
    if (!deletingEmployee) return;
    setIsDeleting(true);

    try {
      const res = await fetch(
        `/api/employees?pin=${encodeURIComponent(deletingEmployee.pin)}`,
        { method: 'DELETE' },
      );
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || t('emp_delete_failed'));
        return;
      }

      toast.success(t('emp_deleted_success'));
      if (editingEmployee?.pin === deletingEmployee.pin) setIsModalOpen(false);
      setDeletingEmployee(null);
      await fetchEmployees();
    } catch {
      toast.error(t('emp_delete_failed'));
    } finally {
      setIsDeleting(false);
    }
  };

  const branches = useMemo(() => {
    const set = new Set(employees.map((employee) => employee.branch).filter(Boolean));
    return Array.from(set) as string[];
  }, [employees]);

  const departmentCount = useMemo(() => {
    const set = new Set(
      employees.map((employee) => employee.department).filter(Boolean),
    );
    return set.size;
  }, [employees]);

  const filteredAndSorted = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    const filtered = employees.filter((employee) => {
      if (branchFilter !== 'all' && employee.branch !== branchFilter) return false;
      if (!term) return true;
      return (
        employee.full_name.toLowerCase().includes(term) ||
        employee.pin.toLowerCase().includes(term) ||
        (employee.department || '').toLowerCase().includes(term) ||
        (employee.designation || '').toLowerCase().includes(term)
      );
    });

    return filtered.sort((a, b) =>
      sortOrder === 'asc'
        ? compareEmployees(a, b, sortKey)
        : -compareEmployees(a, b, sortKey),
    );
  }, [employees, branchFilter, searchTerm, sortKey, sortOrder]);

  const isFiltering = searchTerm.trim() !== '' || branchFilter !== 'all';

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('emp_title')}
        description={t('emp_subtitle')}
        badge={
          <Badge tone="brand" size="md" icon={Users}>
            {employees.length} {t('emp_count_label')}
          </Badge>
        }
        actions={
          <Button icon={Plus} onClick={openAddModal}>
            {t('btn_add_employee')}
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label={t('emp_count_label')}
          value={employees.length}
          icon={Users}
          tone="aurora"
        />
        <MetricTile
          label={t('emp_metric_branches')}
          value={branches.length}
          icon={Building2}
          tone="info"
        />
        <MetricTile
          label={t('emp_metric_departments')}
          value={departmentCount}
          icon={Layers}
          tone="brand"
        />
        <MetricTile
          label={t('emp_metric_showing')}
          value={filteredAndSorted.length}
          icon={Search}
          tone={isFiltering ? 'success' : 'warning'}
        />
      </div>

      <Card className="flex flex-col items-stretch gap-3 p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            size={15}
            aria-hidden="true"
            className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-subtle"
          />
          <Input
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder={t('emp_search_placeholder')}
            aria-label={t('emp_filter_label')}
            className="ps-9"
          />
        </div>

        <div className="sm:w-52">
          <Select
            value={branchFilter}
            onChange={(event) => setBranchFilter(event.target.value)}
            aria-label={t('filter_branch')}
          >
            <option value="all">{t('filter_all_branches')}</option>
            {branches.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </Select>
        </div>

        {isFiltering && (
          <Badge tone="brand" size="sm" className="shrink-0">
            {filteredAndSorted.length} {t('emp_search_result')}
          </Badge>
        )}
      </Card>

      <TableCard>
        <TableScroll>
          <Table caption={t('emp_title')} className="min-w-[52rem]">
            <THead>
              <tr>
                <SortHeader
                  columnKey="pin"
                  label={t('col_pin')}
                  activeKey={sortKey}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
                <SortHeader
                  columnKey="full_name"
                  label={t('col_full_name')}
                  activeKey={sortKey}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
                <SortHeader
                  columnKey="department"
                  label={t('col_department')}
                  activeKey={sortKey}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
                <SortHeader
                  columnKey="branch"
                  label={t('col_branch')}
                  activeKey={sortKey}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
                <SortHeader
                  columnKey="designation"
                  label={t('col_designation')}
                  activeKey={sortKey}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
                <Th align="end">{t('actions')}</Th>
              </tr>
            </THead>

            <TBody>
              {isLoading && (
                <TableMessageRow colSpan={6}>
                  <TableSkeleton rows={6} columns={6} />
                </TableMessageRow>
              )}

              {!isLoading &&
                filteredAndSorted.map((employee, index) => (
                  <Tr
                    key={employee.pin}
                    className="stagger-in"
                    style={{ '--ui-i': Math.min(index, 12) } as CSSProperties}
                  >
                    <Td numeric className="font-mono font-bold text-ink-muted">
                      {employee.pin}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar name={employee.full_name} size="sm" />
                        <span className="truncate font-semibold text-ink">
                          {employee.full_name}
                        </span>
                      </div>
                    </Td>
                    <Td>
                      {employee.department ? (
                        <span className="flex items-center gap-1.5 text-xs text-ink-muted">
                          <Building2
                            size={13}
                            className="shrink-0 text-ink-subtle"
                            aria-hidden="true"
                          />
                          {employee.department}
                        </span>
                      ) : (
                        <span className="text-ink-subtle">—</span>
                      )}
                    </Td>
                    <Td>
                      {employee.branch ? (
                        <Badge tone="brand" size="sm">
                          {employee.branch}
                        </Badge>
                      ) : (
                        <span className="text-ink-subtle">—</span>
                      )}
                    </Td>
                    <Td className="text-xs text-ink-muted">
                      {employee.designation || <span className="text-ink-subtle">—</span>}
                    </Td>
                    <Td align="end">
                      <div className="inline-flex items-center gap-1.5">
                        <Button
                          variant="subtle"
                          size="sm"
                          icon={Edit}
                          onClick={() => openEditModal(employee)}
                          aria-label={`${t('edit')} ${employee.full_name}`}
                        >
                          {t('edit')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="iconSm"
                          onClick={() => setDeletingEmployee(employee)}
                          aria-label={`${t('btn_delete_employee')} ${employee.full_name}`}
                          title={t('btn_delete_employee')}
                          className="text-ink-subtle hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                ))}

              {!isLoading && filteredAndSorted.length === 0 && (
                <TableMessageRow colSpan={6}>
                  <EmptyState
                    icon={Users}
                    title={t('no_employees_found')}
                    description={isFiltering ? undefined : t('emp_subtitle')}
                    action={
                      isFiltering
                        ? undefined
                        : { label: t('btn_add_employee'), onClick: openAddModal }
                    }
                  />
                </TableMessageRow>
              )}
            </TBody>
          </Table>
        </TableScroll>
      </TableCard>

      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingEmployee ? t('modal_edit_emp') : t('modal_register_emp')}
        description={
          editingEmployee
            ? `${t('edit')} — PIN ${editingEmployee.pin}`
            : t('modal_pin_desc')
        }
        closeLabel={t('close')}
        footer={
          <>
            {editingEmployee && (
              <Button
                variant="dangerGhost"
                icon={Trash2}
                className="me-auto"
                onClick={() => setDeletingEmployee(editingEmployee)}
              >
                {t('btn_delete_employee')}
              </Button>
            )}
            <Button variant="ghost" onClick={() => setIsModalOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" form="employee-form" loading={isSaving}>
              {editingEmployee ? t('save') : t('modal_register_emp')}
            </Button>
          </>
        }
      >
        <form id="employee-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('modal_pin_label')}
              required
              hint={editingEmployee ? t('emp_pin_locked_hint') : undefined}
            >
              <Input
                required
                value={form.pin}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, pin: event.target.value }))
                }
                disabled={Boolean(editingEmployee)}
                placeholder={t('emp_pin_placeholder')}
                inputMode="numeric"
              />
            </Field>

            <Field label={t('modal_full_name_label')} required>
              <Input
                required
                value={form.full_name}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, full_name: event.target.value }))
                }
                placeholder={t('emp_name_placeholder')}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('modal_dept_label')}>
              <Input
                value={form.department}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, department: event.target.value }))
                }
                placeholder={t('emp_dept_placeholder')}
              />
            </Field>

            <Field label={t('modal_branch_label')}>
              <Input
                value={form.branch}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, branch: event.target.value }))
                }
                placeholder={t('emp_branch_placeholder')}
              />
            </Field>
          </div>

          <Field label={t('modal_designation_label')}>
            <Input
              value={form.designation}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, designation: event.target.value }))
              }
              placeholder={t('emp_designation_placeholder')}
            />
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={deletingEmployee !== null}
        onClose={() => setDeletingEmployee(null)}
        onConfirm={() => void handleDeleteEmployee()}
        title={t('confirm_delete_emp_title')}
        description={t('confirm_delete_emp_desc')}
        details={
          deletingEmployee && (
            <div className="space-y-1">
              <p className="font-semibold text-ink">{deletingEmployee.full_name}</p>
              <p className="font-mono text-ink-muted">
                PIN: {deletingEmployee.pin}
                {deletingEmployee.branch ? ` • ${deletingEmployee.branch}` : ''}
              </p>
            </div>
          )
        }
        confirmLabel={t('btn_delete_employee')}
        cancelLabel={t('cancel')}
        loading={isDeleting}
      />
    </div>
  );
}
