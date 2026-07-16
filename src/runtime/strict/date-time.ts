const dateTimePattern = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/;

const leapYear = (year: number) => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

const daysInMonth = (year: number, month: number) => [
  31, leapYear(year) ? 29 : 28, 31, 30, 31, 30,
  31, 31, 30, 31, 30, 31,
][month - 1];

export const isRfc3339DateTime = (input: unknown): input is string => {
  if (typeof input !== "string") return false;
  const match = dateTimePattern.exec(input);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  return month >= 1
    && month <= 12
    && day >= 1
    && day <= daysInMonth(year, month)
    && Number(hourText) <= 23
    && Number(minuteText) <= 59
    && Number(secondText) <= 60
    && (offsetHourText === undefined
      || (Number(offsetHourText) <= 23 && Number(offsetMinuteText) <= 59));
};
