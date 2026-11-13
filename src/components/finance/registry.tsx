"use client";
import type { ComponentType } from "react";
import { CreateAdvanceDialog, CreateExpenseDialog, type CreateActionProps } from "./create-dialogs";
import { CreatePayableDialog, CreatePayrollDialog, CreateReceivableDialog } from "./payroll-debt-dialogs";
import { AdvanceRowActions, ApprovalRowActions, ExpenseRowActions, type RowActionProps } from "./row-actions";
import { CreateLeaveDialog, HandoverRowActions, LeaveRowActions } from "@/components/leave/leave-dialogs";
import { CreateTaskDialog, TaskRowActions } from "@/components/tasks/task-dialogs";
import { CreatePurchaseRequestDialog, PurchaseRowActions } from "./purchase-dialogs";
import { PlanTick } from "@/components/plans/plan-tick";
import { BillingRowActions, CarrierRowActions, PayableRowActions, PaymentRowActions, PayrollRowActions, ReceivableRowActions } from "./payroll-debt-actions";

/** Biểu mẫu nghiệp vụ thay cho biểu mẫu chung khi bấm "Tạo …" trên bảng (EntityDef.createAction) */
export const CREATE_ACTIONS: Record<string, ComponentType<CreateActionProps>> = {
  advance: CreateAdvanceDialog,
  expense: CreateExpenseDialog,
  payroll: CreatePayrollDialog,
  receivable: CreateReceivableDialog,
  payable: CreatePayableDialog,
  leave: CreateLeaveDialog,
  task: CreateTaskDialog,
  purchase_request: CreatePurchaseRequestDialog,
};

/** Nút thao tác trên từng dòng (EntityDef.rowActions) */
export const ROW_ACTIONS: Record<string, ComponentType<RowActionProps>> = {
  approval: ApprovalRowActions,
  advance: AdvanceRowActions,
  expense: ExpenseRowActions,
  payroll: PayrollRowActions,
  receivable: ReceivableRowActions,
  payable: PayableRowActions,
  carrier: CarrierRowActions,
  billing: BillingRowActions,
  payment: PaymentRowActions,
  leave: LeaveRowActions,
  leave_handover: HandoverRowActions,
  task: TaskRowActions,
  purchase_request: PurchaseRowActions,
};

/** Ô thao tác ở cột đầu tiên của dòng (EntityDef.leadAction) */
export const LEAD_ACTIONS: Record<string, ComponentType<RowActionProps>> = {
  plan: PlanTick,
};

/** Độ rộng cột thao tác (px) theo loại nút */
export const ROW_ACTION_WIDTH: Record<string, number> = {
  approval: 290,
  advance: 170,
  expense: 150,
  payroll: 210,
  receivable: 250,
  payable: 250,
  carrier: 300,
  billing: 170,
  payment: 150,
  leave: 250,
  leave_handover: 150,
  task: 230,
  purchase_request: 330,
};
