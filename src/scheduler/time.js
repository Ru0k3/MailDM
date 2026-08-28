function partsFor(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day), hour: Number(values.hour), minute: Number(values.minute) };
}

export function localScheduleParts(date, timeZone) {
  const local = partsFor(date, timeZone);
  return { ...local, localDate: `${String(local.year).padStart(4, '0')}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`, minuteOfDay: local.hour * 60 + local.minute };
}

export function isDueAt({ now, summaryTime, timeZone, windowMinutes = 10 }) {
  if (!summaryTime || !timeZone) return false;
  const match = /^(\d{2}):(\d{2})$/.exec(summaryTime);
  if (!match) return false;
  const target = Number(match[1]) * 60 + Number(match[2]);
  const local = localScheduleParts(now, timeZone);
  return local.minuteOfDay >= target && local.minuteOfDay < target + windowMinutes;
}
