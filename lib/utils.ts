import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates UUID format to avoid unnecessary DB calls for malformed IDs. */
export function isValidUuid(id: string | undefined): id is string {
  return typeof id === "string" && id.length > 0 && UUID_REGEX.test(id);
}
