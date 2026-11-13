"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldEditor } from "@/app/(app)/truong-du-lieu/field-manager";
import Link from "next/link";
import { Settings2 } from "lucide-react";
import { ENTITIES, FORMULA_SYSTEM_FIELDS } from "@/lib/entities/definitions";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import type { CustomFieldRow } from "@/lib/entities/types";

/**
 * Nút "+ Thêm trường" đặt ngay trong biểu mẫu: mở hộp tạo trường (chữ, số, ngày, danh sách, công thức…)
 * cho đúng màn hình đang nhập; lưu xong trường mới hiện ngay trong biểu mẫu, không phải rời trang.
 */
export function AddFieldButton({
  module,
  entityKey,
  customRows,
  onSaved,
  size = "sm",
  label = "Thêm trường",
}: {
  module: string;
  entityKey?: string;
  customRows: CustomFieldRow[];
  onSaved?: () => void;
  size?: "sm" | "default";
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nonce, setNonce] = useState(0);
  const entity = entityKey ? ENTITIES[entityKey] : undefined;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={size}
        className="border-dashed text-primary"
        onClick={() => {
          setNonce((n) => n + 1);
          setOpen(true);
        }}
      >
        <Plus /> {label}
      </Button>
      <Link
        href={`/truong-du-lieu?module=${module}`}
        className="inline-flex items-center gap-1 px-2 text-sm text-muted-foreground hover:text-primary hover:underline"
      >
        <Settings2 className="size-3.5" /> Sửa, xóa, sắp xếp trường
      </Link>
      <FieldEditor
        key={nonce}
        open={open}
        onOpenChange={setOpen}
        module={module}
        row={null}
        others={customRows.filter((r) => r.module === module)}
        numericSystem={
          entity
            ? entity.fields.filter((f) => ["number", "currency", "percent"].includes(f.type)).map((f) => ({ key: f.key, label: f.label }))
            : (FORMULA_SYSTEM_FIELDS[module] ?? [])
        }
        systemKeys={(entity?.fields ?? []).map((f) => f.key)}
        permissions={ALL_PERMISSIONS}
        onSaved={() => {
          router.refresh();
          onSaved?.();
        }}
      />
    </>
  );
}
