"use client";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { updateMyProfile } from "./actions";

const schema = z.object({
  fullName: z.string().trim().min(2, "Họ tên tối thiểu 2 ký tự").max(120),
  phone: z.string().trim().regex(/^(\+84|0)[0-9]{8,10}$/, "Số điện thoại không hợp lệ").or(z.literal("")),
});

export function ProfileForm({ fullName, phone }: { fullName: string; phone: string }) {
  const [pending, start] = useTransition();
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { fullName, phone } });
  return (
    <form
      className="space-y-4"
      onSubmit={form.handleSubmit((v) =>
        start(async () => {
          const res = await updateMyProfile(v);
          if (res.ok) toast.success(res.message);
          else toast.error(res.error);
        }),
      )}
    >
      <div className="space-y-1.5">
        <Label htmlFor="fullName">Họ và tên</Label>
        <Input id="fullName" {...form.register("fullName")} />
        {form.formState.errors.fullName ? <p className="text-xs text-destructive">{form.formState.errors.fullName.message}</p> : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="phone">Số điện thoại</Label>
        <Input id="phone" inputMode="tel" {...form.register("phone")} />
        {form.formState.errors.phone ? <p className="text-xs text-destructive">{form.formState.errors.phone.message}</p> : null}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Đang lưu..." : "Lưu"}
      </Button>
    </form>
  );
}
