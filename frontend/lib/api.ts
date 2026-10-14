import type { LeadStatus } from "@/lib/status";

export interface LastNote {
  body: string;
  at: string;
}

export interface Lead {
  id: number;
  name: string;
  company: string | null;
  phone: string | null;
  status: LeadStatus;
  next_follow_up_at: string | null;
  follow_up_overdue: boolean;
  last_note: LastNote | null;
  created_at: string;
  updated_at: string;
}

export type EntryKind =
  | "note"
  | "lead_created"
  | "status_changed"
  | "follow_up_cleared"
  | "follow_up_set"
  | "details_updated";

export interface Entry {
  id: number;
  kind: EntryKind;
  body: string;
  follow_up_at: string | null;
  created_at: string;
}

export interface LeadList {
  pinned: Lead[];
  leads: Lead[];
}

/** Every mutation returns the updated lead and the timeline entry it wrote (null for a no-op). */
export interface Mutation {
  lead: Lead;
  entry: Entry | null;
}

export interface FieldError {
  field: string;
  message: string;
}

export interface NewLead {
  name: string;
  company?: string;
  phone?: string;
}

export interface NewDiscussion {
  note: string;
  follow_up_at?: string;
}

export interface LeadDetails {
  name?: string;
  company?: string;
  phone?: string;
}

export interface ListQuery {
  status?: LeadStatus;
  q?: string;
  tz: string;
}

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

/** A failed request, with a message that is safe to show to the user. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: FieldError[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Field-level messages keyed by field name, for showing under form inputs. */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries(this.details.map((d) => [d.field, d.message]));
  }
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function friendlyMessage(status: number, code: string, serverMessage: string | undefined): string {
  if (status === 422 && serverMessage) return serverMessage; // validation messages are user-facing
  if (code === "lead_not_found") return "This lead no longer exists.";
  if (status >= 500) return "Something went wrong on our side. Please try again.";
  return serverMessage ?? "That didn't work. Please try again.";
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      // Only send a JSON content type with a body, so plain GETs need no CORS preflight.
      headers: init.body ? { "Content-Type": "application/json", ...init.headers } : init.headers,
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new ApiError(0, "network_error", "Can't reach LeadFlow right now. Check your connection and try again.");
  }
  if (response.ok) return (await response.json()) as T;

  let body: { error?: { code?: string; message?: string; details?: FieldError[] } } = {};
  try {
    body = await response.json();
  } catch {
    // Non-JSON error body (e.g. a proxy page); fall back to a generic message.
  }
  const code = body.error?.code ?? "http_error";
  throw new ApiError(response.status, code, friendlyMessage(response.status, code, body.error?.message), body.error?.details ?? []);
}

function json(body: unknown): string {
  return JSON.stringify(body);
}

export const api = {
  listLeads(query: ListQuery, signal?: AbortSignal): Promise<LeadList> {
    const params = new URLSearchParams({ tz: query.tz });
    if (query.status) params.set("status", query.status);
    if (query.q?.trim()) params.set("q", query.q.trim());
    return request(`/leads?${params}`, { signal });
  },
  getLead(id: number, signal?: AbortSignal): Promise<Lead> {
    return request(`/leads/${id}`, { signal });
  },
  timeline(id: number, signal?: AbortSignal): Promise<Entry[]> {
    return request(`/leads/${id}/timeline`, { signal });
  },
  createLead(lead: NewLead): Promise<Mutation> {
    return request("/leads", { method: "POST", body: json(lead) });
  },
  updateStatus(id: number, status: LeadStatus): Promise<Mutation> {
    return request(`/leads/${id}`, { method: "PATCH", body: json({ status }) });
  },
  addDiscussion(id: number, discussion: NewDiscussion): Promise<Mutation> {
    return request(`/leads/${id}/discussions`, { method: "POST", body: json(discussion) });
  },
  clearFollowUp(id: number): Promise<Mutation> {
    return request(`/leads/${id}/follow-up`, { method: "DELETE" });
  },
  setFollowUp(id: number, followUpAt: string): Promise<Mutation> {
    return request(`/leads/${id}/follow-up`, { method: "PUT", body: json({ follow_up_at: followUpAt }) });
  },
  updateDetails(id: number, details: LeadDetails): Promise<Mutation> {
    return request(`/leads/${id}/details`, { method: "PATCH", body: json(details) });
  },
};
