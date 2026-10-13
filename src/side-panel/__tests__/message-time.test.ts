import { describe, expect, it } from 'vitest';
import { messageTime } from '../message-time';

const now = new Date(2026, 9, 9, 11, 0).getTime();
const minutes = (n: number) => now - n * 60_000;

describe('the time under a message', () => {
  it('is relative within a day', () => {
    expect(messageTime(now - 20_000, now, 'en')).toBe('now');
    expect(messageTime(minutes(1), now, 'en')).toBe('1 minute ago');
    expect(messageTime(minutes(5), now, 'en')).toBe('5 minutes ago');
    expect(messageTime(minutes(3 * 60 + 10), now, 'en')).toBe('3 hours ago');
  });

  it('gives the date and time after a day, with the year only for another year', () => {
    expect(messageTime(new Date(2026, 9, 7, 9, 5).getTime(), now, 'en')).toMatch(/^Oct 7, 9:05\sAM$/);
    expect(messageTime(new Date(2025, 11, 30, 9, 5).getTime(), now, 'en')).toMatch(/2025/);
  });

  it('follows the UI language', () => {
    expect(messageTime(minutes(5), now, 'zh_CN')).toBe('5分钟前');
    expect(messageTime(minutes(5), now, 'zh_TW')).toBe('5 分鐘前');
  });

  it('never says a message is from the future', () => {
    expect(messageTime(now + 5_000, now, 'en')).toBe('now');
  });
});
