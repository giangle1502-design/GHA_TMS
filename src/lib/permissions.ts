// Danh mục quyền – phải khớp với supabase/migrations/20261016000002_rbac.sql và các migration thêm quyền sau (0040, 0044, 0068)
// (kiểm thử tests/permissions.test.ts đối chiếu tự động).

export const MODULE_ACTIONS = {
  dashboard: ["view"],
  dispatch: ["view", "create", "update", "delete"],
  shipments: ["view", "create", "update", "delete", "export"],
  drivers: ["view", "create", "update", "delete", "export", "view_sensitive"],
  vehicles: ["view", "create", "update", "delete", "export", "view_sensitive"],
  customers: ["view", "create", "update", "delete", "export"],
  locations: ["view", "create", "update", "delete", "export"],
  price_lists: ["view", "create", "update", "delete", "export"],
  expenses: ["view", "create", "update", "delete", "approve", "export"],
  advances: ["view", "create", "update", "delete", "approve", "pay", "export"],
  settlements: ["view", "update", "approve", "export"],
  receivables: ["view", "create", "update", "delete", "pay", "export"],
  payments: ["view", "create", "delete", "export"],
  approvals: ["view", "approve", "configure"],
  reports: ["view", "export"],
  catalogs: ["view", "create", "update", "delete"],
  fields: ["view", "configure"],
  forms: ["view", "configure"],
  workflows: ["view", "configure"],
  users: ["view", "create", "update", "configure"],
  audit_logs: ["view", "export"],
  settings: ["view", "configure"],
  documents: ["view", "create", "delete", "view_sensitive"],
  driver_app: ["use"],
  purchase_requests: ["view", "create", "delete", "pay", "export"],
  tasks: ["view", "create", "delete", "export"],
  fuel: ["view", "update", "approve", "export"],
} as const;

type ModuleActions = typeof MODULE_ACTIONS;
export type ModuleKey = keyof ModuleActions;
export type Permission = {
  [M in ModuleKey]: `${M}.${ModuleActions[M][number]}`;
}[ModuleKey];

export const ALL_PERMISSIONS: Permission[] = (Object.keys(MODULE_ACTIONS) as ModuleKey[]).flatMap(
  (m) => MODULE_ACTIONS[m].map((a) => `${m}.${a}` as Permission),
);

export const MODULE_LABELS: Record<ModuleKey, string> = {
  dashboard: "Tổng quan",
  dispatch: "Điều phối",
  shipments: "Chuyến xe",
  drivers: "Tài xế",
  vehicles: "Phương tiện",
  customers: "Khách hàng, nhà cung cấp",
  locations: "Địa điểm, tuyến",
  price_lists: "Bảng giá",
  expenses: "Chi phí chuyến",
  advances: "Ứng tiền",
  settlements: "Quyết toán",
  receivables: "Công nợ",
  payments: "Thanh toán",
  approvals: "Phê duyệt",
  reports: "Báo cáo",
  catalogs: "Danh mục hệ thống",
  fields: "Trường dữ liệu",
  forms: "Biểu mẫu",
  workflows: "Quy trình",
  users: "Người dùng và phân quyền",
  audit_logs: "Nhật ký hệ thống",
  settings: "Cấu hình",
  documents: "Chứng từ",
  driver_app: "Ứng dụng tài xế",
  purchase_requests: "Đề nghị chi, mua sắm",
  tasks: "Giao việc",
  fuel: "Dầu theo xe",
};

export const ACTION_LABELS: Record<string, string> = {
  view: "Xem",
  create: "Tạo",
  update: "Sửa",
  delete: "Xóa/Hủy",
  approve: "Duyệt",
  pay: "Thanh toán",
  export: "Xuất",
  configure: "Cấu hình",
  view_sensitive: "Nhạy cảm",
  use: "Sử dụng",
};

export const ACTION_ORDER = Object.keys(ACTION_LABELS);

/** Kiểm tra một tập quyền có chứa ít nhất một quyền trong danh sách. */
export function hasAny(perms: ReadonlySet<string>, required: readonly Permission[]) {
  return required.length === 0 || required.some((p) => perms.has(p));
}

/** "Xem – Phương tiện" */
export function permissionLabel(code: string): string {
  const [m, a] = code.split(".");
  return `${ACTION_LABELS[a] ?? a} – ${MODULE_LABELS[m as ModuleKey] ?? m}`;
}
