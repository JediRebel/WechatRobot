// src/utils/helpers.ts
import { DateTime } from 'luxon';

/**
 * 判断文本是否包含任意关键词
 */
export function containsKeyword(text: string, keywords: string[]): boolean {
  const lowerText = text.toLowerCase();
  return keywords.some(keyword => lowerText.includes(keyword.toLowerCase()));
}

/** 
 * 内部统一：Atlantic（America/Moncton）07:00 → 次日 07:00 时间段
 * 说明：保留旧函数名 getAtlanticTimeRange 以确保向后兼容
 */
function getAtlanticWindow(): { start: DateTime; end: DateTime } {
  const now = DateTime.now().setZone('America/Moncton');
  const sevenAMToday = now.set({ hour: 7, minute: 0, second: 0, millisecond: 0 });
  const start = now < sevenAMToday ? sevenAMToday.minus({ days: 1 }) : sevenAMToday;
  const end = start.plus({ days: 1 });
  return { start, end };
}

/**
 * （向后兼容的名称）获取 Atlantic 时区的 07:00 - 次日 07:00 时间段
 * 注：之前文档写 06:00，这里已改为 07:00，但函数名不变，避免破坏现有引用。
 */
export function getAtlanticTimeRange(): { start: DateTime; end: DateTime } {
  return getAtlanticWindow();
}

/**
 * 判断某个 ISO 时间是否在有效时间范围内（Atlantic 07:00~次日07:00）
 */
export function isWithinTimeWindow(isoDateStr: string): boolean {
  const date = DateTime.fromISO(isoDateStr, { zone: 'America/Moncton' });
  const { start, end } = getAtlanticWindow();
  return date.isValid && date >= start && date < end;
}

/**
 * 直接用 JS Date 判断是否在有效时间范围内（Atlantic 07:00~次日07:00）
 * 爬虫里拿到的是 Date 对象时，推荐使用这个函数。
 */
export function isWithinAtlanticWindowByDate(date: Date): boolean {
  const dt = DateTime.fromJSDate(date).setZone('America/Moncton');
  const { start, end } = getAtlanticWindow();
  return dt.isValid && dt >= start && dt < end;
}

/**
 * 格式化时间为 yyyy-MM-dd HH:mm（Atlantic 时区）
 */
export function formatDateTime(isoDateStr: string): string {
  return DateTime.fromISO(isoDateStr, { zone: 'America/Moncton' })
    .toFormat('yyyy-MM-dd HH:mm');
}

/**
 * 规范化文本用于后期去重（小写、去标点、合并空格）
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^一-龥\w\s]|_/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const LEVEL_1 = ['saint john', 'rothesay', 'quispamsis'];
const LEVEL_2 = ['new brunswick', 'fredericton', 'moncton', 'nb'];

/**
 * 根据标题内容判断区域优先级（用于排序）
 */
export function getRegionPriority(title: string): number {
  const lowerTitle = title.toLowerCase();
  if (LEVEL_1.some(k => lowerTitle.includes(k))) return 1;
  if (LEVEL_2.some(k => lowerTitle.includes(k))) return 2;
  return 3;
}

/**
 * 截断文本为指定长度（用于摘要场景）
 */
export function truncateText(text: string, maxLength = 120): string {
  return text.length <= maxLength ? text : text.slice(0, maxLength) + '...';
}