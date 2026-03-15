

export const parseUzbekistanDate = (dateString: string): Date => {
  const [year, month, day] = dateString.split('-').map(Number);
  
  const utcDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  utcDate.setUTCHours(utcDate.getUTCHours() - 5);
  
  return utcDate;
};

export const getUzbekistanDayStart = (dateString: string): Date => {
  return parseUzbekistanDate(dateString);
};

export const getUzbekistanDayEnd = (dateString: string): Date => {
  const [year, month, day] = dateString.split('-').map(Number);
  
  const utcDate = new Date(Date.UTC(year, month - 1, day, 18, 59, 59, 999));
  
  return utcDate;
};

export const getCurrentUzbekistanTime = (): Date => {
  const now = new Date();
  
  const uzbekistanTime = new Date(now.getTime() + (5 * 60 * 60 * 1000));
  
  return uzbekistanTime;
};

export const formatUzbekistanDate = (date: Date): string => {
  const uzbekistanDate = new Date(date.getTime() + (5 * 60 * 60 * 1000));
  
  const day = uzbekistanDate.getUTCDate().toString().padStart(2, '0');
  const month = (uzbekistanDate.getUTCMonth() + 1).toString().padStart(2, '0');
  const year = uzbekistanDate.getUTCFullYear();
  
  return `${day}.${month}.${year}`;
};

export const UZBEKISTAN_TIMEZONE_OFFSET = 5;
export const UZBEKISTAN_TIMEZONE_NAME = 'Asia/Tashkent';
