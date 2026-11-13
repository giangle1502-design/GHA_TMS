"use client";
import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label, NativeSelect, Textarea } from "@/components/ui/input";
import { inviteUser } from "./actions";
import { RoleSummary } from "./role-summary";

const schema = z.object({
  email: z.email({ message: "Email không hợp lệ" }),
  roleCodes: z.array(z.string()).min(1, "Chọn ít nhất một vai trò"),
  driverId: z.string().optional(),
  note: z.string().max(500, "Tối đa 500 ký tự").optional(),
});
type FormValues = z.infer<typeof schema>;

export function InviteUserDialog({
  roles,
  drivers,
}: {
  roles: { id: string; code: string; name: string; description: string | null; perms: string[] }[];
  drivers: { id: string; code: string; full_name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: "", roleCodes: [], driverId: "", note: "" } });
  const selected = useWatch({ control: form.control, name: "roleCodes" }) ?? [];
  const isDriver = selected.includes("driver");

  function onSubmit(values: FormValues) {
    startTransition(async () => {
      const res = await inviteUser({ ...values, driverId: isDriver ? values.driverId : "" });
      if (res.ok) {
        toast.success(res.message);
        form.reset();
        setOpen(false);
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus /> Cấp quyền truy cập
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cấp quyền truy cập</DialogTitle>
          <DialogDescription>
            Nhập email Google của người dùng. Nếu người này đã đăng nhập trước đó, tài khoản được kích hoạt ngay.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email Google</Label>
            <Input id="email" type="email" autoComplete="off" placeholder="ten@gmail.com" {...form.register("email")} aria-invalid={!!form.formState.errors.email} />
            {form.formState.errors.email ? <p className="text-xs text-destructive">{form.formState.errors.email.message}</p> : null}
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Vai trò</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {roles.map((r) => (
                <div key={r.id} className="space-y-1 rounded-md border p-2 text-sm hover:bg-muted/50">
                  <label className="flex cursor-pointer items-start gap-2">
                    <input type="checkbox" value={r.code} className="mt-0.5" {...form.register("roleCodes")} />
                    <span>
                      <span className="font-medium">{r.name}</span>
                      {r.description ? <span className="block text-xs text-muted-foreground">{r.description}</span> : null}
                    </span>
                  </label>
                  <div className="pl-6">
                    <RoleSummary perms={r.perms} all={r.code === "super_admin"} />
                  </div>
                </div>
              ))}
            </div>
            {form.formState.errors.roleCodes ? <p className="text-xs text-destructive">{form.formState.errors.roleCodes.message}</p> : null}
          </fieldset>
          {isDriver ? (
            <div className="space-y-1.5">
              <Label htmlFor="driverId">Gắn với hồ sơ tài xế</Label>
              <NativeSelect id="driverId" {...form.register("driverId")}>
                <option value="">— Chưa gắn (gắn sau ở màn hình Tài xế) —</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code} – {d.full_name}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-xs text-muted-foreground">Tài xế chỉ thấy các chuyến được phân công cho hồ sơ này.</p>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="note">Ghi chú</Label>
            <Textarea id="note" rows={2} {...form.register("note")} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Đang lưu..." : "Cấp quyền"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
