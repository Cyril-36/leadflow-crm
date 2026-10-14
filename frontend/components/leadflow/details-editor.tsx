"use client";

import { Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Lead, LeadDetails } from "@/lib/api";

interface DetailsEditorProps {
  lead: Lead;
  /** Resolves to field errors (empty when saved). */
  onSave: (details: LeadDetails) => Promise<Record<string, string>>;
  onCancel: () => void;
}

/** Inline form in the lead dialog for correcting name, company and phone. */
export function DetailsEditor({ lead, onSave, onCancel }: DetailsEditorProps) {
  const [values, setValues] = useState({ name: lead.name, company: lead.company ?? "", phone: lead.phone ?? "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (!values.name.trim()) {
      setErrors({ name: "Name is required." });
      return;
    }
    // Send only what changed, so the timeline names exactly those fields.
    const changes: LeadDetails = {};
    if (values.name.trim() !== lead.name) changes.name = values.name;
    if (values.company.trim() !== (lead.company ?? "")) changes.company = values.company;
    if (values.phone.trim() !== (lead.phone ?? "")) changes.phone = values.phone;
    if (!Object.keys(changes).length) {
      onCancel();
      return;
    }
    setSaving(true);
    const fieldErrors = await onSave(changes);
    setSaving(false);
    setErrors(fieldErrors);
  };

  const field = (key: "name" | "company" | "phone", label: string, extra: { type?: string; maxLength: number }) => (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={`edit-${key}`} className="text-[13px] font-semibold text-muted-foreground">
        {label}
      </Label>
      <Input
        id={`edit-${key}`}
        type={extra.type ?? "text"}
        value={values[key]}
        maxLength={extra.maxLength}
        autoFocus={key === "name"}
        readOnly={saving}
        aria-invalid={Boolean(errors[key])}
        aria-describedby={errors[key] ? `edit-${key}-error` : undefined}
        onChange={(event) => {
          setValues((prev) => ({ ...prev, [key]: event.target.value }));
          setErrors((prev) => ({ ...prev, [key]: "" }));
        }}
        className="h-10 bg-card text-[15px]"
      />
      {errors[key] && (
        <p id={`edit-${key}-error`} className="text-[13px] font-semibold text-overdue">
          {errors[key]}
        </p>
      )}
    </div>
  );

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Edit lead details"
      className="lf-fade-in flex flex-none flex-col gap-3 border-b border-border bg-[#fafbfa] px-4 py-3.5 sm:px-6"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {field("name", "Name", { maxLength: 120 })}
        {field("company", "Company (optional)", { maxLength: 120 })}
        {field("phone", "Phone (optional)", { type: "tel", maxLength: 30 })}
      </div>
      {errors.request && <p className="text-sm font-semibold text-overdue">{errors.request}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} aria-disabled={saving} className="h-9 px-3.5 text-[15px]">
          Cancel
        </Button>
        <Button type="submit" aria-disabled={saving} className="h-9 px-3.5 text-[15px] aria-disabled:opacity-70">
          {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
          {saving ? "Saving…" : "Save details"}
        </Button>
      </div>
    </form>
  );
}
