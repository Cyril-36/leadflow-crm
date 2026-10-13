"use client";

import { Loader2 } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api, type Lead } from "@/lib/api";

interface AddLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (lead: Lead) => Promise<void>;
}

const EMPTY = { name: "", company: "", phone: "" };

export function AddLeadDialog({ open, onOpenChange, onCreated }: AddLeadDialogProps) {
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // Radix only restores focus to a DialogTrigger; this dialog is opened from app state.
  const returnFocusTo = useRef<HTMLElement | null>(null);

  const set = (field: keyof typeof EMPTY) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setValues((prev) => ({ ...prev, [field]: event.target.value }));
    setErrors((prev) => ({ ...prev, [field]: "" }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (!values.name.trim()) {
      setErrors({ name: "Name is required." });
      return;
    }
    setSaving(true);
    try {
      const result = await api.createLead({
        name: values.name,
        company: values.company || undefined,
        phone: values.phone || undefined,
      });
      setSaving(false);
      setValues(EMPTY);
      onOpenChange(false);
      await onCreated(result.lead);
    } catch (error) {
      setSaving(false);
      if (error instanceof ApiError && error.details.length) {
        setErrors(error.fieldErrors());
      } else {
        toast.error("Couldn't add the lead. Your details are still in the form.", {
          description: error instanceof ApiError ? error.message : undefined,
        });
      }
    }
  };

  const fieldError = (field: string) =>
    errors[field] ? (
      <p id={`${field}-error`} className="text-[13px] font-semibold text-overdue">
        {errors[field]}
      </p>
    ) : null;

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent
        className="gap-4 rounded-[14px] p-6 text-[15px] sm:max-w-[460px]"
        onOpenAutoFocus={() => {
          returnFocusTo.current = document.activeElement as HTMLElement | null;
        }}
        onCloseAutoFocus={(event) => {
          const target = returnFocusTo.current;
          if (target?.isConnected) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Add lead</DialogTitle>
          <DialogDescription className="text-[15px]">New leads start with the status New.</DialogDescription>
        </DialogHeader>
        <form id="add-lead-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lead-name" className="text-sm font-semibold">
              Name
            </Label>
            <Input
              id="lead-name"
              value={values.name}
              onChange={set("name")}
              placeholder="Full name"
              maxLength={120}
              autoComplete="off"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? "name-error" : undefined}
              className="h-11 bg-card text-[15px]"
            />
            {fieldError("name")}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lead-company" className="text-sm font-semibold">
              Company <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="lead-company"
              value={values.company}
              onChange={set("company")}
              placeholder="Company name"
              maxLength={120}
              autoComplete="off"
              aria-invalid={Boolean(errors.company)}
              aria-describedby={errors.company ? "company-error" : undefined}
              className="h-11 bg-card text-[15px]"
            />
            {fieldError("company")}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lead-phone" className="text-sm font-semibold">
              Phone <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="lead-phone"
              type="tel"
              value={values.phone}
              onChange={set("phone")}
              placeholder="555-0123"
              maxLength={30}
              autoComplete="off"
              aria-invalid={Boolean(errors.phone)}
              aria-describedby={errors.phone ? "phone-error" : undefined}
              className="h-11 bg-card text-[15px]"
            />
            {fieldError("phone")}
          </div>
        </form>
        <DialogFooter className="-mx-6 -mb-6 rounded-b-[14px] px-6 py-4">
          <DialogClose asChild>
            <Button variant="outline" disabled={saving} className="h-10 px-4 text-[15px]">
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" form="add-lead-form" disabled={saving} className="h-10 px-4 text-[15px]">
            {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
            {saving ? "Saving…" : "Save lead"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
