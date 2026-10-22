const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const number = new Intl.NumberFormat("en-US");
const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const date = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

export const formatCents = (cents: number) => money.format(cents / 100);
export const formatNumber = (value: number) => number.format(value);
/** Timestamps are shown in UTC so the same row reads the same for every user and in every screenshot. */
export const formatDateTime = (iso: string) => `${dateTime.format(new Date(iso))} UTC`;
export const formatDate = (iso: string) => date.format(new Date(iso));

export const statusLabel = (status: string) => status.replace("_", " ");
