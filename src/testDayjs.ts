import dayjs from "dayjs";

// 获取当前时间
const now = dayjs();
console.log("当前时间:", now.format("YYYY-MM-DD HH:mm:ss"));

// 获取明天的时间
const tomorrow = now.add(1, "day");
console.log("明天:", tomorrow.format("YYYY-MM-DD"));

// 格式化日期字符串
const parsed = dayjs("2025-08-15 10:30", "YYYY-MM-DD HH:mm");
console.log("解析的时间:", parsed.format("YYYY-MM-DD HH:mm"));

// 计算两个日期之间的天数
const start = dayjs("2025-08-01");
const end = dayjs("2025-08-15");
console.log("相差天数:", end.diff(start, "day"));